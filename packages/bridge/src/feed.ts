import { AnswerSchema, InstructionTextSchema, SessionNotifyChangeSchema, SessionWaitChangeSchema, SettingChangeSchema, type BridgeMessage, type ConsoleMessage } from "@companion/protocol";
import { buildView } from "./view.ts";
import { buildText } from "./reader.ts";
import type { BridgeStore } from "./store.ts";
import type { FaceController } from "./face.ts";

type ViewMessage = Extract<BridgeMessage, { t: "view" }>;

/** Cuenta las fuentes de consola (TCP autenticada + simuladores) y refleja `total > 0` en el store. */
export class ConsoleCounter {
  private n = 0;
  private d = 0;

  constructor(private readonly store: BridgeStore) {}

  get count(): number {
    return this.n;
  }

  /** Consolas reales (TCP autenticadas) conectadas; no incluye simuladores. */
  get devices(): number {
    return this.d;
  }

  /** Registra una fuente ("simulator" por defecto); devuelve su función de liberación (idempotente). */
  acquire(source: "device" | "simulator" = "simulator"): () => void {
    this.n++;
    if (source === "device") this.d++;
    this.store.setConsoleConnected(true);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.n--;
      if (source === "device") this.d--;
      this.store.setConsoleConnected(this.n > 0);
    };
  }
}

/** Difunde la vista a los suscriptores en cada "change", agrupando los cambios de un mismo instante. */
export class ViewFeed {
  private rev = 0;
  private handle: NodeJS.Immediate | null = null;
  private readonly subs = new Set<(m: ViewMessage) => void>();
  private readonly onChange = () => {
    if (this.handle !== null || this.subs.size === 0) return;
    this.handle = setImmediate(() => {
      this.handle = null;
      this.rev++;
      const msg = this.snapshot();
      for (const fn of [...this.subs]) fn(msg);
    });
  };

  constructor(
    private readonly store: BridgeStore,
    private readonly face: FaceController,
  ) {
    store.on("change", this.onChange);
    face.on("change", this.onChange);
  }

  /** Vista actual con el `rev` vigente (para enviar al conectarse). */
  snapshot(): ViewMessage {
    return { t: "view", rev: this.rev, view: buildView(this.store, this.face) };
  }

  subscribe(fn: (m: ViewMessage) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  close(): void {
    this.store.off("change", this.onChange);
    this.face.off("change", this.onChange);
    if (this.handle !== null) clearImmediate(this.handle);
    this.handle = null;
    this.subs.clear();
  }
}

/** Aplica un mensaje de la consola. Devuelve la respuesta que solo debe recibir esa consola (hoy: `text` para `read`). */
export function applyConsoleMessage(store: BridgeStore, msg: ConsoleMessage, log: (m: string) => void = () => {}): BridgeMessage | undefined {
  switch (msg.t) {
    case "decision":
      store.decide(msg.requestId, msg.decision);
      break;
    case "focus":
      store.focus(msg.sessionId);
      break;
    case "skip":
      store.skip();
      break;
    case "mode":
      store.setMode(msg.mode);
      break;
    case "read":
      return buildText(store, msg.sessionId, msg.mode ?? "full");
    case "ack":
      // "Visto": solo se retira la tarjeta del puente; al agente no se le manda nada. Un id desconocido (ya retirada) se ignora.
      if (!store.ackNotice(msg.id)) log(`ack ignorado: aviso desconocido ${JSON.stringify(msg.id).slice(0, 60)}`);
      break;
    case "skipNotice":
      store.skipNotice();
      break;
    case "answer": {
      // un answer inválido (forma, índices o texto que no cuadran con las preguntas) se ignora y se registra; la pregunta sigue esperando
      const a = AnswerSchema.safeParse({ requestId: msg.requestId, ...(msg.pc !== undefined ? { pc: msg.pc } : {}), ...(msg.answers !== undefined ? { answers: msg.answers } : {}) });
      if (!a.success || !store.answerQuestion(a.data)) log(`respuesta ignorada: ${JSON.stringify(msg.requestId).slice(0, 60)}`);
      break;
    }
    case "instruct": {
      // texto vacío, largo o con controles, o sesión desconocida / con la cola llena: se ignora y se registra
      const t = InstructionTextSchema.safeParse(msg.text);
      const r = t.success ? store.enqueueInstruction(msg.sessionId, t.data.trim()) : "invalid";
      if (r === "unknown" || r === "full" || r === "invalid") log(`instrucción ignorada (${r}): ${JSON.stringify(msg.sessionId).slice(0, 60)}`);
      break;
    }
    case "instructClear":
      store.clearInstructions(msg.sessionId);
      break;
    case "release":
      if (!store.releaseInstruction(msg.requestId)) log(`release ignorado: ${JSON.stringify(msg.requestId).slice(0, 60)}`);
      break;
    case "hold":
      break; // solo le importa al servidor de la consola: no corta la conexión por silencio (ver console-server)
    case "setting": {
      if (msg.key === "sessionNotify") {
        // modo de aviso de una sesión: sesión o modo inválidos se ignoran y se registran
        const c = SessionNotifyChangeSchema.safeParse({ sessionId: msg.sessionId, value: msg.value });
        if (!c.success || !store.setSessionNotify(c.data.sessionId, c.data.value)) {
          log(`ajuste ignorado: sessionNotify ${JSON.stringify(msg.sessionId ?? null)?.slice(0, 60)} = ${JSON.stringify(msg.value).slice(0, 60)}`);
        }
        break;
      }
      if (msg.key === "sessionWait") {
        const c = SessionWaitChangeSchema.safeParse({ sessionId: msg.sessionId, value: msg.value });
        if (!c.success || !store.setSessionWait(c.data.sessionId, c.data.value)) {
          log(`ajuste ignorado: sessionWait ${JSON.stringify(msg.sessionId ?? null)?.slice(0, 60)} = ${JSON.stringify(msg.value).slice(0, 60)}`);
        }
        break;
      }
      // una clave desconocida o un valor inválido se ignora y se registra: nunca tumba la conexión
      const change = SettingChangeSchema.safeParse({ key: msg.key, value: msg.value });
      if (change.success) store.setSetting(change.data);
      else log(`ajuste ignorado: ${JSON.stringify(msg.key).slice(0, 60)} = ${JSON.stringify(msg.value).slice(0, 60)}`);
      break;
    }
  }
  return undefined;
}

import { EventEmitter } from "node:events";
import { MAX_QUESTION_LINES, MAX_TEXT, type AgentKind, type FaceView } from "@companion/protocol";
import type { BridgeStore, StoredSession, StoreNotice } from "./store.ts";
import { AGENT_NAMES, summarize } from "./view.ts";
import { clip, wrapLines } from "./text.ts";

export const NOTICE_MS = 5_000;
export const ROTATE_MS = 6_000;

export interface FaceOptions {
  /** Duración de un aviso. Por defecto 5 000 ms. */
  noticeMs?: number;
  /** Cada cuánto rota la cara ambiente entre las sesiones que trabajan. Por defecto 6 000 ms. */
  rotateMs?: number;
  /** Reloj (ms). Por defecto el del store. */
  now?: () => number;
}

const INFORMATIVE: ReadonlySet<StoreNotice["type"]> = new Set(["working", "done", "error"]);

interface ActiveNotice {
  notice: StoreNotice;
  until: number;
}

/** "<nombre> · <detalle>" en una línea de 38: lo que sobra del detalle se corta, el nombre se conserva. */
function nameAndDetail(name: string, detail: string): string {
  if (!detail) return clip(name);
  const budget = MAX_TEXT - name.length - 3;
  return budget >= 8 ? `${name} · ${clip(detail, budget)}` : clip(`${name} · ${detail}`);
}

/**
 * Decide qué dice la cara; los clientes solo la dibujan. Prioridad:
 * 1. aviso reciente (5 s) — pero los avisos informativos (empezó, terminó, error) no tapan una pregunta pendiente,
 * 2. permisos pendientes, 3. una sesión que espera tu respuesta (la pregunta en varias líneas),
 * 4. ambiente (sesiones que trabajan, rotando, o "Todo tranquilo").
 * Emite `"change"` solo cuando la cara cambia de verdad.
 */
export class FaceController extends EventEmitter {
  private notice: ActiveNotice | null = null;
  private noticeTimer: NodeJS.Timeout | null = null;
  private rotation = 0;
  private rotateTimer: NodeJS.Timeout;
  private lastJson: string;
  private lastPending: number;
  private readonly noticeMs: number;
  private readonly now: () => number;

  private readonly onNotice = (n: StoreNotice) => {
    this.notice = { notice: n, until: this.now() + this.noticeMs };
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.noticeTimer = null;
      this.notice = null;
      this.refresh();
    }, this.noticeMs);
    this.noticeTimer.unref();
    this.refresh();
  };
  private readonly onChange = () => {
    // una solicitud nueva pasa por delante de un aviso que aún no venció (como en el prototipo)
    const pending = this.store.pendingCount;
    if (pending > this.lastPending) this.notice = null;
    this.lastPending = pending;
    this.refresh();
  };

  constructor(private readonly store: BridgeStore, options: FaceOptions = {}) {
    super();
    this.noticeMs = options.noticeMs ?? NOTICE_MS;
    this.now = options.now ?? (() => store.now());
    this.lastPending = store.pendingCount;
    this.lastJson = JSON.stringify(this.current);
    store.on("notice", this.onNotice);
    store.on("change", this.onChange);
    this.rotateTimer = setInterval(() => {
      this.rotation++;
      this.refresh();
    }, options.rotateMs ?? ROTATE_MS);
    this.rotateTimer.unref();
  }

  /** La cara de este instante. */
  get current(): FaceView {
    // una pregunta sin responder pesa más que los avisos informativos; los de permisos (decisión, retirado,
    // respondido en el PC) siguen pasando por delante porque son respuesta a algo que acaba de pasar con una tarjeta
    const informative = this.notice !== null && INFORMATIVE.has(this.notice.notice.type);
    const notice = informative && this.store.hasQuestion ? null : this.noticeFace();
    return notice ?? this.pendingFace() ?? this.questionFace() ?? this.ambientFace();
  }

  dispose(): void {
    clearInterval(this.rotateTimer);
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
    this.store.off("notice", this.onNotice);
    this.store.off("change", this.onChange);
    this.removeAllListeners();
  }

  private refresh(): void {
    const json = JSON.stringify(this.current);
    if (json === this.lastJson) return;
    this.lastJson = json;
    this.emit("change");
  }

  /** El agente está oculto en la configuración: no se menciona en la cara (sus permisos sí, ver pendingFace). */
  private isHidden(kind: AgentKind): boolean {
    return this.store.settings.hiddenAgents.includes(kind);
  }

  private noticeFace(): FaceView | null {
    const active = this.notice;
    if (!active || this.now() >= active.until) return null;
    const n = active.notice;
    const session = this.store.getSession(n.sessionId);
    if (!session) return null;
    // avisos informativos de un agente oculto: nada. Los de permisos (decisión, retirado, respondido en el PC) siguen.
    if (INFORMATIVE.has(n.type) && this.isHidden(session.kind)) return null;
    const agent = AGENT_NAMES[session.kind];
    const name = this.store.displayName(session.id);
    const kind = session.kind;
    switch (n.type) {
      case "working":
        return face(kind, "working", `${agent} empezó a trabajar`, nameAndDetail(name, session.activity));
      case "done":
        return face(kind, "done", `¡${agent} terminó!`, nameAndDetail(name, session.lastMessage || session.activity));
      case "error":
        return face(kind, "error", `Ups, ${agent} tuvo un error`, nameAndDetail(name, session.activity));
      case "answered_elsewhere":
        return face(kind, "working", "Respondido en el PC", `${agent} sigue en ${name}`);
      case "withdrawn":
        return face(kind, "working", "Permiso retirado", name);
      case "decision":
        return n.decision === "allow"
          ? face(kind, "done", "Permiso aprobado", `${agent} sigue en ${name}`)
          : face(kind, "working", "Permiso rechazado", `${agent} busca otra forma`);
    }
  }

  private pendingFace(): FaceView | null {
    const pending = this.store.pending;
    if (pending.length === 0) return null;
    const focused = this.store.focusedRequest ?? pending[0]!;
    const session = this.store.getSession(focused.sessionId);
    const kind = session?.kind ?? null;
    const agent = kind ? AGENT_NAMES[kind] : "Un agente";

    if (pending.length > 1 && this.store.mode === "manual") {
      const names = [...new Set(pending.map((p) => this.store.getSession(p.sessionId)).map((s) => (s ? AGENT_NAMES[s.kind] : "Agente")))];
      const allPermissions = pending.every((p) => p.kind === "permission");
      return face(kind, "ask", `${pending.length} ${allPermissions ? "permisos" : "solicitudes"} pendientes`, names.join(", "));
    }
    const name = session ? this.store.displayName(session.id) : "";
    if (focused.kind === "instruction") {
      // fin de turno retenido: la sesión espera lo que le escribas en la consola
      const title = pending.length > 1 ? `${agent} espera tu instrucción (${this.store.focusedPosition} de ${pending.length})` : `${agent} espera tu instrucción`;
      return face(kind, "ask", title, name);
    }
    if (focused.kind === "question") {
      // pregunta con alternativas retenida para la consola: como la pregunta de siempre, con su texto en varias líneas
      const first = (focused.questions?.[0]?.question) ?? "";
      const title = pending.length > 1 ? `${agent} te hace una pregunta (${this.store.focusedPosition} de ${pending.length})` : `${agent} te hace una pregunta`;
      return { kind, mood: "ask", lines: [clip(title), ...wrapLines(first, MAX_TEXT, MAX_QUESTION_LINES)] };
    }
    const suffix = pending.length > 1 ? ` (${this.store.focusedPosition} de ${pending.length})` : "";
    const summary = clip(summarize(focused.toolName, focused.toolInput), Number.MAX_SAFE_INTEGER);
    const budget = MAX_TEXT - name.length - 3;
    const second = !name ? clip(summary) : budget >= 8 ? `${clip(summary, budget)} · ${name}` : clip(`${summary} · ${name}`);
    return face(kind, "ask", `${agent} necesita permiso${suffix}`, second);
  }

  /** Una sesión espera tu respuesta (la más reciente): no es un permiso, no hay tarjeta. */
  private questionFace(): FaceView | null {
    let asking: StoredSession | undefined;
    for (const s of this.store.sessions) if (s.question !== "" && s.notify !== "silent" && !this.isHidden(s.kind) && (!asking || s.lastSeen >= asking.lastSeen)) asking = s;
    if (!asking) return null;
    const agent = AGENT_NAMES[asking.kind];
    const name = this.store.displayName(asking.id);
    const full = `${agent} espera tu respuesta · ${name}`;
    const first = full.length <= MAX_TEXT ? full : clip(`${agent} espera · ${name}`);
    return { kind: asking.kind, mood: "ask", lines: [first, ...wrapLines(asking.question, MAX_TEXT, MAX_QUESTION_LINES)] };
  }

  private ambientFace(): FaceView {
    const working = this.store.sessions.filter((s) => s.state === "working" && s.notify !== "silent" && !this.isHidden(s.kind));
    if (working.length === 0) return { kind: null, mood: "idle", lines: ["Todo tranquilo"] };
    const s = working[this.rotation % working.length]!;
    return face(s.kind, "working", `${AGENT_NAMES[s.kind]} en ${this.store.displayName(s.id)}`, s.activity);
  }
}

function face(kind: FaceView["kind"], mood: FaceView["mood"], first: string, second: string): FaceView {
  const lines = [clip(first)];
  const next = clip(second);
  if (next) lines.push(next);
  return { kind, mood, lines };
}

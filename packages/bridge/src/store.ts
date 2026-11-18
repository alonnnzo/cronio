import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  MAX_NOTICE_LINES,
  MAX_TEXT,
  type AgentKind,
  type AgentState,
  type ChimeKind,
  type NoticeKind,
  type InstructWait,
  type NotifyMode,
  type PermissionMode,
  type Answer,
  type SettingChange,
  MAX_INSTRUCTIONS,
} from "@companion/protocol";
import type { EventLog } from "./events.ts";
import { DEFAULT_SETTINGS, applyChange, loadSettings, saveSettings, type Settings } from "./settings.ts";
import type { PermissionSuggestion } from "./suggestions.ts";
import { MAX_REMEMBERED_PROJECTS, loadProjectModes, loadWaitProjects, passes, saveProjectModes, saveWaitProjects, type AttentionEvent } from "./notify.ts";
import { renderPlain } from "./plaintext.ts";
import { buildAnswers, type QuestionSpec } from "./questions.ts";
import { clip, wrapLines } from "./text.ts";

/** `allow_always`: aprobar y aplicar las sugerencias de permisos de la solicitud (se resuelve solo si las tenía). */
export type Decision = "allow" | "allow_always" | "deny" | "ask";

export interface StoredSession {
  id: string;
  kind: AgentKind;
  project: string;
  model: string;
  /** Título que le puso el agente; vacío si no tiene. */
  title: string;
  state: AgentState;
  activity: string;
  lastMessage: string;
  /** Pregunta con la que el agente espera tu respuesta (AskUserQuestion o fin de turno con pregunta); vacío = ninguna. La sesión está en `ask`. */
  question: string;
  /** Pregunta anunciada por el fin de turno de la app de escritorio; pasa a `question` cuando llega el `Stop`. */
  stopQuestion: string;
  /** Último instante (ms, reloj del store) en que llegó algo de esta sesión. */
  lastSeen: number;
  /** Instante (ms, reloj del store) del último cambio de `state` (o de la creación de la sesión). La vista lo manda como `sinceS`. */
  stateSince: number;
  /** Orden de llegada. */
  order: number;
  /** Nombre mostrado, único entre las sesiones vivas del mismo agente. Se asigna una vez y se conserva. */
  shownName: string;
  /** Base (título o proyecto, sin recortar) con la que se calculó `shownName`; si cambia, se recalcula. */
  nameBase: string;
  /** Modo de aviso de la sesión (Fase 2b, paso 3): el recordado del proyecto o, si no hay, el ajuste `notifyDefault`. */
  notify: NotifyMode;
  /** Ya se avisó del fin de turno / pregunta / error de este tramo: un `idle_prompt` posterior no vuelve a avisar. Vuelve a false al trabajar. */
  notified: boolean;
  /** "Esperar mi respuesta" (paso 6): al terminar el turno sin instrucciones en cola, el `Stop` se retiene para la consola. Recordado por proyecto. */
  waitForMe: boolean;
}

/** Tarjeta de aviso con "Visto": una por sesión como máximo (la más nueva reemplaza a la anterior). */
export interface NoticeCard {
  id: string;
  sessionId: string;
  kind: NoticeKind;
  /** Hecho que la originó (para volver a filtrarla si cambia el modo de la sesión). */
  ev: AttentionEvent;
  title: string;
  /** Hasta MAX_NOTICE_LINES líneas de MAX_TEXT, cortadas al crearla. */
  lines: string[];
}

const NOTICE_TITLES: Record<NoticeKind, string> = {
  done: "Terminó",
  ask: "Espera tu respuesta",
  error: "Error",
  idle: "Esperando instrucciones",
};

/** Resultado de un `Stop` (paso 6): entregar una instrucción (`block` en el hook) o dejar terminar. */
export type StopOutcome = { decision: "instruct"; text: string } | { decision: "none" };

/** Resultado de una solicitud de pregunta (AskUserQuestion): las respuestas por texto de pregunta, o dejarla al PC. */
export type QuestionOutcome = { decision: "answer"; answers: Record<string, string> } | { decision: "ask" };

export interface PendingRequest {
  id: string;
  /**
   * `permission` (la tarjeta de siempre), `question` (AskUserQuestion: se responde con `answerQuestion`, nunca con `decide`) o
   * `instruction` (paso 6: un `Stop` retenido; se responde con `instruct` o `releaseInstruction`, nunca con `decide`).
   */
  kind: "permission" | "question" | "instruction";
  sessionId: string;
  toolName: string;
  toolInput: unknown;
  /** Instante (ms, reloj del store) en que vence el plazo; 0 = sin límite. */
  deadline: number;
  /** Actualizaciones de permisos que el agente sugiere para "no volver a preguntar"; vacío = la opción no se ofrece. */
  suggestions: PermissionSuggestion[];
  /** Solo en las de tipo pregunta: las preguntas con sus etiquetas completas (la consola responde con índices). */
  questions?: QuestionSpec[];
}

/** Hechos que la cara convierte en un aviso de 5 s. Se emiten con el evento `"notice"`. */
export type StoreNotice =
  | { type: "working" | "done" | "error"; sessionId: string }
  | { type: "decision"; sessionId: string; decision: "allow" | "deny" }
  /** La solicitud se resolvió fuera de la consola (terminal del agente): se retiró sin decisión. */
  | { type: "answered_elsewhere"; sessionId: string }
  /** La conexión del hook se cerró (p. ej. el usuario interrumpió al agente): se retiró sin saber quién respondió. */
  | { type: "withdrawn"; sessionId: string };

export interface BridgeStoreOptions {
  /** Plazo de una solicitud antes de devolver `ask`. Por defecto 0 = sin límite (solo se retira al responder, al cerrarse el hook o al resolverse en la terminal). */
  requestTimeoutMs?: number;
  /** Tiempo que `done`/`error` tardan en volver a `idle`. Por defecto 3 000 ms. */
  resetAfterMs?: number;
  events?: EventLog;
  /** Reloj (ms). Por defecto `Date.now`. */
  now?: () => number;
  /** Cada cuánto se barren las sesiones abandonadas. Por defecto 60 000 ms. */
  sweepIntervalMs?: number;
  /** Antigüedad (sin eventos) a partir de la cual una sesión sin permiso pendiente se retira. Por defecto 30 min. */
  sessionMaxAgeMs?: number;
  /** Ruta de `settings.json`. Si falta, el modo no se guarda en disco. */
  settingsPath?: string;
  /** Ruta de `notify-modes.json` (modo de aviso recordado por proyecto). Si falta, no se recuerda en disco. */
  notifyModesPath?: string;
  /** Ruta de `wait-projects.json` ("Esperar mi respuesta" recordado por proyecto, paso 6). Si falta, no se recuerda en disco. */
  waitProjectsPath?: string;
}

interface Internal extends PendingRequest {
  resolve: (d: Decision, answers?: Record<string, string>, text?: string) => void;
  timer: NodeJS.Timeout | null;
  cleanup?: () => void;
}

const INSTRUCT_ACTIVITY = "Espera tu instrucción";
const IDLE_ACTIVITY = "Esperando instrucciones";

/** Tope de sesiones vivas; al superarlo se retira la más antigua sin permiso pendiente. */
export const MAX_STORED_SESSIONS = 200;
const MAX_STORED_TEXT = 2000;
const store = (s: string): string => (s.length > MAX_STORED_TEXT ? s.slice(0, MAX_STORED_TEXT) : s);
/** Último mensaje del agente: se guarda más porque la consola lo lee entero a pedido (mensaje `read`, Fase 2b). */
export const MAX_STORED_MESSAGE = 8000;
const storeMessage = (s: string): string => (s.length > MAX_STORED_MESSAGE ? s.slice(0, MAX_STORED_MESSAGE) : s);

export class BridgeStore extends EventEmitter {
  private readonly sessionMap = new Map<string, StoredSession>();
  private readonly resetTimers = new Map<string, NodeJS.Timeout>();
  private queue: Internal[] = [];
  private consoleOn = false;
  private modeValue: PermissionMode = "queue";
  /** Preferencias de la consola (menú de configuración); el modo vive aparte en modeValue. */
  private prefs: Settings = { ...DEFAULT_SETTINGS, hiddenAgents: [], quickCommands: DEFAULT_SETTINGS.quickCommands.map((c) => ({ ...c })) };
  /** Sesión que la consola tiene abierta (mensaje `focus`). */
  private focusSession: string | null = null;
  /** Solicitud a la que `skip` movió el enfoque. */
  private skipTarget: string | null = null;
  private seq = 0;
  /** Tarjetas de aviso con "Visto", de la más antigua a la más reciente. */
  private noticeCards: NoticeCard[] = [];
  /** Tarjeta de aviso a la que `skipNotice` movió el enfoque. */
  private noticeTarget: string | null = null;
  private chimeSeq = 0;
  private chime: { kind: ChimeKind; seq: number } | null = null;
  /** Modo de aviso elegido en la consola por proyecto (nombre de carpeta). */
  private projectModes = new Map<string, NotifyMode>();
  /** Proyectos con "Esperar mi respuesta" activo. */
  private waitProjects = new Set<string>();
  /** Instrucciones en cola por sesión (en memoria: se pierden al reiniciar el puente), para el próximo `Stop`. */
  private instructionQueue = new Map<string, string[]>();
  /** Instante en que se entregó la última instrucción de cada sesión (reloj del store): el `Stop` de estado que llega justo después no la marca "terminada". */
  private deliveredAt = new Map<string, number>();
  private sweepTimer: NodeJS.Timeout | null = null;
  readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly resetMs: number;
  private readonly maxAgeMs: number;
  private readonly events: EventLog | undefined;
  private readonly settingsPath: string | undefined;
  private readonly notifyModesPath: string | undefined;
  private readonly waitProjectsPath: string | undefined;

  constructor(options: BridgeStoreOptions = {}) {
    super();
    this.timeoutMs = Math.max(0, options.requestTimeoutMs ?? 0);
    this.resetMs = options.resetAfterMs ?? 3_000;
    this.maxAgeMs = options.sessionMaxAgeMs ?? 30 * 60_000;
    this.events = options.events;
    this.now = options.now ?? Date.now;
    this.settingsPath = options.settingsPath;
    if (this.settingsPath) {
      this.prefs = loadSettings(this.settingsPath);
      this.modeValue = this.prefs.mode;
    }
    this.notifyModesPath = options.notifyModesPath;
    if (this.notifyModesPath) this.projectModes = loadProjectModes(this.notifyModesPath);
    this.waitProjectsPath = options.waitProjectsPath;
    if (this.waitProjectsPath) this.waitProjects = loadWaitProjects(this.waitProjectsPath);
    this.sweepTimer = setInterval(() => this.sweep(), options.sweepIntervalMs ?? 60_000);
    this.sweepTimer.unref();
  }

  /** Sesiones en orden de llegada. */
  get sessions(): StoredSession[] {
    return [...this.sessionMap.values()];
  }

  getSession(id: string): StoredSession | undefined {
    return this.sessionMap.get(id);
  }

  get consoleConnected(): boolean {
    return this.consoleOn;
  }

  get mode(): PermissionMode {
    return this.modeValue;
  }

  /** Sesión abierta en la consola, o null. */
  get focusedSessionId(): string | null {
    return this.focusSession;
  }

  /** Solicitudes pendientes, de la más antigua a la más reciente. */
  get pending(): PendingRequest[] {
    return this.queue.map(publicOf);
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  hasPending(sessionId: string): boolean {
    return this.queue.some((q) => q.sessionId === sessionId);
  }

  /** ¿La sesión se puede retirar sola? No si tiene una solicitud pendiente ni instrucciones en cola (se perderían). */
  private retenida(sessionId: string): boolean {
    return this.hasPending(sessionId) || (this.instructionQueue.get(sessionId)?.length ?? 0) > 0;
  }

  /**
   * Solicitud enfocada (la que va en `view.request`), o null.
   * - Si la consola tiene abierta una sesión con solicitud pendiente, la más antigua de esa sesión.
   * - Modo `manual`: si no, nada.
   * - Modo `queue`: la elegida con `skip` si sigue pendiente; si no, la más antigua.
   */
  get focusedRequest(): PendingRequest | null {
    const r = this.focusedInternal();
    return r ? publicOf(r) : null;
  }

  /** Lugar (desde 1) de la solicitud enfocada en la cola, por antigüedad; 0 si no hay enfocada. */
  get focusedPosition(): number {
    const r = this.focusedInternal();
    return r ? this.queue.indexOf(r) + 1 : 0;
  }

  /** Nombre mostrado: el título; si no hay, el proyecto. Único entre las sesiones vivas del mismo agente (se numera). */
  displayName(sessionId: string): string {
    return this.sessionMap.get(sessionId)?.shownName ?? "";
  }

  /** Asigna un nombre libre entre las demás sesiones del mismo agente, comparando el texto final ya recortado. */
  private assignName(s: StoredSession): void {
    s.nameBase = baseName(s);
    const taken = new Set<string>();
    for (const o of this.sessionMap.values()) if (o !== s && o.kind === s.kind) taken.add(o.shownName);
    let name = clip(s.nameBase);
    for (let n = 2; taken.has(name); n++) {
      const suffix = ` ${n}`;
      name = clip(s.nameBase, MAX_TEXT - suffix.length) + suffix;
    }
    s.shownName = name;
  }

  upsertSession(a: { sessionId: string; kind: AgentKind; project: string; model?: string; title?: string }): void {
    const existing = this.sessionMap.get(a.sessionId);
    if (existing) {
      const prevKind = existing.kind;
      existing.kind = a.kind;
      existing.project = store(a.project);
      if (a.model !== undefined) existing.model = store(a.model);
      if (a.title !== undefined) existing.title = store(a.title);
      this.seen(existing);
      if (existing.kind !== prevKind || baseName(existing) !== existing.nameBase) this.assignName(existing);
    } else {
      if (this.sessionMap.size >= MAX_STORED_SESSIONS && !this.evictOldest()) return; // todas con permiso pendiente: se rechaza la nueva
      const created: StoredSession = {
        id: a.sessionId,
        kind: a.kind,
        project: store(a.project),
        model: store(a.model ?? ""),
        title: store(a.title ?? ""),
        state: "idle",
        activity: "",
        lastMessage: "",
        question: "",
        stopQuestion: "",
        lastSeen: this.now(),
        stateSince: this.now(),
        order: ++this.seq,
        shownName: "",
        nameBase: "",
        notify: this.projectModes.get(store(a.project)) ?? this.prefs.notifyDefault,
        notified: false,
        waitForMe: this.waitProjects.has(store(a.project)),
      };
      this.assignName(created);
      this.sessionMap.set(a.sessionId, created);
      this.events?.log("agent_seen", { sessionId: a.sessionId, kind: a.kind, project: a.project });
    }
    this.emit("change");
  }

  /** Retira la sesión con `lastSeen` más antiguo sin permiso pendiente ni instrucciones en cola. Devuelve false si no había ninguna. */
  private evictOldest(): boolean {
    let victim: StoredSession | undefined;
    for (const s of this.sessionMap.values()) {
      if (this.retenida(s.id)) continue;
      if (!victim || s.lastSeen < victim.lastSeen) victim = s;
    }
    if (!victim) return false;
    this.removeSession(victim.id);
    return true;
  }

  setSessionState(sessionId: string, state: AgentState): void {
    const s = this.sessionMap.get(sessionId);
    if (!s) return;
    this.seen(s);
    // con un permiso o una pregunta pendiente la sesión sigue en `ask` hasta que se resuelva
    if (this.hasPending(sessionId) || (s.question !== "" && state !== "ask")) return;
    const prev = s.state;
    this.applyState(s, state);
    if (state !== prev) {
      if (state === "done" || state === "error") {
        if (passes(s.notify, state)) this.emit("notice", { type: state, sessionId } satisfies StoreNotice); // globo de la cara
        this.raise(s, state);
      } else if (state === "working" && prev !== "ask" && passes(s.notify, "working")) {
        this.emit("notice", { type: "working", sessionId } satisfies StoreNotice);
      }
    }
    this.emit("change");
  }

  /** La sesión espera instrucciones (`idle_prompt`): avisa, salvo que ya haya avisado de este mismo tramo (fin de turno, pregunta o error). */
  notifyIdle(sessionId: string): void {
    const s = this.sessionMap.get(sessionId);
    if (!s) return;
    this.seen(s);
    if (s.notified || s.question !== "" || this.hasPending(sessionId)) return;
    this.raise(s, "idle");
    this.emit("change");
  }

  setActivity(sessionId: string, text: string): void {
    const s = this.sessionMap.get(sessionId);
    if (!s) return;
    s.activity = store(text);
    this.seen(s);
    this.emit("change");
  }

  setLastMessage(sessionId: string, text: string): void {
    const s = this.sessionMap.get(sessionId);
    if (!s) return;
    s.lastMessage = storeMessage(text);
    this.seen(s);
    this.emit("change");
  }

  /** El agente espera tu respuesta: la sesión pasa a `ask` con esa pregunta (sin solicitud de permiso). */
  setQuestion(sessionId: string, text: string, source: "tool" | "stop" = "tool"): void {
    const s = this.sessionMap.get(sessionId);
    if (!s) return;
    this.seen(s);
    const before = s.question;
    s.question = store(text);
    s.stopQuestion = "";
    this.applyState(s, "ask");
    // `tool`: pregunta de AskUserQuestion; `stop`: el turno terminó con una pregunta ("te espera"). Una repetición no vuelve a avisar.
    if (s.question !== before) this.raise(s, source === "stop" ? "ask_stop" : "ask_tool");
    this.emit("change");
  }

  /** Recuerda la pregunta con la que terminará el turno (se activa con `Stop`); "" la olvida. */
  setStopQuestion(sessionId: string, text: string): void {
    const s = this.sessionMap.get(sessionId);
    if (!s) return;
    this.seen(s);
    s.stopQuestion = store(text);
  }

  /** Quita la pregunta pendiente y la anunciada. Si la sesión esperaba solo eso, vuelve a `working`. */
  clearQuestion(sessionId: string): void {
    const s = this.sessionMap.get(sessionId);
    if (!s) return;
    const had = s.question !== "";
    s.question = "";
    s.stopQuestion = "";
    if (had && s.state === "ask" && !this.hasPending(sessionId)) {
      this.applyState(s, "working");
      this.emit("change");
    }
  }

  /** ¿Alguna sesión espera una respuesta? */
  get hasQuestion(): boolean {
    // una sesión en silencio no pide atención (ni cara ni LED); sus permisos sí
    for (const s of this.sessionMap.values()) if (s.question !== "" && s.notify !== "silent") return true;
    return false;
  }

  /** Marca que llegó algo de la sesión (sin cambiar nada más). */
  touchSession(sessionId: string): void {
    const s = this.sessionMap.get(sessionId);
    if (s) this.seen(s);
  }

  removeSession(sessionId: string): void {
    if (!this.sessionMap.delete(sessionId)) return;
    this.clearReset(sessionId);
    this.dropNotice(sessionId);
    this.instructionQueue.delete(sessionId);
    this.deliveredAt.delete(sessionId);
    for (const r of this.queue.filter((q) => q.sessionId === sessionId)) this.settle(r, "ask", "session_removed");
    if (this.focusSession === sessionId) this.focusSession = null;
    this.emit("change");
  }

  /** Retira las sesiones sin eventos desde hace más de `sessionMaxAgeMs` y sin permiso pendiente ni instrucciones en cola. */
  sweep(): void {
    const limit = this.now() - this.maxAgeMs;
    for (const s of this.sessions) {
      if (s.lastSeen < limit && !this.retenida(s.id)) this.removeSession(s.id);
    }
  }

  setConsoleConnected(connected: boolean): void {
    if (this.consoleOn === connected) return;
    this.consoleOn = connected;
    this.events?.log(connected ? "console_connected" : "console_disconnected");
    if (!connected) {
      this.focusSession = null;
      this.skipTarget = null;
      for (const r of [...this.queue]) this.settle(r, "ask", "console_disconnected");
    }
    this.emit("change");
  }

  setMode(mode: PermissionMode): void {
    if (this.modeValue === mode) return;
    this.modeValue = mode;
    this.skipTarget = null;
    if (this.settingsPath) saveSettings(this.settingsPath, this.settings);
    this.emit("change");
  }

  /** Todas las preferencias vigentes (copia). */
  get settings(): Settings {
    return { ...this.prefs, mode: this.modeValue, hiddenAgents: [...this.prefs.hiddenAgents] };
  }

  /** Aplica un cambio de ajuste ya validado (menú de configuración de la consola). Guarda y avisa solo si cambió algo. */
  setSetting(change: SettingChange): void {
    const before = JSON.stringify(this.prefs);
    const prevWait = this.prefs.instructWaitMax;
    this.prefs = applyChange(this.settings, change);
    if (JSON.stringify(this.prefs) === before) return;
    if (this.settingsPath) saveSettings(this.settingsPath, this.settings);
    // sin "Visto" no hay tarjetas; un agente oculto no avisa
    const hidden = this.prefs.hiddenAgents;
    this.noticeCards = this.prefs.notifyAck
      ? this.noticeCards.filter((c) => {
          const k = this.sessionMap.get(c.sessionId)?.kind;
          return k !== undefined && !hidden.includes(k);
        })
      : [];
    this.fixNoticeTarget();
    // con las preguntas en la consola apagadas, las que esperan vuelven al PC (el hook no imprime nada)
    if (!this.prefs.questions) for (const r of this.queue.filter((q) => q.kind === "question")) this.settle(r, "ask", "questions_off");
    // una espera nueva dura lo que dice el ajuste: se rearman los plazos de las retenciones actuales
    if (this.prefs.instructWaitMax !== prevWait) for (const r of this.queue.filter((q) => q.kind === "instruction")) this.armInstructionTimer(r);
    this.emit("change");
  }

  // ---------- avisos (Fase 2b, paso 3) ----------

  /** Último aviso con sonido (`chime` de la vista); `seq` sube de uno en uno. */
  get lastChime(): { kind: ChimeKind; seq: number } | null {
    return this.chime;
  }

  /** Cambia el modo de aviso de una sesión y lo recuerda para el proyecto. Devuelve false si la sesión no existe. */
  setSessionNotify(sessionId: string, mode: NotifyMode): boolean {
    const s = this.sessionMap.get(sessionId);
    if (!s) return false;
    this.seen(s);
    s.notify = mode;
    this.projectModes.delete(s.project); // reinsertar: el más reciente queda al final
    this.projectModes.set(s.project, mode);
    while (this.projectModes.size > MAX_REMEMBERED_PROJECTS) this.projectModes.delete(this.projectModes.keys().next().value!);
    if (this.notifyModesPath) saveProjectModes(this.notifyModesPath, this.projectModes);
    // el aviso que el nuevo modo ya no dejaría pasar se retira
    this.noticeCards = this.noticeCards.filter((c) => c.sessionId !== sessionId || passes(mode, c.ev));
    this.fixNoticeTarget();
    this.emit("change");
    return true;
  }

  /** Modo recordado para un proyecto (pruebas). */
  rememberedMode(project: string): NotifyMode | undefined {
    return this.projectModes.get(project);
  }

  /**
   * Tarjeta de aviso que va en la vista, con su lugar en la cola. Nunca con un permiso pendiente (los permisos van
   * siempre primero), aunque en modo manual no haya tarjeta de permiso a la vista.
   */
  get currentNotice(): { card: NoticeCard; position: number; total: number } | null {
    if (this.queue.length > 0 || this.noticeCards.length === 0) return null;
    const card = this.noticeCards.find((c) => c.id === this.noticeTarget) ?? this.noticeCards[0]!;
    return { card, position: this.noticeCards.indexOf(card) + 1, total: this.noticeCards.length };
  }

  get noticeCount(): number {
    return this.noticeCards.length;
  }

  /** "Visto": retira la tarjeta. Solo es de la consola, no se le manda nada al agente. Devuelve false si el id no existe. */
  ackNotice(id: string): boolean {
    const card = this.noticeCards.find((c) => c.id === id);
    if (!card) return false;
    this.noticeCards = this.noticeCards.filter((c) => c !== card);
    this.fixNoticeTarget();
    this.events?.log("ack", { noticeId: id, sessionId: card.sessionId, kind: card.kind });
    this.emit("change");
    return true;
  }

  /** Pasa a la siguiente tarjeta de aviso (circular). No hace nada con un permiso pendiente o menos de dos avisos. */
  skipNotice(): void {
    if (this.queue.length > 0 || this.noticeCards.length < 2) return;
    const cur = this.currentNotice!.card;
    this.noticeTarget = this.noticeCards[(this.noticeCards.indexOf(cur) + 1) % this.noticeCards.length]!.id;
    this.emit("change");
  }

  private fixNoticeTarget(): void {
    if (this.noticeTarget !== null && !this.noticeCards.some((c) => c.id === this.noticeTarget)) this.noticeTarget = null;
  }

  private dropNotice(sessionId: string): void {
    if (!this.noticeCards.some((c) => c.sessionId === sessionId)) return;
    this.noticeCards = this.noticeCards.filter((c) => c.sessionId !== sessionId);
    this.fixNoticeTarget();
  }

  /**
   * Un hecho importante de la sesión: si el modo lo deja pasar, anota el sonido (`chime`, con `seq`) y, con "Visto"
   * activo, la tarjeta de aviso (la más nueva de la sesión reemplaza a la anterior). Un agente oculto no avisa.
   */
  private raise(s: StoredSession, ev: Exclude<AttentionEvent, "working">): void {
    if (this.prefs.hiddenAgents.includes(s.kind) || !passes(s.notify, ev)) return;
    const chime: ChimeKind = ev === "permission" ? "permission" : ev === "ask_tool" || ev === "ask_stop" ? "ask" : ev === "idle" ? "done" : ev;
    this.chime = { kind: chime, seq: ++this.chimeSeq };
    this.events?.log("notice", { sessionId: s.id, event: ev, chime, seq: this.chimeSeq });
    if (ev === "permission") return; // el permiso ya es una tarjeta con decisión
    s.notified = true;
    if (!this.prefs.notifyAck) return;
    const kind: NoticeKind = ev === "ask_tool" || ev === "ask_stop" ? "ask" : ev;
    const source = kind === "ask" ? s.question : kind === "error" ? s.activity : renderPlain(s.lastMessage, MAX_TEXT).join("\n");
    this.dropNotice(s.id);
    this.noticeCards.push({
      id: randomUUID(),
      sessionId: s.id,
      kind,
      ev,
      title: NOTICE_TITLES[kind],
      lines: wrapLines(source, MAX_TEXT, MAX_NOTICE_LINES),
    });
  }

  /** La consola abrió el detalle de una sesión (o lo cerró con null). Una sesión desconocida equivale a null. */
  focus(sessionId: string | null): void {
    const next = sessionId !== null && this.sessionMap.has(sessionId) ? sessionId : null;
    if (next === this.focusSession && this.skipTarget === null) return;
    this.focusSession = next;
    this.skipTarget = null;
    this.emit("change");
  }

  /** Modo `queue`: pasa el enfoque a la siguiente solicitud pendiente (circular) y suelta el enfoque de sesión. */
  skip(): void {
    if (this.modeValue !== "queue" || this.queue.length < 2) return;
    const cur = this.focusedInternal();
    const i = cur ? this.queue.indexOf(cur) : -1;
    this.skipTarget = this.queue[(i + 1) % this.queue.length]!.id;
    this.focusSession = null;
    this.emit("change");
  }

  requestPermission(req: {
    sessionId: string;
    toolName: string;
    toolInput: unknown;
    /** Sugerencias del agente ya validadas (`parseSuggestions`). */
    suggestions?: PermissionSuggestion[];
    signal?: AbortSignal;
  }): Promise<Decision> {
    if (!this.consoleOn || req.signal?.aborted) return Promise.resolve("ask");
    return new Promise<Decision>((resolve) => {
      const id = randomUUID();
      const item: Internal = {
        id,
        kind: "permission",
        sessionId: req.sessionId,
        toolName: req.toolName,
        toolInput: req.toolInput,
        suggestions: req.suggestions ?? [],
        deadline: this.timeoutMs > 0 ? this.now() + this.timeoutMs : 0,
        resolve,
        timer: null,
      };
      if (this.timeoutMs > 0) {
        item.timer = setTimeout(() => this.settle(item, "ask", "timeout"), this.timeoutMs);
        item.timer.unref();
      }
      if (req.signal) {
        const onAbort = () => this.settle(item, "ask", "aborted");
        req.signal.addEventListener("abort", onAbort, { once: true });
        item.cleanup = () => req.signal?.removeEventListener("abort", onAbort);
      }
      this.queue.push(item);
      this.events?.log("request", { requestId: id, sessionId: req.sessionId, toolName: req.toolName });
      const session = this.sessionMap.get(req.sessionId);
      if (session) {
        this.seen(session);
        this.dropNotice(session.id); // un permiso nuevo deja viejo el aviso anterior de la sesión
        this.applyState(session, "ask");
        this.raise(session, "permission");
      }
      this.emit("change");
    });
  }

  /** Aplica la decisión una sola vez a una solicitud pendiente (enfocada o no). Devuelve false si el id es desconocido o ya resuelto. */
  decide(requestId: string, decision: "allow" | "allow_always" | "deny"): boolean {
    const item = this.queue.find((q) => q.id === requestId);
    // una pregunta o una instrucción no se aprueban ni se rechazan: solo `answerQuestion` / `instruct` / `releaseInstruction` las resuelven
    if (!item || item.kind !== "permission") return false;
    // "no volver a preguntar" sin nada que aplicar es un "sí" a secas
    this.settle(item, decision === "allow_always" && item.suggestions.length === 0 ? "allow" : decision, "console");
    return true;
  }

  /**
   * Solicitud de pregunta (AskUserQuestion): entra en la misma cola que los permisos (mismo orden, enfoque y `pendingCount`) y
   * espera la respuesta de la consola. Sin consola, con el ajuste `questions` apagado o con la petición ya cancelada, devuelve
   * `ask` en el acto (la pregunta se responde en el PC). Se libera igual que un permiso: al desconectarse la consola, al
   * terminar la sesión o al resolverse en otra parte.
   */
  requestQuestion(req: { sessionId: string; toolInput: unknown; questions: QuestionSpec[]; signal?: AbortSignal }): Promise<QuestionOutcome> {
    if (!this.consoleOn || !this.prefs.questions || req.signal?.aborted) return Promise.resolve({ decision: "ask" });
    return new Promise<QuestionOutcome>((resolve) => {
      const id = randomUUID();
      const item: Internal = {
        id,
        kind: "question",
        sessionId: req.sessionId,
        toolName: "AskUserQuestion",
        toolInput: req.toolInput,
        suggestions: [],
        questions: req.questions,
        deadline: this.timeoutMs > 0 ? this.now() + this.timeoutMs : 0,
        resolve: (_d, answers) => resolve(answers ? { decision: "answer", answers } : { decision: "ask" }),
        timer: null,
      };
      if (this.timeoutMs > 0) {
        item.timer = setTimeout(() => this.settle(item, "ask", "timeout"), this.timeoutMs);
        item.timer.unref();
      }
      if (req.signal) {
        const onAbort = () => this.settle(item, "ask", "aborted");
        req.signal.addEventListener("abort", onAbort, { once: true });
        item.cleanup = () => req.signal?.removeEventListener("abort", onAbort);
      }
      this.queue.push(item);
      this.events?.log("request", { requestId: id, sessionId: req.sessionId, toolName: "AskUserQuestion" });
      const session = this.sessionMap.get(req.sessionId);
      if (session) {
        this.seen(session);
        this.dropNotice(session.id);
        this.applyState(session, "ask"); // el aviso con sonido de la pregunta ya lo da el hook PreToolUse (setQuestion)
      }
      this.emit("change");
    });
  }

  /**
   * La consola respondió una pregunta. `pc: true` ("Responder en el PC") la devuelve a Claude Code; si no, las respuestas (índices)
   * se traducen a las etiquetas completas. Devuelve false, sin tocar nada, si el id no es el de una pregunta pendiente o la
   * respuesta no cuadra con sus preguntas (la solicitud sigue esperando).
   */
  answerQuestion(answer: Answer): boolean {
    const item = this.queue.find((q) => q.id === answer.requestId);
    if (!item || item.kind !== "question" || !item.questions) return false;
    if ("pc" in answer) {
      this.settle(item, "ask", "answer_pc");
      return true;
    }
    const answers = buildAnswers(item.questions, answer.answers);
    if (!answers) return false;
    this.settle(item, "allow", "answered", answers);
    return true;
  }

  /**
   * Retira sin decisión (`ask`) las solicitudes pendientes de una sesión porque se resolvieron en otra parte
   * (la terminal del agente). Sin `match` retira todas las de la sesión. Con `match` retira solo las que coinciden en
   * herramienta e input; si ninguna coincide no retira nada (con herramientas en paralelo o subagentes, otro evento de
   * la sesión no prueba que ESTE permiso se resolviera). Devuelve cuántas retiró.
   */
  resolveElsewhere(sessionId: string, match?: { toolName?: string; toolInput?: unknown }): number {
    // un `Stop` retenido (instruction) no se retira por eventos de la sesión: su hook de estado llega en paralelo; se libera con releaseInstruction
    const own = this.queue.filter((q) => q.sessionId === sessionId && q.kind !== "instruction");
    if (own.length === 0) return 0;
    let chosen = own;
    if (match) {
      if (match.toolName === undefined && match.toolInput === undefined) return 0;
      chosen = own.filter(
        (q) =>
          (match.toolName === undefined || q.toolName === match.toolName) &&
          (match.toolInput === undefined || stable(q.toolInput) === stable(match.toolInput)),
      );
    }
    for (const r of chosen) this.settle(r, "ask", "answered_elsewhere");
    return chosen.length;
  }

  // ---------- instrucciones por texto (Fase 2b, paso 6) ----------

  /** Instrucciones en cola de la sesión (copia). */
  instructionsOf(sessionId: string): string[] {
    return [...(this.instructionQueue.get(sessionId) ?? [])];
  }

  private instructionRequest(sessionId: string): Internal | undefined {
    return this.queue.find((q) => q.kind === "instruction" && q.sessionId === sessionId);
  }

  /** ¿Hay un `Stop` retenido de la sesión esperando tu instrucción? */
  hasInstructionRequest(sessionId: string): boolean {
    return this.instructionRequest(sessionId) !== undefined;
  }

  /**
   * ¿El fin de turno que se está notificando va a continuar? Sí si hay instrucciones en cola o si se acaba de entregar una
   * (el hook de estado y el de instrucciones llegan a la vez, en cualquier orden): la sesión no está "terminada". La entrega
   * cubre un solo `Stop`: al usarla se consume.
   */
  stopContinues(sessionId: string): boolean {
    if ((this.instructionQueue.get(sessionId)?.length ?? 0) > 0) return true;
    const at = this.deliveredAt.get(sessionId);
    if (at === undefined) return false;
    this.deliveredAt.delete(sessionId); // una sola vez: un Stop posterior (otro fin de turno) sí termina
    return this.now() - at < 5_000;
  }

  /** La sesión ya hizo algo nuevo (prompt o herramienta): la entrega reciente deja de cubrir un `Stop`. */
  clearDelivered(sessionId: string): void {
    this.deliveredAt.delete(sessionId);
  }

  /**
   * Instrucción escrita en la consola para una sesión. Si la sesión espera en una tarjeta "Espera tu instrucción", se entrega en el acto
   * (junto a lo que hubiera en cola); si no, queda en cola para su próximo `Stop`. Devuelve "unknown" (sesión desconocida) o "full" (ya
   * hay MAX_INSTRUCTIONS en cola) sin hacer nada.
   */
  enqueueInstruction(sessionId: string, text: string): "delivered" | "queued" | "unknown" | "full" {
    const s = this.sessionMap.get(sessionId);
    if (!s) return "unknown";
    this.seen(s);
    const waiting = this.instructionRequest(sessionId);
    const queued = this.instructionQueue.get(sessionId) ?? [];
    if (waiting) {
      this.instructionQueue.delete(sessionId);
      this.settle(waiting, "allow", "instructed", undefined, [...queued, text].join("\n\n"));
      return "delivered";
    }
    if (queued.length >= MAX_INSTRUCTIONS) return "full";
    this.instructionQueue.set(sessionId, [...queued, text]);
    this.events?.log("instruction_queued", { sessionId, queued: queued.length + 1 });
    this.emit("change");
    return "queued";
  }

  /** Vacía la cola de instrucciones de la sesión. */
  clearInstructions(sessionId: string): void {
    if (this.instructionQueue.delete(sessionId)) this.emit("change");
  }

  /** "Seguir en el PC": libera un `Stop` retenido sin instrucción. Devuelve false si el id no es el de una retención pendiente. */
  releaseInstruction(requestId: string): boolean {
    const item = this.queue.find((q) => q.id === requestId);
    if (!item || item.kind !== "instruction") return false;
    this.settle(item, "ask", "release");
    return true;
  }

  /** Libera el `Stop` retenido de la sesión (el usuario escribió en el PC, apagó el modo...). Devuelve true si había uno. */
  releaseSessionInstruction(sessionId: string, reason = "release"): boolean {
    const item = this.instructionRequest(sessionId);
    if (!item) return false;
    this.settle(item, "ask", reason);
    return true;
  }

  /** Enciende o apaga "Esperar mi respuesta" de una sesión y lo recuerda para el proyecto. Apagarlo libera la retención. */
  setSessionWait(sessionId: string, value: boolean): boolean {
    const s = this.sessionMap.get(sessionId);
    if (!s) return false;
    this.seen(s);
    s.waitForMe = value;
    if (value) {
      this.waitProjects.delete(s.project);
      this.waitProjects.add(s.project);
      while (this.waitProjects.size > MAX_REMEMBERED_PROJECTS) this.waitProjects.delete(this.waitProjects.values().next().value!);
    } else this.waitProjects.delete(s.project);
    if (this.waitProjectsPath) saveWaitProjects(this.waitProjectsPath, this.waitProjects);
    if (!value) this.releaseSessionInstruction(sessionId, "wait_off");
    this.emit("change");
    return true;
  }

  /**
   * `Stop` de la sesión (hook de instrucciones). Con instrucciones en cola las devuelve en el acto (juntas, en orden). Sin cola, con
   * "Esperar mi respuesta" y una consola conectada, lo retiene en la cola de tarjetas ("Espera tu instrucción") hasta que la consola
   * escriba (`enqueueInstruction`), la libere, se cumpla `instructWaitMax` o la sesión/consola desaparezca. Si no, `none`: Claude termina.
   */
  requestStop(req: { sessionId: string; lastMessage?: string; signal?: AbortSignal }): Promise<StopOutcome> {
    const s = this.sessionMap.get(req.sessionId);
    if (!s || req.signal?.aborted) return Promise.resolve({ decision: "none" });
    const queued = this.instructionQueue.get(req.sessionId);
    if (queued && queued.length > 0) {
      this.instructionQueue.delete(req.sessionId);
      this.markDelivered(s);
      this.emit("change");
      return Promise.resolve({ decision: "instruct", text: queued.join("\n\n") });
    }
    if (!s.waitForMe || !this.consoleOn || this.instructionRequest(req.sessionId)) return Promise.resolve({ decision: "none" });
    if (req.lastMessage !== undefined && req.lastMessage !== "") s.lastMessage = storeMessage(req.lastMessage);
    return new Promise<StopOutcome>((resolve) => {
      const id = randomUUID();
      const item: Internal = {
        id,
        kind: "instruction",
        sessionId: req.sessionId,
        toolName: "Stop",
        toolInput: {},
        suggestions: [],
        deadline: 0,
        resolve: (_d, _a, text) => resolve(text ? { decision: "instruct", text } : { decision: "none" }),
        timer: null,
      };
      this.armInstructionTimer(item);
      if (req.signal) {
        const onAbort = () => this.settle(item, "ask", "aborted");
        req.signal.addEventListener("abort", onAbort, { once: true });
        item.cleanup = () => req.signal?.removeEventListener("abort", onAbort);
      }
      this.queue.push(item);
      this.events?.log("request", { requestId: id, sessionId: req.sessionId, toolName: "Stop" });
      this.seen(s);
      this.dropNotice(s.id);
      // si el hook de estado ya la marcó terminada, ese aviso ya sonó ("terminó"); si no, la retención suena como una pregunta
      const alreadyChimed = s.state === "done";
      this.applyState(s, "ask");
      s.activity = INSTRUCT_ACTIVITY;
      if (!alreadyChimed && !this.prefs.hiddenAgents.includes(s.kind) && passes(s.notify, "ask_stop")) {
        this.chime = { kind: "ask", seq: ++this.chimeSeq };
        this.events?.log("notice", { sessionId: s.id, event: "ask_stop", chime: "ask", seq: this.chimeSeq });
      }
      this.emit("change");
    });
  }

  /** (Re)arma el plazo de una retención: `instructWaitMax` minutos desde ahora. */
  private armInstructionTimer(item: Internal): void {
    if (item.timer) clearTimeout(item.timer);
    item.timer = setTimeout(() => this.settle(item, "ask", "timeout"), this.prefs.instructWaitMax * 60_000);
    item.timer.unref();
  }

  private markDelivered(s: StoredSession): void {
    this.deliveredAt.set(s.id, this.now());
    s.notified = false;
    this.dropNotice(s.id);
    this.applyState(s, "working");
    s.activity = "Siguiendo tu instrucción";
  }

  /** Cancela temporizadores pendientes (para cerrar limpio). */
  dispose(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    for (const t of this.resetTimers.values()) clearTimeout(t);
    this.resetTimers.clear();
    for (const r of [...this.queue]) this.settle(r, "ask", "dispose");
  }

  private focusedInternal(): Internal | null {
    if (this.queue.length === 0) return null;
    if (this.focusSession !== null) {
      const own = this.queue.find((q) => q.sessionId === this.focusSession);
      if (own) return own;
    }
    if (this.modeValue === "manual") return null;
    if (this.skipTarget !== null) {
      const skipped = this.queue.find((q) => q.id === this.skipTarget);
      if (skipped) return skipped;
    }
    return this.queue[0] ?? null;
  }

  private seen(s: StoredSession): void {
    s.lastSeen = this.now();
  }

  private settle(item: Internal, decision: Decision, reason: string, answers?: Record<string, string>, text?: string): void {
    const i = this.queue.indexOf(item);
    if (i < 0) return;
    this.queue.splice(i, 1);
    if (item.timer) clearTimeout(item.timer);
    item.cleanup?.();
    if (this.skipTarget === item.id) this.skipTarget = null;
    this.events?.log(reason === "timeout" ? "timeout" : "decision", {
      requestId: item.id,
      sessionId: item.sessionId,
      decision: item.kind === "question" ? (answers ? "answer" : "ask") : item.kind === "instruction" ? (text ? "instruct" : "ask") : decision,
      reason,
    });
    const session = this.sessionMap.get(item.sessionId);
    if (session && session.state === "ask" && !this.hasPending(item.sessionId)) {
      // el fin de turno retenido que se libera sin instrucción vuelve a "terminó"; con instrucción, a trabajar
      if (item.kind === "instruction" && !text) {
        this.applyState(session, "done");
        session.activity = IDLE_ACTIVITY;
      } else this.applyState(session, "working");
    }
    if (session && item.kind === "instruction" && text) this.markDelivered(session);
    if (session && reason === "console" && decision !== "ask" && item.kind === "permission") {
      this.emit("notice", {
        type: "decision",
        sessionId: item.sessionId,
        decision: decision === "deny" ? "deny" : "allow",
      } satisfies StoreNotice);
    } else if (session && item.kind === "instruction") {
      // la retención de un fin de turno no hace globo en la cara: su tarjeta ya lo decía
    } else if (session && reason === "answered_elsewhere") {
      this.emit("notice", { type: "answered_elsewhere", sessionId: item.sessionId } satisfies StoreNotice);
    } else if (session && reason === "aborted") {
      this.emit("notice", { type: "withdrawn", sessionId: item.sessionId } satisfies StoreNotice);
    }
    item.resolve(decision, answers, text);
    this.emit("change");
  }

  private applyState(session: StoredSession, state: AgentState): void {
    this.clearReset(session.id);
    if (state === "working") {
      // la sesión volvió a trabajar: su aviso (con "Visto" pendiente) ya es viejo
      this.dropNotice(session.id);
      session.notified = false;
    }
    if (session.state !== state) {
      session.state = state;
      session.stateSince = this.now();
      this.events?.log("state", { sessionId: session.id, state });
    }
    if (state === "done" || state === "error") {
      const t = setTimeout(() => {
        this.resetTimers.delete(session.id);
        if (session.state === state) {
          this.applyState(session, "idle");
          this.emit("change");
        }
      }, this.resetMs);
      t.unref();
      this.resetTimers.set(session.id, t);
    }
  }

  private clearReset(id: string): void {
    const t = this.resetTimers.get(id);
    if (t) clearTimeout(t);
    this.resetTimers.delete(id);
  }
}

function publicOf(r: Internal): PendingRequest {
  return {
    id: r.id,
    kind: r.kind,
    ...(r.questions ? { questions: r.questions } : {}),
    sessionId: r.sessionId,
    toolName: r.toolName,
    toolInput: r.toolInput,
    deadline: r.deadline,
    suggestions: r.suggestions,
  };
}

/** JSON con las claves ordenadas, para comparar entradas de herramientas. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  );
}

/** Título o, si no hay, proyecto; ya saneado y en una línea, sin cortar. */
function baseName(s: StoredSession): string {
  return clip(s.title || s.project, Number.MAX_SAFE_INTEGER) || "sin nombre";
}

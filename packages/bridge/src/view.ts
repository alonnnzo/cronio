import {
  MAX_DETAIL_LINES,
  MAX_PAYLOAD,
  MAX_QUESTION_LINES,
  MAX_SESSIONS,
  MAX_SINCE_S,
  MAX_TEXT,
  TAG_LENGTH,
  type AgentKind,
  type DetailView,
  type NoticeKind,
  type NoticeView,
  type RequestView,
  type SessionView,
  type ViewModel,
} from "@companion/protocol";
import type { BridgeStore } from "./store.ts";
import type { FaceController } from "./face.ts";
import { classifyRisk } from "./risk.ts";
import { suggestionsLabel } from "./suggestions.ts";
import { QUESTION_VIEW_LEVELS, questionToView } from "./questions.ts";
import { renderPlain } from "./plaintext.ts";
import { shortModel } from "./model.ts";
import { clip, wrapLines } from "./text.ts";

/** Resumen de lo que pide la herramienta (para `Bash`, el comando; para `Write`/`Edit`, `"<herramienta> <ruta>"`). */
export function summarize(toolName: string, toolInput: unknown): string {
  const input = (typeof toolInput === "object" && toolInput !== null ? toolInput : {}) as Record<string, unknown>;
  if (toolName === "Bash" && typeof input.command === "string") return input.command;
  if ((toolName === "Write" || toolName === "Edit") && typeof input.file_path === "string") {
    return `${toolName} ${input.file_path}`;
  }
  let json: string;
  try {
    json = JSON.stringify(toolInput) ?? "";
  } catch {
    json = "";
  }
  return `${toolName} ${json}`.trim();
}

export const AGENT_NAMES: Record<AgentKind, string> = {
  claude: "Claude",
  gemini: "Gemini",
  codex: "Codex",
  cursor: "Cursor",
  hermes: "Hermes",
};

const NOTICE_LED: Record<NoticeKind, ViewModel["led"]> = { done: "done", idle: "done", ask: "ask", error: "error" };

/**
 * Tamaño con el que una vista con pregunta debe caber en una trama: el máximo sellado menos el mismo margen que las pruebas de
 * tamaño exigen al peor caso realista. Si la pregunta es tan grande que no cabe (cuatro preguntas de cuatro opciones con textos
 * al límite y doce sesiones con textos al límite, todo en caracteres de 3 bytes), se le quitan descripciones y líneas
 * (`questionToView` por niveles) hasta que quepa; las opciones y sus etiquetas nunca se tocan.
 */
export const QUESTION_VIEW_BUDGET = MAX_PAYLOAD - TAG_LENGTH - 3000;

const viewBytes = (view: ViewModel): number => Buffer.byteLength(JSON.stringify({ t: "view", rev: 4294967295, view }));

export function buildView(store: BridgeStore, face: FaceController, now: number = store.now()): ViewModel {
  const settings = store.settings;
  const cur = store.focusedRequest;
  // Un agente oculto no sale en la lista de la consola. Excepción de seguridad: la sesión de la tarjeta de permiso
  // enfocada se queda, para que la consola siga resolviendo de quién es la tarjeta. Los permisos nunca se filtran.
  const all = store.sessions.filter((s) => !settings.hiddenAgents.includes(s.kind) || s.id === cur?.sessionId);
  const focusedId = store.focusedSessionId;

  // Tope de sesiones: primero la de la solicitud enfocada y la abierta en la consola, luego las que piden
  // permiso, luego las más recientes por actividad. La vista las deja en orden de llegada.
  const rank = (id: string) =>
    id === cur?.sessionId ? 0 : id === focusedId ? 1 : store.hasPending(id) ? 2 : 3;
  const chosen = [...all]
    .sort((a, b) => rank(a.id) - rank(b.id) || b.lastSeen - a.lastSeen || a.order - b.order)
    .slice(0, MAX_SESSIONS)
    .sort((a, b) => a.order - b.order);

  const sessions: SessionView[] = chosen.map((s) => ({
    id: s.id,
    kind: s.kind,
    title: store.displayName(s.id),
    project: clip(s.project),
    model: shortModel(s.model),
    state: s.state,
    // con una pregunta pendiente la fila muestra la pregunta en vez de la actividad genérica
    activity: clip(s.question !== "" ? s.question : s.activity),
    // segundos en el estado actual: la consola les suma su propio reloj desde que recibe la vista
    sinceS: Math.min(MAX_SINCE_S, Math.max(0, Math.floor((now - s.stateSince) / 1000))),
  }));

  let request: RequestView | null = null;
  if (cur && cur.kind === "instruction") {
    // fin de turno retenido (paso 6): la consola escribe una instrucción o libera. `lines` es el comienzo del último mensaje.
    const session = store.getSession(cur.sessionId);
    request = {
      id: cur.id,
      sessionId: cur.sessionId,
      kind: "instruction",
      title: clip(`${session ? AGENT_NAMES[session.kind] : "Agente"} espera tu instrucción`),
      lines: wrapLines(renderPlain(session?.lastMessage ?? "", MAX_TEXT).join("\n"), MAX_TEXT, 3),
      risk: "normal",
      expiresInS: 0,
      position: store.focusedPosition,
      total: store.pendingCount,
      // atajos de un toque (ajuste `quickCommands`); sin ninguno la tarjeta queda como antes
      ...(settings.quickCommands.length > 0 ? { quick: settings.quickCommands.map((c) => ({ ...c })) } : {}),
    };
  } else if (cur && cur.kind === "question" && cur.questions) {
    // pregunta con alternativas (AskUserQuestion): la consola responde con `answer`, nunca con `decision`. `lines` lleva la
    // primera pregunta para que una consola que no entienda `kind` muestre algo; el puente ignora una `decision` sobre ella.
    const session = store.getSession(cur.sessionId);
    const questions = cur.questions.map((q) => questionToView(q));
    request = {
      id: cur.id,
      sessionId: cur.sessionId,
      kind: "question",
      title: clip(`${session ? AGENT_NAMES[session.kind] : "Agente"} te hace una pregunta`),
      lines: questions[0]!.text,
      risk: "normal",
      expiresInS: cur.deadline === 0 ? 0 : Math.max(1, Math.ceil((cur.deadline - now) / 1000)),
      position: store.focusedPosition,
      total: store.pendingCount,
      questions,
    };
  } else if (cur) {
    const session = store.getSession(cur.sessionId);
    const always = suggestionsLabel(cur.suggestions);
    request = {
      id: cur.id,
      sessionId: cur.sessionId,
      title: clip(`${session ? AGENT_NAMES[session.kind] : "Agente"} pide permiso`),
      lines: wrapLines(summarize(cur.toolName, cur.toolInput), MAX_TEXT, 6),
      risk: classifyRisk(cur.toolName, cur.toolInput),
      expiresInS: cur.deadline === 0 ? 0 : Math.max(1, Math.ceil((cur.deadline - now) / 1000)), // 0 = sin límite
      position: store.focusedPosition,
      total: store.pendingCount,
      ...(always !== undefined ? { always } : {}),
    };
  }

  let detail: DetailView | null = null;
  const open = focusedId !== null ? store.getSession(focusedId) : undefined;
  if (open) {
    const queuedInstructions = store.instructionsOf(open.id);
    // la pregunta pendiente va aparte (completa, resaltada arriba del último mensaje) para que no se pierda
    detail = {
      sessionId: open.id,
      lastMessage: wrapLines(open.lastMessage, MAX_TEXT, MAX_DETAIL_LINES),
      ...(open.question !== "" ? { question: wrapLines(open.question, MAX_TEXT, MAX_QUESTION_LINES) } : {}),
      notify: open.notify,
      ...(queuedInstructions.length > 0 ? { instructions: { count: queuedInstructions.length, first: clip(queuedInstructions[0]!) } } : {}),
      ...(open.waitForMe ? { waitForMe: true } : {}),
    };
  }

  // tarjeta de aviso con "Visto": nunca junto a un permiso pendiente (el store ya lo garantiza)
  let notice: NoticeView | undefined;
  const cur2 = store.currentNotice;
  const noticeSession = cur2 ? store.getSession(cur2.card.sessionId) : undefined;
  if (cur2 && noticeSession) {
    notice = {
      id: cur2.card.id,
      sessionId: cur2.card.sessionId,
      kind: cur2.card.kind,
      agent: clip(AGENT_NAMES[noticeSession.kind]),
      project: clip(noticeSession.project),
      title: cur2.card.title,
      lines: cur2.card.lines,
      position: cur2.position,
      total: cur2.total,
    };
  }

  const faceView = face.current;
  const chime = store.lastChime;
  const result: ViewModel = {
    sessions,
    request,
    pendingCount: store.pendingCount,
    mode: store.mode,
    face: faceView,
    detail,
    // permiso pendiente > pregunta > aviso sin "Visto" > lo que muestra la cara (trabajando, terminó, error, nada)
    led: store.pendingCount > 0 || store.hasQuestion ? "ask" : notice ? NOTICE_LED[notice.kind] : faceView.mood === "idle" ? "off" : faceView.mood,
    settings: {
      notifyDefault: settings.notifyDefault,
      notifyAck: settings.notifyAck,
      sound: settings.sound,
      questions: settings.questions,
      readerDefault: settings.readerDefault,
      instructWaitMax: settings.instructWaitMax,
      hiddenAgents: [...settings.hiddenAgents],
    },
    ...(notice ? { notice } : {}),
    ...(chime ? { chime: { kind: chime.kind, seq: chime.seq } } : {}),
  };
  // una pregunta enorme no debe dejar la vista sin caber en una trama: se achica lo accesorio hasta que quepa
  if (cur?.kind === "question" && cur.questions && request?.questions) {
    for (const level of QUESTION_VIEW_LEVELS) {
      if (level > 0) {
        const questions = cur.questions.map((q) => questionToView(q, level));
        request = { ...request, lines: questions[0]!.text, questions };
        result.request = request;
      }
      if (viewBytes(result) <= QUESTION_VIEW_BUDGET) break;
    }
  }
  return result;
}

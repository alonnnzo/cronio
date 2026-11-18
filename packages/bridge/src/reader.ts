import { MAX_PAYLOAD, MAX_QUESTION_LINES, MAX_READ_LINES, MAX_READ_TEXT, type BridgeMessage, type ReadMode } from "@companion/protocol";
import type { BridgeStore } from "./store.ts";
import { renderPlain } from "./plaintext.ts";
import { extractive, type Summarizer } from "./summary.ts";
import { wrapLines } from "./text.ts";

export type TextMessage = Extract<BridgeMessage, { t: "text" }>;

/** Bytes de la trama sellada que no son JSON: la etiqueta de autenticación. */
const TAG_BYTES = 16;
/** Margen para no rozar el límite de la trama. */
const SAFETY_BYTES = 1024;
/**
 * Tope de bytes del JSON del mensaje `text`: lo que cabe en una trama sellada (MAX_PAYLOAD menos la etiqueta)
 * menos un margen. Con acentos cada carácter pesa 2 bytes y el peor caso de 240 líneas de 48 caracteres lo pasaría,
 * por eso se corta también por bytes y no solo por líneas.
 */
export const MAX_TEXT_JSON_BYTES = MAX_PAYLOAD - TAG_BYTES - SAFETY_BYTES;

const byteLength = (s: string) => Buffer.byteLength(JSON.stringify(s), "utf8");

/**
 * Mensaje `text` para la consola que pidió leer `sessionId`: el último mensaje del agente sin markdown, cortado en
 * líneas de MAX_READ_TEXT, hasta MAX_READ_LINES y MAX_TEXT_JSON_BYTES. Sesión desconocida → sin líneas (nunca falla).
 * `mode` (paso 5): `full` (por defecto) el mensaje entero, o `summary` el resumen del `summarizer` (hoy el extractivo, sin
 * modelo); en resumen, `short` avisa que el mensaje ya cabía entero y las líneas son el mensaje.
 */
export function buildText(store: BridgeStore, sessionId: string, mode: ReadMode = "full", summarizer: Summarizer = extractive): TextMessage {
  const session = store.getSession(sessionId);
  if (!session) return { t: "text", sessionId, lines: [], truncated: false, mode };
  const question = session.question !== "" ? wrapLines(session.question, MAX_READ_TEXT, MAX_QUESTION_LINES) : [];
  let short = false;
  let all: string[];
  if (mode === "summary") {
    // el resumen no repite la pregunta pendiente: el lector la muestra arriba
    const s = summarizer.summarize(session.lastMessage, { width: MAX_READ_TEXT, question: session.question });
    all = s.lines;
    short = s.short;
  } else {
    all = renderPlain(session.lastMessage, MAX_READ_TEXT);
  }

  const head = (lines: string[]): TextMessage => ({
    t: "text",
    sessionId,
    lines,
    truncated: false,
    mode,
    ...(short ? { short: true } : {}),
    ...(question.length > 0 ? { question } : {}),
  });
  // tamaño del JSON con la lista vacía; cada línea suma su JSON y una coma
  let bytes = Buffer.byteLength(JSON.stringify({ ...head([]), truncated: true }), "utf8");
  const lines: string[] = [];
  let truncated = false;
  for (const line of all) {
    const next = bytes + byteLength(line) + 1;
    if (lines.length >= MAX_READ_LINES || next > MAX_TEXT_JSON_BYTES) {
      truncated = true;
      break;
    }
    lines.push(line);
    bytes = next;
  }
  // no terminar en una línea en blanco justo antes del corte
  while (truncated && lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return { ...head(lines), truncated };
}

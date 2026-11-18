import {
  MAX_OPTION_DESC_LINES,
  MAX_QUESTION_LINES,
  MAX_QUESTION_OPTIONS,
  MAX_QUESTIONS,
  MAX_TEXT,
  type Answer,
  type QuestionView,
} from "@companion/protocol";
import { z } from "zod";
import { clip, sanitizeText, wrapLines } from "./text.ts";

/** Topes de lo que se acepta de Claude Code (lo que pasa de aquí no se retiene: la pregunta se responde en el PC). */
const MAX_QUESTION_CHARS = 2000;
const MAX_LABEL_CHARS = 300;
const MAX_DESC_CHARS = 1000;

const QuestionSchema = z.object({
  question: z.string().min(1).max(MAX_QUESTION_CHARS),
  header: z.string().max(MAX_LABEL_CHARS).default(""),
  options: z
    .array(
      z.object({
        label: z.string().min(1).max(MAX_LABEL_CHARS),
        description: z.string().max(MAX_DESC_CHARS).default(""),
      }),
    )
    .min(2)
    .max(MAX_QUESTION_OPTIONS),
  multiSelect: z.boolean().default(false),
});

/** Lo que se retiene de `tool_input` de AskUserQuestion: de 1 a 4 preguntas, cada una de 2 a 4 opciones. */
export type QuestionSpec = z.infer<typeof QuestionSchema>;

/**
 * Valida el `tool_input` de AskUserQuestion. Devuelve las preguntas, o null si no cumple (la pregunta se deja al PC).
 * Un texto de pregunta repetido también se rechaza: las respuestas van indexadas por ese texto y chocarían.
 */
export function parseQuestions(toolInput: unknown): QuestionSpec[] | null {
  const r = z.object({ questions: z.array(QuestionSchema).min(1).max(MAX_QUESTIONS) }).safeParse(toolInput);
  if (!r.success) return null;
  const texts = r.data.questions.map((q) => q.question);
  if (new Set(texts).size !== texts.length) return null;
  return r.data.questions;
}

/** "(Recommended)" o "(Recomendado/a)" al final de una etiqueta: se quita de lo que se muestra y se marca aparte. */
const RECOMMENDED = /\s*\((?:recommended|recomendad[oa])\)\s*$/i;

export function splitRecommended(label: string): { label: string; recommended: boolean } {
  const stripped = label.replace(RECOMMENDED, "");
  if (stripped === label || stripped.trim() === "") return { label, recommended: false };
  return { label: stripped, recommended: true };
}

/**
 * La pregunta tal como va en la vista: textos recortados a los límites; la etiqueta sin "(Recommended)".
 * `level` achica lo accesorio cuando la vista no cabe en una trama (ver `fitQuestions`): 0 completa, 1 descripciones de una
 * línea, 2 sin descripciones, 3 sin descripciones y el texto de la pregunta en una sola línea. Etiquetas y opciones nunca se tocan.
 */
export function questionToView(q: QuestionSpec, level = 0): QuestionView {
  const descLines = level === 0 ? MAX_OPTION_DESC_LINES : level === 1 ? 1 : 0;
  return {
    header: clip(q.header),
    text: wrapLines(q.question, MAX_TEXT, level >= 3 ? 1 : MAX_QUESTION_LINES),
    multi: q.multiSelect,
    options: q.options.map((o) => {
      const { label, recommended } = splitRecommended(o.label);
      return { label: clip(label), desc: descLines === 0 ? [] : wrapLines(o.description, MAX_TEXT, descLines), recommended };
    }),
  };
}

/** Niveles de `questionToView` en el orden en que se prueban. */
export const QUESTION_VIEW_LEVELS = [0, 1, 2, 3] as const;

/** Texto escrito en "Otra…" listo para mandar: sin controles ni saltos, recortado en los extremos. */
export function cleanOther(text: string): string {
  return sanitizeText(text).replace(/\n/g, " ").trim();
}

/**
 * Traduce lo que respondió la consola (índices) a `answers` de Claude Code: `{ "<texto de la pregunta>": "<etiqueta>" }`.
 * Las etiquetas son las completas, tal cual llegaron (con "(Recommended)" si lo traían). Varias (multiSelect) se unen con ", ".
 * "Otra" manda el texto escrito. Devuelve null si algo no cuadra con las preguntas: una cantidad distinta de respuestas, un índice
 * fuera de rango, varias opciones en una pregunta de una sola, o un texto vacío.
 */
export function buildAnswers(questions: QuestionSpec[], entries: Extract<Answer, { answers: unknown }>["answers"]): Record<string, string> | null {
  if (entries.length !== questions.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const e = entries[i]!;
    if ("other" in e) {
      const text = cleanOther(e.other);
      if (text === "") return null;
      out[q.question] = text;
      continue;
    }
    if (e.choose.some((idx) => idx >= q.options.length)) return null;
    if (!q.multiSelect && e.choose.length !== 1) return null;
    // en el orden de la pregunta, no en el que se marcó
    const ordered = [...e.choose].sort((a, b) => a - b);
    out[q.question] = ordered.map((idx) => q.options[idx]!.label).join(", ");
  }
  return out;
}

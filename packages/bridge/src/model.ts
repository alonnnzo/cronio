import { clip } from "./text.ts";

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const version = (major: string, minor: string | undefined): string => (minor !== undefined ? `${major}.${minor}` : major);

/**
 * Nombre corto de un modelo para la ficha de la sesión: `claude-opus-5-5` -> `Opus 5.5`, `claude-sonnet-4-20250514` -> `Sonnet 4`,
 * `claude-3-5-haiku-20241022` -> `Haiku 3.5`, `opus[1m]` -> `Opus`. Lo que no se reconoce se deja como llegó (recortado a la vista).
 */
export function shortModel(raw: string): string {
  const original = raw.trim();
  if (original === "") return "";
  const id = original
    .toLowerCase()
    .replace(/\[[^\]]*\]\s*$/, "") // sufijo de contexto: opus[1m]
    .replace(/^(?:[a-z]{2}\.)?anthropic\./, "") // Bedrock: anthropic.claude-... / us.anthropic.claude-...
    .replace(/[@-]\d{8}(?:-v\d+(?::\d+)?)?$/, "") // fecha de la versión (y el -v1:0 de Bedrock)
    .replace(/-latest$/, "")
    .trim();
  // claude-opus-5-5, claude-sonnet-4, claude-opus
  let m = /^claude-([a-z]+)(?:-(\d+)(?:-(\d{1,2}))?)?$/.exec(id);
  if (m) return m[2] !== undefined ? `${capitalize(m[1]!)} ${version(m[2], m[3])}` : capitalize(m[1]!);
  // claude-3-5-sonnet, claude-3-opus
  m = /^claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)$/.exec(id);
  if (m) return `${capitalize(m[3]!)} ${version(m[1]!, m[2])}`;
  // alias que usa Claude Code: opus, sonnet, haiku, opusplan
  m = /^(opus|sonnet|haiku)(?:plan)?$/.exec(id);
  if (m) return capitalize(m[1]!);
  return clip(original);
}

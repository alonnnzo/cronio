import { MAX_READ_TEXT } from "@companion/protocol";
import { sanitizeText, scrubSurrogates } from "./text.ts";

/**
 * Del markdown que escribe el agente al texto plano que cabe en la pantalla de la consola (Fase 2b, paso 1).
 * Funciones puras: nada de estado ni de red. Reglas:
 * - énfasis (`**`, `__`, `*`, `_`) y código en línea (`` ` ``): se quitan los marcadores, no el texto;
 * - títulos `# Título` → `Título`, con una línea en blanco antes;
 * - listas `- ` o `* ` → `• ` (continuación sangrada 2 espacios); las numeradas se mantienen;
 * - bloques de código: sin vallas, líneas sangradas 2 espacios y cortadas "a duro" (no por palabras);
 * - enlaces `[texto](url)` → `texto`; tablas: sin fila separadora, celdas unidas con ` · `;
 * - 3 o más saltos seguidos → una sola línea en blanco.
 */

const MAX_INDENT = 8;

/** Código en línea sin marcadores; lo de adentro no se interpreta. */
function stripEmphasis(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)\s]*\)/g, "$1")
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "$1")
    .replace(/(?<!\w)__(?=\S)(.+?)(?<=\S)__(?!\w)/g, "$1")
    .replace(/(?<![\w*])\*(?=[^\s*])([^*]+?)(?<=[^\s*])\*(?![\w*])/g, "$1")
    .replace(/(?<![\w_])_(?=[^\s_])([^_]+?)(?<=[^\s_])_(?![\w_])/g, "$1");
}

/** Quita énfasis, código en línea y enlaces de una línea de texto. */
export function stripInline(s: string): string {
  return s
    .split(/(`[^`\n]+`)/)
    .map((part, i) => (i % 2 === 1 ? part.slice(1, -1) : stripEmphasis(part)))
    .join("");
}

type Item = { kind: "blank" } | { kind: "text"; first: string; hang: string; body: string; hard: boolean };

const BLANK: Item = { kind: "blank" };
const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d+[.)])\s+(.*)$/;
const QUOTE = /^\s*>\s?/;

const indentOf = (ws: string) => " ".repeat(Math.min(ws.length, MAX_INDENT));

function tableRow(line: string): Item | null {
  const t = line.trim();
  if (!t.startsWith("|")) return null;
  if (/^[\s|:-]+$/.test(t) && t.includes("-")) return BLANK_SKIP;
  const cells = t
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => stripInline(c.trim()))
    .filter((c) => c.length > 0);
  return { kind: "text", first: "", hang: "", body: cells.join(" · "), hard: false };
}

/** Marca de "esta línea no produce nada" (fila separadora de una tabla). */
const BLANK_SKIP: Item = { kind: "blank" };

function parse(clean: string): Item[] {
  const items: Item[] = [];
  const lastIsBlank = () => items.length === 0 || items[items.length - 1]!.kind === "blank";
  let inCode = false;
  for (const raw of clean.split("\n")) {
    if (FENCE.test(raw)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      items.push(raw.trim() === "" ? BLANK : { kind: "text", first: "  ", hang: "  ", body: raw, hard: true });
      continue;
    }
    if (raw.trim() === "" || RULE.test(raw)) {
      items.push(BLANK);
      continue;
    }
    const h = HEADING.exec(raw);
    if (h) {
      if (!lastIsBlank()) items.push(BLANK);
      items.push({ kind: "text", first: "", hang: "", body: stripInline(h[1]!), hard: false });
      continue;
    }
    const row = tableRow(raw);
    if (row) {
      if (row !== BLANK_SKIP) items.push(row);
      continue;
    }
    const b = BULLET.exec(raw);
    if (b) {
      const ind = indentOf(b[1]!);
      items.push({ kind: "text", first: `${ind}• `, hang: `${ind}  `, body: stripInline(b[2]!), hard: false });
      continue;
    }
    const n = NUMBERED.exec(raw);
    if (n) {
      const ind = indentOf(n[1]!);
      items.push({
        kind: "text",
        first: `${ind}${n[2]} `,
        hang: " ".repeat(ind.length + n[2]!.length + 1),
        body: stripInline(n[3]!),
        hard: false,
      });
      continue;
    }
    let text = raw;
    while (QUOTE.test(text)) text = text.replace(QUOTE, "");
    const lead = /^\s*/.exec(text)![0];
    const ind = indentOf(lead);
    items.push({ kind: "text", first: ind, hang: ind, body: stripInline(text.slice(lead.length)), hard: false });
  }
  return items;
}

/** Parte `body` en filas de `width` con sangrías; `hard` corta justo en el ancho sin mirar palabras. */
function wrapItem(item: Extract<Item, { kind: "text" }>, width: number): string[] {
  const out: string[] = [];
  const avail = (prefix: string) => Math.max(1, width - prefix.length);
  if (item.hard) {
    for (let i = 0; i < item.body.length || i === 0; ) {
      const prefix = item.hang;
      const chunk = item.body.slice(i, i + avail(prefix));
      i += chunk.length;
      out.push(scrubSurrogates(prefix + chunk).trimEnd());
      if (chunk.length === 0) break;
    }
    return out;
  }
  let prefix = item.first;
  let current = "";
  const flush = () => {
    out.push(prefix + current);
    prefix = item.hang;
    current = "";
  };
  for (let word of item.body.split(/ +/).filter((w) => w.length > 0)) {
    while (word.length > avail(prefix)) {
      if (current) flush();
      const cut = word.slice(0, avail(prefix));
      out.push(prefix + cut);
      prefix = item.hang;
      word = word.slice(cut.length);
    }
    if (!current) current = word;
    else if (prefix.length + current.length + 1 + word.length <= width) current += " " + word;
    else {
      flush();
      current = word;
    }
  }
  if (current || out.length === 0) flush();
  return out.map((l) => scrubSurrogates(l).trimEnd());
}

/**
 * Texto de la sesión → líneas de hasta `width` listas para dibujar, sin tope de cantidad (lo pone quien lo usa).
 * Primero se sanea (controles, bidi), manteniendo las líneas en blanco.
 */
export function renderPlain(text: string, width: number = MAX_READ_TEXT): string[] {
  const rows: string[] = [];
  for (const item of parse(sanitizeText(text, true))) {
    if (item.kind === "blank") {
      if (rows.length > 0 && rows[rows.length - 1] !== "") rows.push("");
      continue;
    }
    for (const row of wrapItem(item, width)) {
      if (row === "" && (rows.length === 0 || rows[rows.length - 1] === "")) continue;
      rows.push(row);
    }
  }
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  return rows;
}

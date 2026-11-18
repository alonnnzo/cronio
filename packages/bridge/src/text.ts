import { MAX_LINES, MAX_TEXT } from "@companion/protocol";

/** Marcador visible que sustituye a los caracteres de control o de formato. */
export const REPLACEMENT = "�";

// Rangos de puntos de código a sustituir por el marcador: C0 (salvo tab y salto, tratados aparte), DEL y C1;
// formato bidi (202A-202E, 2066-2069, 200E, 200F, 061C); ancho cero (200B-200D, 2060, FEFF).
const UNSAFE_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x08],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
  [0x061c, 0x061c],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2060],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

const NL = String.fromCharCode(10);

function isLowSurrogate(cp: number): boolean {
  return cp >= 0xdc00 && cp <= 0xdfff;
}

/** Cambia por el marcador las mitades sueltas de pares sustitutos (por ejemplo, tras cortar en medio de un emoji). */
export function scrubSurrogates(s: string): string {
  return s.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, REPLACEMENT);
}

function isUnsafe(cp: number): boolean {
  return UNSAFE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

/**
 * Deja el texto listo para mostrarlo en la consola: nada invisible ni de control.
 * - CRLF, U+2028 y U+2029 son saltos de línea; cualquier otro control, bidi o ancho cero pasa al marcador visible.
 * - La tabulación pasa a un espacio.
 * - Se quitan las líneas vacías y los espacios finales, así lo peligroso no se escapa de la vista tras líneas en blanco.
 * El resultado separa las líneas con LF.
 * Con `keepBlank` se conservan las líneas vacías (el lector del mensaje completo necesita los párrafos).
 */
export function sanitizeText(text: string, keepBlank = false): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    if (cp === 0x0d && text.charCodeAt(i + 1) === 0x0a) continue; // CRLF: basta el LF
    if (cp === 0x0a || cp === 0x2028 || cp === 0x2029) out += NL;
    else if (cp === 0x09) out += " ";
    else if (cp >= 0xd800 && cp <= 0xdbff && isLowSurrogate(text.charCodeAt(i + 1))) {
      out += text[i]! + text[i + 1]!; // par válido: un solo carácter
      i++;
    } else if (cp >= 0xd800 && cp <= 0xdfff) out += REPLACEMENT; // mitad suelta: en JSON ocuparía 6 bytes
    else out += isUnsafe(cp) ? REPLACEMENT : text[i];
  }
  return out
    .split(NL)
    .map((l) => l.trimEnd())
    .filter((l) => keepBlank || l.length > 0)
    .join(NL);
}

/** Recorta a `max` caracteres; si corta, el último es `…`. Los saltos de línea pasan a espacio. */
export function clip(text: string, max: number = MAX_TEXT): string {
  const flat = sanitizeText(text).replace(/\n/g, " ");
  if (flat.length <= max) return flat;
  if (max <= 1) return "…".slice(0, Math.max(0, max));
  return scrubSurrogates(flat.slice(0, max - 1)) + "…";
}

/** Parte en líneas de hasta `width` caracteres, sin límite de líneas. Entrada ya saneada. */
function wrapAll(clean: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of clean.split("\n")) {
    const words = paragraph.split(/ +/).filter((w) => w.length > 0);
    let current = "";
    for (let word of words) {
      while (word.length > width) {
        if (current) {
          out.push(current);
          current = "";
        }
        out.push(word.slice(0, width));
        word = word.slice(width);
      }
      if (!current) current = word;
      else if (current.length + 1 + word.length <= width) current += " " + word;
      else {
        out.push(current);
        current = word;
      }
    }
    if (current) out.push(current);
  }
  return out;
}

/** ¿Cabe el texto saneado completo en `maxLines` líneas de `width`? */
export function fitsInLines(text: string, width: number = MAX_TEXT, maxLines: number = MAX_LINES): boolean {
  return wrapAll(sanitizeText(text), width).length <= maxLines;
}

/**
 * Sanea y corta por palabras en líneas de hasta `width` caracteres, máximo `maxLines`.
 * Una palabra más larga que el ancho se parte. Si sobra texto, la última línea termina en `… (+N)`,
 * con N = caracteres no mostrados.
 */
export function wrapLines(text: string, width: number = MAX_TEXT, maxLines: number = MAX_LINES): string[] {
  const all = wrapAll(sanitizeText(text), width).map(scrubSurrogates);
  if (all.length <= maxLines) return all;
  const kept = all.slice(0, maxLines);
  const hidden = all.slice(maxLines).reduce((n, l) => n + l.length, 0);
  const last = kept[maxLines - 1] ?? "";
  let shown = last;
  let suffix = "…";
  for (let i = 0; i < 4; i++) {
    suffix = `… (+${hidden + (last.length - shown.length)})`;
    shown = last.slice(0, Math.max(0, width - suffix.length)).trimEnd();
  }
  suffix = `… (+${hidden + (last.length - shown.length)})`;
  kept[maxLines - 1] = suffix.length <= width ? scrubSurrogates(shown) + suffix : "…";
  return kept;
}

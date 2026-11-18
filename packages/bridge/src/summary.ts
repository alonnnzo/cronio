import { MAX_READ_TEXT } from "@companion/protocol";
import { renderPlain, stripInline } from "./plaintext.ts";
import { sanitizeText } from "./text.ts";

/**
 * Versión resumida del último mensaje (Fase 2b, paso 5). El resumen base es **extractivo**: no usa ningún modelo, es
 * gratis, instantáneo y el texto no sale del PC. Elige frases del mensaje con reglas fijas (función pura, sin estado).
 *
 * `Summarizer` es la costura para una mejora posterior (un resumen con `claude -p` o con la API implementaría la misma
 * interfaz sin tocar el protocolo); hoy solo existe `extractive`.
 */

/** Líneas del resumen: una pantalla del lector sin pregunta. */
export const SUMMARY_MAX_LINES = 12;
/** Puntos clave (viñetas) como mucho. */
const MAX_POINTS = 5;
/** Pendientes (lo que queda abierto) como mucho. */
const MAX_OPEN = 2;
/** Tope de caracteres por viñeta y por primera idea (unas dos y tres líneas de 48). */
const POINT_CHARS = 90;
const LEAD_CHARS = 130;
/** Una viñeta de una sola línea (48 menos la viñeta). */
const ONE_LINE_CHARS = 44;
/** Líneas que puede ocupar la primera idea. */
const LEAD_LINES = 3;

export interface SummaryOptions {
  /** Ancho de línea (por defecto MAX_READ_TEXT). */
  width?: number;
  /** Tope de líneas (por defecto SUMMARY_MAX_LINES). */
  maxLines?: number;
  /** Pregunta pendiente de la sesión: el lector ya la muestra arriba, así que el resumen no la repite. */
  question?: string;
}

export interface SummaryResult {
  /** Líneas ya cortadas al ancho. */
  lines: string[];
  /** El mensaje ya cabía entero en el tope: `lines` es el mensaje, no un resumen. */
  short: boolean;
}

export interface Summarizer {
  readonly name: string;
  summarize(markdown: string, opts?: SummaryOptions): SummaryResult;
}

// ---------- bloques ----------

type Block =
  | { k: "para"; text: string }
  | { k: "head"; text: string }
  | { k: "item"; level: number; text: string }
  | { k: "table"; rows: number };

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const QUOTE = /^\s*>\s?/;
/** Línea que es solo una etiqueta en negrita: `**Qué cambió:**`, `**Resultado**:` */
const BOLD_LABEL = /^\s*(?:\*\*|__)([^*_]+?)(?:\*\*|__)\s*:?\s*$/;

function parseBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let inCode = false;
  let tableRows = 0;
  /** El último bloque es un ítem de lista al que todavía se le puede pegar una continuación (sin línea en blanco de por medio). */
  let openItem: Extract<Block, { k: "item" }> | null = null;

  const flushPara = () => {
    if (para.length === 0) return;
    const text = para.join(" ").replace(/\s+/g, " ").trim();
    para = [];
    if (text === "") return;
    // una línea corta que termina en ":" es una etiqueta ("Cambios:"), no prosa
    if (text.length <= 50 && text.endsWith(":") && !text.includes(". ")) blocks.push({ k: "head", text: stripInline(text) });
    else {
      // un párrafo que abre con una negrita ("**Para probarlo** hay que…") empieza una sección; el primer bloque no (es la primera idea)
      const lead = blocks.length > 0 ? /^\*\*([^*]+?)\*\*\s*:?\s*(\S.*)$/.exec(text) : null;
      if (lead) {
        blocks.push({ k: "head", text: lead[1]!.trim().replace(/:$/, "") });
        blocks.push({ k: "para", text: lead[2]! });
      } else blocks.push({ k: "para", text });
    }
  };
  const flushTable = () => {
    if (tableRows > 0) blocks.push({ k: "table", rows: tableRows });
    tableRows = 0;
  };

  for (const raw of md.split("\n")) {
    if (FENCE.test(raw)) {
      flushPara();
      flushTable();
      openItem = null;
      inCode = !inCode;
      continue;
    }
    if (inCode) continue; // el código se descarta
    const t = raw.trim();
    if (t.startsWith("|")) {
      flushPara();
      openItem = null;
      if (!(/^[\s|:-]+$/.test(t) && t.includes("-"))) tableRows++;
      continue;
    }
    flushTable();
    if (t === "" || RULE.test(raw)) {
      flushPara();
      openItem = null;
      continue;
    }
    const h = HEADING.exec(raw);
    if (h) {
      flushPara();
      openItem = null;
      blocks.push({ k: "head", text: stripInline(h[1]!.trim()) });
      continue;
    }
    const b = BULLET.exec(raw);
    if (b) {
      flushPara();
      const item: Extract<Block, { k: "item" }> = { k: "item", level: Math.floor(b[1]!.length / 2), text: b[2]!.trim() };
      blocks.push(item);
      openItem = item;
      continue;
    }
    const q = raw.replace(QUOTE, "");
    if (openItem && para.length === 0 && /^\s+\S/.test(q)) {
      openItem.text += " " + q.trim(); // línea de continuación sangrada del ítem
      continue;
    }
    openItem = null;
    const label = BOLD_LABEL.exec(q);
    if (label && para.length === 0) {
      blocks.push({ k: "head", text: label[1]!.trim().replace(/:$/, "") });
      continue;
    }
    para.push(q.trim());
  }
  flushPara();
  flushTable();
  return blocks;
}

// ---------- frases ----------

/** Abreviaturas tras las que un punto no cierra la oración. */
const ABBREV = /(?:^|[\s(])(?:p|ej|etc|vs|sr|sra|dr|dra|núm|aprox|máx|mín|cap|fig|pág|pp|v|aprox|ud|uds)\.$/i;

/** Partes `text` en oraciones: el punto, `!`, `?` o `…` seguidos de espacio y de una mayúscula, `¿`, `¡` o un número. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const re = /[.!?…]+(?=\s+[A-ZÁÉÍÓÚÑÜ¿¡"“(\d])/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const end = m.index + m[0].length;
    if (m[0] === "." && ABBREV.test(text.slice(0, end))) continue;
    out.push(text.slice(start, end).trim());
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest !== "") out.push(rest);
  return out.filter((s) => s !== "");
}

/** Acorta las rutas largas al último tramo y los enlaces sueltos a su dominio. */
export function shortenPaths(s: string): string {
  return s
    .replace(/\bhttps?:\/\/([^\s/)]+)[^\s)]*/g, "$1")
    .replace(/(?:[A-Za-z]:)?[\w.~@-]*(?:[\\/][\w.~@-]+){2,}[\\/]?/g, (p) => {
      if (p.length <= 24) return p;
      const parts = p.split(/[\\/]/).filter((x) => x !== "");
      return parts[parts.length - 1] ?? p;
    });
}

/** Una sola idea: sin marcas, rutas cortas, espacios normales y como mucho `max` caracteres (corte en palabra, con "…"). */
function tidy(raw: string, max: number): string {
  const s = shortenPaths(stripInline(raw)).replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return (at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:.\-–—]+$/, "") + "…";
}

// \b no sirve con vocales acentuadas ("probó" termina en una letra que JS no cuenta como de palabra): bordes con \p{L}
const OPEN_WORDS = /(?<![\p{L}\d_])(?:falta(?:n)?|pendientes?|sin probar|no se prob[óo]|no prob[ée]|todav[ií]a)(?![\p{L}\d_])/iu;
const isQuestion = (s: string) => s.includes("¿") || /\?["”)]*$/.test(s);
/** "Si falta X, avisa" describe una comprobación, no algo que falte. */
const CONDITIONAL_FALTA = /\bsi\b[^.!?]{0,40}\bfalta/i;
const isOpen = (s: string) => (OPEN_WORDS.test(s) && !CONDITIONAL_FALTA.test(s)) || isQuestion(s);

/** La oración, desde su "¿" si la tiene (una pregunta suele venir tras una frase afirmativa en la misma oración). */
function fromQuestionMark(s: string): string {
  const i = s.indexOf("¿");
  return i > 0 ? s.slice(i) : s;
}

// ---------- el resumen ----------

/** Un punto clave o un pendiente: la oración tal cual (sin acortar) y de dónde salió, para no repetirla. */
interface Cand {
  raw: string;
  src: string;
}

type Para = Extract<Block, { k: "para" }>;

function extractiveSummary(markdown: string, opts: SummaryOptions = {}): SummaryResult {
  const width = opts.width ?? MAX_READ_TEXT;
  const maxLines = opts.maxLines ?? SUMMARY_MAX_LINES;
  const clean = sanitizeText(markdown, true);

  // 5. si el mensaje ya cabe, el resumen es el mensaje
  const whole = renderPlain(clean, width);
  if (whole.length <= maxLines) return { lines: whole, short: true };

  const blocks = parseBlocks(clean);
  const used = new Set<string>();
  const question = (opts.question ?? "").trim();
  const repeatsQuestion = (s: string) => question !== "" && (question.includes(s.slice(0, 30)) || s.includes(question.slice(0, 30)));

  // 1. primera idea: la primera oración de la primera prosa (hasta dos si la primera es muy corta)
  let lead = "";
  const leadIdx = blocks.findIndex((b) => b.k === "para");
  if (leadIdx >= 0) {
    const sents = sentences(stripInline((blocks[leadIdx] as Para).text));
    let n = 1;
    lead = sents[0] ?? "";
    if (lead.length < 40 && sents.length > 1) {
      lead += " " + sents[1];
      n = 2;
    }
    for (let i = 0; i < n; i++) used.add(`${leadIdx}:${i}`);
    lead = leadText(lead, width);
  }

  // secciones: un título (o una negrita al comienzo de un párrafo) y lo que lo sigue hasta el próximo título
  interface Section {
    head: string;
    pending: boolean;
    /** Primeras oraciones de su contenido: ítems de primer nivel o, si no hay, de la prosa. */
    items: Cand[];
  }
  const sections: Section[] = [];
  blocks.forEach((b, i) => {
    if (b.k !== "head" || b.text === "") return;
    const items: Cand[] = [];
    const prose: Cand[] = [];
    for (let j = i + 1; j < blocks.length && blocks[j]!.k !== "head"; j++) {
      const c = blocks[j]!;
      if (c.k === "item" && c.level === 0) {
        const first = sentences(stripInline(c.text))[0] ?? "";
        if (first !== "") items.push({ raw: first, src: `${j}:0` });
      } else if (c.k === "para") {
        sentences(stripInline(c.text)).forEach((s, k) => prose.push({ raw: s, src: `${j}:${k}` }));
      }
    }
    const content = items.length > 0 ? items : prose;
    const unused = content.filter((c) => !used.has(c.src));
    if (unused.length === 0) return; // sin contenido (lo sigue una tabla, código u otro título) o es la primera idea
    sections.push({ head: stripInline(b.text).replace(/[:\s]+$/, ""), pending: PENDING_HEAD.test(b.text), items: unused });
  });

  // 3. lo que queda abierto: primero los ítems de las secciones "Sin probar", "Falta", "Pendiente"…; luego, en orden de
  // aparición, oraciones con "falta", "pendiente", "sin probar", "todavía" o una pregunta. Los títulos no cuentan y la
  // pregunta pendiente de la sesión no se repite (el lector ya la muestra arriba).
  const open: Cand[] = [];
  for (const s of sections) {
    if (!s.pending) continue;
    s.items.slice(0, MAX_OPEN).forEach((c) => open.push(c));
    s.items.forEach((c) => used.add(c.src)); // el resto de la sección ya está dicho por su título
  }
  blocks.forEach((b, i) => {
    if (b.k === "table" || b.k === "head") return;
    sentences(stripInline(b.text)).forEach((s, j) => {
      if (used.has(`${i}:${j}`) || !isOpen(s)) return;
      const text = fromQuestionMark(s);
      if (isQuestion(s) && repeatsQuestion(text)) return;
      open.push({ raw: text, src: `${i}:${j}` });
    });
  });
  const pending = open.slice(0, MAX_OPEN);
  const isPending = (src: string) => open.some((o) => o.src === src);

  // 2. puntos clave. Con dos o más secciones, una viñeta por sección en orden ("Título: primera oración de su contenido");
  // con una o ninguna, los ítems de primer nivel y los títulos con prosa debajo, en orden de aparición.
  let points: Cand[] = [];
  const plain = sections.filter((s) => !s.pending);
  if (plain.length >= 2) {
    points = plain.map((s) => ({ raw: `${s.head}: ${lowerFirst(s.items[0]!.raw)}`, src: s.items[0]!.src }));
  } else {
    blocks.forEach((b, i) => {
      if (b.k === "item" && b.level === 0) {
        const first = sentences(stripInline(b.text))[0] ?? "";
        if (first !== "") points.push({ raw: first, src: `${i}:0` });
      } else if (b.k === "head" && b.text !== "") {
        const next = blocks[i + 1];
        if (next && next.k === "para" && !used.has(`${i + 1}:0`)) {
          const first = sentences(stripInline(next.text))[0] ?? "";
          if (first !== "") points.push({ raw: `${b.text.replace(/:$/, "")}: ${first}`, src: `${i + 1}:0` });
        }
      }
    });
    // sin estructura (prosa corrida): las oraciones que siguen a la primera idea
    if (points.length === 0) {
      blocks.forEach((b, i) => {
        if (b.k !== "para") return;
        sentences(stripInline(b.text)).forEach((s, j) => {
          if (!used.has(`${i}:${j}`)) points.push({ raw: s, src: `${i}:${j}` });
        });
      });
    }
  }
  points = points.filter((p) => !used.has(p.src) && !isPending(p.src) && !repeatsQuestion(p.raw)).slice(0, MAX_POINTS);

  // 4. si no hay nada más y el mensaje traía una tabla, se dice
  const tables = blocks.filter((b): b is Extract<Block, { k: "table" }> => b.k === "table");
  if (lead === "" && points.length === 0 && pending.length === 0 && tables.length > 0) {
    const rows = tables.reduce((n, t) => n + Math.max(1, t.rows - 1), 0); // sin la fila de encabezados
    return { lines: renderPlain(`(tabla de ${rows} ${rows === 1 ? "fila" : "filas"})`, width), short: false };
  }
  const lines = fit(lead, points, pending, width, maxLines);
  return { lines: lines.length > 0 ? lines : whole.slice(0, maxLines), short: false };
}

/** Un título de sección cuyos ítems son lo que queda abierto. */
const PENDING_HEAD = /(?<![\p{L}\d_])(?:sin probar|sin verificar|no probado|falta(?:n)?|pendientes?|queda(?:n)?)(?![\p{L}\d_])/iu;

/** "Hay 5 commits" -> "hay 5 commits" después de "Título: " (no toca siglas ni nombres propios en mayúsculas seguidas). */
function lowerFirst(s: string): string {
  return /^[A-ZÁÉÍÓÚÑ][a-záéíóúñü]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/**
 * Primera idea: entera si cabe en 3 líneas; si no, cortada en una coma, punto y coma o conjunción (y, pero, que, e, o, ni) y
 * cerrada con "…", nunca a media palabra mientras haya un límite que quepa en 3 líneas.
 */
function leadText(sentence: string, width: number): string {
  const s = shortenPaths(stripInline(sentence)).replace(/\s+/g, " ").trim();
  const fits = (t: string) => renderPlain(t, width).length <= LEAD_LINES;
  if (fits(s)) return s;
  const cuts: number[] = [];
  const re = /[,;]\s|\s(?:y|pero|que|e|o|ni|aunque|porque|mientras)\s/g;
  for (let m = re.exec(s); m; m = re.exec(s)) cuts.push(m.index);
  for (let i = cuts.length - 1; i >= 0; i--) {
    const t = s.slice(0, cuts[i]!).replace(/[\s,;:.\-–—]+$/, "") + "…";
    if (cuts[i]! >= 20 && fits(t)) return t;
  }
  return tidy(s, LEAD_CHARS);
}

/**
 * Arma las líneas y las ajusta al tope: primera idea, una línea en blanco, los puntos y, tras otra, los pendientes.
 * Si no caben prueba, en orden: viñetas de los puntos más cortas (una línea), menos puntos (hasta quedar con dos), pendientes
 * de una línea, un solo pendiente, y por último suelta los puntos. La primera idea y los pendientes mandan sobre los puntos.
 */
function fit(lead: string, points: Cand[], pending: Cand[], width: number, maxLines: number): string[] {
  const bullet = (c: Cand, chars: number) => renderPlain(`- ${tidy(c.raw, chars)}`, width);
  const build = (np: number, npen: number, pchars: number, penchars: number): string[] => {
    const out: string[] = [];
    if (lead !== "") out.push(...renderPlain(lead, width));
    const section = (cands: Cand[], chars: number) => {
      if (cands.length === 0) return;
      if (out.length > 0) out.push("");
      for (const c of cands) out.push(...bullet(c, chars));
    };
    section(points.slice(0, np), pchars);
    section(pending.slice(0, npen), penchars);
    return out;
  };
  const attempts: [number, number, number, number][] = [];
  // más puntos antes que viñetas largas: con cada cantidad de puntos se acortan primero los puntos y luego los pendientes
  for (let np = points.length; np >= Math.min(2, points.length); np--) {
    attempts.push([np, pending.length, POINT_CHARS, POINT_CHARS], [np, pending.length, ONE_LINE_CHARS, POINT_CHARS], [np, pending.length, ONE_LINE_CHARS, ONE_LINE_CHARS]);
  }
  for (let np = points.length; np >= 0; np--) attempts.push([np, Math.min(1, pending.length), ONE_LINE_CHARS, ONE_LINE_CHARS]);
  for (const [np, npen, pc, nc] of attempts) {
    const lines = build(np, npen, pc, nc);
    if (lines.length <= maxLines) return lines;
  }
  return build(0, 0, ONE_LINE_CHARS, ONE_LINE_CHARS).slice(0, maxLines);
}

/** El resumen extractivo: sin modelo, solo reglas. */
export const extractive: Summarizer = { name: "extractive", summarize: extractiveSummary };

/** Atajo: solo las líneas del resumen extractivo (`summarize(markdown, opts) -> string[]`). */
export function summarize(markdown: string, opts?: SummaryOptions): string[] {
  return extractive.summarize(markdown, opts).lines;
}

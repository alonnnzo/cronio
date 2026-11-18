import { describe, expect, it } from "vitest";
// @ts-expect-error módulo JS sin tipos (página estática)
import { createReader, reduceReader, shownMode, visibleRows, visibleLines, position, canOpen, mustClose, allLines, TRUNCATED_LINE } from "../public/reader.js";

const detail = (first = "Listo el hero") => ({ sessionId: "s1", lastMessage: [first, "segunda"] });
const view = (extra: Record<string, unknown> = {}) => ({
  sessions: [{ id: "s1", kind: "claude", title: "t", project: "p", model: "m", state: "done", activity: "" }],
  request: null,
  pendingCount: 0,
  mode: "queue",
  face: { kind: null, mood: "idle", lines: ["x"] },
  detail: detail(),
  led: "off",
  ...extra,
});
const request = { id: "r1", sessionId: "s1", title: "t", lines: ["ls"], risk: "normal", expiresInS: 0, position: 1, total: 1 };
const nav = { level: "detail", kind: "claude", sessionId: "s1", cursor: 0 };
const text = (lines: string[], extra: Record<string, unknown> = {}) => ({ t: "text", sessionId: "s1", lines, truncated: false, ...extra });
const many = (n: number) => Array.from({ length: n }, (_, i) => `linea ${i + 1}`);

function opened(lines = many(40), extra: Record<string, unknown> = {}) {
  let s = reduceReader(createReader(), { type: "open", sessionId: "s1", view: view() }).state;
  s = reduceReader(s, { type: "text", msg: text(lines, extra) }).state;
  return s;
}

describe("reader: filas visibles (mismas cuentas que el cliente)", () => {
  it("13 sin nada, 12 con aviso, 8 con 3 líneas de pregunta (con el pie de modo, una menos que sin él)", () => {
    expect(visibleRows(0, false)).toBe(13);
    expect(visibleRows(0, true)).toBe(12);
    expect(visibleRows(1, false)).toBe(10);
    expect(visibleRows(2, false)).toBe(9);
    expect(visibleRows(3, false)).toBe(8);
    expect(visibleRows(9, false)).toBe(8); // la pregunta se acota a 3 líneas
    expect(visibleRows(3, true)).toBe(7);
  });
});

describe("reader: abrir, cargar, mostrar", () => {
  it("abrir pide read y queda cargando; la respuesta lo muestra desde arriba", () => {
    const o = reduceReader(createReader(), { type: "open", sessionId: "s1", view: view() });
    expect(o.messages).toEqual([{ t: "read", sessionId: "s1" }]);
    expect(o.state).toMatchObject({ open: true, loading: true, sessionId: "s1", top: 0, stale: false });
    expect(reduceReader(o.state, { type: "scroll", delta: 3 }).state.top).toBe(0); // cargando: no se desplaza
    const s = reduceReader(o.state, { type: "text", msg: text(many(40)) }).state;
    expect(s.loading).toBe(false);
    expect(position(s)).toEqual({ first: 1, last: 13, total: 40 });
    expect(visibleLines(s)).toEqual(many(13));
  });

  it("no se abre con una tarjeta de permiso", () => {
    expect(canOpen(nav, view())).toBe(true);
    expect(canOpen(nav, view({ request }))).toBe(false);
    expect(canOpen({ level: "sessions", kind: "claude", sessionId: null, cursor: 0 }, view())).toBe(false);
    const r = reduceReader(createReader(), { type: "open", sessionId: "s1", view: view({ request }) });
    expect(r.state.open).toBe(false);
    expect(r.messages).toEqual([]);
  });

  it("ignora respuestas de otra sesión o con el lector cerrado", () => {
    const o = reduceReader(createReader(), { type: "open", sessionId: "s1", view: view() }).state;
    expect(reduceReader(o, { type: "text", msg: { ...text(["x"]), sessionId: "otra" } }).state).toBe(o);
    const c = createReader();
    expect(reduceReader(c, { type: "text", msg: text(["x"]) }).state).toBe(c);
  });

  it("sesión desconocida o sin mensaje: sin líneas", () => {
    const s = opened([]);
    expect(position(s)).toEqual({ first: 0, last: 0, total: 0 });
    expect(visibleLines(s)).toEqual([]);
  });

  it("truncado: una línea final '… sigue en el PC'", () => {
    const s = opened(many(15), { truncated: true });
    expect(allLines(s.doc)).toHaveLength(16);
    expect(position(s).total).toBe(16);
    const t = reduceReader(s, { type: "scroll", delta: 5 }).state;
    expect(t.top).toBe(3);
    expect(visibleLines(t).at(-1)).toBe(TRUNCATED_LINE);
  });
});

describe("reader: desplazamiento", () => {
  it("línea a línea, sin pasar de los extremos", () => {
    let s = opened();
    s = reduceReader(s, { type: "scroll", delta: -1 }).state;
    expect(s.top).toBe(0);
    s = reduceReader(s, { type: "scroll", delta: 1 }).state;
    expect(s.top).toBe(1);
    s = reduceReader(s, { type: "scroll", delta: 100 }).state;
    expect(s.top).toBe(27); // 40 - 13
  });

  it("páginas de (filas - 1) con una línea de contexto", () => {
    let s = opened();
    s = reduceReader(s, { type: "page", dir: 1 }).state;
    expect(s.top).toBe(12);
    s = reduceReader(s, { type: "page", dir: 1 }).state;
    expect(s.top).toBe(24);
    s = reduceReader(s, { type: "page", dir: -1 }).state;
    expect(s.top).toBe(12);
  });

  it("con la pregunta arriba caben menos líneas", () => {
    const s = opened(many(30), { question: ["¿Sigo?", "¿Seguro?", "¿Y ahora?"] });
    expect(position(s)).toEqual({ first: 1, last: 8, total: 30 });
    expect(reduceReader(s, { type: "page", dir: 1 }).state.top).toBe(7);
  });

  it("un documento corto no se desplaza", () => {
    const s = opened(many(5));
    expect(reduceReader(s, { type: "scroll", delta: 3 }).state.top).toBe(0);
  });
});

describe("reader: mensaje nuevo, recarga y cierre", () => {
  it("un mensaje nuevo no salta: marca stale y conserva la posición", () => {
    let s = opened();
    s = reduceReader(s, { type: "scroll", delta: 4 }).state;
    expect(reduceReader(s, { type: "view", view: view(), nav }).state.stale).toBe(false);
    const n = reduceReader(s, { type: "view", view: view({ detail: detail("Otro mensaje") }), nav }).state;
    expect(n.stale).toBe(true);
    expect(n.top).toBe(4);
    expect(n.doc).toBe(s.doc);
    // recargar: foto nueva, de nuevo cargando y desde arriba
    const r = reduceReader(n, { type: "reload", view: view({ detail: detail("Otro mensaje") }) });
    expect(r.messages).toEqual([{ t: "read", sessionId: "s1" }]);
    expect(r.state).toMatchObject({ loading: true, stale: false, top: 0 });
  });

  it("si el detalle aún no estaba al abrir, la primera vista que lo trae fija la foto sin avisar", () => {
    let s = reduceReader(createReader(), { type: "open", sessionId: "s1", view: view({ detail: null }) }).state;
    expect(s.snap).toBeNull();
    s = reduceReader(s, { type: "view", view: view(), nav }).state;
    expect(s.snap).toEqual(["Listo el hero", "segunda"]);
    expect(s.stale).toBe(false);
    expect(reduceReader(s, { type: "view", view: view({ detail: detail("Cambió") }), nav }).state.stale).toBe(true);
  });

  it("una tarjeta de permiso lo cierra en el acto", () => {
    const s = opened();
    expect(mustClose(s, nav, view({ request }))).toBe(true);
    const r = reduceReader(s, { type: "view", view: view({ request }), nav });
    expect(r.state.open).toBe(false);
    expect(r.messages).toEqual([]); // cerrar no envía nada: ni decisión ni focus
    // y la respuesta que llegue después no lo reabre
    expect(reduceReader(r.state, { type: "text", msg: text(["x"]) }).state.open).toBe(false);
  });

  it("también se cierra si el detalle ya no es el de su sesión", () => {
    const s = opened();
    expect(mustClose(s, { level: "sessions", kind: "claude", sessionId: null, cursor: 0 }, view())).toBe(true);
    expect(mustClose(s, { ...nav, sessionId: "otra" }, view())).toBe(true);
    expect(mustClose(s, nav, view())).toBe(false);
    expect(reduceReader(s, { type: "view", view: view(), nav: { level: "sessions", kind: "claude", sessionId: null, cursor: 0 } }).state.open).toBe(false);
  });

  it("close lo deja como nuevo", () => {
    expect(reduceReader(opened(), { type: "close" }).state).toEqual(createReader());
  });
});

describe("reader: modo resumen (paso 5)", () => {
  const withDefault = (readerDefault?: string) => view({ settings: { notifyDefault: "important", notifyAck: true, hiddenAgents: [], ...(readerDefault ? { readerDefault } : {}) } });

  it("abre en el modo del ajuste readerDefault: completo sin campo; resumen pide read con mode", () => {
    expect(reduceReader(createReader(), { type: "open", sessionId: "s1", view: view() }).messages).toEqual([{ t: "read", sessionId: "s1" }]);
    expect(reduceReader(createReader(), { type: "open", sessionId: "s1", view: withDefault("full") }).messages).toEqual([{ t: "read", sessionId: "s1" }]);
    const o = reduceReader(createReader(), { type: "open", sessionId: "s1", view: withDefault("summary") });
    expect(o.messages).toEqual([{ t: "read", sessionId: "s1", mode: "summary" }]);
    expect(o.state.mode).toBe("summary");
  });

  it("X (toggle) pide el otro modo, vuelve a cargar y empieza arriba; otra vez regresa", () => {
    let s = opened();
    s = reduceReader(s, { type: "scroll", delta: 5 }).state;
    const a = reduceReader(s, { type: "toggle", view: view() });
    expect(a.messages).toEqual([{ t: "read", sessionId: "s1", mode: "summary" }]);
    expect(a.state).toMatchObject({ open: true, loading: true, top: 0, stale: false, mode: "summary" });
    const shown = reduceReader(a.state, { type: "text", msg: text(many(5), { mode: "summary" }) }).state;
    expect(shownMode(shown)).toBe("summary");
    const b = reduceReader(shown, { type: "toggle", view: view() });
    expect(b.messages).toEqual([{ t: "read", sessionId: "s1" }]);
    expect(b.state.mode).toBe("full");
  });

  it("X no hace nada cargando ni cerrado", () => {
    const loading = reduceReader(createReader(), { type: "open", sessionId: "s1", view: view() }).state;
    expect(reduceReader(loading, { type: "toggle", view: view() }).messages).toEqual([]);
    expect(reduceReader(createReader(), { type: "toggle", view: view() }).messages).toEqual([]);
  });

  it("recargar (mensaje nuevo) conserva el modo que se estaba viendo", () => {
    let s = reduceReader(createReader(), { type: "open", sessionId: "s1", view: withDefault("summary") }).state;
    s = reduceReader(s, { type: "text", msg: text(many(5), { mode: "summary", short: true }) }).state;
    expect(s.doc.short).toBe(true);
    const r = reduceReader(s, { type: "reload", view: view() });
    expect(r.messages).toEqual([{ t: "read", sessionId: "s1", mode: "summary" }]);
  });

  it("un puente anterior que no manda mode se muestra como completo y X ofrece el resumen", () => {
    // se pidió resumen pero la respuesta no trae mode: es el mensaje entero
    let s = reduceReader(createReader(), { type: "open", sessionId: "s1", view: withDefault("summary") }).state;
    s = reduceReader(s, { type: "text", msg: text(many(5)) }).state;
    expect(shownMode(s)).toBe("full");
    expect(reduceReader(s, { type: "toggle", view: view() }).messages).toEqual([{ t: "read", sessionId: "s1", mode: "summary" }]);
  });

  it("una tarjeta de permiso cierra el lector también en resumen", () => {
    const s = reduceReader(createReader(), { type: "open", sessionId: "s1", view: withDefault("summary") }).state;
    expect(reduceReader(s, { type: "view", view: view({ request }), nav }).state.open).toBe(false);
  });
});

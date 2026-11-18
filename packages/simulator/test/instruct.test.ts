import { describe, expect, it } from "vitest";
// @ts-expect-error módulo JS sin tipos (página estática)
import { INSTRUCT_GUARD_MS, ROWS, rowsOf, canInstruct, clearMessages, cleanInstruction, createInstruct, instructReady, isInstructionCard, queuedOf, reduceInstruct, toggleWaitMessages, waitingOf, writeEffect } from "../public/instruct.js";
// @ts-expect-error módulo JS sin tipos (página estática)
import { bAction, skipMessages } from "../public/nav.js";
// @ts-expect-error módulo JS sin tipos (página estática)
import { canOpen as menuCanOpen, mustClose as menuMustClose, createMenu, reduceMenu, ROOT_ENTRIES, entryEnabled } from "../public/menu.js";

const request = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  sessionId: "s1",
  kind: "instruction",
  title: "Claude espera tu instrucción",
  lines: ["Terminé el login."],
  risk: "normal",
  expiresInS: 0,
  position: 1,
  total: 1,
  ...over,
});
const view = (req: unknown = request(), extra: Record<string, unknown> = {}) => ({
  sessions: [{ id: "s1", kind: "claude", title: "t", project: "p", model: "m", state: "ask", activity: "" }],
  request: req,
  pendingCount: req ? 1 : 0,
  mode: "queue",
  face: { kind: "claude", mood: "ask", lines: ["Espera tu instrucción"] },
  detail: null,
  led: "ask",
  ...extra,
});

const T0 = 10_000;
type Ev = Record<string, unknown>;
function run(state: any, req: any, ...events: Ev[]) {
  const messages: unknown[] = [];
  const effects: unknown[] = [];
  for (const ev of events) {
    const r = reduceInstruct(state, ev, req);
    state = r.state;
    messages.push(...r.messages);
    if (r.effect) effects.push(r.effect);
  }
  return { state, messages, effects };
}
const start = (req: any = request()) => run(createInstruct(), req, { type: "connection", connected: true }, { type: "view", now: T0, request: req }).state;
const A = (now = T0 + INSTRUCT_GUARD_MS): Ev => ({ type: "activate", now });

describe("instruct: la tarjeta Espera tu instrucción", () => {
  it("se reconoce solo con kind instruction", () => {
    expect(isInstructionCard(view())).toBe(true);
    expect(isInstructionCard(view(request({ kind: "question" })))).toBe(false);
    expect(isInstructionCard(view({ ...request(), kind: undefined }))).toBe(false);
    expect(isInstructionCard(view(null))).toBe(false);
  });

  it("guarda de 500 ms: A no hace nada antes; después Escribir pide el teclado (sin marcar enviada) y no manda mensajes", () => {
    const s = start();
    const early = run(s, request(), A(T0 + INSTRUCT_GUARD_MS - 1));
    expect(early.messages).toEqual([]);
    expect(early.effects).toEqual([]);
    const ok = run(s, request(), A());
    expect(ok.effects).toEqual([{ kind: "write", sessionId: "s1" }]);
    expect(ok.messages).toEqual([]);
    expect(ok.state.sent).toBe(false);
    expect(instructReady(ok.state, T0 + 5000)).toBe(true);
    // una repetición de la tecla no cuenta
    expect(run(s, request(), { ...A(), repeat: true }).effects).toEqual([]);
  });

  it("Seguir en el PC manda release con el id de la solicitud, una sola vez, y nunca una decisión", () => {
    const r = run(start(), request(), { type: "move", dy: 1 }, A(), A(T0 + 2000));
    expect(r.messages).toEqual([{ t: "release", requestId: "r1" }]);
    expect(r.state.sent).toBe(true);
    expect(JSON.stringify(r)).not.toContain("decision");
  });

  it("el cursor se queda en las dos filas y tocar una fila la elige", () => {
    let r = run(start(), request(), { type: "move", dy: 5 });
    expect(r.state.cursor).toBe(ROWS.length - 1);
    r = run(r.state, request(), { type: "move", dy: -5 });
    expect(r.state.cursor).toBe(0);
    r = run(r.state, request(), { type: "select", row: 1 }, { type: "select", row: 2 });
    expect(r.state.cursor).toBe(1);
    const touch = run(start(), request(), { type: "activate", now: T0 + 600, row: 1 });
    expect(touch.messages).toEqual([{ t: "release", requestId: "r1" }]);
  });

  it("lo escrito se limpia y sale como instruct a la sesión; vacío o cancelado no manda nada; desde la tarjeta marca enviada", () => {
    const r = run(start(), request(), { type: "text", sessionId: "s1", text: "  Agrega\npruebas  " });
    expect(r.messages).toEqual([{ t: "instruct", sessionId: "s1", text: "Agrega pruebas" }]);
    expect(r.state.sent).toBe(true);
    for (const text of ["", "   \n ", null, undefined]) {
      const c = run(start(), request(), { type: "text", sessionId: "s1", text });
      expect(c.messages).toEqual([]);
      expect(c.state.sent).toBe(false);
    }
    // del detalle (otra sesión o sin tarjeta): sale igual y no toca la tarjeta
    const d = run(createInstruct(), null, { type: "text", sessionId: "s2", text: "hola" });
    expect(d.messages).toEqual([{ t: "instruct", sessionId: "s2", text: "hola" }]);
    expect(run(start(), request(), { type: "text", sessionId: "s2", text: "hola" }).state.sent).toBe(false);
  });

  it("cleanInstruction: controles a espacio, recorta y corta a 400 caracteres (sin partir emoji)", () => {
    expect(cleanInstruction("a\tb\u0000c")).toBe("a b c");
    expect(cleanInstruction("😀".repeat(500))).toBe("😀".repeat(400));
    expect(cleanInstruction(5)).toBe("");
  });

  it("una tarjeta distinta empieza de cero; la misma vista repetida no; sin conexión A no hace nada", () => {
    let s = start();
    s = run(s, request(), { type: "move", dy: 1 }).state;
    expect(run(s, request(), { type: "view", now: T0 + 9000, request: request() }).state).toEqual(s);
    const other = request({ id: "r2" });
    const fresh = run(s, other, { type: "view", now: T0 + 9000, request: other }).state;
    expect(fresh).toMatchObject({ id: "r2", since: T0 + 9000, cursor: 0, sent: false });
    const offline = run(start(), request(), { type: "connection", connected: false });
    expect(run(offline.state, request(), A()).effects).toEqual([]);
    // una tarjeta de otro tipo (o ninguna) la borra
    expect(run(s, null, { type: "view", now: T0, request: null }).state.id).toBeNull();
    expect(run(s, request({ kind: "question" }), { type: "view", now: T0, request: request({ kind: "question" }) }).state.id).toBeNull();
  });

  it("B nunca envía ni libera ni rechaza; L/R saltan a otra solicitud; el menú no se abre con la tarjeta", () => {
    expect(bAction(view())).toBe("instruction");
    expect(skipMessages(view(request({ total: 2 }), { pendingCount: 2 }))).toEqual([{ t: "skip" }]);
    expect(skipMessages(view(request(), { pendingCount: 1 }))).toEqual([]);
    expect(menuCanOpen(view())).toBe(false);
    expect(menuMustClose({ ...createMenu(), open: true }, view())).toBe(true);
  });
});

describe("instruct: detalle de la sesión", () => {
  const nav = { level: "detail", kind: "claude", sessionId: "s1", cursor: 0 };
  const detailView = (detail: object | null, settings: object | null = { notifyDefault: "important", notifyAck: true, hiddenAgents: [], instructWaitMax: 10 }) =>
    view(null, { detail: detail ? { sessionId: "s1", lastMessage: ["Listo."], ...detail } : null, ...(settings ? { settings } : {}), led: "off" });

  it("solo se ofrece sin tarjeta, en el detalle abierto y si el puente manda instructWaitMax", () => {
    expect(canInstruct(detailView({}), nav)).toBe(true);
    expect(canInstruct(detailView({}, null), nav)).toBe(false);
    expect(canInstruct(detailView({}), { ...nav, level: "sessions" })).toBe(false);
    expect(canInstruct(detailView({}), { ...nav, sessionId: "s2" })).toBe(false);
    expect(canInstruct(detailView(null), nav)).toBe(false);
    expect(canInstruct({ ...detailView({}), request: request() }, nav)).toBe(false);
    expect(canInstruct({ ...detailView({}), notice: { id: "n1" } }, nav)).toBe(false);
  });

  it("X escribe, izquierda/derecha alternan Esperar y abajo borra la cola solo si hay", () => {
    expect(writeEffect(detailView({}), nav)).toEqual({ kind: "write", sessionId: "s1" });
    expect(writeEffect(detailView({}, null), nav)).toBeNull();
    expect(toggleWaitMessages(detailView({}), nav)).toEqual([{ t: "setting", key: "sessionWait", sessionId: "s1", value: true }]);
    expect(toggleWaitMessages(detailView({ waitForMe: true }), nav)).toEqual([{ t: "setting", key: "sessionWait", sessionId: "s1", value: false }]);
    expect(waitingOf(detailView({ waitForMe: true }), nav)).toBe(true);
    expect(waitingOf(detailView({}), nav)).toBe(false);
    expect(clearMessages(detailView({}), nav)).toEqual([]);
    const queued = detailView({ instructions: { count: 2, first: "Agrega pruebas" } });
    expect(queuedOf(queued, nav)).toEqual({ count: 2, first: "Agrega pruebas" });
    expect(clearMessages(queued, nav)).toEqual([{ t: "instructClear", sessionId: "s1" }]);
    expect(toggleWaitMessages(detailView({}, null), nav)).toEqual([]);
  });
});

describe("instruct: entrada del menú", () => {
  it("es la entrada 5 y exige que el puente la mande", () => {
    expect(ROOT_ENTRIES[5]).toBe("instructWait");
    expect(entryEnabled("instructWait", view(null, { settings: { notifyDefault: "end", notifyAck: true, hiddenAgents: [] } }))).toBe(false);
    expect(reduceMenu(createMenu(), view(null), { type: "open" }).state.open).toBe(true);
  });
});

describe("instruct: atajos de un toque (Fase 3)", () => {
  const QUICK = [
    { label: "Sigue", text: "Sigue con lo que estabas haciendo." },
    { label: "Corre las pruebas", text: "Corre las pruebas y arregla lo que falle." },
    { label: "Haz commit", text: "Haz commit de los cambios con un mensaje claro." },
    { label: "Resume", text: "Resume en pocas líneas qué hiciste y qué falta." },
  ];
  const withQuick = (n = 4) => request({ quick: QUICK.slice(0, n) });
  const M = (dy: number, dx = 0): Ev => ({ type: "move", dy, dx });

  it("las filas son los atajos y después Escribir y Seguir; el cursor empieza en Escribir", () => {
    expect(rowsOf(withQuick()).map((r: any) => r.kind)).toEqual(["quick", "quick", "quick", "quick", "write", "release"]);
    expect(rowsOf(request()).map((r: any) => r.kind)).toEqual(["write", "release"]); // sin atajos, como antes
    expect(rowsOf(request({ kind: "permission", quick: QUICK })).length).toBe(2); // solo con kind instruction
    const s = start(withQuick());
    expect(s.quick).toBe(4);
    expect(s.cursor).toBe(4);
    // A suelto abre el teclado, no manda una orden
    const r = run(s, withQuick(), A());
    expect(r.effects).toEqual([{ kind: "write", sessionId: "s1" }]);
    expect(r.messages).toEqual([]);
  });

  it("la cruceta recorre la cuadrícula de dos columnas", () => {
    const req = withQuick();
    const at = (...evs: Ev[]) => run(start(req), req, ...evs).state.cursor;
    expect(at(M(-1))).toBe(3);
    expect(at(M(-1), M(-1))).toBe(1);
    expect(at(M(-1), M(-1), M(-1))).toBe(1);
    expect(at(M(-1), M(-1), M(0, -1))).toBe(0);
    expect(at(M(-1), M(-1), M(0, 1))).toBe(1);
    expect(at(M(-1), M(0, 1))).toBe(3); // no pasa de columna
    expect(at(M(-1), M(0, -1), M(1))).toBe(4); // del último atajo (fila de abajo) a Escribir
    expect(at(M(1), M(1), M(1))).toBe(5);
    expect(at(M(0, 1))).toBe(4); // izquierda/derecha no mueven las filas fijas
    // tres atajos: el tercero queda solo en su fila
    const r3 = withQuick(3);
    const at3 = (...evs: Ev[]) => run(start(r3), r3, ...evs).state.cursor;
    expect(at3(M(-1))).toBe(2);
    expect(at3(M(-1), M(0, 1))).toBe(2);
    expect(at3({ type: "select", row: 1 }, M(1))).toBe(3);
    expect(run(start(r3), r3, { type: "select", row: 5 }).state.cursor).toBe(3); // fuera de rango
  });

  it("un atajo manda su texto como instruct, una sola vez, con la guarda de 500 ms y nunca una decisión", () => {
    const req = withQuick();
    const s = start(req);
    expect(run(s, req, { type: "activate", now: T0 + INSTRUCT_GUARD_MS - 1, row: 1 }).messages).toEqual([]);
    expect(run(s, req, { type: "activate", now: T0 + INSTRUCT_GUARD_MS, row: 1, repeat: true }).messages).toEqual([]);
    const r = run(s, req, { type: "activate", now: T0 + INSTRUCT_GUARD_MS, row: 1 }, A(T0 + 2000), { type: "activate", now: T0 + 2100, row: 2 });
    expect(r.messages).toEqual([{ t: "instruct", sessionId: "s1", text: "Corre las pruebas y arregla lo que falle." }]);
    expect(r.state.sent).toBe(true);
    expect(JSON.stringify(r)).not.toContain("decision");
    // con la cruceta
    const k = run(start(req), req, M(-1), M(-1), M(0, -1), A());
    expect(k.messages).toEqual([{ t: "instruct", sessionId: "s1", text: "Sigue con lo que estabas haciendo." }]);
  });

  it("Escribir y Seguir siguen funcionando en su lugar nuevo", () => {
    const req = withQuick();
    expect(run(start(req), req, { type: "activate", now: T0 + 600, row: 4 }).effects).toEqual([{ kind: "write", sessionId: "s1" }]);
    expect(run(start(req), req, { type: "activate", now: T0 + 600, row: 5 }).messages).toEqual([{ t: "release", requestId: "r1" }]);
    expect(run(start(req), req, { type: "activate", now: T0 + 600, row: 6 }).messages).toEqual([]);
  });
});

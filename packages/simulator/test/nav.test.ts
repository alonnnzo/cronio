import { describe, expect, it } from "vitest";
// @ts-expect-error módulo JS sin tipos (página estática)
import { createNav, reduce, bAction, skipMessages, modeMessages, sessionsOf, itemCount, KINDS } from "../public/nav.js";

type Nav = { level: string; kind: string | null; sessionId: string | null; cursor: number };

const session = (id: string, kind: string, state = "idle") => ({ id, kind, title: id, project: "p", model: "m", state, activity: "" });
const baseView = (sessions: ReturnType<typeof session>[], extra: Record<string, unknown> = {}) => ({
  sessions,
  request: null,
  pendingCount: 0,
  mode: "queue",
  face: { kind: null, mood: "idle", lines: ["x"] },
  detail: null,
  led: "off",
  ...extra,
});
const request = { id: "r1", sessionId: "a", title: "t", lines: ["ls"], risk: "normal", expiresInS: 40, position: 1, total: 1 };

const view = baseView([session("a", "claude"), session("b", "claude"), session("c", "claude"), session("g", "gemini")]);

function run(state: Nav, v: unknown, ...actions: object[]) {
  let s = state;
  const messages: unknown[] = [];
  for (const a of actions) {
    const r = reduce(s, v, a);
    s = r.state;
    messages.push(...r.messages);
  }
  return { state: s, messages };
}

describe("nav: entrar y salir", () => {
  it("empieza en agentes", () => {
    expect(createNav()).toEqual({ level: "agents", kind: null, sessionId: null, cursor: 0 });
  });

  it("agentes -> sesiones -> detalle: solo entrar al detalle envía focus", () => {
    const a = run(createNav(), view, { type: "enter" });
    expect(a.state).toEqual({ level: "sessions", kind: "claude", sessionId: null, cursor: 0 });
    expect(a.messages).toEqual([]);
    const b = run(a.state, view, { type: "move", dx: 0, dy: 1 }, { type: "enter" });
    expect(b.state).toEqual({ level: "detail", kind: "claude", sessionId: "b", cursor: 0, confirmed: false, since: 0 });
    expect(b.messages).toEqual([{ t: "focus", sessionId: "b" }]);
  });

  it("salir del detalle envía focus null y deja el cursor en esa sesión", () => {
    const r = run({ level: "detail", kind: "claude", sessionId: "c", cursor: 0 }, view, { type: "back" });
    expect(r.state).toEqual({ level: "sessions", kind: "claude", sessionId: null, cursor: 2 });
    expect(r.messages).toEqual([{ t: "focus", sessionId: null }]);
  });

  it("volver de sesiones a agentes no envía nada y deja el cursor en el agente", () => {
    const r = run({ level: "sessions", kind: "gemini", sessionId: null, cursor: 0 }, view, { type: "back" });
    expect(r.state).toEqual({ level: "agents", kind: null, sessionId: null, cursor: 1 });
    expect(r.messages).toEqual([]);
  });

  it("volver en agentes no hace nada", () => {
    const r = run(createNav(), view, { type: "back" });
    expect(r.state).toEqual(createNav());
    expect(r.messages).toEqual([]);
  });

  it("enter con índice (clic) entra a ese elemento", () => {
    expect(run(createNav(), view, { type: "enter", index: 1 }).state.kind).toBe("gemini");
    const s = run(createNav(), view, { type: "enter", index: 0 }).state;
    const r = run(s, view, { type: "enter", index: 2 });
    expect(r.state.sessionId).toBe("c");
    expect(r.messages).toEqual([{ t: "focus", sessionId: "c" }]);
  });

  it("enter con un índice fuera de rango o sin sesiones no cambia nada", () => {
    expect(run(createNav(), view, { type: "enter", index: 9 }).state).toEqual(createNav());
    const inSessions = { level: "sessions", kind: "cursor", sessionId: null, cursor: 0 };
    const r = run(inSessions, view, { type: "enter" });
    expect(r.state).toEqual(inSessions);
    expect(r.messages).toEqual([]);
  });

  it("enter en el detalle no hace nada", () => {
    const d = { level: "detail", kind: "claude", sessionId: "a", cursor: 0 };
    expect(run(d, view, { type: "enter" })).toEqual({ state: d, messages: [] });
  });

  it("un agente sin sesiones se puede abrir y muestra la lista vacía", () => {
    const r = run(createNav(), view, { type: "move", dx: 1, dy: 0 }, { type: "move", dx: 1, dy: 0 }, { type: "enter" });
    expect(r.state).toMatchObject({ level: "sessions", kind: "codex" });
    expect(itemCount(r.state, view)).toBe(0);
  });
});

describe("nav: cursor", () => {
  it("cuadrícula de 3 columnas con borde", () => {
    const m = (s: Nav, dx: number, dy: number) => run(s, view, { type: "move", dx, dy }).state;
    let s = createNav();
    s = m(s, -1, 0);
    expect(s.cursor).toBe(0); // borde izquierdo
    s = m(s, 0, 1);
    expect(s.cursor).toBe(3);
    s = m(s, 1, 0);
    expect(s.cursor).toBe(4);
    s = m(s, 1, 0);
    expect(s.cursor).toBe(4); // último
    s = m(s, 0, 1);
    expect(s.cursor).toBe(4); // no hay fila de abajo
    s = m(s, 0, -1);
    expect(s.cursor).toBe(1);
    s = m(s, 0, -1);
    expect(s.cursor).toBe(1); // no hay fila de arriba
  });

  it("lista de sesiones: cualquier flecha recorre y se queda en los bordes", () => {
    let s: Nav = { level: "sessions", kind: "claude", sessionId: null, cursor: 0 };
    s = run(s, view, { type: "move", dx: 0, dy: -1 }).state;
    expect(s.cursor).toBe(0);
    s = run(s, view, { type: "move", dx: 0, dy: 1 }, { type: "move", dx: 1, dy: 0 }, { type: "move", dx: 0, dy: 1 }).state;
    expect(s.cursor).toBe(2);
  });

  it("sin elementos, mover no rompe", () => {
    const s: Nav = { level: "sessions", kind: "hermes", sessionId: null, cursor: 0 };
    expect(run(s, view, { type: "move", dx: 0, dy: 1 }).state).toEqual(s);
  });

  it("el cursor vuelve a rango cuando la lista se acorta", () => {
    const s: Nav = { level: "sessions", kind: "claude", sessionId: null, cursor: 2 };
    const shorter = baseView([session("a", "claude")]);
    const r = run(s, shorter, { type: "sync" });
    expect(r.state.cursor).toBe(0);
    expect(r.messages).toEqual([]);
    const none = baseView([]);
    expect(run(s, none, { type: "sync" }).state.cursor).toBe(0);
  });

  it("sync no cambia un estado válido", () => {
    const s: Nav = { level: "sessions", kind: "claude", sessionId: null, cursor: 1 };
    expect(run(s, view, { type: "sync" }).state).toBe(s);
  });
});

describe("nav: la sesión abierta desaparece", () => {
  const d: Nav = { level: "detail", kind: "claude", sessionId: "b", cursor: 0 };

  it("vuelve a la lista del agente y avisa con focus null", () => {
    const gone = baseView([session("a", "claude"), session("c", "claude")]);
    const r = run(d, gone, { type: "sync" });
    expect(r.state).toEqual({ level: "sessions", kind: "claude", sessionId: null, cursor: 0 });
    expect(r.messages).toEqual([{ t: "focus", sessionId: null }]);
  });

  it("si desaparecen todas, la lista queda vacía con el cursor en 0", () => {
    const r = run(d, baseView([session("g", "gemini")]), { type: "sync" });
    expect(r.state).toMatchObject({ level: "sessions", kind: "claude", cursor: 0 });
    expect(sessionsOf(baseView([session("g", "gemini")]), "claude")).toEqual([]);
  });

  it("mientras la sesión siga en la vista no se mueve", () => {
    expect(run(d, view, { type: "sync" })).toEqual({ state: d, messages: [] });
  });
});

describe("nav: B, saltar y modo", () => {
  it("B rechaza si hay tarjeta y vuelve un nivel si no", () => {
    expect(bAction(baseView([], { request }))).toBe("deny");
    expect(bAction(view)).toBe("back");
  });

  it("saltar: solo en modo en fila, con tarjeta y más de un pendiente", () => {
    expect(skipMessages(baseView([], { request, pendingCount: 3, mode: "queue" }))).toEqual([{ t: "skip" }]);
    expect(skipMessages(baseView([], { request, pendingCount: 1, mode: "queue" }))).toEqual([]);
    expect(skipMessages(baseView([], { request: null, pendingCount: 3, mode: "queue" }))).toEqual([]);
    expect(skipMessages(baseView([], { request, pendingCount: 3, mode: "manual" }))).toEqual([]);
  });

  it("modo: alterna entre queue y manual", () => {
    expect(modeMessages(baseView([], { mode: "queue" }))).toEqual([{ t: "mode", mode: "manual" }]);
    expect(modeMessages(baseView([], { mode: "manual" }))).toEqual([{ t: "mode", mode: "queue" }]);
  });

  it("los cinco agentes, en orden", () => {
    expect(KINDS).toEqual(["claude", "gemini", "codex", "cursor", "hermes"]);
  });
});

describe("nav: el puente quita el enfoque de sesión", () => {
  const open = () => run(createNav(), view, { type: "enter" }, { type: "move", dx: 1, dy: 0 }, { type: "enter", now: 100 });
  const withDetail = (id: string | null) => baseView(view.sessions, { detail: id ? { sessionId: id, lastMessage: [] } : null });

  it("entrar al detalle no rebota mientras llega la vista que lo confirma", () => {
    const e = open();
    expect(e.state).toMatchObject({ level: "detail", sessionId: "b", confirmed: false, since: 100 });
    expect(e.messages).toEqual([{ t: "focus", sessionId: "b" }]);
    // vistas viejas (sin detalle) dentro del plazo: se queda
    const r1 = run(e.state, withDetail(null), { type: "sync", now: 150 }, { type: "sync", now: 1099 });
    expect(r1.state).toBe(e.state);
    expect(r1.messages).toEqual([]);
    // llega la vista con el detalle: queda confirmado
    const r2 = run(e.state, withDetail("b"), { type: "sync", now: 200 });
    expect(r2.state).toMatchObject({ level: "detail", confirmed: true });
  });

  it("otro cliente envía focus(null): tras confirmarse, vuelve a sesiones sin enviar focus", () => {
    const e = open();
    const confirmed = run(e.state, withDetail("b"), { type: "sync", now: 200 }).state;
    const r = run(confirmed, withDetail(null), { type: "sync", now: 300 });
    expect(r.state).toEqual({ level: "sessions", kind: "claude", sessionId: null, cursor: 1 });
    expect(r.messages).toEqual([]);
  });

  it("skip: el detalle pasa a otra sesión o a ninguna y el cliente vuelve a sesiones", () => {
    const e = open();
    const confirmed = run(e.state, withDetail("b"), { type: "sync", now: 200 }).state;
    const r = run(confirmed, withDetail("c"), { type: "sync", now: 300 });
    expect(r.state).toMatchObject({ level: "sessions", kind: "claude", sessionId: null });
    expect(r.messages).toEqual([]);
  });

  it("si el puente nunca confirma, tras 1 s vuelve a sesiones sin enviar focus", () => {
    const e = open();
    const r = run(e.state, withDetail(null), { type: "sync", now: 1100 });
    expect(r.state).toMatchObject({ level: "sessions", kind: "claude", sessionId: null });
    expect(r.messages).toEqual([]);
  });
});

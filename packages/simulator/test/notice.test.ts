import { describe, expect, it } from "vitest";
// @ts-expect-error módulo JS sin tipos (página estática)
import { NOTIFY_ORDER, ackMessage, chimeStep, createChime, cycleNotifyMessages, detailNotify, nextNotify, noticeApproval, noticeShown, skipNoticeMessages } from "../public/notice.js";
// @ts-expect-error módulo JS sin tipos (página estática)
import { createApproval, approveReduce, approveReady } from "../public/approve.js";
// @ts-expect-error módulo JS sin tipos (página estática)
import { createReader, reduceReader, canOpen as readerCanOpen, mustClose as readerMustClose } from "../public/reader.js";
// @ts-expect-error módulo JS sin tipos (página estática)
import { createMenu, reduceMenu, canOpen as menuCanOpen, mustClose as menuMustClose } from "../public/menu.js";
// @ts-expect-error módulo JS sin tipos (página estática)
import { createNav, reduce, skipMessages } from "../public/nav.js";

const sessions = [
  { id: "s1", kind: "claude", title: "t", project: "mi-portal", model: "m", state: "done", activity: "" },
  { id: "s2", kind: "codex", title: "v", project: "ATLAS", model: "m", state: "ask", activity: "" },
];
const notice = (over: Record<string, unknown> = {}) => ({
  id: "n1",
  sessionId: "s1",
  kind: "done",
  agent: "Claude",
  project: "mi-portal",
  title: "Terminó",
  lines: ["Listo el hero."],
  position: 1,
  total: 1,
  ...over,
});
const request = { id: "r1", sessionId: "s2", title: "t", lines: ["ls"], risk: "normal", expiresInS: 0, position: 1, total: 1 };
const view = (extra: Record<string, unknown> = {}) => ({
  sessions,
  request: null,
  pendingCount: 0,
  mode: "queue",
  face: { kind: null, mood: "idle", lines: ["x"] },
  detail: null,
  led: "off",
  ...extra,
});
const navDetail = { level: "detail", kind: "claude", sessionId: "s1", cursor: 0 };

/** El gesto de "Visto": otra instancia de la máquina de aprobar, alimentada con `noticeApproval`. */
function ackRun(events: ((s: any) => any)[]) {
  let state = approveReduce(createApproval(), { type: "connection", connected: true }).state;
  const emitted: unknown[] = [];
  for (const ev of events) {
    const r = approveReduce(state, ev(state));
    state = r.state;
    if (r.emit) emitted.push(r.emit);
  }
  return { state, emitted };
}
const show = (now: number, v: unknown) => () => ({ type: "view", now, request: noticeApproval(v) });
const down = (now: number) => () => ({ type: "down", now, source: "key" });
const up = (now: number) => () => ({ type: "up", now, source: "key" });

describe("notice: qué se muestra", () => {
  it("solo sin tarjeta de permiso: los permisos van primero", () => {
    expect(noticeShown(view({ notice: notice() }))).toBe(true);
    expect(noticeShown(view())).toBe(false);
    expect(noticeShown(view({ notice: notice(), request }))).toBe(false); // un puente con errores no puede hacer que gane el aviso
    expect(noticeShown(null)).toBe(false);
    expect(noticeApproval(view({ notice: notice(), request }))).toBeNull();
    expect(noticeApproval(view({ notice: notice() }))).toEqual({ id: "n1", risk: "normal", owner: "aviso", lines: ["Listo el hero."] });
  });
});

describe("notice: 'Visto' (gesto propio)", () => {
  const v = view({ notice: notice() });
  it("A tras la guarda emite ack y nunca una decisión", () => {
    const { emitted } = ackRun([show(0, v), down(600), up(650)]);
    expect(emitted).toEqual([{ requestId: "n1", decision: "allow" }]); // el emit de approve.js es genérico; app.js lo convierte en { t: 'ack', id }
    expect(ackMessage("n1")).toEqual({ t: "ack", id: "n1" });
  });

  it("dentro de la guarda de 500 ms no marca", () => {
    expect(ackRun([show(0, v), down(300), up(350)]).emitted).toEqual([]);
  });

  it("una pulsación que empezó antes de que apareciera el aviso no lo marca", () => {
    const none = view();
    const { emitted } = ackRun([show(0, none), down(100), show(150, v), up(200)]);
    expect(emitted).toEqual([]);
  });

  it("otro aviso (otro id o líneas) o un permiso que llega anula el gesto en curso", () => {
    expect(ackRun([show(0, v), down(600), show(650, view({ notice: notice({ id: "n2" }) })), up(700)]).emitted).toEqual([]);
    expect(ackRun([show(0, v), down(600), show(650, view({ notice: notice({ lines: ["otra cosa"] }) })), up(700)]).emitted).toEqual([]);
    expect(ackRun([show(0, v), down(600), show(650, view({ notice: notice(), request })), up(700)]).emitted).toEqual([]); // llegó un permiso
  });

  it("el botón se habilita pasada la guarda y no se repite tras marcar", () => {
    const { state } = ackRun([show(0, v), down(600), up(650)]);
    expect(approveReady(state, 700)).toBe(false); // ya marcado
    const fresh = ackRun([show(0, v)]).state;
    expect(approveReady(fresh, 100)).toBe(false);
    expect(approveReady(fresh, 600)).toBe(true);
  });

  it("una instancia no toca a la otra: un gesto de aviso no aprueba el permiso", () => {
    // gesto de "Visto" en curso; llega un permiso a la máquina de aprobar y se suelta A
    let seen = approveReduce(createApproval(), { type: "connection", connected: true }).state;
    let perm = approveReduce(createApproval(), { type: "connection", connected: true }).state;
    seen = approveReduce(seen, { type: "view", now: 0, request: noticeApproval(view({ notice: notice() })) }).state;
    perm = approveReduce(perm, { type: "down", now: 700, source: "key" }).state; // A pulsada: la máquina de permisos no tiene nada
    seen = approveReduce(seen, { type: "down", now: 700, source: "key" }).state;
    perm = approveReduce(perm, { type: "view", now: 800, request: { id: "r1", risk: "normal", owner: "Codex · v", lines: ["ls"] } }).state;
    seen = approveReduce(seen, { type: "view", now: 800, request: null }).state; // el aviso se retira porque hay permiso
    const p = approveReduce(perm, { type: "up", now: 900, source: "key" });
    const a = approveReduce(seen, { type: "up", now: 900, source: "key" });
    expect(p.emit).toBeNull(); // la pulsación empezó antes de la tarjeta de permiso
    expect(a.emit).toBeNull();
  });
});

describe("notice: L/R y modo de aviso", () => {
  it("L/R pasan entre avisos solo con varios y sin permiso; con permisos mandan los permisos", () => {
    expect(skipNoticeMessages(view({ notice: notice({ total: 3 }) }))).toEqual([{ t: "skipNotice" }]);
    expect(skipNoticeMessages(view({ notice: notice() }))).toEqual([]);
    expect(skipNoticeMessages(view({ notice: notice({ total: 3 }), request }))).toEqual([]);
    expect(skipMessages(view({ request: { ...request }, pendingCount: 2, notice: notice({ total: 3 }) }))).toEqual([{ t: "skip" }]);
  });

  it("Y recorre todo → lo importante → solo al terminar → silencio → todo", () => {
    expect(NOTIFY_ORDER).toEqual(["all", "important", "end", "silent"]);
    expect(["all", "important", "end", "silent"].map(nextNotify)).toEqual(["important", "end", "silent", "all"]);
    const v = (notify: string) => view({ detail: { sessionId: "s1", lastMessage: [], notify } });
    expect(cycleNotifyMessages(v("end"), navDetail)).toEqual([{ t: "setting", key: "sessionNotify", sessionId: "s1", value: "silent" }]);
    expect(cycleNotifyMessages(v("silent"), navDetail)).toEqual([{ t: "setting", key: "sessionNotify", sessionId: "s1", value: "all" }]);
  });

  it("solo en el detalle de esa sesión, con el modo que manda el puente y sin permiso a la vista", () => {
    const v = view({ detail: { sessionId: "s1", lastMessage: [], notify: "all" } });
    expect(cycleNotifyMessages(v, createNav())).toEqual([]); // en la lista de agentes
    expect(cycleNotifyMessages(v, { ...navDetail, sessionId: "s2" })).toEqual([]); // el detalle es de otra sesión
    expect(cycleNotifyMessages(view({ detail: { sessionId: "s1", lastMessage: [] } }), navDetail)).toEqual([]); // puente anterior: sin modo
    expect(cycleNotifyMessages(view({ request, detail: { sessionId: "s1", lastMessage: [], notify: "all" } }), navDetail)).toEqual([]); // con permiso Y es "siempre"
    expect(detailNotify(v, navDetail)).toBe("all");
  });

  it("con un aviso a la vista el modo de aviso sigue pudiéndose cambiar", () => {
    const v = view({ notice: notice(), detail: { sessionId: "s1", lastMessage: [], notify: "important" } });
    expect(cycleNotifyMessages(v, navDetail)).toHaveLength(1);
  });
});

describe("notice: lector, menú y navegación ceden como ante un permiso", () => {
  const withNotice = view({ notice: notice() });

  it("el menú se cierra con un aviso y no se abre: primero se marca 'Visto'", () => {
    const open = reduceMenu(createMenu(), view(), { type: "open" }).state;
    expect(menuMustClose(open, withNotice)).toBe(true);
    expect(menuMustClose(open, view({ notice: notice(), request }))).toBe(true);
    expect(menuMustClose(open, view())).toBe(false);
    expect(menuCanOpen(withNotice)).toBe(false);
    expect(menuCanOpen(view())).toBe(true);
    expect(reduceMenu(createMenu(), withNotice, { type: "open" }).state.open).toBe(false);
  });

  it("el lector normal se cierra con un aviso; el abierto con 'Leer todo' no, pero sí con un permiso", () => {
    expect(readerCanOpen(navDetail, view())).toBe(true);
    expect(readerCanOpen(navDetail, withNotice)).toBe(false); // A marca "Visto"
    const normal = reduceReader(createReader(), { type: "open", sessionId: "s1", view: view() }).state;
    expect(readerMustClose(normal, navDetail, withNotice)).toBe(true);
    expect(reduceReader(normal, { type: "view", view: withNotice, nav: navDetail }).state.open).toBe(false);
    // sin 'fromNotice', abrir con un aviso a la vista no abre
    expect(reduceReader(createReader(), { type: "open", sessionId: "s1", view: withNotice }).state.open).toBe(false);
    const r = reduceReader(createReader(), { type: "open", sessionId: "s1", view: withNotice, fromNotice: true });
    expect(r.messages).toEqual([{ t: "read", sessionId: "s1" }]);
    expect(r.state).toMatchObject({ open: true, fromNotice: true });
    expect(readerMustClose(r.state, navDetail, withNotice)).toBe(false);
    expect(reduceReader(r.state, { type: "view", view: withNotice, nav: navDetail }).state.open).toBe(true);
    expect(readerMustClose(r.state, navDetail, view({ notice: notice(), request }))).toBe(true); // el permiso siempre manda
    expect(reduceReader(r.state, { type: "view", view: view({ request }), nav: navDetail }).state.open).toBe(false);
    // recargar conserva de dónde se abrió
    const re = reduceReader(r.state, { type: "reload", view: withNotice });
    expect(re.state).toMatchObject({ open: true, loading: true, fromNotice: true });
    expect(re.messages).toEqual([{ t: "read", sessionId: "s1" }]);
  });

  it("openSession abre el detalle de la sesión del aviso desde cualquier nivel y enfoca una sola vez", () => {
    const v = view({ notice: notice() });
    const r = reduce(createNav(), v, { type: "openSession", sessionId: "s1", now: 5 });
    expect(r.state).toMatchObject({ level: "detail", kind: "claude", sessionId: "s1", confirmed: false });
    expect(r.messages).toEqual([{ t: "focus", sessionId: "s1" }]);
    expect(reduce(r.state, v, { type: "openSession", sessionId: "s1" }).messages).toEqual([]); // ya abierto
    expect(reduce(createNav(), v, { type: "openSession", sessionId: "fantasma" }).messages).toEqual([]);
    const hidden = view({ notice: notice(), settings: { notifyDefault: "important", notifyAck: true, hiddenAgents: ["claude"] } });
    expect(reduce(createNav(), hidden, { type: "openSession", sessionId: "s1" }).state.level).toBe("agents");
  });
});

describe("notice: sonido (chime) todavía sin tocar", () => {
  const c = (seq: number, kind = "done") => view({ chime: { kind, seq } });
  it("el primero que se ve es el punto de partida; después suena una vez por seq nuevo", () => {
    let s = createChime();
    let r = chimeStep(s, c(7));
    expect(r.play).toBeNull();
    s = r.state;
    r = chimeStep(s, c(7));
    expect(r.play).toBeNull(); // la misma vista otra vez
    r = chimeStep(r.state, c(8, "ask"));
    expect(r.play).toEqual({ kind: "ask", seq: 8 });
    r = chimeStep(r.state, c(8, "ask"));
    expect(r.play).toBeNull(); // una sola vez
    r = chimeStep(r.state, c(10, "error"));
    expect(r.play).toEqual({ kind: "error", seq: 10 }); // saltos: suena el último
    expect(chimeStep(r.state, view()).play).toBeNull(); // una vista sin chime no suena
    expect(chimeStep(r.state, c(2)).play).toBeNull(); // seq menor (el puente se reinició): nuevo punto de partida
  });
});

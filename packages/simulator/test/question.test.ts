import { describe, expect, it } from "vitest";
// @ts-expect-error módulo JS sin tipos (página estática)
import { QUESTION_GUARD_MS, createQuestion, isQuestionCard, questionReady, reduceQuestion, rowsOf } from "../public/question.js";
// @ts-expect-error módulo JS sin tipos (página estática)
import { bAction, skipMessages } from "../public/nav.js";
// @ts-expect-error módulo JS sin tipos (página estática)
import { createMenu, reduceMenu, canOpen as menuCanOpen, mustClose as menuMustClose } from "../public/menu.js";
// @ts-expect-error módulo JS sin tipos (página estática)
import { createReader, mustClose as readerMustClose } from "../public/reader.js";
// @ts-expect-error módulo JS sin tipos (página estática)
import { noticeShown } from "../public/notice.js";

const opt = (label: string, over: Record<string, unknown> = {}) => ({ label, desc: [`${label} desc`], recommended: false, ...over });
const QUESTIONS = [
  { header: "Fondo", text: ["¿Qué fondo uso?"], multi: false, options: [opt("Video", { recommended: true }), opt("Gradiente"), opt("Imagen")] },
  { header: "Secciones", text: ["¿Qué secciones?"], multi: true, options: [opt("Hero"), opt("Footer"), opt("Menú")] },
  { header: "Tono", text: ["¿Qué tono?"], multi: false, options: [opt("Serio"), opt("Cálido")] },
];
const request = (over: Record<string, unknown> = {}) => ({
  id: "q1",
  sessionId: "s1",
  kind: "question",
  title: "Claude te hace una pregunta",
  lines: ["¿Qué fondo uso?"],
  risk: "normal",
  expiresInS: 0,
  position: 1,
  total: 1,
  questions: QUESTIONS,
  ...over,
});
const view = (req: unknown = request(), extra: Record<string, unknown> = {}) => ({
  sessions: [{ id: "s1", kind: "claude", title: "t", project: "p", model: "m", state: "ask", activity: "" }],
  request: req,
  pendingCount: 1,
  mode: "queue",
  face: { kind: "claude", mood: "ask", lines: ["Te hace una pregunta"] },
  detail: null,
  led: "ask",
  ...extra,
});

const T0 = 10_000;
type Ev = Record<string, unknown>;
/** Aplica eventos en orden con la tarjeta `req` a la vista; devuelve el estado final y todos los mensajes y efectos. */
function run(state: any, req: any, ...events: Ev[]) {
  const messages: unknown[] = [];
  const effects: unknown[] = [];
  for (const ev of events) {
    const r = reduceQuestion(state, ev, req);
    state = r.state;
    messages.push(...r.messages);
    if (r.effect) effects.push(r.effect);
  }
  return { state, messages, effects };
}
const start = (req: any = request()) => run(createQuestion(), req, { type: "connection", connected: true }, { type: "view", now: T0, request: req }).state;
const A = (now = T0 + QUESTION_GUARD_MS): Ev => ({ type: "activate", now });
const down = (n = 1): Ev[] => Array.from({ length: n }, () => ({ type: "move", dy: 1 }));

describe("question.js: filas", () => {
  it("opciones, Listo solo en multiSelect, Otra… y Responder en el PC al final", () => {
    expect(rowsOf(QUESTIONS[0]).map((r: any) => r.kind)).toEqual(["option", "option", "option", "other", "pc"]);
    expect(rowsOf(QUESTIONS[1]).map((r: any) => r.kind)).toEqual(["option", "option", "option", "done", "other", "pc"]);
    expect(rowsOf(QUESTIONS[0]).map((r: any) => r.label).slice(-2)).toEqual(["Otra…", "Responder en el PC"]);
    expect(rowsOf(QUESTIONS[0])[0]).toMatchObject({ label: "Video", recommended: true });
  });

  it("isQuestionCard solo con kind question y preguntas", () => {
    expect(isQuestionCard(view())).toBe(true);
    expect(isQuestionCard(view(request({ kind: undefined, questions: undefined })))).toBe(false);
    expect(isQuestionCard(view(request({ kind: "permission", questions: undefined })))).toBe(false);
    expect(isQuestionCard(view(null))).toBe(false);
  });
});

describe("question.js: elegir y enviar", () => {
  it("una sola pregunta: A elige la fila del cursor y envía answer con el índice (nunca decision)", () => {
    const req = request({ questions: [QUESTIONS[0]] });
    const r = run(start(req), req, ...down(1), A());
    expect(r.messages).toEqual([{ t: "answer", requestId: "q1", answers: [{ choose: [1] }] }]);
    expect(r.state.sent).toBe(true);
  });

  it("varias preguntas: se avanza una por una y se envían todas juntas al final", () => {
    const req = request();
    let t = T0 + QUESTION_GUARD_MS;
    // 1ª: Video (fila 0)
    let r = run(start(req), req, A(t));
    expect(r.messages).toEqual([]);
    expect(r.state).toMatchObject({ index: 1, cursor: 0, sent: false });
    // 2ª (multi): marcar Hero y Menú, bajar a Listo
    t += QUESTION_GUARD_MS;
    r = run(r.state, req, A(t), ...down(2), A(t), ...down(1), A(t));
    expect(r.messages).toEqual([]);
    expect(r.state.index).toBe(2);
    // 3ª: Cálido -> envía las tres
    t += QUESTION_GUARD_MS;
    r = run(r.state, req, ...down(1), A(t));
    expect(r.messages).toEqual([{ t: "answer", requestId: "q1", answers: [{ choose: [0] }, { choose: [0, 2] }, { choose: [1] }] }]);
  });

  it("multiSelect: A marca y desmarca; Listo sin marcas no envía; Listo envía lo marcado en orden", () => {
    const req = request({ questions: [QUESTIONS[1]] });
    const t = T0 + QUESTION_GUARD_MS;
    let r = run(start(req), req, ...down(3), A(t)); // Listo sin nada marcado
    expect(r.messages).toEqual([]);
    expect(r.state.sent).toBe(false);
    r = run(r.state, req, { type: "select", row: 2 }, A(t), { type: "select", row: 0 }, A(t), { type: "select", row: 1 }, A(t), A(t)); // marca 2, 0, 1 y desmarca 1
    expect(r.state.marks[0]).toEqual([true, false, true]);
    r = run(r.state, req, { type: "select", row: 3 }, A(t));
    expect(r.messages).toEqual([{ t: "answer", requestId: "q1", answers: [{ choose: [0, 2] }] }]);
  });

  it("Otra…: pide el texto (efecto) y lo escrito es la respuesta de esa pregunta; vacío o cancelado no hace nada", () => {
    const req = request({ questions: [QUESTIONS[0]] });
    const t = T0 + QUESTION_GUARD_MS;
    let r = run(start(req), req, ...down(3), A(t));
    expect(r.effects).toEqual([{ kind: "other", index: 0 }]);
    expect(r.messages).toEqual([]);
    for (const text of ["", "   ", null, undefined]) {
      const c = run(r.state, req, { type: "text", text, now: t });
      expect(c.messages, String(text)).toEqual([]);
      expect(c.state.sent).toBe(false);
    }
    r = run(r.state, req, { type: "text", text: "  un   mapa\nanimado ", now: t });
    expect(r.messages).toEqual([{ t: "answer", requestId: "q1", answers: [{ other: "un mapa animado" }] }]);
  });

  it("Otra… se recorta a 200 caracteres", () => {
    const req = request({ questions: [QUESTIONS[0]] });
    const r = run(start(req), req, { type: "text", text: "x".repeat(500), now: T0 + QUESTION_GUARD_MS });
    expect((r.messages[0] as any).answers[0].other).toHaveLength(200);
  });

  it("Responder en el PC manda pc: true en el acto", () => {
    const req = request();
    const r = run(start(req), req, ...down(4), A()); // 3 opciones + Otra… + PC (fila 4)
    expect(r.messages).toEqual([{ t: "answer", requestId: "q1", pc: true }]);
    expect(r.state.sent).toBe(true);
  });

  it("después de enviar no se envía otra vez (ni A repetida ni otra fila)", () => {
    const req = request({ questions: [QUESTIONS[0]] });
    const r = run(start(req), req, A(), A(), ...down(1), A());
    expect(r.messages).toHaveLength(1);
  });

  it("sin conexión el reductor no manda nada que ya no esté pendiente: la app solo envía con conexión", () => {
    const req = request({ questions: [QUESTIONS[0]] });
    const s = run(createQuestion(), req, { type: "view", now: T0, request: req }).state;
    expect(questionReady(s, T0 + 5000)).toBe(false);
    expect(run(s, req, A(T0 + 5000)).messages).toEqual([]);
  });
});

describe("question.js: guarda de 500 ms", () => {
  it("A antes de 500 ms desde que llegó la tarjeta no hace nada; justo a los 500 ms sí", () => {
    const req = request({ questions: [QUESTIONS[0]] });
    expect(questionReady(start(req), T0 + QUESTION_GUARD_MS - 1)).toBe(false);
    expect(questionReady(start(req), T0 + QUESTION_GUARD_MS)).toBe(true);
    expect(run(start(req), req, A(T0 + QUESTION_GUARD_MS - 1)).messages).toEqual([]);
    expect(run(start(req), req, A(T0 + QUESTION_GUARD_MS)).messages).toHaveLength(1);
  });

  it("una vista repetida de la misma tarjeta no reinicia la guarda; otra tarjeta sí y empieza de cero", () => {
    const req = request();
    let s = start(req);
    s = run(s, req, { type: "view", now: T0 + 400, request: req }).state;
    expect(questionReady(s, T0 + QUESTION_GUARD_MS)).toBe(true);
    const other = request({ id: "q2" });
    s = run(s, other, { type: "view", now: T0 + 2000, request: other }).state;
    expect(s).toMatchObject({ id: "q2", index: 0, cursor: 0, sent: false });
    expect(questionReady(s, T0 + 2000 + QUESTION_GUARD_MS - 1)).toBe(false);
  });

  it("al pasar a la pregunta siguiente la guarda vuelve a contar (un doble toque no elige la siguiente)", () => {
    const req = request();
    const t = T0 + QUESTION_GUARD_MS;
    const r = run(start(req), req, A(t), A(t + 10));
    expect(r.state.index).toBe(1);
    expect(r.state.marks[1]).toEqual([false, false, false]); // la segunda A no marcó nada
  });

  it("A mantenida (repetición de tecla) se ignora", () => {
    const req = request({ questions: [QUESTIONS[1]] });
    const r = run(start(req), req, { type: "activate", now: T0 + QUESTION_GUARD_MS, repeat: true });
    expect(r.state.marks[0]).toEqual([false, false, false]);
  });

  it("se pierde la tarjeta: el estado se reinicia (nada queda a medias)", () => {
    const req = request();
    let s = run(start(req), req, A()).state;
    expect(s.index).toBe(1);
    s = run(s, null, { type: "view", now: T0 + 3000, request: null }).state;
    expect(s).toMatchObject({ id: null, index: 0, answers: [], connected: true });
    // una permiso no es pregunta
    const perm = { id: "p1", sessionId: "s1", title: "t", lines: ["ls"], risk: "normal", expiresInS: 0, position: 1, total: 1 };
    expect(run(s, perm, { type: "view", now: T0 + 3000, request: perm }).state.id).toBeNull();
  });
});

describe("question.js: B nunca rechaza ni responde", () => {
  it("B vuelve a la pregunta anterior y rehace la respuesta; en la primera no hace nada", () => {
    const req = request();
    const t = T0 + QUESTION_GUARD_MS;
    let r = run(start(req), req, { type: "back" });
    expect(r.state).toMatchObject({ index: 0 });
    expect(r.messages).toEqual([]);
    r = run(r.state, req, A(t), { type: "back" });
    expect(r.state).toMatchObject({ index: 0, cursor: 0, answers: [] });
    r = run(r.state, req, ...down(1), A(t + 1000)); // ahora Gradiente
    expect(r.state.answers).toEqual([{ choose: [1] }]);
    expect(r.messages).toEqual([]);
  });

  it("bAction con una pregunta no es 'deny'; con un permiso sí; sin tarjeta, 'back'", () => {
    expect(bAction(view())).toBe("question");
    expect(bAction(view(null))).toBe("back");
    expect(bAction(view({ id: "p1", sessionId: "s1", title: "t", lines: ["ls"], risk: "normal", expiresInS: 0, position: 1, total: 1 }))).toBe("deny");
    expect(bAction(view(request({ kind: undefined, questions: undefined })))).toBe("deny");
  });

  it("después de enviar B no hace nada", () => {
    const req = request({ questions: [QUESTIONS[0]] });
    const r = run(start(req), req, A(), { type: "back" });
    expect(r.messages).toHaveLength(1);
  });
});

describe("question.js: convivencia con el resto", () => {
  it("la tarjeta de pregunta cierra el menú y el lector, y no deja abrir el menú", () => {
    const v = view();
    const open = reduceMenu(createMenu(), view(null), { type: "open" }).state;
    expect(menuMustClose(open, v)).toBe(true);
    expect(menuCanOpen(v)).toBe(false);
    expect(readerMustClose({ ...createReader(), open: true, sessionId: "s1" }, { level: "detail", sessionId: "s1" }, v)).toBe(true);
    expect(noticeShown({ ...v, notice: { id: "n" } })).toBe(false); // los avisos ceden ante la pregunta, como ante un permiso
  });

  it("L/R saltan entre solicitudes en modo fila (también con una pregunta); sin otras pendientes no", () => {
    expect(skipMessages({ ...view(), pendingCount: 2 })).toEqual([{ t: "skip" }]);
    expect(skipMessages(view())).toEqual([]);
  });

  it("move respeta los extremos de las filas", () => {
    const req = request({ questions: [QUESTIONS[0]] });
    expect(run(start(req), req, { type: "move", dy: -1 }).state.cursor).toBe(0);
    expect(run(start(req), req, ...down(20)).state.cursor).toBe(rowsOf(QUESTIONS[0]).length - 1);
  });
});

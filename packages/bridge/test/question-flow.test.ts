import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewModelSchema, type ViewModel } from "@companion/protocol";
import { BridgeStore, type QuestionOutcome } from "../src/store.ts";
import { FaceController } from "../src/face.ts";
import { buildView } from "../src/view.ts";
import { applyConsoleMessage } from "../src/feed.ts";
import { parseQuestions } from "../src/questions.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const INPUT = {
  questions: [
    {
      question: "¿Qué fondo uso en el hero?",
      header: "Fondo",
      options: [
        { label: "Video (Recommended)", description: "Pesa más" },
        { label: "Gradiente", description: "Liviano" },
      ],
      multiSelect: false,
    },
    {
      question: "¿Qué secciones?",
      header: "Secciones",
      options: [
        { label: "Hero", description: "Portada" },
        { label: "Footer", description: "Pie" },
        { label: "Menú", description: "Arriba" },
      ],
      multiSelect: true,
    },
  ],
};

function make() {
  const store = new BridgeStore();
  const face = new FaceController(store);
  store.upsertSession({ sessionId: "s1", kind: "claude", project: "mi-portal" });
  store.setConsoleConnected(true);
  const view = (): ViewModel => {
    const v = buildView(store, face);
    expect(ViewModelSchema.safeParse(v).success).toBe(true);
    return v;
  };
  const ask = (sessionId = "s1", signal?: AbortSignal): Promise<QuestionOutcome> =>
    store.requestQuestion({ sessionId, toolInput: INPUT, questions: parseQuestions(INPUT)!, signal });
  return { store, face, view, ask };
}

describe("solicitud de pregunta en el store", () => {
  it("sin consola o con el ajuste apagado responde ask en el acto y no encola", async () => {
    const { store, ask } = make();
    store.setConsoleConnected(false);
    await expect(ask()).resolves.toEqual({ decision: "ask" });
    store.setConsoleConnected(true);
    store.setSetting({ key: "questions", value: false });
    await expect(ask()).resolves.toEqual({ decision: "ask" });
    expect(store.pendingCount).toBe(0);
  });

  it("con una señal ya cancelada responde ask", async () => {
    const { store, ask } = make();
    const ac = new AbortController();
    ac.abort();
    await expect(ask("s1", ac.signal)).resolves.toEqual({ decision: "ask" });
    expect(store.pendingCount).toBe(0);
  });

  it("queda en la cola (pendingCount, sesión en ask) y answerQuestion la resuelve con las etiquetas completas", async () => {
    const { store, ask } = make();
    const p = ask();
    expect(store.pendingCount).toBe(1);
    expect(store.getSession("s1")!.state).toBe("ask");
    const id = store.pending[0]!.id;
    expect(store.pending[0]).toMatchObject({ kind: "question", toolName: "AskUserQuestion" });
    expect(store.answerQuestion({ requestId: id, answers: [{ choose: [0] }, { choose: [0, 2] }] })).toBe(true);
    await expect(p).resolves.toEqual({
      decision: "answer",
      answers: { "¿Qué fondo uso en el hero?": "Video (Recommended)", "¿Qué secciones?": "Hero, Menú" },
    });
    expect(store.pendingCount).toBe(0);
    expect(store.getSession("s1")!.state).toBe("working"); // ya nada la tiene esperando
  });

  it("'Otra' manda el texto escrito", async () => {
    const { store, ask } = make();
    const p = ask();
    store.answerQuestion({ requestId: store.pending[0]!.id, answers: [{ other: "Un mapa animado" }, { choose: [1] }] });
    await expect(p).resolves.toEqual({
      decision: "answer",
      answers: { "¿Qué fondo uso en el hero?": "Un mapa animado", "¿Qué secciones?": "Footer" },
    });
  });

  it("'Responder en el PC' (pc) la devuelve como ask", async () => {
    const { store, ask } = make();
    const p = ask();
    expect(store.answerQuestion({ requestId: store.pending[0]!.id, pc: true })).toBe(true);
    await expect(p).resolves.toEqual({ decision: "ask" });
    expect(store.pendingCount).toBe(0);
  });

  it("una respuesta que no cuadra no resuelve nada: la pregunta sigue esperando", async () => {
    const { store, ask } = make();
    const p = ask();
    const id = store.pending[0]!.id;
    expect(store.answerQuestion({ requestId: id, answers: [{ choose: [0] }] })).toBe(false); // faltó una pregunta
    expect(store.answerQuestion({ requestId: id, answers: [{ choose: [2] }, { choose: [0] }] })).toBe(false); // índice fuera
    expect(store.answerQuestion({ requestId: id, answers: [{ choose: [0, 1] }, { choose: [0] }] })).toBe(false); // varias en una sola
    expect(store.answerQuestion({ requestId: "otro", pc: true })).toBe(false);
    expect(store.pendingCount).toBe(1);
    store.answerQuestion({ requestId: id, pc: true });
    await p;
  });

  it("una decisión (allow, allow_always, deny) sobre una pregunta no hace nada: no se aprueba ni se rechaza", async () => {
    const { store, ask } = make();
    const p = ask();
    const id = store.pending[0]!.id;
    for (const d of ["allow", "allow_always", "deny"] as const) expect(store.decide(id, d)).toBe(false);
    applyConsoleMessage(store, { t: "decision", requestId: id, decision: "allow" });
    expect(store.pendingCount).toBe(1);
    store.answerQuestion({ requestId: id, pc: true });
    await p;
  });

  it("answer sobre un permiso no hace nada", async () => {
    const { store } = make();
    const p = store.requestPermission({ sessionId: "s1", toolName: "Bash", toolInput: { command: "ls" } });
    const id = store.pending[0]!.id;
    expect(store.answerQuestion({ requestId: id, pc: true })).toBe(false);
    expect(store.pendingCount).toBe(1);
    store.decide(id, "deny");
    await expect(p).resolves.toBe("deny");
  });

  it("se libera al PC si la consola se desconecta, si se apaga el ajuste, si la sesión termina o si se cancela la petición", async () => {
    const { store, ask } = make();
    let p = ask();
    store.setConsoleConnected(false);
    await expect(p).resolves.toEqual({ decision: "ask" });
    store.setConsoleConnected(true);

    p = ask();
    store.setSetting({ key: "questions", value: false });
    await expect(p).resolves.toEqual({ decision: "ask" });
    store.setSetting({ key: "questions", value: true });

    p = ask();
    store.removeSession("s1");
    await expect(p).resolves.toEqual({ decision: "ask" });
    store.upsertSession({ sessionId: "s1", kind: "claude", project: "mi-portal" });

    const ac = new AbortController();
    p = ask("s1", ac.signal);
    ac.abort();
    await expect(p).resolves.toEqual({ decision: "ask" });
    expect(store.pendingCount).toBe(0);
  });

  it("se retira al resolverse en otra parte (PostToolUse con la misma herramienta e input)", async () => {
    const { store, ask } = make();
    const p = ask();
    store.resolveElsewhere("s1", { toolName: "AskUserQuestion", toolInput: INPUT });
    await expect(p).resolves.toEqual({ decision: "ask" });
  });

  it("comparte la cola con los permisos: mismo orden, L/R (skip) y pendingCount", async () => {
    const { store, view, ask } = make();
    store.upsertSession({ sessionId: "s2", kind: "claude", project: "otro" });
    const perm = store.requestPermission({ sessionId: "s2", toolName: "Bash", toolInput: { command: "ls" } });
    const q = ask();
    expect(view().pendingCount).toBe(2);
    expect(view().request).toMatchObject({ position: 1, total: 2 });
    expect(view().request!.kind).toBeUndefined(); // el permiso va primero (más antiguo)
    store.skip();
    expect(view().request).toMatchObject({ kind: "question", position: 2, total: 2 });
    store.skip();
    expect(view().request!.kind).toBeUndefined();
    store.decide(store.pending[0]!.id, "allow");
    await perm;
    expect(view().request).toMatchObject({ kind: "question", position: 1, total: 1 });
    store.answerQuestion({ requestId: store.pending[0]!.id, pc: true });
    await q;
  });
});

describe("vista de la pregunta", () => {
  it("request.kind question con las preguntas recortadas; (Recommended) fuera de la etiqueta y marcada", async () => {
    const { store, view, ask } = make();
    const p = ask();
    const r = view().request!;
    expect(r.kind).toBe("question");
    expect(r.title).toBe("Claude te hace una pregunta");
    expect(r.risk).toBe("normal");
    expect(r.lines).toEqual(["¿Qué fondo uso en el hero?"]);
    expect(r.questions).toEqual([
      {
        header: "Fondo",
        text: ["¿Qué fondo uso en el hero?"],
        multi: false,
        options: [
          { label: "Video", desc: ["Pesa más"], recommended: true },
          { label: "Gradiente", desc: ["Liviano"], recommended: false },
        ],
      },
      {
        header: "Secciones",
        text: ["¿Qué secciones?"],
        multi: true,
        options: [
          { label: "Hero", desc: ["Portada"], recommended: false },
          { label: "Footer", desc: ["Pie"], recommended: false },
          { label: "Menú", desc: ["Arriba"], recommended: false },
        ],
      },
    ]);
    expect(r.always).toBeUndefined();
    store.answerQuestion({ requestId: store.pending[0]!.id, pc: true });
    await p;
    expect(view().request).toBeNull();
  });

  it("con tres preguntas y espacio de sobra todas conservan las descripciones (el índice no es el nivel)", () => {
    const { store, view } = make();
    const input = {
      questions: ["uno", "dos", "tres"].map((n) => ({
        question: `¿Pregunta ${n}?`,
        header: n,
        options: [
          { label: "A", description: `Descripción de A en ${n}` },
          { label: "B", description: `Descripción de B en ${n}` },
        ],
        multiSelect: false,
      })),
    };
    void store.requestQuestion({ sessionId: "s1", toolInput: input, questions: parseQuestions(input)! });
    const qs = view().request!.questions!;
    expect(qs).toHaveLength(3);
    for (const q of qs) for (const o of q.options) expect(o.desc.length).toBeGreaterThan(0);
  });

  it("el permiso no trae kind ni questions (la vista de siempre)", () => {
    const { store, view } = make();
    void store.requestPermission({ sessionId: "s1", toolName: "Bash", toolInput: { command: "ls" } });
    expect(view().request).not.toHaveProperty("kind");
    expect(view().request).not.toHaveProperty("questions");
  });

  it("prioridad sobre los avisos, led en ask y la cara dice que te hace una pregunta", () => {
    const { store, view, ask } = make();
    store.upsertSession({ sessionId: "s2", kind: "claude", project: "otro" });
    store.setSessionState("s2", "done"); // deja una tarjeta de aviso
    expect(view().notice).toBeDefined();
    void ask();
    const v = view();
    expect(v.request!.kind).toBe("question");
    expect(v.notice).toBeUndefined();
    expect(v.led).toBe("ask");
    expect(v.face).toEqual({ kind: "claude", mood: "ask", lines: ["Claude te hace una pregunta", "¿Qué fondo uso en el hero?"] });
  });
});

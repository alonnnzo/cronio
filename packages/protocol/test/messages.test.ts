import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SettingChangeSchema,
  AGENT_STYLES,
  ID_PATTERN,
  MAX_DETAIL_LINES,
  MAX_FACE_LINES,
  MAX_ID,
  MAX_LINES,
  MAX_PAYLOAD,
  MAX_QUESTION_LINES,
  MAX_SESSIONS,
  MAX_READ_TEXT,
  MAX_TEXT,
  parseBridgeMessage,
  parseConsoleMessage,
  AnswerSchema,
  SessionNotifyChangeSchema,
  SessionWaitChangeSchema,
  InstructionTextSchema,
  type ViewModel,
} from "@companion/protocol";

const dir = new URL("../fixtures/messages/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const load = (f: string) => JSON.parse(readFileSync(new URL(f, dir), "utf8"));
const parserFor = (f: string) => (f.startsWith("bridge-") ? parseBridgeMessage : parseConsoleMessage);

describe("fixtures de mensajes", () => {
  it("hay al menos un válido por tipo y varios inválidos", () => {
    const valid = files.filter((f) => f.endsWith(".valid.json"));
    for (const t of ["bridge-error", "bridge-view", "console-decision", "console-focus", "console-skip", "console-mode", "console-read", "bridge-text", "console-ack"]) {
      expect(valid.some((f) => f.startsWith(t)), t).toBe(true);
    }
    expect(files.filter((f) => f.endsWith(".invalid.json")).length).toBeGreaterThanOrEqual(3);
  });

  for (const f of files.filter((n) => n.endsWith(".valid.json"))) {
    it(`válido: ${f}`, () => {
      const json = load(f);
      expect(parserFor(f)(json)).toEqual(json);
    });
  }

  for (const f of files.filter((n) => n.endsWith(".invalid.json"))) {
    it(`inválido: ${f}`, () => {
      expect(() => parserFor(f)(load(f))).toThrow();
    });
  }
});

it("request.always es opcional: sin él sigue valiendo, con texto vacío o largo no", () => {
  const base = load("bridge-view.valid.json") as { t: "view"; rev: number; view: ViewModel };
  const withAlways = (always: unknown) => ({ ...base, view: { ...base.view, request: { ...base.view.request!, always } } });
  expect(parseBridgeMessage(base).t).toBe("view");
  expect(parseBridgeMessage(withAlways("Bash(ls)")).t).toBe("view");
  expect(() => parseBridgeMessage(withAlways(""))).toThrow();
  expect(() => parseBridgeMessage(withAlways("x".repeat(MAX_TEXT + 1)))).toThrow();
  expect(() => parseBridgeMessage(withAlways(5))).toThrow();
});

it("MAX_PAYLOAD es 16384", () => {
  expect(MAX_PAYLOAD).toBe(16384);
});

describe("límites del modelo de vista", () => {
  const base = load("bridge-view.valid.json") as { t: "view"; rev: number; view: ViewModel };
  const withView = (patch: Partial<ViewModel>) => ({ ...base, view: { ...base.view, ...patch } });
  const session = (i: number) => ({
    id: `a${i}`,
    kind: "claude" as const,
    title: "x",
    project: "p",
    model: "m",
    state: "idle" as const,
    activity: "a",
  });
  const req = (patch: object) => ({ ...base.view.request!, ...patch });
  const face = (lines: string[]) => ({ ...base.view.face, lines });

  it("38 caracteres: acepta 38 y rechaza 39 en cada texto", () => {
    const ok = "x".repeat(MAX_TEXT);
    const long = "x".repeat(MAX_TEXT + 1);
    expect(() => parseBridgeMessage(withView({ request: req({ title: ok }) }))).not.toThrow();
    expect(() => parseBridgeMessage(withView({ request: req({ title: long }) }))).toThrow();
    expect(() => parseBridgeMessage(withView({ request: req({ lines: [long] }) }))).toThrow();
    for (const field of ["title", "project", "model", "activity"]) {
      expect(() => parseBridgeMessage(withView({ sessions: [{ ...session(0), [field]: ok }] }))).not.toThrow();
      expect(() => parseBridgeMessage(withView({ sessions: [{ ...session(0), [field]: long }] })), field).toThrow();
    }
    expect(() => parseBridgeMessage(withView({ face: face([long]) }))).toThrow();
    expect(() => parseBridgeMessage(withView({ detail: { sessionId: "a0", lastMessage: [long] } }))).toThrow();
  });

  it("tarjeta: 6 líneas sí, 7 no", () => {
    expect(() => parseBridgeMessage(withView({ request: req({ lines: Array(MAX_LINES).fill("l") }) }))).not.toThrow();
    expect(() => parseBridgeMessage(withView({ request: req({ lines: Array(MAX_LINES + 1).fill("l") }) }))).toThrow();
  });

  it("cara: de 1 a 4 líneas (3 o 4 = título + pregunta)", () => {
    expect(() => parseBridgeMessage(withView({ face: face([]) }))).toThrow();
    expect(() => parseBridgeMessage(withView({ face: face(["a"]) }))).not.toThrow();
    expect(() => parseBridgeMessage(withView({ face: face(Array(MAX_FACE_LINES).fill("a")) }))).not.toThrow();
    expect(() => parseBridgeMessage(withView({ face: face(["a", "b", "c"]) }))).not.toThrow();
    expect(() => parseBridgeMessage(withView({ face: face(["a", "b", "c", "d", "e"]) }))).toThrow();
    expect(MAX_FACE_LINES).toBe(4);
  });

  it("detalle: la pregunta es opcional, de 1 a 3 líneas de 38", () => {
    const d = (question?: unknown) => ({ sessionId: "a0", lastMessage: ["l"], ...(question === undefined ? {} : { question }) }) as ViewModel["detail"];
    expect(() => parseBridgeMessage(withView({ detail: d() }))).not.toThrow();
    expect(() => parseBridgeMessage(withView({ detail: d(Array(MAX_QUESTION_LINES).fill("q")) }))).not.toThrow();
    expect(() => parseBridgeMessage(withView({ detail: d([]) }))).toThrow();
    expect(() => parseBridgeMessage(withView({ detail: d(Array(MAX_QUESTION_LINES + 1).fill("q")) }))).toThrow();
    expect(() => parseBridgeMessage(withView({ detail: d(["x".repeat(39)]) }))).toThrow();
    expect(() => parseBridgeMessage(withView({ detail: d(null) }))).toThrow();
  });

  it("detalle: 4 líneas sí, 5 no", () => {
    const d = (n: number) => ({ sessionId: "a0", lastMessage: Array(n).fill("l") });
    expect(() => parseBridgeMessage(withView({ detail: d(MAX_DETAIL_LINES) }))).not.toThrow();
    expect(() => parseBridgeMessage(withView({ detail: d(MAX_DETAIL_LINES + 1) }))).toThrow();
  });

  it("12 sesiones sí, 13 no", () => {
    const n = (c: number) => Array.from({ length: c }, (_, i) => session(i));
    expect(() => parseBridgeMessage(withView({ sessions: n(MAX_SESSIONS) }))).not.toThrow();
    expect(() => parseBridgeMessage(withView({ sessions: n(MAX_SESSIONS + 1) }))).toThrow();
  });

  it("position y total empiezan en 1; pendingCount puede ser 0", () => {
    expect(() => parseBridgeMessage(withView({ request: req({ position: 0 }) }))).toThrow();
    expect(() => parseBridgeMessage(withView({ request: req({ total: 0 }) }))).toThrow();
    expect(() => parseBridgeMessage(withView({ request: null, pendingCount: 0 }))).not.toThrow();
    expect(() => parseBridgeMessage(withView({ pendingCount: -1 }))).toThrow();
  });

  it("identificadores: 1 a 48 de [A-Za-z0-9_.:-]", () => {
    const ok = "i".repeat(MAX_ID);
    const long = "i".repeat(MAX_ID + 1);
    expect(ID_PATTERN.test("a.b:c_d-E9")).toBe(true);
    expect(() => parseBridgeMessage(withView({ sessions: [{ ...session(0), id: ok }] }))).not.toThrow();
    expect(() => parseBridgeMessage(withView({ sessions: [{ ...session(0), id: long }] }))).toThrow();
    expect(() => parseBridgeMessage(withView({ sessions: [{ ...session(0), id: "" }] }))).toThrow();
    expect(() => parseBridgeMessage(withView({ request: req({ id: long }) }))).toThrow();
    expect(() => parseBridgeMessage(withView({ request: req({ sessionId: long }) }))).toThrow();
    expect(() => parseConsoleMessage({ t: "focus", sessionId: ok })).not.toThrow();
    expect(() => parseConsoleMessage({ t: "focus", sessionId: long })).toThrow();
    expect(() => parseConsoleMessage({ t: "decision", requestId: long, decision: "allow" })).toThrow();
    for (const bad of ["a b", "a/b", "a\\b", 'a"b', "ñ", "a\u0001", "a\n"]) {
      expect(() => parseBridgeMessage(withView({ sessions: [{ ...session(0), id: bad }] })), JSON.stringify(bad)).toThrow();
      expect(() => parseConsoleMessage({ t: "decision", requestId: bad, decision: "allow" })).toThrow();
      expect(() => parseConsoleMessage({ t: "focus", sessionId: bad })).toThrow();
    }
  });

  it("acepta la vista vacía", () => {
    const m = withView({
      sessions: [],
      request: null,
      pendingCount: 0,
      face: { kind: null, mood: "idle", lines: ["Todo tranquilo"] },
      detail: null,
      led: "off",
    });
    expect(parseBridgeMessage(m)).toEqual(m);
  });

  it("rechaza modo, ánimo y led desconocidos, y los campos antiguos no bastan", () => {
    expect(() => parseBridgeMessage(withView({ mode: "auto" as never }))).toThrow();
    expect(() => parseBridgeMessage(withView({ face: { ...base.view.face, mood: "happy" as never } }))).toThrow();
    expect(() => parseBridgeMessage(withView({ led: "blue" as never }))).toThrow();
    expect(() => parseBridgeMessage({ t: "view", rev: 1, view: { agents: [], selectedAgentId: null, request: null, status: "", led: "off" } })).toThrow();
  });
});

describe("mensajes de la consola", () => {
  it("decision, focus, skip y mode; select ya no existe", () => {
    expect(parseConsoleMessage({ t: "decision", requestId: "r1", decision: "deny" })).toEqual({ t: "decision", requestId: "r1", decision: "deny" });
    expect(parseConsoleMessage({ t: "focus", sessionId: null })).toEqual({ t: "focus", sessionId: null });
    expect(parseConsoleMessage({ t: "skip" })).toEqual({ t: "skip" });
    expect(parseConsoleMessage({ t: "mode", mode: "queue" })).toEqual({ t: "mode", mode: "queue" });
    expect(parseConsoleMessage({ t: "decision", requestId: "r1", decision: "allow_always" })).toEqual({ t: "decision", requestId: "r1", decision: "allow_always" });
    expect(() => parseConsoleMessage({ t: "select", agentId: "a" })).toThrow();
    expect(() => parseConsoleMessage({ t: "focus" })).toThrow();
    expect(() => parseConsoleMessage({ t: "mode", mode: "x" })).toThrow();
  });

  it("rechaza mensajes del lado equivocado", () => {
    const base = load("bridge-view.valid.json");
    expect(() => parseConsoleMessage(base)).toThrow();
    expect(() => parseBridgeMessage({ t: "skip" })).toThrow();
  });
});

describe("estilos de los puntos", () => {
  it("define los cinco agentes con color; solo Gemini tiene segundo color", () => {
    expect(Object.keys(AGENT_STYLES).sort()).toEqual(["claude", "codex", "cursor", "gemini", "hermes"]);
    expect(AGENT_STYLES.claude).toEqual({ color: "#ee7446", signature: "sparks" });
    expect(AGENT_STYLES.gemini.color2).toBe("#b274ff");
    expect(AGENT_STYLES.codex.color2).toBeUndefined();
  });
});

describe("mensaje text: líneas del lector", () => {
  const text = (lines: string[], question?: string[]) => ({ t: "text", sessionId: "s1", lines, truncated: false, ...(question ? { question } : {}) });
  it("MAX_READ_TEXT es 48 y MAX_TEXT sigue en 38", () => {
    expect(MAX_READ_TEXT).toBe(48);
    expect(MAX_TEXT).toBe(38);
  });
  it("acepta 48 caracteres y rechaza 49, en lines y en question", () => {
    expect(() => parseBridgeMessage(text(["x".repeat(MAX_READ_TEXT)], ["q".repeat(MAX_READ_TEXT)]))).not.toThrow();
    expect(() => parseBridgeMessage(text(["x".repeat(MAX_READ_TEXT + 1)]))).toThrow();
    expect(() => parseBridgeMessage(text(["ok"], ["q".repeat(MAX_READ_TEXT + 1)]))).toThrow();
  });
});

it("notice, chime y detail.notify son opcionales: sin ellos una vista anterior sigue valiendo", () => {
  const base = load("bridge-view.valid.json") as { t: "view"; rev: number; view: ViewModel };
  expect(parseBridgeMessage(base).t).toBe("view");
  const withNotice = load("bridge-view-notice.valid.json") as { t: "view"; rev: number; view: ViewModel };
  const msg = parseBridgeMessage(withNotice);
  expect(msg.t === "view" && msg.view.notice?.kind).toBe("done");
  expect(msg.t === "view" && msg.view.chime).toEqual({ kind: "done", seq: 3 });
  expect(() => parseBridgeMessage({ ...withNotice, view: { ...withNotice.view, notice: null } })).toThrow();
});

it("ack y skipNotice son de la consola; el setting de sesión solo comprueba la forma (el puente valida el resto)", () => {
  expect(parseConsoleMessage({ t: "ack", id: "n1" })).toEqual({ t: "ack", id: "n1" });
  expect(parseConsoleMessage({ t: "skipNotice" })).toEqual({ t: "skipNotice" });
  expect(() => parseConsoleMessage({ t: "ack" })).toThrow();
  expect(parseConsoleMessage({ t: "setting", key: "sessionNotify", sessionId: "s1", value: "ruidoso" }).t).toBe("setting");
  expect(SessionNotifyChangeSchema.safeParse({ sessionId: "s1", value: "ruidoso" }).success).toBe(false);
  expect(SessionNotifyChangeSchema.safeParse({ value: "all" }).success).toBe(false);
  expect(SessionNotifyChangeSchema.safeParse({ sessionId: "s1", value: "silent" }).success).toBe(true);
});

it("answer y hold: la forma la comprueba el mensaje y el contenido AnswerSchema (un answer inválido no cierra la conexión)", () => {
  // un answer con contenido raro sigue siendo un mensaje bien formado: el puente lo ignora y lo registra
  expect(parseConsoleMessage({ t: "answer", requestId: "r1", answers: "no es lista" }).t).toBe("answer");
  expect(parseConsoleMessage({ t: "answer", requestId: "r1", pc: "sí" }).t).toBe("answer");
  expect(() => parseConsoleMessage({ t: "answer" })).toThrow();
  expect(() => parseConsoleMessage({ t: "answer", requestId: 5 })).toThrow();

  const ok = (v: unknown) => AnswerSchema.safeParse(v).success;
  expect(ok({ requestId: "r1", pc: true })).toBe(true);
  expect(ok({ requestId: "r1", pc: false })).toBe(false);
  expect(ok({ requestId: "r1", answers: [{ choose: [0] }, { choose: [1, 3] }, { other: "texto" }] })).toBe(true);
  expect(ok({ requestId: "r1", answers: [] })).toBe(false);
  expect(ok({ requestId: "r1", answers: Array(5).fill({ choose: [0] }) })).toBe(false);
  expect(ok({ requestId: "r1", answers: [{ choose: [] }] })).toBe(false);
  expect(ok({ requestId: "r1", answers: [{ choose: [4] }] })).toBe(false);
  expect(ok({ requestId: "r1", answers: [{ choose: [-1] }] })).toBe(false);
  expect(ok({ requestId: "r1", answers: [{ choose: [1, 1] }] })).toBe(false);
  expect(ok({ requestId: "r1", answers: [{ choose: [0], other: "x" }] })).toBe(false);
  expect(ok({ requestId: "r1", answers: [{ other: "" }] })).toBe(false);
  expect(ok({ requestId: "r1", answers: [{ other: "x".repeat(200) }] })).toBe(true);
  expect(ok({ requestId: "r1", answers: [{ other: "x".repeat(201) }] })).toBe(false);
  expect(ok({ requestId: "r1", answers: [{ choose: [0] }], pc: true })).toBe(false);
  expect(ok({ requestId: "r 1", pc: true })).toBe(false);
  expect(ok({ pc: true })).toBe(false);
});

it("request.kind y questions son opcionales: una vista anterior sigue valiendo", () => {
  const base = load("bridge-view.valid.json") as { t: "view"; rev: number; view: ViewModel };
  expect(base.view.request!.kind).toBeUndefined();
  expect(parseBridgeMessage(base).t).toBe("view");
  const q = load("bridge-view-request-question.valid.json") as { view: ViewModel };
  expect(q.view.request!.kind).toBe("question");
  expect(q.view.request!.questions).toHaveLength(2);
});

it("settings.questions es opcional (un puente anterior no lo manda) y booleano", () => {
  const base = load("bridge-view-settings.valid.json") as { t: "view"; rev: number; view: ViewModel };
  const withQ = (questions: unknown) => ({ ...base, view: { ...base.view, settings: { ...base.view.settings!, questions } } });
  expect(parseBridgeMessage(withQ(false)).t).toBe("view");
  expect(parseBridgeMessage(withQ(undefined)).t).toBe("view");
  expect(() => parseBridgeMessage(withQ("no"))).toThrow();
});

it("paso 5: read.mode, text.mode/short y settings.readerDefault son opcionales y de dos valores", () => {
  expect(parseConsoleMessage({ t: "read", sessionId: "s1" }).t).toBe("read");
  expect(parseConsoleMessage({ t: "read", sessionId: "s1", mode: "summary" })).toEqual({ t: "read", sessionId: "s1", mode: "summary" });
  expect(() => parseConsoleMessage({ t: "read", sessionId: "s1", mode: "brief" })).toThrow();
  const text = (extra: Record<string, unknown>) => ({ t: "text", sessionId: "s1", lines: ["x"], truncated: false, ...extra });
  expect(parseBridgeMessage(text({})).t).toBe("text"); // un puente anterior no manda mode
  expect(parseBridgeMessage(text({ mode: "full" })).t).toBe("text");
  expect(parseBridgeMessage(text({ mode: "summary", short: true })).t).toBe("text");
  expect(() => parseBridgeMessage(text({ mode: "resumen" }))).toThrow();
  expect(() => parseBridgeMessage(text({ mode: "summary", short: 1 }))).toThrow();
  expect(SettingChangeSchema.safeParse({ key: "readerDefault", value: "summary" }).success).toBe(true);
  expect(SettingChangeSchema.safeParse({ key: "readerDefault", value: "full" }).success).toBe(true);
  expect(SettingChangeSchema.safeParse({ key: "readerDefault", value: "brief" }).success).toBe(false);
  expect(SettingChangeSchema.safeParse({ key: "readerDefault", value: true }).success).toBe(false);
  const base = load("bridge-view-settings.valid.json") as { t: "view"; rev: number; view: ViewModel };
  const withR = (readerDefault: unknown) => ({ ...base, view: { ...base.view, settings: { ...base.view.settings!, readerDefault } } });
  expect(parseBridgeMessage(withR("summary")).t).toBe("view");
  expect(parseBridgeMessage(withR(undefined)).t).toBe("view");
  expect(() => parseBridgeMessage(withR("brief"))).toThrow();
});

it("paso 6: instruct, instructClear y release son de la consola; el texto lo valida InstructionTextSchema (un instruct inválido no cierra la conexión)", () => {
  expect(parseConsoleMessage({ t: "instruct", sessionId: "s1", text: "hola" }).t).toBe("instruct");
  // la forma pasa aunque el contenido no sirva: el puente lo ignora y lo registra
  expect(parseConsoleMessage({ t: "instruct", sessionId: "s1", text: "   " }).t).toBe("instruct");
  expect(parseConsoleMessage({ t: "instruct", sessionId: "no valido!", text: "x" }).t).toBe("instruct");
  expect(() => parseConsoleMessage({ t: "instruct", sessionId: "s1" })).toThrow();
  expect(() => parseConsoleMessage({ t: "instruct", sessionId: "s1", text: 5 })).toThrow();
  expect(parseConsoleMessage({ t: "instructClear", sessionId: "s1" }).t).toBe("instructClear");
  expect(() => parseConsoleMessage({ t: "release" })).toThrow();

  const ok = (s: string) => InstructionTextSchema.safeParse(s).success;
  expect(ok("hola")).toBe(true);
  expect(ok("é".repeat(400))).toBe(true);
  expect(ok("x".repeat(401))).toBe(false);
  expect(ok("")).toBe(false);
  expect(ok("   ")).toBe(false);
  expect(ok("a\nb")).toBe(false);
  expect(ok("a\tb")).toBe(false);
  expect(ok("a\u0000b")).toBe(false);
  expect(ok("a\u007fb")).toBe(false);
});

it("paso 6: sessionWait e instructWaitMax; request.kind instruction no lleva questions; detail.instructions y waitForMe son opcionales", () => {
  expect(SessionWaitChangeSchema.safeParse({ sessionId: "s1", value: true }).success).toBe(true);
  expect(SessionWaitChangeSchema.safeParse({ sessionId: "s1", value: "sí" }).success).toBe(false);
  expect(SessionWaitChangeSchema.safeParse({ value: true }).success).toBe(false);
  expect(parseConsoleMessage({ t: "setting", key: "instructWaitMax", value: 10 }).t).toBe("setting");
  for (const v of [5, 10, 30]) expect(SettingChangeSchema.safeParse({ key: "instructWaitMax", value: v }).success).toBe(true);
  for (const v of [0, 7, 60, "10", true]) expect(SettingChangeSchema.safeParse({ key: "instructWaitMax", value: v }).success).toBe(false);
  const inst = load("bridge-view-request-instruction.valid.json") as { view: ViewModel };
  expect(inst.view.request!.kind).toBe("instruction");
  expect(inst.view.request!.questions).toBeUndefined();
  const base = load("bridge-view.valid.json") as { t: "view"; rev: number; view: ViewModel };
  expect(base.view.detail?.instructions).toBeUndefined();
  expect(parseBridgeMessage(base).t).toBe("view");
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_INSTRUCTIONS, ViewModelSchema, parseConsoleMessage, type ViewModel } from "@companion/protocol";
import { BridgeStore, MAX_STORED_SESSIONS, type StopOutcome } from "../src/store.ts";
import { FaceController } from "../src/face.ts";
import { buildView } from "../src/view.ts";
import { applyConsoleMessage } from "../src/feed.ts";
import { applyClaudeHook } from "../src/adapters/claude-code.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function make(options: ConstructorParameters<typeof BridgeStore>[0] = {}) {
  const store = new BridgeStore(options);
  const face = new FaceController(store);
  store.upsertSession({ sessionId: "s1", kind: "claude", project: "mi-portal" });
  store.setConsoleConnected(true);
  const view = (): ViewModel => {
    const v = buildView(store, face);
    expect(ViewModelSchema.safeParse(v).success).toBe(true);
    return v;
  };
  const stop = (sessionId = "s1", signal?: AbortSignal, lastMessage?: string): Promise<StopOutcome> => store.requestStop({ sessionId, signal, lastMessage });
  const send = (json: unknown) => applyConsoleMessage(store, parseConsoleMessage(json));
  return { store, face, view, stop, send };
}

describe("cola de instrucciones", () => {
  it("se juntan en orden, separadas por línea en blanco, y el Stop las entrega en el acto", async () => {
    const { store, stop } = make();
    expect(store.enqueueInstruction("s1", "primero")).toBe("queued");
    expect(store.enqueueInstruction("s1", "segundo")).toBe("queued");
    expect(store.instructionsOf("s1")).toEqual(["primero", "segundo"]);
    await expect(stop()).resolves.toEqual({ decision: "instruct", text: "primero\n\nsegundo" });
    expect(store.instructionsOf("s1")).toEqual([]);
    await expect(stop()).resolves.toEqual({ decision: "none" });
  });

  it("tope de cinco por sesión y sesión desconocida", () => {
    const { store } = make();
    for (let i = 0; i < MAX_INSTRUCTIONS; i++) expect(store.enqueueInstruction("s1", `n${i}`)).toBe("queued");
    expect(store.enqueueInstruction("s1", "una más")).toBe("full");
    expect(store.instructionsOf("s1")).toHaveLength(MAX_INSTRUCTIONS);
    expect(store.enqueueInstruction("nadie", "x")).toBe("unknown");
  });

  it("clearInstructions la vacía; la vista trae cuántas hay y el comienzo de la primera", () => {
    const { store, view } = make();
    store.enqueueInstruction("s1", "Agrega pruebas para el login con contraseñas muy largas y otras cosas");
    store.enqueueInstruction("s1", "otra");
    store.focus("s1");
    const d = view().detail!;
    expect(d.instructions!.count).toBe(2);
    expect(d.instructions!.first.length).toBeLessThanOrEqual(38);
    expect(d.instructions!.first.startsWith("Agrega pruebas")).toBe(true);
    store.clearInstructions("s1");
    expect(view().detail!.instructions).toBeUndefined();
  });

  it("una sesión que termina olvida su cola", () => {
    const { store } = make();
    store.enqueueInstruction("s1", "x");
    store.removeSession("s1");
    store.upsertSession({ sessionId: "s1", kind: "claude", project: "mi-portal" });
    expect(store.instructionsOf("s1")).toEqual([]);
  });

  it("al entregarse la sesión vuelve a trabajar y stopContinues cubre el Stop de estado que llega justo después", async () => {
    const { store, stop } = make();
    store.setSessionState("s1", "done");
    store.enqueueInstruction("s1", "sigue");
    expect(store.stopContinues("s1")).toBe(true);
    await stop();
    expect(store.getSession("s1")!.state).toBe("working");
    expect(store.stopContinues("s1")).toBe(true);
    vi.advanceTimersByTime(6000);
    expect(store.stopContinues("s1")).toBe(false);
  });

  it("la entrega cubre un solo Stop: otro Stop dentro de 5 s termina como done", async () => {
    const { store, stop } = make();
    store.enqueueInstruction("s1", "sigue");
    await stop(); // entrega
    vi.advanceTimersByTime(1000);
    applyClaudeHook(store, { hook_event_name: "Stop", session_id: "s1", cwd: "/x" }); // el Stop de estado del mismo fin de turno
    expect(store.getSession("s1")!.state).toBe("working");
    vi.advanceTimersByTime(1000);
    applyClaudeHook(store, { hook_event_name: "Stop", session_id: "s1", cwd: "/x" }); // un fin de turno posterior, de verdad
    expect(store.getSession("s1")!.state).toBe("done");
  });

  it("un PreToolUse tras la entrega la consume: el Stop siguiente termina", async () => {
    const { store, stop } = make();
    store.enqueueInstruction("s1", "sigue");
    await stop();
    applyClaudeHook(store, { hook_event_name: "PreToolUse", session_id: "s1", cwd: "/x", tool_name: "Bash", tool_input: { command: "ls" } });
    applyClaudeHook(store, { hook_event_name: "Stop", session_id: "s1", cwd: "/x" });
    expect(store.getSession("s1")!.state).toBe("done");
  });
});

describe("comandos rápidos de la tarjeta de instrucción", () => {
  it("la tarjeta trae los cuatro de fábrica, válidos para el protocolo", async () => {
    const { store, view, stop } = make();
    store.setSessionWait("s1", true);
    const p = stop("s1");
    const q = view().request!.quick!;
    expect(q.map((c) => c.label)).toEqual(["Sigue", "Corre las pruebas", "Haz commit", "Resume"]);
    expect(q[1]!.text).toBe("Corre las pruebas y arregla lo que falle.");
    store.releaseSessionInstruction("s1");
    await p;
  });

  it("sin comandos configurados la tarjeta de instrucción no trae quick", async () => {
    const dir2 = mkdtempSync(join(tmpdir(), "quick-"));
    try {
      const settingsPath = join(dir2, "settings.json");
      writeFileSync(settingsPath, JSON.stringify({ quickCommands: [] }));
      const { store, view, stop } = make({ settingsPath });
      store.setSessionWait("s1", true);
      const p = stop("s1");
      expect(view().request!.kind).toBe("instruction");
      expect(view().request!.quick).toBeUndefined();
      store.releaseSessionInstruction("s1");
      await p;
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("el protocolo rechaza quick fuera de una instrucción y más de cuatro", () => {
    const base = { id: "r1", sessionId: "s1", title: "t", lines: [], risk: "normal", expiresInS: 0, position: 1, total: 1 };
    const quick = [{ label: "A", text: "a" }];
    const ok = (r: Record<string, unknown>) => ViewModelSchema.safeParse({ sessions: [], request: r, pendingCount: 1, mode: "queue", face: { kind: null, mood: "idle", lines: ["x"] }, detail: null, led: "off" }).success;
    expect(ok({ ...base, kind: "instruction", quick })).toBe(true);
    expect(ok({ ...base, kind: "permission", quick })).toBe(false);
    expect(ok({ ...base, quick })).toBe(false);
    expect(ok({ ...base, kind: "instruction", quick: Array.from({ length: 5 }, () => quick[0]) })).toBe(false);
    expect(ok({ ...base, kind: "instruction", quick: [{ label: "x".repeat(21), text: "a" }] })).toBe(false);
    expect(ok({ ...base, kind: "instruction", quick: [{ label: "a", text: "x".repeat(121) }] })).toBe(false);
    expect(ok({ ...base, kind: "instruction", quick: [{ label: "", text: "a" }] })).toBe(false);
  });

  it("un atajo manda su texto como instruct y el Stop retenido lo recibe", async () => {
    const { store, view, stop, send } = make();
    store.setSessionWait("s1", true);
    const p = stop("s1");
    const q = view().request!.quick![0]!;
    send({ t: "instruct", sessionId: "s1", text: q.text });
    await expect(p).resolves.toEqual({ decision: "instruct", text: "Sigue con lo que estabas haciendo." });
  });
});

describe("cola de instrucciones y limpieza de sesiones", () => {
  it("sweep no retira una sesión con instrucciones en cola; vacía la cola, sí", () => {
    let t = 0;
    const store = new BridgeStore({ now: () => t, sessionMaxAgeMs: 1000 });
    store.upsertSession({ sessionId: "s1", kind: "claude", project: "a" });
    store.enqueueInstruction("s1", "pendiente");
    t = 5000;
    store.sweep();
    expect(store.instructionsOf("s1")).toEqual(["pendiente"]);
    expect(store.sessions).toHaveLength(1);
    store.clearInstructions("s1");
    store.sweep();
    expect(store.sessions).toHaveLength(0);
    store.dispose();
  });

  it("evictOldest salta la sesión con cola y retira la siguiente más antigua", () => {
    let t = 0;
    const store = new BridgeStore({ now: () => t });
    store.upsertSession({ sessionId: "vieja", kind: "claude", project: "a" });
    store.enqueueInstruction("vieja", "pendiente"); // lastSeen = 0
    for (let i = 0; i < MAX_STORED_SESSIONS - 1; i++) {
      t = i + 1;
      store.upsertSession({ sessionId: `n${i}`, kind: "claude", project: "b" });
    }
    t = 10_000;
    store.upsertSession({ sessionId: "nueva", kind: "claude", project: "c" });
    expect(store.getSession("vieja")).toBeDefined();
    expect(store.instructionsOf("vieja")).toEqual(["pendiente"]);
    expect(store.getSession("n0")).toBeUndefined();
    expect(store.getSession("nueva")).toBeDefined();
    store.dispose();
  });
});

describe("Stop retenido (Esperar mi respuesta)", () => {
  it("sin el modo, sin consola o sin sesión no se retiene", async () => {
    const { store, stop } = make();
    await expect(stop()).resolves.toEqual({ decision: "none" });
    store.setSessionWait("s1", true);
    store.setConsoleConnected(false);
    await expect(stop()).resolves.toEqual({ decision: "none" });
    store.setConsoleConnected(true);
    await expect(stop("nadie")).resolves.toEqual({ decision: "none" });
    const ac = new AbortController();
    ac.abort();
    await expect(stop("s1", ac.signal)).resolves.toEqual({ decision: "none" });
    expect(store.pendingCount).toBe(0);
  });

  it("con el modo y la consola queda en la cola de tarjetas: sesión en ask, tarjeta instruction, pendingCount y LED", async () => {
    const { store, view, stop } = make();
    store.setSessionWait("s1", true);
    store.setLastMessage("s1", "Terminé el login. ¿Algo más?");
    const p = stop("s1");
    expect(store.pendingCount).toBe(1);
    expect(store.getSession("s1")!.state).toBe("ask");
    expect(store.getSession("s1")!.activity).toBe("Espera tu instrucción");
    const v = view();
    expect(v.request).toMatchObject({ kind: "instruction", sessionId: "s1", title: "Claude espera tu instrucción", expiresInS: 0, position: 1, total: 1 });
    expect(v.request!.questions).toBeUndefined();
    expect(v.request!.lines.join(" ")).toContain("Terminé el login");
    expect(v.pendingCount).toBe(1);
    expect(v.led).toBe("ask");
    expect(v.face.lines[0]).toBe("Claude espera tu instrucción");
    expect(v.sessions[0]!.state).toBe("ask");
    store.releaseSessionInstruction("s1");
    await p;
  });

  it("la retención suena como una pregunta (sin tarjeta de aviso) salvo que ya sonara el terminó del hook de estado", async () => {
    const { store, stop } = make();
    store.setSessionWait("s1", true);
    const before = store.lastChime?.seq ?? 0;
    const p = stop();
    expect(store.lastChime).toEqual({ kind: "ask", seq: before + 1 });
    expect(store.currentNotice).toBeNull();
    store.releaseSessionInstruction("s1");
    await p;
    expect(store.noticeCount).toBe(0); // liberarla no deja un aviso suelto
    // llegó antes el hook de estado: ya sonó "terminó" y no suena dos veces
    applyClaudeHook(store, { hook_event_name: "UserPromptSubmit", session_id: "s1" });
    applyClaudeHook(store, { hook_event_name: "Stop", session_id: "s1", last_assistant_message: "Listo." });
    const seq = store.lastChime!.seq;
    expect(store.lastChime!.kind).toBe("done");
    const p2 = stop();
    expect(store.lastChime!.seq).toBe(seq);
    store.releaseSessionInstruction("s1");
    await p2;
    // en silencio no suena
    store.setSessionNotify("s1", "silent");
    applyClaudeHook(store, { hook_event_name: "UserPromptSubmit", session_id: "s1" });
    const p3 = stop();
    expect(store.lastChime!.seq).toBe(seq);
    store.releaseSessionInstruction("s1");
    await p3;
  });

  it("enqueueInstruction entrega a la retenida (con lo que hubiera en cola) y la sesión vuelve a trabajar", async () => {
    const { store, stop } = make();
    store.setSessionWait("s1", true);
    // algo en cola se entrega en el acto, sin retener
    store.enqueueInstruction("s1", "uno");
    await expect(stop()).resolves.toEqual({ decision: "instruct", text: "uno" });
    const p = stop();
    expect(store.pendingCount).toBe(1);
    expect(store.enqueueInstruction("s1", "dos")).toBe("delivered");
    await expect(p).resolves.toEqual({ decision: "instruct", text: "dos" });
    expect(store.pendingCount).toBe(0);
    expect(store.getSession("s1")!.state).toBe("working");
  });

  it("release (Seguir en el PC) la libera sin instrucción y deja la sesión terminada; el id desconocido no hace nada", async () => {
    const { store, stop, send } = make();
    store.setSessionWait("s1", true);
    const p = stop();
    send({ t: "release", requestId: "no-existe" });
    expect(store.pendingCount).toBe(1);
    const id = store.pending[0]!.id;
    send({ t: "release", requestId: id });
    await expect(p).resolves.toEqual({ decision: "none" });
    expect(store.pendingCount).toBe(0);
    expect(store.getSession("s1")!.state).toBe("done");
  });

  it("decide y answer no resuelven una retención", async () => {
    const { store, stop, send } = make();
    store.setSessionWait("s1", true);
    const p = stop();
    const id = store.pending[0]!.id;
    expect(store.decide(id, "allow")).toBe(false);
    send({ t: "answer", requestId: id, pc: true });
    expect(store.pendingCount).toBe(1);
    store.releaseInstruction(id);
    await p;
  });

  it("la consola que se desconecta, la sesión que termina y apagar el modo la liberan", async () => {
    const { store, stop } = make();
    store.setSessionWait("s1", true);
    let p = stop();
    store.setConsoleConnected(false);
    await expect(p).resolves.toEqual({ decision: "none" });
    store.setConsoleConnected(true);
    p = stop();
    store.removeSession("s1");
    await expect(p).resolves.toEqual({ decision: "none" });
    store.upsertSession({ sessionId: "s1", kind: "claude", project: "mi-portal" });
    expect(store.getSession("s1")!.waitForMe).toBe(true); // recordado por proyecto
    p = stop();
    store.setSessionWait("s1", false);
    await expect(p).resolves.toEqual({ decision: "none" });
    expect(store.pendingCount).toBe(0);
  });

  it("el plazo instructWaitMax la libera (10 min por defecto; se puede cambiar a 5 o 30 en caliente)", async () => {
    const { store, stop } = make();
    store.setSessionWait("s1", true);
    let p = stop();
    vi.advanceTimersByTime(10 * 60_000 - 1);
    expect(store.pendingCount).toBe(1);
    vi.advanceTimersByTime(2);
    await expect(p).resolves.toEqual({ decision: "none" });
    p = stop();
    store.setSetting({ key: "instructWaitMax", value: 5 });
    vi.advanceTimersByTime(5 * 60_000 + 1);
    await expect(p).resolves.toEqual({ decision: "none" });
    expect(store.settings.instructWaitMax).toBe(5);
  });

  it("el hook que se cierra (señal abortada) retira la retención sin globo en la cara", async () => {
    const { store, stop } = make();
    store.setSessionWait("s1", true);
    const notices = vi.fn();
    store.on("notice", notices);
    const ac = new AbortController();
    const p = stop("s1", ac.signal);
    ac.abort();
    await expect(p).resolves.toEqual({ decision: "none" });
    expect(store.pendingCount).toBe(0);
    expect(notices).not.toHaveBeenCalled();
  });

  it("una segunda retención de la misma sesión no se duplica", async () => {
    const { store, stop } = make();
    store.setSessionWait("s1", true);
    const p = stop();
    await expect(stop()).resolves.toEqual({ decision: "none" });
    expect(store.pendingCount).toBe(1);
    store.releaseSessionInstruction("s1");
    await p;
  });

  it("comparte la cola con los permisos: mismo orden y posición", async () => {
    const { store, view, stop } = make();
    store.upsertSession({ sessionId: "s2", kind: "claude", project: "otro" });
    store.setSessionWait("s1", true);
    const perm = store.requestPermission({ sessionId: "s2", toolName: "Bash", toolInput: { command: "ls" } });
    const p = stop();
    expect(store.pendingCount).toBe(2);
    expect(view().request).toMatchObject({ sessionId: "s2", position: 1, total: 2 });
    store.decide(store.pending[0]!.id, "allow");
    await perm;
    expect(view().request).toMatchObject({ kind: "instruction", position: 1, total: 1 });
    store.releaseSessionInstruction("s1");
    await p;
  });

  it("si el hook trae el último mensaje y la sesión no lo tenía, la tarjeta lo muestra", async () => {
    const { store, view, stop } = make();
    store.setSessionWait("s1", true);
    const p = stop("s1", undefined, "Listo, quedó el botón.");
    expect(view().request!.lines).toEqual(["Listo, quedó el botón."]);
    store.releaseSessionInstruction("s1");
    await p;
  });
});

describe("hooks de estado y retención", () => {
  const stopHook = { hook_event_name: "Stop", session_id: "s1", last_assistant_message: "Listo." };

  it("con el Stop retenido, el hook http de estado no la marca terminada ni cambia la actividad (en cualquier orden)", async () => {
    const { store, stop } = make();
    store.setSessionWait("s1", true);
    const p = stop();
    applyClaudeHook(store, stopHook);
    expect(store.getSession("s1")!.state).toBe("ask");
    expect(store.getSession("s1")!.activity).toBe("Espera tu instrucción");
    expect(store.pendingCount).toBe(1); // el Stop de estado no retira la retención
    store.enqueueInstruction("s1", "sigue");
    await p;
    // otro orden: llega primero el de estado ("terminó") y luego la retención
    vi.advanceTimersByTime(6000);
    applyClaudeHook(store, { hook_event_name: "UserPromptSubmit", session_id: "s1" });
    applyClaudeHook(store, stopHook);
    expect(store.getSession("s1")!.state).toBe("done");
    const p2 = stop();
    expect(store.getSession("s1")!.state).toBe("ask");
    store.releaseSessionInstruction("s1");
    await p2;
  });

  it("con una instrucción en cola o recién entregada, el hook de estado deja la sesión trabajando", async () => {
    const { store, stop } = make();
    store.enqueueInstruction("s1", "sigue");
    applyClaudeHook(store, stopHook); // llegó antes que el hook de instrucciones
    expect(store.getSession("s1")!.state).toBe("working");
    await stop();
    applyClaudeHook(store, stopHook); // llegó después
    expect(store.getSession("s1")!.state).toBe("working");
    expect(store.getSession("s1")!.activity).toBe("Siguiendo tu instrucción");
  });

  it("UserPromptSubmit libera la retención y no borra la cola", async () => {
    const { store, stop } = make();
    store.setSessionWait("s1", true);
    const p = stop();
    store.enqueueInstruction("s1", "x"); // entrega a la retenida
    await p;
    store.enqueueInstruction("s1", "para después");
    store.setSessionWait("s1", true);
    // sin retención (la cola ya tiene algo): se entrega; probamos el caso de la retención sin cola
    await stop();
    const p2 = stop();
    expect(store.pendingCount).toBe(1);
    store.enqueueInstruction("s1", "z"); // vuelve a la retenida
    await p2;
    const p3 = stop();
    expect(store.pendingCount).toBe(1);
    applyClaudeHook(store, { hook_event_name: "UserPromptSubmit", session_id: "s1" });
    await expect(p3).resolves.toEqual({ decision: "none" });
    expect(store.getSession("s1")!.state).toBe("working");
    store.enqueueInstruction("s1", "queda");
    applyClaudeHook(store, { hook_event_name: "UserPromptSubmit", session_id: "s1" });
    expect(store.instructionsOf("s1")).toEqual(["queda"]);
  });

  it("SessionEnd libera la retención", async () => {
    const { store, stop } = make();
    store.setSessionWait("s1", true);
    const p = stop();
    applyClaudeHook(store, { hook_event_name: "SessionEnd", session_id: "s1" });
    await expect(p).resolves.toEqual({ decision: "none" });
  });

  it("un PostToolUse o un evento con cancel_pending de la sesión no retiran la retención", async () => {
    const { store, stop } = make();
    store.setSessionWait("s1", true);
    const p = stop();
    expect(store.resolveElsewhere("s1")).toBe(0);
    applyClaudeHook(store, { hook_event_name: "PostToolUse", session_id: "s1", tool_name: "Bash", tool_input: {} });
    expect(store.pendingCount).toBe(1);
    store.releaseSessionInstruction("s1");
    await p;
  });
});

describe("mensajes de la consola", () => {
  it("instruct encola o entrega; el texto inválido, la sesión desconocida y la cola llena se ignoran y se registran sin tirar nada", () => {
    const { store, send } = make();
    const log = vi.fn();
    const msg = (json: unknown) => applyConsoleMessage(store, parseConsoleMessage(json), log);
    msg({ t: "instruct", sessionId: "s1", text: "  hola  " });
    expect(store.instructionsOf("s1")).toEqual(["hola"]);
    msg({ t: "instruct", sessionId: "s1", text: "   " });
    msg({ t: "instruct", sessionId: "s1", text: "a\nb" });
    msg({ t: "instruct", sessionId: "s1", text: "x".repeat(401) });
    msg({ t: "instruct", sessionId: "nadie", text: "hola" });
    expect(log).toHaveBeenCalledTimes(4);
    expect(store.instructionsOf("s1")).toEqual(["hola"]);
    msg({ t: "instruct", sessionId: "s1", text: "x".repeat(400) });
    expect(store.instructionsOf("s1")).toHaveLength(2);
    send({ t: "instructClear", sessionId: "s1" });
    expect(store.instructionsOf("s1")).toEqual([]);
    for (let i = 0; i < 6; i++) msg({ t: "instruct", sessionId: "s1", text: `n${i}` });
    expect(store.instructionsOf("s1")).toHaveLength(MAX_INSTRUCTIONS);
    expect(log).toHaveBeenCalledTimes(5);
  });

  it("setting sessionWait y instructWaitMax: válidos se aplican; inválidos se ignoran", () => {
    const { store } = make();
    const log = vi.fn();
    const msg = (json: unknown) => applyConsoleMessage(store, parseConsoleMessage(json), log);
    msg({ t: "setting", key: "sessionWait", sessionId: "s1", value: true });
    expect(store.getSession("s1")!.waitForMe).toBe(true);
    msg({ t: "setting", key: "sessionWait", sessionId: "s1", value: "sí" });
    msg({ t: "setting", key: "sessionWait", sessionId: "nadie", value: true });
    msg({ t: "setting", key: "sessionWait", value: true });
    expect(log).toHaveBeenCalledTimes(3);
    msg({ t: "setting", key: "instructWaitMax", value: 30 });
    expect(store.settings.instructWaitMax).toBe(30);
    msg({ t: "setting", key: "instructWaitMax", value: 7 });
    msg({ t: "setting", key: "instructWaitMax", value: "10" });
    expect(store.settings.instructWaitMax).toBe(30);
    expect(log).toHaveBeenCalledTimes(5);
  });

  it("la vista trae waitForMe solo si está encendido y settings.instructWaitMax", () => {
    const { store, view } = make();
    store.focus("s1");
    expect(view().detail!.waitForMe).toBeUndefined();
    expect(view().settings!.instructWaitMax).toBe(10);
    store.setSessionWait("s1", true);
    expect(view().detail!.waitForMe).toBe(true);
  });
});

describe("recuerdo por proyecto", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wait-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("Esperar mi respuesta se guarda por proyecto y sobrevive a un reinicio; la cola no", () => {
    const waitProjectsPath = join(dir, "wait-projects.json");
    const a = make({ waitProjectsPath });
    a.store.setSessionWait("s1", true);
    a.store.enqueueInstruction("s1", "x");
    expect(JSON.parse(readFileSync(waitProjectsPath, "utf8"))).toEqual(["mi-portal"]);
    const b = new BridgeStore({ waitProjectsPath });
    b.upsertSession({ sessionId: "z", kind: "claude", project: "mi-portal" });
    b.upsertSession({ sessionId: "y", kind: "claude", project: "otro" });
    expect(b.getSession("z")!.waitForMe).toBe(true);
    expect(b.getSession("y")!.waitForMe).toBe(false);
    expect(b.instructionsOf("z")).toEqual([]);
    b.setSessionWait("z", false);
    expect(JSON.parse(readFileSync(waitProjectsPath, "utf8"))).toEqual([]);
  });
});

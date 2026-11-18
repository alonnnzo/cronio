import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BridgeStore } from "../src/store.ts";
import { activityFor, applyClaudeHook } from "../src/adapters/claude-code.ts";

let store: BridgeStore;
beforeEach(() => {
  vi.useFakeTimers();
  store = new BridgeStore();
});
afterEach(() => {
  store.dispose();
  vi.useRealTimers();
});

const base = { session_id: "c1", cwd: "C:\\Users\\tu-usuario\\developer\\mi-portal" };
const hook = (extra: Record<string, unknown>) => applyClaudeHook(store, { ...base, ...extra });
const s = () => store.getSession("c1")!;

describe("applyClaudeHook: tabla de eventos", () => {
  it("SessionStart: crea la sesión con model y session_title; el proyecto es el último tramo de cwd", () => {
    hook({ hook_event_name: "SessionStart", model: "claude-opus", session_title: "Ajustar el hero" });
    expect(s()).toMatchObject({ kind: "claude", project: "mi-portal", model: "claude-opus", title: "Ajustar el hero", state: "idle" });
  });

  it("SessionStart sin model ni título los deja vacíos, y repetido actualiza sin duplicar", () => {
    hook({ hook_event_name: "SessionStart" });
    expect(s()).toMatchObject({ model: "", title: "" });
    hook({ hook_event_name: "SessionStart", model: "m", session_title: "t", cwd: "/home/u/otro" });
    expect(store.sessions).toHaveLength(1);
    expect(s()).toMatchObject({ model: "m", title: "t", project: "otro" });
  });

  it("UserPromptSubmit: working y Pensando", () => {
    hook({ hook_event_name: "UserPromptSubmit", prompt: "hola" });
    expect(s()).toMatchObject({ state: "working", activity: "Pensando" });
  });

  it("PreToolUse: working y la actividad de la herramienta", () => {
    hook({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "src/hero.astro" } });
    expect(s()).toMatchObject({ state: "working", activity: "Editando hero.astro" });
  });

  it("Notification idle_prompt: idle y Esperando instrucciones", () => {
    hook({ hook_event_name: "UserPromptSubmit" });
    hook({ hook_event_name: "Notification", notification_type: "idle_prompt" });
    expect(s()).toMatchObject({ state: "idle", activity: "Esperando instrucciones" });
  });

  it("Notification de otro tipo solo actualiza lastSeen", () => {
    hook({ hook_event_name: "UserPromptSubmit" });
    const before = s().lastSeen;
    vi.advanceTimersByTime(1000);
    hook({ hook_event_name: "Notification", notification_type: "permission_prompt" });
    expect(s()).toMatchObject({ state: "working", activity: "Pensando" });
    expect(s().lastSeen).toBe(before + 1000);
  });

  it("Stop: done, guarda last_assistant_message y actividad en espera", () => {
    hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test" } });
    hook({ hook_event_name: "Stop", last_assistant_message: "Listo, todo pasa." });
    expect(s()).toMatchObject({ state: "done", lastMessage: "Listo, todo pasa.", activity: "Esperando instrucciones" });
  });

  it("Stop sin last_assistant_message no borra el anterior", () => {
    hook({ hook_event_name: "Stop", last_assistant_message: "uno" });
    hook({ hook_event_name: "Stop" });
    expect(s().lastMessage).toBe("uno");
  });

  it("SessionEnd: retira la sesión, y no crea una para retirarla", () => {
    hook({ hook_event_name: "SessionStart" });
    hook({ hook_event_name: "SessionEnd" });
    expect(store.sessions).toEqual([]);
    hook({ hook_event_name: "SessionEnd" });
    expect(store.sessions).toEqual([]);
  });

  it("cualquier otro evento: crea si falta y solo actualiza lastSeen", () => {
    hook({ hook_event_name: "PostToolUse" });
    expect(s()).toMatchObject({ state: "idle", activity: "" });
    const before = s().lastSeen;
    vi.advanceTimersByTime(500);
    hook({ hook_event_name: "PreCompact" });
    expect(s().lastSeen).toBe(before + 500);
  });

  it("si la sesión no existe, un evento la crea como claude con el proyecto de cwd", () => {
    hook({ hook_event_name: "UserPromptSubmit", cwd: "/home/u/ATLAS/" });
    expect(s()).toMatchObject({ kind: "claude", project: "ATLAS" });
    applyClaudeHook(store, { session_id: "sin-cwd", hook_event_name: "Stop" });
    expect(store.getSession("sin-cwd")!.project).toBe("unknown");
  });

  it("un PreToolUse que llega antes del PermissionRequest no retira nada", () => {
    store.setConsoleConnected(true);
    hook({ hook_event_name: "SessionStart" });
    hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } });
    void store.requestPermission({ sessionId: "c1", toolName: "Bash", toolInput: { command: "ls" } });
    expect(store.pendingCount).toBe(1);
    expect(s().state).toBe("ask");
  });

  describe("espera tu respuesta", () => {
    const ask = { hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "¿Qué rama uso?", options: [] }] } };

    it("PreToolUse AskUserQuestion: ask, actividad y pregunta recordada", () => {
      hook(ask);
      expect(s()).toMatchObject({ state: "ask", activity: "Te hace una pregunta", question: "¿Qué rama uso?" });
      expect(store.pendingCount).toBe(0);
      expect(store.hasQuestion).toBe(true);
    });

    it("AskUserQuestion sin questions válidas igual pasa a ask", () => {
      hook({ ...ask, tool_input: {} });
      expect(s()).toMatchObject({ state: "ask", question: "Te hace una pregunta" });
    });

    it.each(["PostToolUse", "PostToolUseFailure"])("%s de AskUserQuestion la limpia y vuelve a working", (event) => {
      hook(ask);
      hook({ hook_event_name: event, tool_name: "AskUserQuestion", tool_input: ask.tool_input });
      expect(s()).toMatchObject({ state: "working", question: "" });
      expect(store.hasQuestion).toBe(false);
    });

    it("PostToolUse de AskUserQuestion retira la pregunta pendiente aunque tool_input traiga answers de más", () => {
      store.setConsoleConnected(true);
      hook(ask);
      const questions = [{ question: "¿Qué rama uso?", options: [] }];
      void store.requestQuestion({ sessionId: "c1", toolInput: { questions }, questions: [] });
      void store.requestPermission({ sessionId: "c1", toolName: "Bash", toolInput: { command: "ls" } });
      expect(store.pendingCount).toBe(2);
      hook({ hook_event_name: "PostToolUse", tool_name: "AskUserQuestion", tool_input: { questions, answers: { "¿Qué rama uso?": "main" } } });
      // solo se retira la pregunta (por nombre); el permiso de otra herramienta sigue
      expect(store.pendingCount).toBe(1);
      expect(store.hasQuestion).toBe(false);
    });

    it("UserPromptSubmit limpia la pregunta", () => {
      hook(ask);
      hook({ hook_event_name: "UserPromptSubmit" });
      expect(s()).toMatchObject({ state: "working", activity: "Pensando", question: "" });
    });

    it("otra herramienta en paralelo no saca a la sesión de ask", () => {
      hook(ask);
      hook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "a.ts" } });
      expect(s().state).toBe("ask");
    });

    it("Notification idle_prompt no pisa la pregunta pendiente", () => {
      hook(ask);
      hook({ hook_event_name: "Notification", notification_type: "idle_prompt" });
      expect(s()).toMatchObject({ state: "ask", activity: "Te hace una pregunta" });
    });

    it("wrap_up con ask + Stop: espera tu respuesta, con la pregunta y el último mensaje", () => {
      hook({ hook_event_name: "UserPromptSubmit" });
      hook({ hook_event_name: "PreToolUse", tool_name: "mcp__ccd_turn__wrap_up", tool_input: { recap: "x", ask: "¿Commit?" } });
      expect(s().state).toBe("working"); // hasta el Stop no cambia
      hook({ hook_event_name: "Stop", last_assistant_message: "Todo listo." });
      expect(s()).toMatchObject({ state: "ask", activity: "Espera tu respuesta", question: "¿Commit?", lastMessage: "Todo listo." });
      hook({ hook_event_name: "Notification", notification_type: "idle_prompt" });
      expect(s().state).toBe("ask");
      vi.advanceTimersByTime(10_000); // done se resetearía a idle; ask no
      expect(s().state).toBe("ask");
      hook({ hook_event_name: "UserPromptSubmit" });
      expect(s()).toMatchObject({ state: "working", question: "" });
    });

    it.each([{ recap: "x" }, { ask: "" }, { ask: 5 }, undefined])("wrap_up sin ask válido: Stop termina como siempre (%j)", (input) => {
      hook({ hook_event_name: "PreToolUse", tool_name: "mcp__ccd_turn__wrap_up", tool_input: input });
      hook({ hook_event_name: "Stop", last_assistant_message: "ok" });
      expect(s()).toMatchObject({ state: "done", question: "" });
    });

    it("la pregunta de un turno no se arrastra al siguiente Stop", () => {
      hook({ hook_event_name: "PreToolUse", tool_name: "mcp__ccd_turn__wrap_up", tool_input: { ask: "¿Sigo?" } });
      hook({ hook_event_name: "Stop" });
      hook({ hook_event_name: "UserPromptSubmit" });
      hook({ hook_event_name: "Stop" });
      expect(s().state).toBe("done");
    });
  });

  describe("permisos resueltos en la terminal", () => {
    const pend = (input: unknown = { command: "ls" }, tool = "Bash") => {
      const p = store.requestPermission({ sessionId: "c1", toolName: tool, toolInput: input });
      return p;
    };
    beforeEach(() => {
      store.setConsoleConnected(true);
      hook({ hook_event_name: "SessionStart" });
    });

    it.each(["Stop", "UserPromptSubmit", "SessionEnd"])(
      "%s posterior retira la solicitud de la sesión con ask",
      async (event) => {
        const p = pend();
        hook({ hook_event_name: event });
        await expect(p).resolves.toBe("ask");
        expect(store.pendingCount).toBe(0);
      },
    );

    it("PostToolUse con herramienta e input iguales retira solo esa solicitud (input con otro orden de claves)", async () => {
      const a = pend({ command: "ls", description: "x" });
      const b = pend({ command: "rm x" });
      hook({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { description: "x", command: "ls" } });
      await expect(a).resolves.toBe("ask");
      expect(store.pendingCount).toBe(1);
      expect(store.pending[0]!.toolInput).toEqual({ command: "rm x" });
      store.decide(store.pending[0]!.id, "allow");
      await expect(b).resolves.toBe("allow");
    });

    it("PostToolUseFailure con la misma herramienta e input retira esa solicitud", async () => {
      const a = pend({ command: "ls" });
      hook({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "ls" } });
      await expect(a).resolves.toBe("ask");
      expect(store.pendingCount).toBe(0);
    });

    it.each(["PostToolUse", "PostToolUseFailure"])("%s de otra herramienta no retira nada", (event) => {
      void pend({ command: "ls" });
      hook({ hook_event_name: event, tool_name: "Read", tool_input: { file_path: "a.txt" } });
      hook({ hook_event_name: event, tool_name: "Bash", tool_input: { command: "otro" } });
      hook({ hook_event_name: event });
      expect(store.pendingCount).toBe(1);
      expect(s().state).toBe("ask");
    });

    it("PreToolUse de otra herramienta (o de la misma) no retira nada", () => {
      void pend({ command: "ls" });
      hook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "a.txt" } });
      hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } });
      expect(store.pendingCount).toBe(1);
    });

    it("no toca las solicitudes de otra sesión", async () => {
      hook({ hook_event_name: "SessionStart", session_id: "c2" });
      const other = store.requestPermission({ sessionId: "c2", toolName: "Bash", toolInput: {} });
      void pend();
      hook({ hook_event_name: "Stop" });
      expect(store.pending.map((r) => r.sessionId)).toEqual(["c2"]);
      store.decide(store.pending[0]!.id, "deny");
      await expect(other).resolves.toBe("deny");
    });

    it("la sesión deja de estar en ask y emite el aviso answered_elsewhere", () => {
      const notices: unknown[] = [];
      store.on("notice", (n) => notices.push(n));
      void pend();
      expect(s().state).toBe("ask");
      hook({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" } });
      expect(s().state).toBe("working");
      expect(notices).toContainEqual({ type: "answered_elsewhere", sessionId: "c1" });
    });
  });
});

describe("activityFor: actividad por herramienta", () => {
  const cases: [string, unknown, string][] = [
    ["Edit", { file_path: "C:\\x\\y\\hero.astro" }, "Editando hero.astro"],
    ["Write", { file_path: "/a/b/c.md" }, "Editando c.md"],
    ["MultiEdit", { file_path: "a/b.ts" }, "Editando b.ts"],
    ["NotebookEdit", { notebook_path: "/n/nb.ipynb" }, "Editando nb.ipynb"],
    ["Read", { file_path: "/a/b/c.ts" }, "Leyendo c.ts"],
    ["Bash", { command: "npm test" }, "Ejecutando npm test"],
    ["PowerShell", { command: "Get-ChildItem" }, "Ejecutando Get-ChildItem"],
    ["Grep", { pattern: "x" }, "Buscando en el proyecto"],
    ["Glob", { pattern: "*.ts" }, "Buscando en el proyecto"],
    ["WebFetch", { url: "http://x" }, "Buscando en la web"],
    ["WebSearch", { query: "x" }, "Buscando en la web"],
    ["Agent", {}, "Coordinando subagentes"],
    ["Task", {}, "Coordinando subagentes"],
    ["mcp__github__create_issue", {}, "Usando github"],
    ["mcp__plugin_x_y__tool", {}, "Usando plugin_x_y"],
    ["TodoWrite", {}, "Usando TodoWrite"],
  ];
  for (const [tool, input, want] of cases) {
    it(`${tool} -> ${want}`, () => expect(activityFor(tool, input)).toBe(want));
  }

  it("con entradas incompletas o raras no lanza", () => {
    expect(activityFor("Edit", undefined)).toBe("Editando");
    expect(activityFor("Read", null)).toBe("Leyendo");
    expect(activityFor("Bash", "texto")).toBe("Ejecutando");
    expect(activityFor("Edit", { file_path: 5 })).toBe("Editando");
    expect(activityFor(undefined, {})).toBe("Trabajando");
    expect(activityFor("mcp__", {})).toBe("Usando");
  });
});

describe("applyClaudeHook: cargas inesperadas no lanzan ni dejan basura", () => {
  const payloads: unknown[] = [
    undefined,
    null,
    42,
    "texto",
    [],
    [{ session_id: "c1" }],
    {},
    { session_id: "c1" },
    { session_id: 5, hook_event_name: "Stop" },
    { session_id: "con espacios", hook_event_name: "Stop" },
    { session_id: "x".repeat(49), hook_event_name: "Stop" },
    { session_id: "c1", hook_event_name: ["Stop"] },
    { session_id: "c1", hook_event_name: "PreToolUse", tool_name: { a: 1 }, tool_input: [1, 2] },
    { session_id: "c1", hook_event_name: "PreToolUse", tool_input: "x" },
    { session_id: "c1", hook_event_name: "Stop", last_assistant_message: 123 },
    { session_id: "c1", hook_event_name: "SessionStart", model: {}, session_title: [], cwd: 7 },
    { session_id: "c1", hook_event_name: "Notification", notification_type: { x: 1 } },
    { session_id: "c1", hook_event_name: "__proto__", constructor: "x" },
  ];
  it("ninguna lanza", () => {
    for (const p of payloads) expect(() => applyClaudeHook(store, p), JSON.stringify(p)).not.toThrow();
  });

  it("los ids inválidos no crean sesiones", () => {
    for (const p of payloads) applyClaudeHook(store, p);
    expect(store.sessions.every((x) => /^[A-Za-z0-9_.:-]{1,48}$/.test(x.id))).toBe(true);
    expect(store.getSession("con espacios")).toBeUndefined();
  });

  it("no lanza aunque el store falle", () => {
    const broken = { getSession: () => { throw new Error("boom"); } } as unknown as BridgeStore;
    expect(() => applyClaudeHook(broken, { session_id: "c1", hook_event_name: "Stop" })).not.toThrow();
  });
});

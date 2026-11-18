import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BridgeMessageSchema, MAX_NOTICE_LINES, MAX_TEXT, type NotifyMode } from "@companion/protocol";
import { BridgeStore } from "../src/store.ts";
import { FaceController } from "../src/face.ts";
import { buildView } from "../src/view.ts";
import { applyClaudeHook } from "../src/adapters/claude-code.ts";
import { applyConsoleMessage } from "../src/feed.ts";
import { passes, loadProjectModes, type AttentionEvent } from "../src/notify.ts";
import { postJson, startTestBridge, waitFor, type TestBridge } from "./helpers.ts";

let dir: string;
beforeEach(() => {
  vi.useFakeTimers();
  dir = mkdtempSync(join(tmpdir(), "companion-notify-"));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

function make(opts: { mode?: NotifyMode; ack?: boolean; modesFile?: boolean } = {}) {
  const store = new BridgeStore({ notifyModesPath: opts.modesFile ? join(dir, "modes.json") : undefined });
  if (opts.mode) store.setSetting({ key: "notifyDefault", value: opts.mode });
  if (opts.ack === false) store.setSetting({ key: "notifyAck", value: false });
  store.setConsoleConnected(true);
  const face = new FaceController(store);
  const view = () => buildView(store, face);
  const add = (id: string, kind: "claude" | "codex" | "gemini" = "claude", project = "proj") => store.upsertSession({ sessionId: id, kind, project });
  return { store, face, view, add };
}

const EVENTS: AttentionEvent[] = ["working", "permission", "ask_tool", "ask_stop", "error", "done", "idle"];

describe("tabla evento → aviso por modo", () => {
  const expected: Record<NotifyMode, AttentionEvent[]> = {
    all: EVENTS,
    important: ["permission", "ask_tool", "ask_stop", "error", "done", "idle"],
    end: ["ask_stop", "done", "idle"],
    silent: [],
  };
  for (const mode of ["all", "important", "end", "silent"] as const) {
    it(`${mode}: ${expected[mode].join(", ") || "nada"}`, () => {
      expect(EVENTS.filter((e) => passes(mode, e))).toEqual(expected[mode]);
    });
  }
});

describe("modo de aviso por sesión", () => {
  it("las sesiones nuevas toman notifyDefault; cambiarlo no toca las ya creadas", () => {
    const { store, add } = make({ mode: "end" });
    add("a");
    expect(store.getSession("a")!.notify).toBe("end");
    store.setSetting({ key: "notifyDefault", value: "silent" });
    add("b");
    expect(store.getSession("a")!.notify).toBe("end");
    expect(store.getSession("b")!.notify).toBe("silent");
  });

  it("se cambia por sesión y se recuerda por proyecto: otra sesión del mismo proyecto lo reutiliza", () => {
    const { store, add } = make({ mode: "important", modesFile: true });
    add("a", "claude", "mi-portal");
    expect(store.setSessionNotify("a", "silent")).toBe(true);
    add("b", "claude", "mi-portal");
    add("c", "claude", "otro");
    expect(store.getSession("b")!.notify).toBe("silent");
    expect(store.getSession("c")!.notify).toBe("important");
    // sobrevive a un reinicio del puente
    expect(JSON.parse(readFileSync(join(dir, "modes.json"), "utf8"))).toEqual({ "mi-portal": "silent" });
    const again = new BridgeStore({ notifyModesPath: join(dir, "modes.json") });
    again.upsertSession({ sessionId: "z", kind: "claude", project: "mi-portal" });
    expect(again.getSession("z")!.notify).toBe("silent");
    again.dispose();
  });

  it("el recuerdo manda sobre notifyDefault; un archivo ausente, dañado o con valores inválidos se carga sin fallar", () => {
    expect(loadProjectModes(join(dir, "no-existe.json")).size).toBe(0);
    writeFileSync(join(dir, "mal.json"), "{no es json");
    expect(loadProjectModes(join(dir, "mal.json")).size).toBe(0);
    writeFileSync(join(dir, "mix.json"), JSON.stringify({ a: "end", b: "ruidoso", c: 3, d: "all" }));
    expect([...loadProjectModes(join(dir, "mix.json"))]).toEqual([["a", "end"], ["d", "all"]]);
    writeFileSync(join(dir, "arr.json"), "[1,2]");
    expect(loadProjectModes(join(dir, "arr.json")).size).toBe(0);
  });

  it("setSessionNotify con una sesión desconocida devuelve false y no recuerda nada", () => {
    const { store } = make({ modesFile: true });
    expect(store.setSessionNotify("nada", "all")).toBe(false);
    expect(store.rememberedMode("proj")).toBeUndefined();
  });

  it("la vista del detalle trae el modo de la sesión abierta", () => {
    const { store, add, view } = make({ mode: "end" });
    add("a");
    store.focus("a");
    expect(view().detail?.notify).toBe("end");
    store.setSessionNotify("a", "all");
    expect(view().detail?.notify).toBe("all");
  });
});

describe("avisos por modo (store)", () => {
  /** Dispara cada hecho en una sesión nueva de ese modo y devuelve qué quedó (sonido y tarjeta). */
  function fire(mode: NotifyMode, what: AttentionEvent, ack = true) {
    const { store, add, view } = make({ mode, ack });
    add("s");
    store.setLastMessage("s", "Listo el refactor.");
    const before = store.lastChime?.seq ?? 0;
    switch (what) {
      case "working":
        store.setSessionState("s", "working");
        break;
      case "permission":
        void store.requestPermission({ sessionId: "s", toolName: "Bash", toolInput: { command: "ls" } });
        break;
      case "ask_tool":
        store.setQuestion("s", "¿Sigo?", "tool");
        break;
      case "ask_stop":
        store.setQuestion("s", "¿Sigo?", "stop");
        break;
      case "error":
        store.setActivity("s", "falló el build");
        store.setSessionState("s", "error");
        break;
      case "done":
        store.setSessionState("s", "done");
        break;
      case "idle":
        store.notifyIdle("s");
        break;
    }
    const chimed = (store.lastChime?.seq ?? 0) > before;
    return { chimed, chime: store.lastChime?.kind, card: store.currentNotice?.card, view: view(), store };
  }

  const CHIME = { permission: "permission", ask_tool: "ask", ask_stop: "ask", error: "error", done: "done", idle: "done" } as const;
  const CARD = { ask_tool: "ask", ask_stop: "ask", error: "error", done: "done", idle: "idle" } as const;

  for (const mode of ["all", "important", "end", "silent"] as const) {
    for (const ev of EVENTS.filter((e) => e !== "working")) {
      it(`${mode} + ${ev}`, () => {
        const r = fire(mode, ev);
        const should = passes(mode, ev);
        expect(r.chimed, "sonido").toBe(should);
        if (should) expect(r.chime).toBe(CHIME[ev as keyof typeof CHIME]);
        const wantsCard = should && ev !== "permission";
        expect(r.card?.kind, "tarjeta").toBe(wantsCard ? CARD[ev as keyof typeof CARD] : undefined);
        if (ev === "permission") expect(r.view.request, "el permiso siempre es tarjeta").not.toBeNull();
        if (ev === "ask_tool" || ev === "ask_stop") expect(r.view.sessions[0]!.activity, "la pregunta no se oculta").toBe("¿Sigo?");
        r.store.dispose();
      });
    }
  }

  it("sin 'Visto' (notifyAck false) suena igual pero no hay tarjeta", () => {
    const r = fire("important", "done", false);
    expect(r.chimed).toBe(true);
    expect(r.card).toBeUndefined();
    expect(r.view.notice).toBeUndefined();
    r.store.dispose();
  });

  it("el globo de la cara: 'empezó a trabajar' solo con all; 'terminó' con all, important y end; silent nada", () => {
    for (const [mode, working, done] of [["all", true, true], ["important", false, true], ["end", false, true], ["silent", false, false]] as const) {
      const { store, add, face } = make({ mode });
      add("s");
      store.setSessionState("s", "working");
      expect(face.current.lines[0] === "Claude empezó a trabajar", `${mode} working`).toBe(working);
      vi.advanceTimersByTime(5000);
      store.setSessionState("s", "done");
      expect(face.current.lines[0] === "¡Claude terminó!", `${mode} done`).toBe(done);
      store.dispose();
    }
  });

  it("silent: ni globo ni ambiente ni pregunta en la cara ni LED por la pregunta; el permiso sí es tarjeta", () => {
    const { store, add, face, view } = make({ mode: "silent" });
    add("s");
    store.setSessionState("s", "working");
    expect(face.current.lines).toEqual(["Todo tranquilo"]);
    store.setQuestion("s", "¿Sigo?");
    expect(face.current.lines).toEqual(["Todo tranquilo"]);
    expect(view().led).toBe("off");
    void store.requestPermission({ sessionId: "s", toolName: "Bash", toolInput: { command: "ls" } });
    expect(view().request).not.toBeNull();
    expect(face.current.mood).toBe("ask");
    expect(view().led).toBe("ask");
    expect(store.lastChime).toBeNull(); // sin sonido
  });

  it("agente oculto: no avisa (ni sonido ni tarjeta); su permiso sí llega", () => {
    const { store, add, view } = make({ mode: "all" });
    store.setSetting({ key: "hiddenAgents", value: ["codex"] });
    add("h", "codex");
    store.setSessionState("h", "done");
    expect(store.lastChime).toBeNull();
    expect(view().notice).toBeUndefined();
    void store.requestPermission({ sessionId: "h", toolName: "Bash", toolInput: { command: "ls" } });
    expect(view().request).not.toBeNull();
  });

  it("ocultar un agente retira sus tarjetas; desactivar 'Visto' retira todas", () => {
    const { store, add, view } = make();
    add("a", "claude");
    add("b", "codex");
    store.setSessionState("a", "done");
    store.setSessionState("b", "done");
    expect(view().notice?.total).toBe(2);
    store.setSetting({ key: "hiddenAgents", value: ["codex"] });
    expect(view().notice).toMatchObject({ sessionId: "a", total: 1 });
    store.setSetting({ key: "notifyAck", value: false });
    expect(view().notice).toBeUndefined();
  });

  it("cambiar el modo de la sesión retira el aviso que el modo nuevo no dejaría pasar", () => {
    const { store, add, view } = make();
    add("a");
    store.setQuestion("a", "¿Sigo?", "tool");
    expect(view().notice?.kind).toBe("ask");
    store.setSessionNotify("a", "end"); // la pregunta de herramienta no pasa en `end`
    expect(view().notice).toBeUndefined();
  });
});

describe("tarjetas de aviso", () => {
  it("contenido: título, agente, proyecto y comienzo del mensaje en hasta 4 líneas de 38", () => {
    const { store, add, view } = make();
    add("a", "codex", "ATLAS");
    store.setLastMessage("a", "**Listo** el refactor del runner. " + "Corrí los tests y pasan. ".repeat(20));
    store.setSessionState("a", "done");
    const n = view().notice!;
    expect(n).toMatchObject({ sessionId: "a", kind: "done", agent: "Codex", project: "ATLAS", title: "Terminó", position: 1, total: 1 });
    expect(n.lines.length).toBe(MAX_NOTICE_LINES);
    expect(n.lines.every((l) => l.length <= MAX_TEXT)).toBe(true);
    expect(n.lines[0]).toBe("Listo el refactor del runner. Corrí"); // sin markdown
    expect(BridgeMessageSchema.safeParse({ t: "view", rev: 1, view: view() }).success).toBe(true);
  });

  it("títulos por clase", () => {
    const { store, add, view } = make();
    add("a");
    store.setQuestion("a", "¿Prefieres A o B?", "stop");
    expect(view().notice).toMatchObject({ kind: "ask", title: "Espera tu respuesta", lines: ["¿Prefieres A o B?"] });
    store.clearQuestion("a");
    store.setActivity("a", "2 tests fallaron");
    store.setSessionState("a", "error");
    expect(view().notice).toMatchObject({ kind: "error", title: "Error", lines: ["2 tests fallaron"] });
    store.setSessionState("a", "working");
    store.notifyIdle("a");
    expect(view().notice).toMatchObject({ kind: "idle", title: "Esperando instrucciones" });
  });

  it("una sola por sesión: la más nueva reemplaza a la anterior y la cola mantiene el orden", () => {
    const { store, add, view } = make();
    add("a");
    add("b");
    store.setLastMessage("a", "primero");
    store.setSessionState("a", "done");
    store.setLastMessage("b", "segundo");
    store.setSessionState("b", "done");
    expect(view().notice).toMatchObject({ sessionId: "a", position: 1, total: 2 });
    store.setSessionState("a", "working");
    store.setLastMessage("a", "tercero");
    store.setSessionState("a", "done");
    expect(view().notice).toMatchObject({ sessionId: "b", position: 1, total: 2 });
    store.setQuestion("b", "¿y ahora?", "stop"); // reemplaza el de b
    expect(store.noticeCount).toBe(2);
    expect(view().notice).toMatchObject({ sessionId: "a", lines: ["tercero"] });
  });

  it("'Visto' la retira; un id desconocido se ignora y se registra", () => {
    const { store, add, view } = make();
    add("a");
    store.setSessionState("a", "done");
    const id = view().notice!.id;
    const log = vi.fn();
    applyConsoleMessage(store, { t: "ack", id: "no-existe" }, log);
    expect(log).toHaveBeenCalledOnce();
    expect(view().notice).toBeDefined();
    applyConsoleMessage(store, { t: "ack", id }, log);
    expect(view().notice).toBeUndefined();
    applyConsoleMessage(store, { t: "ack", id }, log); // repetido
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("el 'Visto' es solo de la consola: no resuelve permisos ni cambia a la sesión", async () => {
    const { store, add } = make();
    add("a");
    store.setSessionState("a", "done");
    const p = store.requestPermission({ sessionId: "a", toolName: "Bash", toolInput: { command: "ls" } });
    const decided = vi.fn();
    void p.then(decided);
    applyConsoleMessage(store, { t: "ack", id: "cualquiera" });
    await vi.advanceTimersByTimeAsync(10);
    expect(decided).not.toHaveBeenCalled();
    expect(store.pendingCount).toBe(1);
  });

  it("se retira sola al volver a trabajar, al terminar la sesión y con un permiso nuevo", () => {
    const { store, add, view } = make();
    add("a");
    add("b");
    add("c");
    for (const id of ["a", "b", "c"]) store.setSessionState(id, "done");
    expect(view().notice?.total).toBe(3);
    store.setSessionState("a", "working"); // UserPromptSubmit / PreToolUse
    expect(view().notice?.total).toBe(2);
    store.removeSession("b"); // SessionEnd
    expect(view().notice).toMatchObject({ sessionId: "c", total: 1 });
    void store.requestPermission({ sessionId: "c", toolName: "Bash", toolInput: { command: "ls" } });
    expect(store.noticeCount).toBe(0);
  });

  it("los permisos van primero: con uno pendiente no hay tarjeta de aviso, y vuelve al resolverse el permiso", async () => {
    const { store, add, view } = make();
    add("a");
    add("b");
    store.setSessionState("a", "done");
    expect(view().notice?.sessionId).toBe("a");
    const p = store.requestPermission({ sessionId: "b", toolName: "Bash", toolInput: { command: "ls" } });
    expect(view().request).not.toBeNull();
    expect(view().notice).toBeUndefined();
    store.setMode("manual"); // sin tarjeta de permiso a la vista pero con uno pendiente: tampoco aviso
    expect(view().request).toBeNull();
    expect(view().pendingCount).toBe(1);
    expect(view().notice).toBeUndefined();
    store.setMode("queue");
    store.decide(store.focusedRequest!.id, "allow");
    await p;
    expect(view().notice?.sessionId).toBe("a");
  });

  it("skipNotice recorre la cola de forma circular y no hace nada con un permiso pendiente", () => {
    const { store, add, view } = make();
    add("a");
    add("b");
    add("c");
    for (const id of ["a", "b", "c"]) store.setSessionState(id, "done");
    expect(view().notice).toMatchObject({ sessionId: "a", position: 1, total: 3 });
    store.skipNotice();
    expect(view().notice).toMatchObject({ sessionId: "b", position: 2 });
    store.skipNotice();
    store.skipNotice();
    expect(view().notice).toMatchObject({ sessionId: "a", position: 1 });
    store.skipNotice();
    store.ackNotice(view().notice!.id); // retira b: el enfoque pasa a la más antigua
    expect(view().notice).toMatchObject({ sessionId: "a", total: 2 });
    void store.requestPermission({ sessionId: "c", toolName: "Bash", toolInput: { command: "ls" } });
    store.skipNotice(); // nada
    expect(view().notice).toBeUndefined();
  });

  it("LED: permiso > pregunta > aviso sin 'Visto' > trabajando", () => {
    const { store, add, view } = make();
    add("a");
    add("b");
    add("c");
    store.setSessionState("a", "working");
    expect(view().led).toBe("working");
    store.setSessionState("b", "done");
    expect(view().led).toBe("done"); // aviso sin ver
    store.setSessionState("c", "error");
    store.ackNotice(view().notice!.id); // ve "Terminó"
    expect(view().led).toBe("error");
    store.ackNotice(view().notice!.id);
    expect(view().notice).toBeUndefined();
    vi.advanceTimersByTime(5000);
    expect(view().led).toBe("working");
    store.setSessionState("b", "working");
    store.setQuestion("b", "¿Sigo?", "stop");
    expect(view().led).toBe("ask");
    void store.requestPermission({ sessionId: "a", toolName: "Bash", toolInput: { command: "ls" } });
    expect(view().led).toBe("ask");
  });
});

describe("sonido (chime) en la vista", () => {
  it("sin avisos no hay chime; seq sube de uno en uno con cada aviso que suena", () => {
    const { store, add, view } = make();
    add("a");
    expect(view().chime).toBeUndefined();
    store.setSessionState("a", "done");
    expect(view().chime).toEqual({ kind: "done", seq: 1 });
    store.setSessionState("a", "working");
    expect(view().chime).toEqual({ kind: "done", seq: 1 }); // lo menor no suena
    store.setQuestion("a", "¿Sigo?", "tool");
    expect(view().chime).toEqual({ kind: "ask", seq: 2 });
    store.setQuestion("a", "¿Sigo?", "tool"); // repetida: no vuelve a sonar
    expect(view().chime?.seq).toBe(2);
    store.clearQuestion("a");
    store.setActivity("a", "x");
    store.setSessionState("a", "error");
    expect(view().chime).toEqual({ kind: "error", seq: 3 });
    store.setSessionState("a", "working");
    void store.requestPermission({ sessionId: "a", toolName: "Bash", toolInput: { command: "ls" } });
    expect(view().chime).toEqual({ kind: "permission", seq: 4 });
    expect(BridgeMessageSchema.safeParse({ t: "view", rev: 1, view: view() }).success).toBe(true);
  });
});

describe("hooks de Claude Code", () => {
  const hook = (store: BridgeStore, o: Record<string, unknown>) => applyClaudeHook(store, { session_id: "s1", cwd: "/w/mi-portal", ...o });

  it("Stop: tarjeta 'Terminó' con el comienzo del último mensaje; UserPromptSubmit la retira", () => {
    const { store, view } = make();
    hook(store, { hook_event_name: "SessionStart" });
    hook(store, { hook_event_name: "UserPromptSubmit" });
    hook(store, { hook_event_name: "Stop", last_assistant_message: "Listo el hero. Falta decidir el fondo." });
    expect(view().notice).toMatchObject({ kind: "done", project: "mi-portal", lines: ["Listo el hero. Falta decidir el fondo."] });
    expect(view().chime).toEqual({ kind: "done", seq: 1 });
    hook(store, { hook_event_name: "UserPromptSubmit" });
    expect(view().notice).toBeUndefined();
  });

  it("PreToolUse de trabajo retira la tarjeta; SessionEnd también", () => {
    const { store, view } = make();
    hook(store, { hook_event_name: "Stop", last_assistant_message: "ok" });
    expect(view().notice).toBeDefined();
    hook(store, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "a.ts" } });
    expect(view().notice).toBeUndefined();
    hook(store, { hook_event_name: "Stop", last_assistant_message: "ok" });
    hook(store, { hook_event_name: "SessionEnd" });
    expect(view().notice).toBeUndefined();
  });

  it("idle_prompt tras el fin de turno no vuelve a avisar; sin fin de turno previo avisa 'Esperando instrucciones'", () => {
    const { store, view } = make();
    hook(store, { hook_event_name: "Stop", last_assistant_message: "Listo" });
    store.ackNotice(view().notice!.id);
    hook(store, { hook_event_name: "Notification", notification_type: "idle_prompt" });
    expect(view().notice).toBeUndefined(); // ya había avisado
    expect(view().chime?.seq).toBe(1);

    hook(store, { session_id: "s2", hook_event_name: "SessionStart" });
    applyClaudeHook(store, { session_id: "s2", cwd: "/w/otro", hook_event_name: "Notification", notification_type: "idle_prompt" });
    expect(view().notice).toMatchObject({ sessionId: "s2", kind: "idle", title: "Esperando instrucciones" });
    expect(view().chime?.seq).toBe(2);
  });

  it("AskUserQuestion avisa en all/important y no en end; el fin de turno con pregunta ('te espera') avisa también en end", () => {
    for (const [mode, askTool, askStop] of [["all", true, true], ["important", true, true], ["end", false, true]] as const) {
      const { store, view } = make({ mode });
      hook(store, { hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "¿Cuál fondo?" }] } });
      expect(view().notice?.kind === "ask", `${mode} herramienta`).toBe(askTool);
      expect(view().sessions[0]!.activity).toBe("¿Cuál fondo?"); // nunca se oculta
      hook(store, { hook_event_name: "UserPromptSubmit" });
      hook(store, { hook_event_name: "PreToolUse", tool_name: "mcp__ccd_turn__wrap_up", tool_input: { ask: "¿Hago el commit?" } });
      hook(store, { hook_event_name: "Stop", last_assistant_message: "Terminé" });
      expect(view().notice?.kind === "ask", `${mode} te espera`).toBe(askStop);
      store.dispose();
    }
  });

  it("silent: el Stop no deja tarjeta ni sonido", () => {
    const { store, view } = make({ mode: "silent" });
    hook(store, { hook_event_name: "Stop", last_assistant_message: "Listo" });
    expect(view().notice).toBeUndefined();
    expect(view().chime).toBeUndefined();
  });
});

describe("mensajes de la consola", () => {
  let bridge: TestBridge;
  afterEach(async () => bridge?.cleanup());

  it("ack, skipNotice y setting sessionNotify por el puente real; lo inválido se ignora sin cerrar la conexión", async () => {
    vi.useRealTimers();
    const logs: string[] = [];
    bridge = await startTestBridge({ log: (m) => logs.push(m) });
    const con = await bridge.console();
    for (const id of ["a", "b"]) {
      await postJson("/event", { session_id: id, cwd: "/w/p-" + id, kind: "claude", event: "start" }, bridge);
      await postJson("/event", { session_id: id, kind: "claude", event: "done", last_message: "listo " + id }, bridge);
    }
    await waitFor(() => con.lastView?.notice?.total === 2, 2000, "dos tarjetas");
    expect(con.lastView!.notice).toMatchObject({ sessionId: "a", position: 1 });
    con.send({ t: "skipNotice" });
    await waitFor(() => con.lastView?.notice?.sessionId === "b", 2000, "salta al segundo");

    // modo de sesión: válido
    con.send({ t: "setting", key: "sessionNotify", sessionId: "a", value: "silent" });
    await waitFor(() => bridge.store.getSession("a")!.notify === "silent", 2000, "modo de la sesión a");
    // inválidos: valor, sesión, forma. Se ignoran y se registran
    con.send({ t: "setting", key: "sessionNotify", sessionId: "a", value: "ruidoso" });
    con.send({ t: "setting", key: "sessionNotify", sessionId: "nada", value: "all" });
    con.send({ t: "setting", key: "sessionNotify", value: "all" });
    con.send({ t: "setting", key: "sessionNotify", sessionId: "../../x", value: true });
    con.send({ t: "ack", id: "no-existe" });
    await waitFor(() => logs.filter((l) => l.includes("ignorado")).length >= 5, 2000, "5 ignorados");
    expect(bridge.store.getSession("a")!.notify).toBe("silent");

    // la conexión sigue viva: el ack de verdad llega
    con.send({ t: "ack", id: con.lastView!.notice!.id });
    await waitFor(() => con.lastView?.notice === undefined, 2000, "Visto");
    expect(bridge.store.noticeCount).toBe(0);
  });

  it("el modo recordado por proyecto sobrevive a un reinicio del puente (notify-modes.json)", async () => {
    vi.useRealTimers();
    bridge = await startTestBridge();
    await postJson("/event", { session_id: "a", cwd: "/w/proyecto-x", kind: "claude", event: "start" }, bridge);
    bridge.store.setSessionNotify("a", "end");
    const saved = JSON.parse(readFileSync(join(bridge.tmp, "notify-modes.json"), "utf8"));
    expect(saved).toEqual({ "proyecto-x": "end" });
  });
});

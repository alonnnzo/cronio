import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingChangeSchema, ViewModelSchema, parseConsoleMessage, type ViewModel } from "@companion/protocol";
import { BridgeStore } from "../src/store.ts";
import { FaceController } from "../src/face.ts";
import { buildView } from "../src/view.ts";
import { applyConsoleMessage } from "../src/feed.ts";
import { DEFAULT_QUICK_COMMANDS, DEFAULT_SETTINGS, cleanQuickCommands, loadSettings, saveSettings } from "../src/settings.ts";
import { startTestBridge, waitFor, type TestBridge } from "./helpers.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "settings-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("loadSettings: campo por campo", () => {
  const path = () => join(dir, "settings.json");

  it("archivo que falta: todo por defecto", () => {
    expect(loadSettings(path())).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({ mode: "queue", notifyDefault: "important", notifyAck: true, hiddenAgents: [], sound: true, questions: true, readerDefault: "full", instructWaitMax: 10, quickCommands: DEFAULT_SETTINGS.quickCommands });
  });

  it("archivo anterior que solo trae mode: conserva mode y usa los demás por defecto", () => {
    writeFileSync(path(), JSON.stringify({ mode: "manual" }));
    expect(loadSettings(path())).toEqual({ ...DEFAULT_SETTINGS, mode: "manual" });
  });

  it("un campo inválido cae a su defecto sin tirar los demás", () => {
    writeFileSync(
      path(),
      JSON.stringify({ mode: "manual", notifyDefault: "ruidoso", notifyAck: "si", hiddenAgents: ["gemini", "nadie", "gemini", "claude", 4] }),
    );
    expect(loadSettings(path())).toEqual({ mode: "manual", notifyDefault: "important", notifyAck: true, hiddenAgents: ["claude", "gemini"], sound: true, questions: true, readerDefault: "full", instructWaitMax: 10, quickCommands: DEFAULT_SETTINGS.quickCommands });
    writeFileSync(path(), JSON.stringify({ notifyDefault: "silent", notifyAck: false, hiddenAgents: "claude" }));
    expect(loadSettings(path())).toEqual({ mode: "queue", notifyDefault: "silent", notifyAck: false, hiddenAgents: [], sound: true, questions: true, readerDefault: "full", instructWaitMax: 10, quickCommands: DEFAULT_SETTINGS.quickCommands });
  });

  it("JSON dañado o que no es objeto: por defecto", () => {
    writeFileSync(path(), "{no es json");
    expect(loadSettings(path())).toEqual(DEFAULT_SETTINGS);
    writeFileSync(path(), "[1,2]");
    expect(loadSettings(path())).toEqual(DEFAULT_SETTINGS);
  });

  it("guardar y volver a leer", () => {
    const s = { mode: "manual" as const, notifyDefault: "end" as const, notifyAck: false, hiddenAgents: ["codex" as const], sound: false, questions: false, readerDefault: "summary" as const, instructWaitMax: 30 as const, quickCommands: [{ label: "Uno", text: "Haz uno." }] };
    saveSettings(path(), s);
    expect(loadSettings(path())).toEqual(s);
  });
});

describe("preguntas en la consola (paso 4)", () => {
  const path = () => join(dir, "settings.json");
  it("por defecto activo; un archivo sin el campo o con un valor inválido lo deja activo", () => {
    expect(DEFAULT_SETTINGS.questions).toBe(true);
    writeFileSync(path(), JSON.stringify({ mode: "manual", sound: false }));
    expect(loadSettings(path()).questions).toBe(true);
    writeFileSync(path(), JSON.stringify({ questions: "no" }));
    expect(loadSettings(path()).questions).toBe(true);
    writeFileSync(path(), JSON.stringify({ questions: false }));
    expect(loadSettings(path()).questions).toBe(false);
  });

  it("el cambio se valida, se aplica, se guarda y va en la vista", () => {
    expect(SettingChangeSchema.safeParse({ key: "questions", value: false }).success).toBe(true);
    expect(SettingChangeSchema.safeParse({ key: "questions", value: "false" }).success).toBe(false);
    expect(SettingChangeSchema.safeParse({ key: "questions" }).success).toBe(false);
    const settingsPath = join(dir, "questions.json");
    const store = new BridgeStore({ settingsPath });
    expect(store.settings.questions).toBe(true);
    applyConsoleMessage(store, { t: "setting", key: "questions", value: false });
    expect(store.settings.questions).toBe(false);
    expect(JSON.parse(readFileSync(settingsPath, "utf8")).questions).toBe(false);
    const face = new FaceController(store);
    expect(buildView(store, face).settings!.questions).toBe(false);
    face.dispose();
    store.dispose();
    const again = new BridgeStore({ settingsPath });
    expect(again.settings.questions).toBe(false);
    again.dispose();
  });
});

describe("sonido (paso 3b)", () => {
  const path = () => join(dir, "settings.json");
  it("por defecto activo; un archivo sin el campo o con un valor inválido lo deja activo", () => {
    expect(DEFAULT_SETTINGS.sound).toBe(true);
    writeFileSync(path(), JSON.stringify({ mode: "manual", notifyAck: false }));
    expect(loadSettings(path()).sound).toBe(true);
    writeFileSync(path(), JSON.stringify({ sound: "no" }));
    expect(loadSettings(path()).sound).toBe(true);
    writeFileSync(path(), JSON.stringify({ sound: false }));
    expect(loadSettings(path()).sound).toBe(false);
  });

  it("el cambio se valida, se aplica y se guarda", () => {
    expect(SettingChangeSchema.safeParse({ key: "sound", value: false }).success).toBe(true);
    expect(SettingChangeSchema.safeParse({ key: "sound", value: "false" }).success).toBe(false);
    expect(SettingChangeSchema.safeParse({ key: "sound" }).success).toBe(false);
    const settingsPath = join(dir, "sound.json");
    const store = new BridgeStore({ settingsPath });
    expect(store.settings.sound).toBe(true);
    applyConsoleMessage(store, { t: "setting", key: "sound", value: false });
    expect(store.settings.sound).toBe(false);
    expect(JSON.parse(readFileSync(settingsPath, "utf8")).sound).toBe(false);
    store.dispose();
    const again = new BridgeStore({ settingsPath });
    expect(again.settings.sound).toBe(false);
    again.dispose();
  });
});

describe("SettingChangeSchema", () => {
  it("acepta cada clave con valor válido", () => {
    for (const v of ["all", "important", "end", "silent"]) expect(SettingChangeSchema.safeParse({ key: "notifyDefault", value: v }).success).toBe(true);
    expect(SettingChangeSchema.safeParse({ key: "notifyAck", value: false }).success).toBe(true);
    expect(SettingChangeSchema.safeParse({ key: "hiddenAgents", value: ["claude", "hermes"] }).success).toBe(true);
    expect(SettingChangeSchema.safeParse({ key: "hiddenAgents", value: [] }).success).toBe(true);
  });
  it("rechaza clave desconocida, valor de otro tipo, agente desconocido y repetidos", () => {
    expect(SettingChangeSchema.safeParse({ key: "idioma", value: "es" }).success).toBe(false);
    expect(SettingChangeSchema.safeParse({ key: "notifyDefault", value: "ruidoso" }).success).toBe(false);
    expect(SettingChangeSchema.safeParse({ key: "notifyAck", value: "true" }).success).toBe(false);
    expect(SettingChangeSchema.safeParse({ key: "hiddenAgents", value: ["nadie"] }).success).toBe(false);
    expect(SettingChangeSchema.safeParse({ key: "hiddenAgents", value: ["claude", "claude"] }).success).toBe(false);
  });
  it("el mensaje setting pasa el análisis de forma de la consola", () => {
    expect(parseConsoleMessage({ t: "setting", key: "notifyAck", value: false })).toEqual({ t: "setting", key: "notifyAck", value: false });
    expect(() => parseConsoleMessage({ t: "setting", key: "x" })).toThrow();
  });
});

describe("store y applyConsoleMessage", () => {
  it("un cambio válido se guarda en disco, emite change y sobrevive a un reinicio", () => {
    const settingsPath = join(dir, "settings.json");
    const store = new BridgeStore({ settingsPath });
    const changes = vi.fn();
    store.on("change", changes);
    applyConsoleMessage(store, { t: "setting", key: "notifyDefault", value: "silent" });
    applyConsoleMessage(store, { t: "setting", key: "notifyAck", value: false });
    applyConsoleMessage(store, { t: "setting", key: "hiddenAgents", value: ["hermes", "claude"] });
    expect(changes).toHaveBeenCalledTimes(3);
    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({
      mode: "queue",
      notifyDefault: "silent",
      notifyAck: false,
      hiddenAgents: ["claude", "hermes"],
      sound: true,
      questions: true,
      readerDefault: "full",
      instructWaitMax: 10,
      quickCommands: DEFAULT_SETTINGS.quickCommands,
    });
    // el mismo valor otra vez no es un cambio
    applyConsoleMessage(store, { t: "setting", key: "notifyAck", value: false });
    expect(changes).toHaveBeenCalledTimes(3);
    store.setMode("manual"); // el modo no pisa lo demás
    expect(loadSettings(settingsPath)).toEqual({ mode: "manual", notifyDefault: "silent", notifyAck: false, hiddenAgents: ["claude", "hermes"], sound: true, questions: true, readerDefault: "full", instructWaitMax: 10, quickCommands: DEFAULT_SETTINGS.quickCommands });
    store.dispose();
    const again = new BridgeStore({ settingsPath });
    expect(again.mode).toBe("manual");
    expect(again.settings.notifyDefault).toBe("silent");
    again.dispose();
  });

  it("clave desconocida o valor inválido: se ignora, se registra y no cambia nada ni lanza", () => {
    const store = new BridgeStore();
    const log = vi.fn();
    const before = store.settings;
    const bad: [string, unknown][] = [
      ["idioma", "en"],
      ["notifyDefault", "ruidoso"],
      ["notifyAck", "no"],
      ["sound", "no"],
      ["questions", "no"],
      ["hiddenAgents", ["claude", "claude"]],
      ["hiddenAgents", ["nadie"]],
    ];
    for (const [key, value] of bad) {
      expect(() => applyConsoleMessage(store, { t: "setting", key, value: value as never }, log)).not.toThrow();
    }
    expect(log).toHaveBeenCalledTimes(7);
    expect(store.settings).toEqual(before);
    store.dispose();
  });
});

describe("la vista", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function make() {
    const store = new BridgeStore();
    const face = new FaceController(store);
    const view = (): ViewModel => {
      const v = buildView(store, face);
      expect(ViewModelSchema.safeParse(v).success).toBe(true);
      return v;
    };
    return { store, face, view };
  }

  it("trae settings con los valores por defecto", () => {
    const { view, store } = make();
    expect(view().settings).toEqual({ notifyDefault: "important", notifyAck: true, hiddenAgents: [], sound: true, questions: true, readerDefault: "full", instructWaitMax: 10 });
    store.dispose();
  });

  it("un agente oculto sale de la lista de sesiones; al mostrarlo vuelve", () => {
    const { view, store } = make();
    store.upsertSession({ sessionId: "a", kind: "claude", project: "p" });
    store.upsertSession({ sessionId: "b", kind: "gemini", project: "q" });
    store.setSetting({ key: "hiddenAgents", value: ["gemini"] });
    expect(view().sessions.map((s) => s.id)).toEqual(["a"]);
    expect(view().settings?.hiddenAgents).toEqual(["gemini"]);
    store.setSetting({ key: "hiddenAgents", value: [] });
    expect(view().sessions.map((s) => s.id)).toEqual(["a", "b"]);
    store.dispose();
  });

  it("los permisos de un agente oculto siguen llegando: request, pendingCount, cara de permiso y su sesión", () => {
    const { view, store } = make();
    store.upsertSession({ sessionId: "g", kind: "gemini", project: "q" });
    store.upsertSession({ sessionId: "c", kind: "claude", project: "p" });
    store.setConsoleConnected(true);
    store.setSetting({ key: "hiddenAgents", value: ["gemini"] });
    void store.requestPermission({ sessionId: "g", toolName: "Bash", toolInput: { command: "rm -rf x" } });
    const v = view();
    expect(v.request).toMatchObject({ sessionId: "g", position: 1, total: 1 });
    expect(v.pendingCount).toBe(1);
    expect(v.face).toMatchObject({ kind: "gemini", mood: "ask" });
    expect(v.led).toBe("ask");
    // la sesión de la tarjeta se queda (la consola resuelve de quién es); la lista no tiene más ocultos
    expect(v.sessions.map((s) => s.id)).toEqual(["g", "c"]);
    store.dispose();
  });
});

describe("la cara con agentes ocultos", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("no menciona al agente oculto: ni ambiente, ni avisos de empezó, terminó o error", () => {
    const store = new BridgeStore();
    const face = new FaceController(store);
    store.upsertSession({ sessionId: "a", kind: "claude", project: "mi-portal" });
    store.upsertSession({ sessionId: "b", kind: "gemini", project: "otro-sitio" });
    store.setSetting({ key: "hiddenAgents", value: ["gemini"] });
    store.setSessionState("b", "working");
    store.setActivity("b", "Leyendo");
    expect(face.current).toEqual({ kind: null, mood: "idle", lines: ["Todo tranquilo"] });
    vi.advanceTimersByTime(20_000);
    expect(face.current).toEqual({ kind: null, mood: "idle", lines: ["Todo tranquilo"] });
    store.setSessionState("a", "working");
    store.setActivity("a", "Editando");
    vi.advanceTimersByTime(20_000);
    expect(face.current.lines[0]).toBe("Claude en mi-portal");
    store.setSessionState("b", "done");
    expect(face.current.lines[0]).toBe("Claude en mi-portal"); // "Gemini terminó" no sale
    store.dispose();
  });

  it("la cara de permiso de un agente oculto se mantiene, y también el aviso de la decisión", async () => {
    const store = new BridgeStore();
    const face = new FaceController(store);
    store.upsertSession({ sessionId: "b", kind: "gemini", project: "otro-sitio" });
    store.setConsoleConnected(true);
    store.setSetting({ key: "hiddenAgents", value: ["gemini"] });
    const p = store.requestPermission({ sessionId: "b", toolName: "Bash", toolInput: { command: "ls" } });
    expect(face.current).toMatchObject({ kind: "gemini", mood: "ask" });
    expect(face.current.lines[0]).toBe("Gemini necesita permiso");
    store.decide(store.focusedRequest!.id, "allow");
    await p;
    expect(face.current.lines[0]).toBe("Permiso aprobado");
    store.dispose();
  });
});

describe("integración: la consola cambia un ajuste", () => {
  let bridge: TestBridge;
  afterEach(async () => {
    await bridge?.cleanup();
  });

  it("setting llega por TCP y se reenvía la vista; uno inválido se ignora y la conexión sigue", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    await waitFor(() => con.views.length > 0, 2000, "vista inicial");
    expect(con.lastView!.settings).toEqual({ notifyDefault: "important", notifyAck: true, hiddenAgents: [], sound: true, questions: true, readerDefault: "full", instructWaitMax: 10 });

    con.send({ t: "setting", key: "notifyDefault", value: "end" });
    await waitFor(() => con.lastView?.settings?.notifyDefault === "end", 2000, "notifyDefault");
    con.send({ t: "setting", key: "hiddenAgents", value: ["cursor"] });
    await waitFor(() => con.lastView?.settings?.hiddenAgents.join() === "cursor", 2000, "hiddenAgents");

    con.send({ t: "setting", key: "idioma", value: "en" });
    con.send({ t: "setting", key: "notifyAck", value: "quizás" as never });
    con.send({ t: "mode", mode: "manual" }); // y sigue atendiendo
    await waitFor(() => con.lastView?.mode === "manual", 2000, "modo");
    expect(con.closed).toBe(false);
    expect(con.lastView!.settings).toEqual({ notifyDefault: "end", notifyAck: true, hiddenAgents: ["cursor"], sound: true, questions: true, readerDefault: "full", instructWaitMax: 10 });
  });
});

describe("abrir mensajes en (readerDefault, paso 5)", () => {
  const path = () => join(dir, "settings.json");

  it("por defecto full; un archivo sin el campo o con un valor inválido lo deja en full", () => {
    expect(DEFAULT_SETTINGS.readerDefault).toBe("full");
    writeFileSync(path(), JSON.stringify({ mode: "manual", sound: false }));
    expect(loadSettings(path()).readerDefault).toBe("full");
    writeFileSync(path(), JSON.stringify({ readerDefault: "brief" }));
    expect(loadSettings(path()).readerDefault).toBe("full");
    writeFileSync(path(), JSON.stringify({ readerDefault: true }));
    expect(loadSettings(path()).readerDefault).toBe("full");
    writeFileSync(path(), JSON.stringify({ readerDefault: "summary" }));
    expect(loadSettings(path()).readerDefault).toBe("summary");
  });

  it("el cambio se valida, se aplica, se guarda y va en la vista", () => {
    expect(SettingChangeSchema.safeParse({ key: "readerDefault", value: "summary" }).success).toBe(true);
    expect(SettingChangeSchema.safeParse({ key: "readerDefault", value: "brief" }).success).toBe(false);
    expect(SettingChangeSchema.safeParse({ key: "readerDefault", value: false }).success).toBe(false);
    expect(SettingChangeSchema.safeParse({ key: "readerDefault" }).success).toBe(false);
    const settingsPath = join(dir, "reader.json");
    const store = new BridgeStore({ settingsPath });
    expect(store.settings.readerDefault).toBe("full");
    applyConsoleMessage(store, { t: "setting", key: "readerDefault", value: "summary" });
    expect(store.settings.readerDefault).toBe("summary");
    expect(JSON.parse(readFileSync(settingsPath, "utf8")).readerDefault).toBe("summary");
    const face = new FaceController(store);
    expect(buildView(store, face).settings!.readerDefault).toBe("summary");
    face.dispose();
    expect(new BridgeStore({ settingsPath }).settings.readerDefault).toBe("summary"); // sobrevive a un reinicio
    // un valor inválido no cambia nada
    applyConsoleMessage(store, { t: "setting", key: "readerDefault", value: "brief" });
    expect(store.settings.readerDefault).toBe("summary");
  });
});

describe("comandos rápidos (ajuste quickCommands)", () => {
  const path = () => join(dir, "settings.json");
  it("de fábrica son los cuatro pedidos, y un archivo sin el campo los deja", () => {
    expect(DEFAULT_QUICK_COMMANDS.map((c) => c.label)).toEqual(["Sigue", "Corre las pruebas", "Haz commit", "Resume"]);
    writeFileSync(path(), JSON.stringify({ mode: "manual" }));
    expect(loadSettings(path()).quickCommands).toEqual(DEFAULT_QUICK_COMMANDS);
  });
  it("se limpian: topes de largo, en una línea, sin vacíos ni basura y máximo cuatro", () => {
    const c = cleanQuickCommands([
      { label: "  Una etiqueta demasiado larga para caber ", text: "Hola\nmundo" },
      { label: "", text: "x" },
      { label: "y", text: "" },
      7,
      null,
      { label: 1, text: "z" },
      { label: "Largo", text: "a".repeat(300) },
      { label: "3", text: "3" },
      { label: "4", text: "4" },
      { label: "5", text: "5" },
    ]);
    expect(c).toHaveLength(4);
    expect(c[0]).toEqual({ label: "Una etiqueta demasia", text: "Hola mundo" });
    expect(c[0]!.label.length).toBeLessThanOrEqual(20);
    expect(c[1]!.text).toHaveLength(120);
    expect(c.map((x) => x.label)).toEqual(["Una etiqueta demasia", "Largo", "3", "4"]);
  });
  it("lista vacía = ninguno; algo que no es lista = los de fábrica; guardar y volver a leer", () => {
    writeFileSync(path(), JSON.stringify({ quickCommands: [] }));
    expect(loadSettings(path()).quickCommands).toEqual([]);
    writeFileSync(path(), JSON.stringify({ quickCommands: "no" }));
    expect(loadSettings(path()).quickCommands).toEqual(DEFAULT_QUICK_COMMANDS);
    const s = { ...DEFAULT_SETTINGS, quickCommands: [{ label: "Uno", text: "Haz uno." }] };
    saveSettings(path(), s);
    expect(loadSettings(path()).quickCommands).toEqual(s.quickCommands);
  });
});

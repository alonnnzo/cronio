import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BridgeStore, type BridgeStoreOptions, type Decision } from "../src/store.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";

const tool = { toolName: "Bash", toolInput: { command: "ls" } };
const cmd = (c: string) => ({ toolName: "Bash", toolInput: { command: c } });

function setup(opts: BridgeStoreOptions = {}) {
  const store = new BridgeStore(opts);
  store.upsertSession({ sessionId: "s1", kind: "claude", project: "proj" });
  return store;
}

/** Tres sesiones con una solicitud cada una, en orden a, b, c. Devuelve las promesas y los ids. */
function threePending(opts: BridgeStoreOptions = {}) {
  const store = new BridgeStore(opts);
  for (const id of ["a", "b", "c"]) store.upsertSession({ sessionId: id, kind: "claude", project: `p-${id}` });
  store.setConsoleConnected(true);
  const promises: Promise<Decision>[] = [];
  const ids: string[] = [];
  for (const id of ["a", "b", "c"]) {
    promises.push(store.requestPermission({ sessionId: id, ...cmd(`cmd ${id}`) }));
    ids.push(store.pending.at(-1)!.id);
  }
  return { store, promises, ids };
}

describe("BridgeStore: permisos", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sin consola resuelve ask de inmediato", async () => {
    const store = setup();
    await expect(store.requestPermission({ sessionId: "s1", ...tool })).resolves.toBe("ask");
    expect(store.pendingCount).toBe(0);
  });

  it("con consola queda pendiente y decide resuelve allow", async () => {
    const store = setup();
    store.setConsoleConnected(true);
    const p = store.requestPermission({ sessionId: "s1", ...tool });
    const id = store.focusedRequest!.id;
    expect(store.sessions[0]!.state).toBe("ask");
    expect(store.decide(id, "allow")).toBe(true);
    await expect(p).resolves.toBe("allow");
    expect(store.sessions[0]!.state).toBe("working");
    expect(store.focusedRequest).toBeNull();
  });

  it("decide resuelve deny", async () => {
    const store = setup();
    store.setConsoleConnected(true);
    const p = store.requestPermission({ sessionId: "s1", ...tool });
    store.decide(store.focusedRequest!.id, "deny");
    await expect(p).resolves.toBe("deny");
  });

  it("decide repetido o con id desconocido devuelve false y no cambia nada", async () => {
    const store = setup();
    store.setConsoleConnected(true);
    const p = store.requestPermission({ sessionId: "s1", ...tool });
    const id = store.focusedRequest!.id;
    expect(store.decide("nope", "allow")).toBe(false);
    expect(store.pendingCount).toBe(1);
    expect(store.decide(id, "allow")).toBe(true);
    const onChange = vi.fn();
    store.on("change", onChange);
    expect(store.decide(id, "deny")).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    await expect(p).resolves.toBe("allow");
  });

  it("plazo configurable: vence con ask y la sesión vuelve a working", async () => {
    const store = setup({ requestTimeoutMs: 1000 });
    store.setConsoleConnected(true);
    const p = store.requestPermission({ sessionId: "s1", ...tool });
    vi.advanceTimersByTime(999);
    expect(store.pendingCount).toBe(1);
    vi.advanceTimersByTime(1);
    await expect(p).resolves.toBe("ask");
    expect(store.pendingCount).toBe(0);
    expect(store.sessions[0]!.state).toBe("working");
  });

  it("por defecto no hay plazo: la solicitud sigue pendiente pasadas horas y deadline vale 0", async () => {
    const store = setup();
    store.setConsoleConnected(true);
    const p = store.requestPermission({ sessionId: "s1", ...tool });
    expect(store.pending[0]!.deadline).toBe(0);
    vi.advanceTimersByTime(48 * 3_600_000);
    expect(store.pendingCount).toBe(1);
    store.decide(store.pending[0]!.id, "allow");
    await expect(p).resolves.toBe("allow");
  });

  it("requestTimeoutMs 0 equivale a sin límite", () => {
    const store = setup({ requestTimeoutMs: 0 });
    store.setConsoleConnected(true);
    void store.requestPermission({ sessionId: "s1", ...tool });
    vi.advanceTimersByTime(3_600_000);
    expect(store.pendingCount).toBe(1);
  });

  it("resolveElsewhere con aviso: retira con ask y emite answered_elsewhere; abortar también", async () => {
    const store = setup();
    store.setConsoleConnected(true);
    const notices: unknown[] = [];
    store.on("notice", (n) => notices.push(n));
    const p = store.requestPermission({ sessionId: "s1", ...tool });
    expect(store.resolveElsewhere("s1")).toBe(1);
    await expect(p).resolves.toBe("ask");
    expect(notices).toEqual([{ type: "answered_elsewhere", sessionId: "s1" }]);
    expect(store.resolveElsewhere("s1")).toBe(0);
    const ac = new AbortController();
    void store.requestPermission({ sessionId: "s1", ...tool, signal: ac.signal });
    ac.abort();
    expect(notices).toHaveLength(2);
    expect(notices[1]).toEqual({ type: "withdrawn", sessionId: "s1" }); // abortar no dice "respondido en el PC"
  });

  it("resolveElsewhere con match retira solo la coincidente y, sin coincidencia, nada", async () => {
    const store = setup();
    store.setConsoleConnected(true);
    const a = store.requestPermission({ sessionId: "s1", toolName: "Bash", toolInput: { command: "ls" } });
    void store.requestPermission({ sessionId: "s1", toolName: "Bash", toolInput: { command: "rm x" } });
    expect(store.resolveElsewhere("s1", { toolName: "Read" })).toBe(0);
    expect(store.resolveElsewhere("s1", { toolName: "Bash", toolInput: { command: "otro" } })).toBe(0);
    expect(store.resolveElsewhere("s1", {})).toBe(0);
    expect(store.pendingCount).toBe(2);
    expect(store.resolveElsewhere("s1", { toolName: "Bash", toolInput: { command: "ls" } })).toBe(1);
    await expect(a).resolves.toBe("ask");
    expect(store.pendingCount).toBe(1);
  });

  it("abortar con AbortSignal retira la solicitud", async () => {
    const store = setup();
    store.setConsoleConnected(true);
    const ac = new AbortController();
    const p = store.requestPermission({ sessionId: "s1", ...tool, signal: ac.signal });
    expect(store.pendingCount).toBe(1);
    ac.abort();
    expect(store.pendingCount).toBe(0);
    expect(store.focusedRequest).toBeNull();
    await expect(p).resolves.toBe("ask");
  });

  it("signal ya abortada no encola", async () => {
    const store = setup();
    store.setConsoleConnected(true);
    const ac = new AbortController();
    ac.abort();
    await expect(store.requestPermission({ sessionId: "s1", ...tool, signal: ac.signal })).resolves.toBe("ask");
    expect(store.pendingCount).toBe(0);
  });

  it("desconectar la consola resuelve todas las pendientes con ask", async () => {
    const { store, promises } = threePending();
    store.setConsoleConnected(false);
    for (const p of promises) await expect(p).resolves.toBe("ask");
    expect(store.pendingCount).toBe(0);
  });

  it("varias pendientes a la vez, en orden de llegada; con otra pendiente de la misma sesión sigue en ask", async () => {
    const store = setup();
    store.setConsoleConnected(true);
    const a = store.requestPermission({ sessionId: "s1", ...cmd("uno") });
    const b = store.requestPermission({ sessionId: "s1", ...cmd("dos") });
    expect(store.pending.map((r) => (r.toolInput as { command: string }).command)).toEqual(["uno", "dos"]);
    store.decide(store.pending[0]!.id, "allow");
    await a;
    expect((store.focusedRequest!.toolInput as { command: string }).command).toBe("dos");
    expect(store.sessions[0]!.state).toBe("ask");
    store.decide(store.focusedRequest!.id, "deny");
    await expect(b).resolves.toBe("deny");
    expect(store.sessions[0]!.state).toBe("working");
  });

  it("done y error vuelven a idle a los 3 s", () => {
    const store = setup();
    store.setSessionState("s1", "done");
    vi.advanceTimersByTime(2999);
    expect(store.sessions[0]!.state).toBe("done");
    vi.advanceTimersByTime(1);
    expect(store.sessions[0]!.state).toBe("idle");
    store.setSessionState("s1", "error");
    vi.advanceTimersByTime(3000);
    expect(store.sessions[0]!.state).toBe("idle");
  });

  it("un estado nuevo cancela el retorno a idle", () => {
    const store = setup();
    store.setSessionState("s1", "done");
    store.setSessionState("s1", "working");
    vi.advanceTimersByTime(5000);
    expect(store.sessions[0]!.state).toBe("working");
  });

  it("con un permiso pendiente, un cambio de estado de la sesión no pisa a ask", async () => {
    const store = setup();
    store.setConsoleConnected(true);
    const p = store.requestPermission({ sessionId: "s1", ...tool });
    store.setSessionState("s1", "working");
    expect(store.sessions[0]!.state).toBe("ask");
    store.decide(store.focusedRequest!.id, "allow");
    await p;
    expect(store.sessions[0]!.state).toBe("working");
  });

  it("emite change", () => {
    const store = new BridgeStore();
    const onChange = vi.fn();
    store.on("change", onChange);
    store.upsertSession({ sessionId: "s1", kind: "claude", project: "p" });
    store.setSessionState("s1", "working");
    store.setActivity("s1", "x");
    store.setLastMessage("s1", "y");
    store.setConsoleConnected(true);
    store.setMode("manual");
    store.removeSession("s1");
    expect(onChange).toHaveBeenCalledTimes(7);
    store.dispose();
  });

  it("removeSession resuelve sus pendientes y suelta el enfoque", async () => {
    const store = setup();
    store.upsertSession({ sessionId: "s2", kind: "codex", project: "q" });
    store.setConsoleConnected(true);
    const p = store.requestPermission({ sessionId: "s1", ...tool });
    store.focus("s1");
    store.removeSession("s1");
    await expect(p).resolves.toBe("ask");
    expect(store.focusedSessionId).toBeNull();
  });
});

describe("BridgeStore: enfoque en modo queue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("por defecto enfoca la más antigua, con position/total", () => {
    const { store, ids } = threePending();
    expect(store.mode).toBe("queue");
    expect(store.focusedRequest!.id).toBe(ids[0]);
    expect(store.focusedPosition).toBe(1);
    expect(store.pendingCount).toBe(3);
  });

  it("focus a una sesión con pendiente enfoca la suya; position cuenta por antigüedad", () => {
    const { store, ids } = threePending();
    store.focus("c");
    expect(store.focusedRequest!.id).toBe(ids[2]);
    expect(store.focusedPosition).toBe(3);
  });

  it("focus a una sesión sin pendiente cae a la más antigua", () => {
    const { store, ids } = threePending();
    store.upsertSession({ sessionId: "z", kind: "codex", project: "z" });
    store.focus("z");
    expect(store.focusedSessionId).toBe("z");
    expect(store.focusedRequest!.id).toBe(ids[0]);
  });

  it("focus a una sesión desconocida equivale a null", () => {
    const { store } = threePending();
    store.focus("nadie");
    expect(store.focusedSessionId).toBeNull();
  });

  it("skip avanza de forma circular y anula el focus de sesión", () => {
    const { store, ids } = threePending();
    store.focus("b");
    store.skip();
    expect(store.focusedSessionId).toBeNull();
    expect(store.focusedRequest!.id).toBe(ids[2]); // de b pasa a c
    store.skip();
    expect(store.focusedRequest!.id).toBe(ids[0]); // vuelta a a
    store.skip();
    expect(store.focusedRequest!.id).toBe(ids[1]);
    expect(store.focusedPosition).toBe(2);
  });

  it("skip sin focus parte de la más antigua", () => {
    const { store, ids } = threePending();
    store.skip();
    expect(store.focusedRequest!.id).toBe(ids[1]);
  });

  it("skip con una sola pendiente (o ninguna) no hace nada", () => {
    const store = setup();
    store.setConsoleConnected(true);
    const onChange = vi.fn();
    store.skip();
    void store.requestPermission({ sessionId: "s1", ...tool });
    store.on("change", onChange);
    store.skip();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("al resolverse la enfocada vuelve a la más antigua", async () => {
    const { store, promises, ids } = threePending();
    store.skip();
    store.skip(); // enfoca c
    expect(store.focusedRequest!.id).toBe(ids[2]);
    store.decide(ids[2]!, "allow");
    await promises[2];
    expect(store.focusedRequest!.id).toBe(ids[0]);
    expect(store.focusedPosition).toBe(1);
    expect(store.pendingCount).toBe(2);
  });

  it("con focus de sesión, al resolverse su solicitud vuelve a la más antigua", async () => {
    const { store, promises, ids } = threePending();
    store.focus("b");
    store.decide(ids[1]!, "deny");
    await promises[1];
    expect(store.focusedSessionId).toBe("b"); // la consola sigue en b
    expect(store.focusedRequest!.id).toBe(ids[0]);
    expect(store.focusedPosition).toBe(1);
    expect(store.pendingCount).toBe(2);
  });

  it("decidir una solicitud no enfocada la resuelve y deja intacta a la enfocada", async () => {
    const { store, promises, ids } = threePending();
    expect(store.decide(ids[2]!, "allow")).toBe(true);
    await expect(promises[2]).resolves.toBe("allow");
    expect(store.focusedRequest!.id).toBe(ids[0]);
    expect(store.pendingCount).toBe(2);
    expect(store.decide(ids[2]!, "allow")).toBe(false);
  });

  it("un focus nuevo anula el salto de skip", () => {
    const { store, ids } = threePending();
    store.skip();
    expect(store.focusedRequest!.id).toBe(ids[1]);
    store.focus(null);
    expect(store.focusedRequest!.id).toBe(ids[0]);
  });
});

describe("BridgeStore: enfoque en modo manual", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sin focus no hay solicitud enfocada, pero pendingCount cuenta", () => {
    const { store } = threePending();
    store.setMode("manual");
    expect(store.focusedRequest).toBeNull();
    expect(store.focusedPosition).toBe(0);
    expect(store.pendingCount).toBe(3);
  });

  it("focus a una sesión con pendiente la enfoca; sin pendiente, no", () => {
    const { store, ids } = threePending();
    store.setMode("manual");
    store.focus("b");
    expect(store.focusedRequest!.id).toBe(ids[1]);
    expect(store.focusedPosition).toBe(2);
    store.upsertSession({ sessionId: "z", kind: "codex", project: "z" });
    store.focus("z");
    expect(store.focusedRequest).toBeNull();
    store.focus(null);
    expect(store.focusedRequest).toBeNull();
  });

  it("skip se ignora", () => {
    const { store } = threePending();
    store.setMode("manual");
    const onChange = vi.fn();
    store.on("change", onChange);
    store.skip();
    expect(onChange).not.toHaveBeenCalled();
    expect(store.focusedRequest).toBeNull();
  });

  it("cambiar de modo con pendientes recalcula el enfoque", () => {
    const { store, ids } = threePending();
    store.focus("b");
    store.setMode("manual");
    expect(store.focusedRequest!.id).toBe(ids[1]); // la sesión abierta sigue enfocada
    store.focus(null);
    expect(store.focusedRequest).toBeNull();
    store.setMode("queue");
    expect(store.focusedRequest!.id).toBe(ids[0]); // vuelve a la más antigua
    store.setMode("queue"); // sin cambio, sin efecto
    expect(store.mode).toBe("queue");
  });

  it("desconectar la consola suelta el enfoque", () => {
    const { store } = threePending();
    store.focus("a");
    store.setConsoleConnected(false);
    expect(store.focusedSessionId).toBeNull();
  });
});

describe("BridgeStore: modo guardado en settings.json", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bridge-settings-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("persiste entre reinicios, por defecto queue, y la escritura es atómica", () => {
    const path = join(dir, "sub", "settings.json");
    const a = new BridgeStore({ settingsPath: path });
    expect(a.mode).toBe("queue");
    a.setMode("manual");
    a.dispose();
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ mode: "manual", notifyDefault: "important", notifyAck: true, hiddenAgents: [], sound: true, questions: true, readerDefault: "full", instructWaitMax: 10, quickCommands: DEFAULT_SETTINGS.quickCommands });
    expect(readdirSync(join(dir, "sub")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    const b = new BridgeStore({ settingsPath: path });
    expect(b.mode).toBe("manual");
    b.setMode("queue");
    b.dispose();
    expect(new BridgeStore({ settingsPath: path }).mode).toBe("queue");
  });

  it("un archivo dañado o con un modo inválido cae a queue", async () => {
    const { writeFileSync } = await import("node:fs");
    const path = join(dir, "settings.json");
    writeFileSync(path, "{no es json");
    expect(new BridgeStore({ settingsPath: path }).mode).toBe("queue");
    writeFileSync(path, JSON.stringify({ mode: "auto" }));
    expect(new BridgeStore({ settingsPath: path }).mode).toBe("queue");
  });

  it("sin ruta no escribe nada", () => {
    const store = new BridgeStore();
    store.setMode("manual");
    expect(readdirSync(dir)).toEqual([]);
    store.dispose();
  });
});

describe("BridgeStore: sesiones", () => {
  it("guarda título, actividad y último mensaje, y marca lastSeen con el reloj inyectado", () => {
    let t = 1000;
    const store = new BridgeStore({ now: () => t });
    store.upsertSession({ sessionId: "s1", kind: "claude", project: "p", title: "Mi título", model: "Opus" });
    expect(store.getSession("s1")).toMatchObject({ title: "Mi título", model: "Opus", state: "idle", lastSeen: 1000 });
    t = 2000;
    store.setActivity("s1", "Leyendo x");
    expect(store.getSession("s1")!.lastSeen).toBe(2000);
    t = 3000;
    store.setLastMessage("s1", "hola");
    expect(store.getSession("s1")).toMatchObject({ activity: "Leyendo x", lastMessage: "hola", lastSeen: 3000 });
    t = 4000;
    store.setSessionState("s1", "working");
    expect(store.getSession("s1")!.lastSeen).toBe(4000);
    t = 5000;
    store.touchSession("s1");
    expect(store.getSession("s1")!.lastSeen).toBe(5000);
    store.dispose();
  });

  it("upsert de una sesión existente conserva lo que no se pasa", () => {
    const store = new BridgeStore();
    store.upsertSession({ sessionId: "s1", kind: "claude", project: "p", title: "T", model: "M" });
    store.upsertSession({ sessionId: "s1", kind: "claude", project: "p2" });
    expect(store.getSession("s1")).toMatchObject({ project: "p2", title: "T", model: "M" });
    store.dispose();
  });

  it("las llamadas sobre sesiones desconocidas se ignoran", () => {
    const store = new BridgeStore();
    expect(() => {
      store.setSessionState("x", "working");
      store.setActivity("x", "a");
      store.setLastMessage("x", "a");
      store.touchSession("x");
      store.removeSession("x");
    }).not.toThrow();
    expect(store.sessions).toEqual([]);
    store.dispose();
  });

  describe("nombre mostrado", () => {
    it("el título; si no hay, el proyecto", () => {
      const store = new BridgeStore();
      store.upsertSession({ sessionId: "a", kind: "claude", project: "mi-portal", title: "Arreglar el hero" });
      store.upsertSession({ sessionId: "b", kind: "claude", project: "OTRO-SISTEMA" });
      expect(store.displayName("a")).toBe("Arreglar el hero");
      expect(store.displayName("b")).toBe("OTRO-SISTEMA");
      expect(store.displayName("nadie")).toBe("");
      store.dispose();
    });

    it("se numera por orden de llegada si se repite en el mismo agente", () => {
      const store = new BridgeStore();
      for (const id of ["a", "b", "c"]) store.upsertSession({ sessionId: id, kind: "claude", project: "mi-portal" });
      store.upsertSession({ sessionId: "g", kind: "gemini", project: "mi-portal" });
      expect(["a", "b", "c"].map((id) => store.displayName(id))).toEqual(["mi-portal", "mi-portal 2", "mi-portal 3"]);
      expect(store.displayName("g")).toBe("mi-portal"); // otro agente: no cuenta
      store.dispose();
    });

    it("un título igual a un nombre ya numerado no lo duplica", () => {
      const store = new BridgeStore();
      store.upsertSession({ sessionId: "a", kind: "claude", project: "mi-portal" });
      store.upsertSession({ sessionId: "b", kind: "claude", project: "mi-portal" });
      store.upsertSession({ sessionId: "c", kind: "claude", project: "p", title: "mi-portal 2" });
      expect(["a", "b", "c"].map((id) => store.displayName(id))).toEqual(["mi-portal", "mi-portal 2", "mi-portal 2 2"]);
      store.dispose();
    });

    it("el nombre no cambia al retirarse otra sesión; si la propia cambia de título, solo se recalcula la suya", () => {
      const store = new BridgeStore();
      for (const id of ["a", "b", "c"]) store.upsertSession({ sessionId: id, kind: "claude", project: "mi-portal" });
      store.removeSession("a");
      expect(store.displayName("b")).toBe("mi-portal 2");
      expect(store.displayName("c")).toBe("mi-portal 3");
      store.upsertSession({ sessionId: "c", kind: "claude", project: "mi-portal", title: "Otro" });
      expect(store.displayName("c")).toBe("Otro");
      expect(store.displayName("b")).toBe("mi-portal 2");
      store.upsertSession({ sessionId: "c", kind: "claude", project: "mi-portal", title: "mi-portal" }); // el nombre libre es el sin número
      expect(store.displayName("c")).toBe("mi-portal");
      store.dispose();
    });

    it("dos títulos iguales también se numeran, y el número cabe en 38 caracteres", () => {
      const store = new BridgeStore();
      const long = "x".repeat(60);
      store.upsertSession({ sessionId: "a", kind: "codex", project: "p", title: long });
      store.upsertSession({ sessionId: "b", kind: "codex", project: "p", title: long });
      expect(store.displayName("a")).toHaveLength(38);
      expect(store.displayName("b")).toHaveLength(38);
      expect(store.displayName("b").endsWith("… 2") || store.displayName("b").endsWith(" 2")).toBe(true);
      expect(store.displayName("a")).not.toBe(store.displayName("b"));
      store.dispose();
    });

    it("títulos de 38 caracteres idénticos: todos distintos", () => {
      const store = new BridgeStore();
      const t = "y".repeat(38);
      for (const id of ["a", "b", "c", "d"]) store.upsertSession({ sessionId: id, kind: "claude", project: "p", title: t });
      const names = ["a", "b", "c", "d"].map((id) => store.displayName(id));
      expect(new Set(names).size).toBe(4);
      expect(names[0]).toBe(t);
      for (const n of names) expect(n.length).toBeLessThanOrEqual(38);
      store.dispose();
    });
  });

  describe("tope de sesiones", () => {
    it("al pasar de 200 retira la de lastSeen más antiguo sin permiso pendiente", () => {
      let t = 0;
      const store = new BridgeStore({ now: () => t });
      for (let i = 0; i < 200; i++) { t = i + 1; store.upsertSession({ sessionId: `s${i}`, kind: "claude", project: `p${i}` }); }
      t = 1000;
      store.touchSession("s0"); // la más antigua pasa a ser s1
      store.upsertSession({ sessionId: "nueva", kind: "claude", project: "n" });
      expect(store.sessions).toHaveLength(200);
      expect(store.getSession("s1")).toBeUndefined();
      expect(store.getSession("s0")).toBeDefined();
      expect(store.getSession("nueva")).toBeDefined();
      store.dispose();
    });

    it("no retira una con permiso pendiente; si todas lo tienen, rechaza la nueva sin fallar", async () => {
      let t = 0;
      const store = new BridgeStore({ now: () => t });
      store.setConsoleConnected(true);
      for (let i = 0; i < 200; i++) { t = i + 1; store.upsertSession({ sessionId: `s${i}`, kind: "claude", project: `p${i}` }); }
      const p0 = store.requestPermission({ sessionId: "s0", toolName: "Bash", toolInput: {} });
      t = 5000;
      store.upsertSession({ sessionId: "nueva", kind: "claude", project: "n" });
      expect(store.getSession("s0")).toBeDefined(); // la más antigua tenía pendiente
      expect(store.getSession("s1")).toBeUndefined();
      expect(store.sessions).toHaveLength(200);
      store.dispose(); // resuelve las pendientes
      await p0;
    });

    it("con todas pendientes la nueva se rechaza", async () => {
      const store = new BridgeStore();
      store.setConsoleConnected(true);
      const ps: Promise<unknown>[] = [];
      for (let i = 0; i < 200; i++) {
        store.upsertSession({ sessionId: `s${i}`, kind: "claude", project: `p${i}` });
        ps.push(store.requestPermission({ sessionId: `s${i}`, toolName: "Bash", toolInput: {} }));
      }
      expect(() => store.upsertSession({ sessionId: "nueva", kind: "claude", project: "n" })).not.toThrow();
      expect(store.getSession("nueva")).toBeUndefined();
      expect(store.sessions).toHaveLength(200);
      store.dispose();
      await Promise.all(ps);
    });
  });

  describe("barrido de abandonadas", () => {
    it("retira las que llevan más de maxAge sin eventos y deja las recientes", () => {
      let t = 0;
      const store = new BridgeStore({ now: () => t, sessionMaxAgeMs: 30 * 60_000 });
      store.upsertSession({ sessionId: "vieja", kind: "claude", project: "a" });
      t = 20 * 60_000;
      store.upsertSession({ sessionId: "nueva", kind: "claude", project: "b" });
      t = 31 * 60_000;
      store.sweep();
      expect(store.sessions.map((s) => s.id)).toEqual(["nueva"]);
      store.dispose();
    });

    it("un evento reciente la salva; el límite es estricto", () => {
      let t = 0;
      const store = new BridgeStore({ now: () => t, sessionMaxAgeMs: 1000 });
      store.upsertSession({ sessionId: "s", kind: "claude", project: "a" });
      t = 1000;
      store.sweep();
      expect(store.sessions).toHaveLength(1);
      store.touchSession("s");
      t = 1999;
      store.sweep();
      expect(store.sessions).toHaveLength(1);
      t = 2001;
      store.sweep();
      expect(store.sessions).toHaveLength(0);
      store.dispose();
    });

    it("no retira una sesión con permiso pendiente", async () => {
      let t = 0;
      const store = new BridgeStore({ now: () => t, sessionMaxAgeMs: 1000, requestTimeoutMs: 10 * 60_000 });
      store.upsertSession({ sessionId: "s", kind: "claude", project: "a" });
      store.upsertSession({ sessionId: "t", kind: "claude", project: "b" });
      store.setConsoleConnected(true);
      const p = store.requestPermission({ sessionId: "s", ...tool });
      t = 5000;
      store.sweep();
      expect(store.sessions.map((s) => s.id)).toEqual(["s"]);
      store.decide(store.focusedRequest!.id, "allow");
      await p;
      store.sweep(); // resuelto el permiso, ya cuenta como abandonada (lastSeen = 0)
      expect(store.sessions).toEqual([]);
      store.dispose();
    });

    it("corre solo cada sweepIntervalMs", () => {
      vi.useFakeTimers();
      try {
        const store = new BridgeStore({ sweepIntervalMs: 60_000, sessionMaxAgeMs: 30 * 60_000 });
        store.upsertSession({ sessionId: "s", kind: "claude", project: "a" });
        vi.advanceTimersByTime(30 * 60_000);
        expect(store.sessions).toHaveLength(1);
        vi.advanceTimersByTime(60_000 + 1);
        expect(store.sessions).toHaveLength(0);
        store.dispose();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe("BridgeStore: sí, no volver a preguntar", () => {
  const rules = [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "ls" }], behavior: "allow", destination: "localSettings" }];

  it("allow_always con sugerencias se resuelve como allow_always y avisa como aprobado", async () => {
    const store = setup();
    store.setConsoleConnected(true);
    const notices: unknown[] = [];
    store.on("notice", (n) => notices.push(n));
    const p = store.requestPermission({ sessionId: "s1", ...tool, suggestions: rules });
    expect(store.pending[0]!.suggestions).toEqual(rules);
    expect(store.decide(store.pending[0]!.id, "allow_always")).toBe(true);
    await expect(p).resolves.toBe("allow_always");
    expect(notices).toEqual([{ type: "decision", sessionId: "s1", decision: "allow" }]);
  });

  it("allow_always sin sugerencias es un allow a secas", async () => {
    const store = setup();
    store.setConsoleConnected(true);
    const p = store.requestPermission({ sessionId: "s1", ...tool });
    expect(store.pending[0]!.suggestions).toEqual([]);
    store.decide(store.pending[0]!.id, "allow_always");
    await expect(p).resolves.toBe("allow");
  });
});

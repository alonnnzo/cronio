import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FaceViewSchema, type AgentKind } from "@companion/protocol";
import { BridgeStore } from "../src/store.ts";
import { FaceController } from "../src/face.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function make(opts: { noticeMs?: number; rotateMs?: number } = {}) {
  const store = new BridgeStore();
  const face = new FaceController(store, opts);
  const changes = vi.fn();
  face.on("change", changes);
  const add = (id: string, kind: AgentKind, project: string, extra: { title?: string } = {}) =>
    store.upsertSession({ sessionId: id, kind, project, ...extra });
  // el globo de "empezó a trabajar" es un aviso menor: solo con el modo `all` (los demás, ver notify.test.ts)
  store.setSetting({ key: "notifyDefault", value: "all" });
  return { store, face, changes, add };
}

const cmd = (c: string) => ({ toolName: "Bash", toolInput: { command: c } });

describe("cara: ambiente (prioridad 3)", () => {
  it("sin sesiones trabajando: Todo tranquilo", () => {
    const { face, add, store } = make();
    expect(face.current).toEqual({ kind: null, mood: "idle", lines: ["Todo tranquilo"] });
    add("a", "claude", "mi-portal");
    expect(face.current.lines).toEqual(["Todo tranquilo"]);
    store.dispose();
  });

  it("una sesión trabajando: agente en sesión y actividad", () => {
    const { face, add, store } = make();
    add("a", "claude", "mi-portal");
    store.setActivity("a", "Editando hero.astro");
    store.setSessionState("a", "working");
    vi.advanceTimersByTime(5000); // pasa el aviso de "empezó a trabajar"
    expect(face.current).toEqual({ kind: "claude", mood: "working", lines: ["Claude en mi-portal", "Editando hero.astro"] });
  });

  it("rota entre las sesiones que trabajan cada 6 s", () => {
    const { face, add, store } = make();
    add("a", "claude", "mi-portal");
    add("b", "gemini", "otro-sitio");
    for (const id of ["a", "b"]) {
      store.setSessionState(id, "working");
      store.setActivity(id, `Haciendo ${id}`);
    }
    vi.advanceTimersByTime(5000);
    const seen = [face.current.lines[0]];
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(6000);
      seen.push(face.current.lines[0]);
    }
    // la rotación es estrictamente alterna entre las dos
    expect(new Set(seen)).toEqual(new Set(["Claude en mi-portal", "Gemini en otro-sitio"]));
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
    expect(face.current.kind === "claude" || face.current.kind === "gemini").toBe(true);
  });

  it("la rotación respeta el intervalo inyectado", () => {
    const { face, add, store } = make({ rotateMs: 1000, noticeMs: 1 });
    add("a", "claude", "uno");
    add("b", "codex", "dos");
    store.setSessionState("a", "working");
    store.setSessionState("b", "working");
    vi.advanceTimersByTime(10);
    const first = face.current.lines[0];
    vi.advanceTimersByTime(989); // 999 ms desde el inicio
    expect(face.current.lines[0]).toBe(first);
    vi.advanceTimersByTime(1);
    expect(face.current.lines[0]).not.toBe(first);
  });

  it("usa el nombre numerado de la sesión", () => {
    const { face, add, store } = make({ noticeMs: 1 });
    add("a", "claude", "mi-portal");
    add("b", "claude", "mi-portal");
    store.setSessionState("b", "working");
    vi.advanceTimersByTime(10);
    expect(face.current.lines[0]).toBe("Claude en mi-portal 2");
  });
});

describe("cara: permisos pendientes (prioridad 2)", () => {
  it("una pendiente: <Agente> necesita permiso / <resumen> · <sesión>", () => {
    const { face, add, store } = make();
    add("a", "claude", "mi-portal");
    store.setConsoleConnected(true);
    void store.requestPermission({ sessionId: "a", ...cmd("npm install sharp") });
    expect(face.current).toEqual({
      kind: "claude",
      mood: "ask",
      lines: ["Claude necesita permiso", "npm install sharp · mi-portal"],
    });
  });

  it("varias en modo queue: la enfocada con (N de M), que sigue a skip y a focus", () => {
    const { face, add, store } = make();
    add("a", "claude", "mi-portal");
    add("b", "gemini", "otro-sitio");
    add("c", "codex", "ATLAS");
    store.setConsoleConnected(true);
    void store.requestPermission({ sessionId: "a", ...cmd("uno") });
    void store.requestPermission({ sessionId: "b", ...cmd("dos") });
    void store.requestPermission({ sessionId: "c", ...cmd("tres") });
    expect(face.current).toEqual({ kind: "claude", mood: "ask", lines: ["Claude necesita permiso (1 de 3)", "uno · mi-portal"] });
    store.skip();
    expect(face.current).toEqual({ kind: "gemini", mood: "ask", lines: ["Gemini necesita permiso (2 de 3)", "dos · otro-sitio"] });
    store.focus("c");
    expect(face.current).toEqual({ kind: "codex", mood: "ask", lines: ["Codex necesita permiso (3 de 3)", "tres · ATLAS"] });
  });

  it("varias en modo manual: N permisos pendientes y los agentes", () => {
    const { face, add, store } = make();
    add("a", "claude", "mi-portal");
    add("a2", "claude", "otro");
    add("b", "gemini", "otro-sitio");
    store.setMode("manual");
    store.setConsoleConnected(true);
    void store.requestPermission({ sessionId: "a", ...cmd("uno") });
    void store.requestPermission({ sessionId: "b", ...cmd("dos") });
    void store.requestPermission({ sessionId: "a2", ...cmd("tres") });
    expect(face.current).toEqual({ kind: "claude", mood: "ask", lines: ["3 permisos pendientes", "Claude, Gemini"] });
    store.focus("b"); // el color sigue a la solicitud enfocada
    expect(face.current).toEqual({ kind: "gemini", mood: "ask", lines: ["3 permisos pendientes", "Claude, Gemini"] });
  });

  it("una sola pendiente en modo manual usa el texto de una", () => {
    const { face, add, store } = make();
    add("a", "claude", "mi-portal");
    store.setMode("manual");
    store.setConsoleConnected(true);
    void store.requestPermission({ sessionId: "a", ...cmd("ls") });
    expect(face.current.lines).toEqual(["Claude necesita permiso", "ls · mi-portal"]);
  });

  it("un comando largo se corta pero conserva la sesión; todas las líneas caben en 38", () => {
    const { face, add, store } = make();
    add("a", "claude", "mi-portal");
    store.setConsoleConnected(true);
    void store.requestPermission({ sessionId: "a", ...cmd("echo " + "x".repeat(300)) });
    const [, second] = face.current.lines;
    expect(second!.endsWith("· mi-portal")).toBe(true);
    expect(second).toContain("…");
    expect(FaceViewSchema.safeParse(face.current).success).toBe(true);
  });

  it("gana al ambiente: con sesiones trabajando y un permiso, dice el permiso", () => {
    const { face, add, store } = make({ noticeMs: 1 });
    add("a", "claude", "mi-portal");
    add("b", "codex", "ATLAS");
    store.setSessionState("b", "working");
    store.setConsoleConnected(true);
    void store.requestPermission({ sessionId: "a", ...cmd("ls") });
    vi.advanceTimersByTime(10);
    expect(face.current.mood).toBe("ask");
  });
});

describe("cara: avisos (prioridad 1)", () => {
  it("terminar: ¡<Agente> terminó! con el último mensaje; dura 5 s y vuelve al ambiente", () => {
    const { face, add, store } = make();
    add("g", "gemini", "otro-sitio");
    add("w", "codex", "ATLAS");
    store.setSessionState("w", "working");
    store.setActivity("w", "Leyendo el runner");
    vi.advanceTimersByTime(5000);
    store.setLastMessage("g", "Formulario listo y probado.");
    store.setSessionState("g", "done");
    expect(face.current).toEqual({
      kind: "gemini",
      mood: "done",
      lines: ["¡Gemini terminó!", "otro-sitio · Formulario listo y proba…"],
    });
    vi.advanceTimersByTime(4999);
    expect(face.current.mood).toBe("done");
    vi.advanceTimersByTime(1);
    expect(face.current).toEqual({ kind: "codex", mood: "working", lines: ["Codex en ATLAS", "Leyendo el runner"] });
  });

  it("fallar: texto de error con la actividad", () => {
    const { face, add, store } = make();
    add("c", "claude", "OTRO-SISTEMA");
    store.setActivity("c", "2 tests fallaron");
    store.setSessionState("c", "error");
    expect(face.current).toEqual({
      kind: "claude",
      mood: "error",
      lines: ["Ups, Claude tuvo un error", "OTRO-SISTEMA · 2 tests fallaron"],
    });
  });

  it("empezar a trabajar", () => {
    const { face, add, store } = make();
    add("x", "codex", "ATLAS");
    store.setActivity("x", "Leyendo el runner");
    store.setSessionState("x", "working");
    expect(face.current).toEqual({
      kind: "codex",
      mood: "working",
      lines: ["Codex empezó a trabajar", "ATLAS · Leyendo el runner"],
    });
    // el texto sigue la actividad si cambia dentro del aviso
    store.setActivity("x", "Editando run.ts");
    expect(face.current.lines[1]).toBe("ATLAS · Editando run.ts");
  });

  it("seguir trabajando (working de nuevo) no es un aviso nuevo", () => {
    const { face, add, store } = make();
    add("x", "codex", "ATLAS");
    store.setSessionState("x", "working");
    vi.advanceTimersByTime(5000);
    store.setSessionState("x", "working");
    store.setActivity("x", "Otra cosa");
    expect(face.current.lines[0]).toBe("Codex en ATLAS");
  });

  it("decisión: Permiso aprobado / rechazado; dura 5 s y luego el ambiente", async () => {
    const { face, add, store } = make();
    add("a", "claude", "mi-portal");
    store.setConsoleConnected(true);
    const p = store.requestPermission({ sessionId: "a", ...cmd("ls") });
    store.decide(store.focusedRequest!.id, "allow");
    await p;
    expect(face.current).toEqual({ kind: "claude", mood: "done", lines: ["Permiso aprobado", "Claude sigue en mi-portal"] });
    vi.advanceTimersByTime(5000);
    expect(face.current.mood).toBe("working"); // la sesión volvió a working: ambiente
    expect(face.current.lines[0]).toBe("Claude en mi-portal");

    const q = store.requestPermission({ sessionId: "a", ...cmd("rm x") });
    store.decide(store.focusedRequest!.id, "deny");
    await q;
    expect(face.current).toEqual({ kind: "claude", mood: "working", lines: ["Permiso rechazado", "Claude busca otra forma"] });
  });

  it("un aborto no da aviso de decisión (solo Permiso retirado)", async () => {
    const { face, add, store } = make();
    add("a", "claude", "mi-portal");
    store.setConsoleConnected(true);
    const ac = new AbortController();
    const p = store.requestPermission({ sessionId: "a", ...cmd("ls"), signal: ac.signal });
    ac.abort();
    await p;
    expect(face.current.lines[0]).not.toMatch(/^Permiso (aprobado|rechazado)/);
  });

  it("un aviso pasa por delante de los permisos pendientes durante 5 s", async () => {
    const { face, add, store } = make();
    add("a", "claude", "mi-portal");
    add("b", "gemini", "otro-sitio");
    store.setConsoleConnected(true);
    const p = store.requestPermission({ sessionId: "a", ...cmd("uno") });
    void store.requestPermission({ sessionId: "b", ...cmd("dos") });
    store.decide(store.pending[0]!.id, "allow");
    await p;
    expect(face.current.lines[0]).toBe("Permiso aprobado");
    vi.advanceTimersByTime(5000);
    expect(face.current).toEqual({ kind: "gemini", mood: "ask", lines: ["Gemini necesita permiso", "dos · otro-sitio"] });
  });

  it("una solicitud nueva desplaza al aviso que aún no vence", () => {
    const { face, add, store } = make();
    add("a", "claude", "mi-portal");
    store.setConsoleConnected(true);
    store.setSessionState("a", "done");
    expect(face.current.mood).toBe("done");
    void store.requestPermission({ sessionId: "a", ...cmd("ls") });
    expect(face.current.mood).toBe("ask");
  });

  it("la duración del aviso es inyectable", () => {
    const { face, add, store } = make({ noticeMs: 200 });
    add("a", "claude", "p");
    store.setSessionState("a", "done");
    vi.advanceTimersByTime(199);
    expect(face.current.mood).toBe("done");
    vi.advanceTimersByTime(1);
    expect(face.current.mood).toBe("idle");
  });

  it("si la sesión del aviso se retira, el aviso desaparece sin fallar", () => {
    const { face, add, store } = make();
    add("a", "claude", "p");
    store.setSessionState("a", "done");
    store.removeSession("a");
    expect(face.current.lines).toEqual(["Todo tranquilo"]);
  });
});

describe("cara: Permiso retirado", () => {
  it("al cerrarse la conexión del hook avisa con texto neutro, no \"Respondido en el PC\"", () => {
    const { face, add, store } = make();
    add("a", "claude", "mi-portal");
    store.setConsoleConnected(true);
    const ac = new AbortController();
    void store.requestPermission({ sessionId: "a", ...cmd("ls"), signal: ac.signal });
    ac.abort();
    expect(face.current.lines[0]).toBe("Permiso retirado");
    expect(face.current.lines.every((l) => l.length <= 38)).toBe(true);
  });
});

describe("cara: Respondido en el PC", () => {
  it("aviso de 5 s al retirarse una solicitud porque se resolvió en otra parte", () => {
    const { face, add, store } = make();
    add("a", "claude", "mi-portal");
    store.setConsoleConnected(true);
    void store.requestPermission({ sessionId: "a", ...cmd("ls") });
    expect(face.current.mood).toBe("ask");
    store.resolveElsewhere("a");
    expect(face.current).toEqual({ kind: "claude", mood: "working", lines: ["Respondido en el PC", "Claude sigue en mi-portal"] });
    vi.advanceTimersByTime(4_999);
    expect(face.current.lines[0]).toBe("Respondido en el PC");
    vi.advanceTimersByTime(1);
    expect(face.current.lines[0]).not.toBe("Respondido en el PC");
    store.dispose();
  });
});

describe("cara: emite change solo cuando cambia", () => {
  it("emite al empezar y al vencer un aviso, y no por cambios que no se ven", () => {
    const { face, add, store, changes } = make();
    add("a", "claude", "p");
    expect(changes).not.toHaveBeenCalled(); // sigue "Todo tranquilo"
    store.setActivity("a", "algo");
    store.setLastMessage("a", "hola");
    expect(changes).not.toHaveBeenCalled();
    store.setSessionState("a", "working"); // aviso
    expect(changes).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000); // vence: pasa a ambiente
    expect(changes).toHaveBeenCalledTimes(2);
    // con una sola sesión trabajando, la rotación no cambia la cara
    vi.advanceTimersByTime(6000 * 5);
    expect(changes).toHaveBeenCalledTimes(2);
    store.setActivity("a", "otra");
    expect(changes).toHaveBeenCalledTimes(3);
    store.setSessionState("a", "idle");
    expect(changes).toHaveBeenCalledTimes(4);
    expect(face.current.lines).toEqual(["Todo tranquilo"]);
  });

  it("dispose detiene los temporizadores y los oyentes", () => {
    const { face, add, store, changes } = make();
    add("a", "claude", "p");
    face.dispose();
    store.setSessionState("a", "done");
    vi.advanceTimersByTime(20_000);
    expect(changes).not.toHaveBeenCalled();
  });
});

describe("cara: todas las líneas pasan el esquema", () => {
  it("con nombres, actividades y mensajes enormes o con caracteres raros", () => {
    const { face, add, store } = make();
    add("a", "claude", "p".repeat(100), { title: "t\u0001".repeat(60) });
    store.setActivity("a", "€".repeat(200));
    store.setLastMessage("a", "😀".repeat(100));
    store.setConsoleConnected(true);
    for (const state of ["working", "error", "done"] as const) {
      store.setSessionState("a", state);
      expect(FaceViewSchema.safeParse(face.current).success, state).toBe(true);
    }
    void store.requestPermission({ sessionId: "a", ...cmd("‮" + "y".repeat(400)) });
    expect(FaceViewSchema.safeParse(face.current).success).toBe(true);
  });
});

describe("cara: sesión que espera tu respuesta", () => {
  it("título con agente y proyecto, y la pregunta completa en varias líneas", () => {
    const { face, add, store } = make();
    add("a", "claude", "mi-portal");
    store.setQuestion("a", "¿Prefieres un video de fondo en el hero o un gradiente animado que pese menos?");
    expect(face.current).toEqual({
      kind: "claude",
      mood: "ask",
      lines: ["Claude espera tu respuesta · mi-portal", "¿Prefieres un video de fondo en el", "hero o un gradiente animado que pese", "menos?"],
    });
    expect(FaceViewSchema.safeParse(face.current).success).toBe(true);
  });

  it("si agente + proyecto no caben en 38, el título se acorta pero conserva el proyecto", () => {
    const { face, add, store } = make();
    add("a", "claude", "otro-sistema-produccion-larga");
    store.setQuestion("a", "¿Sigo?");
    const [title, q] = face.current.lines;
    expect(title).toMatch(/^Claude espera · otro-sistema/);
    expect(title!.length).toBeLessThanOrEqual(38);
    expect(q).toBe("¿Sigo?");
  });

  it("una pregunta enorme ocupa a lo más 3 líneas tras el título (4 en total) y pasa el esquema", () => {
    const { face, add, store } = make();
    add("a", "gemini", "p");
    store.setQuestion("a", "palabra ".repeat(200));
    expect(face.current.lines).toHaveLength(4);
    expect(face.current.lines[3]).toMatch(/\(\+\d+\)$/);
    expect(FaceViewSchema.safeParse(face.current).success).toBe(true);
  });

  it("un aviso informativo (empezó, terminó, error) no tapa la pregunta, ni de esa sesión ni de otra", () => {
    const { face, add, store } = make();
    add("a", "claude", "mi-portal");
    add("b", "codex", "ATLAS");
    store.setQuestion("a", "¿Hago el commit?");
    const question = face.current;
    expect(question.lines[0]).toBe("Claude espera tu respuesta · mi-portal");
    store.setSessionState("b", "working"); // "Codex empezó a trabajar"
    expect(face.current).toEqual(question);
    store.setSessionState("b", "done");
    expect(face.current).toEqual(question);
    store.setSessionState("b", "error");
    expect(face.current).toEqual(question);
    vi.advanceTimersByTime(10_000);
    expect(face.current).toEqual(question);
    store.dispose();
  });

  it("al responderse la pregunta, los avisos vuelven a verse", () => {
    const { face, add, store } = make();
    add("a", "claude", "mi-portal");
    add("b", "codex", "ATLAS");
    store.setQuestion("a", "¿Hago el commit?");
    store.clearQuestion("a");
    store.setSessionState("b", "working");
    expect(face.current.lines[0]).toBe("Codex empezó a trabajar");
    store.dispose();
  });

  it("un permiso pendiente sigue pasando por delante de la pregunta", () => {
    const { face, add, store } = make();
    add("a", "claude", "mi-portal");
    add("b", "codex", "ATLAS");
    store.setConsoleConnected(true);
    store.setQuestion("a", "¿Hago el commit?");
    void store.requestPermission({ sessionId: "b", ...cmd("ls") });
    expect(face.current.lines[0]).toBe("Codex necesita permiso");
    store.dispose();
  });

  it("los avisos de permisos (respondido en el PC) siguen pasando por delante de la pregunta", () => {
    const { face, add, store } = make();
    add("a", "claude", "mi-portal");
    add("b", "codex", "ATLAS");
    store.setConsoleConnected(true);
    store.setQuestion("a", "¿Hago el commit?");
    void store.requestPermission({ sessionId: "b", ...cmd("ls") });
    store.resolveElsewhere("b");
    expect(face.current.lines[0]).toBe("Respondido en el PC");
    vi.advanceTimersByTime(5_000);
    expect(face.current.lines[0]).toBe("Claude espera tu respuesta · mi-portal");
    store.dispose();
  });
});

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { MAX_ID } from "@companion/protocol";
import { permissionBody, postJson, startTestBridge, waitFor, type TestBridge } from "./helpers.ts";
import { bridgeVersion } from "../src/version.ts";

let bridge: TestBridge;
afterEach(async () => {
  await bridge?.cleanup();
});

function openWs(b: TestBridge, origin?: string): Promise<{ ws: WebSocket; msgs: any[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${b.wsUrl()}`, origin ? { headers: { Origin: origin } } : {});
    const msgs: any[] = [];
    ws.on("message", (d) => msgs.push(JSON.parse(d.toString())));
    ws.on("open", () => resolve({ ws, msgs }));
    ws.on("error", reject);
  });
}

function rawGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode!, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("WebSocket del simulador", () => {
  it("/health marca simulator y no device con solo un WebSocket", async () => {
    bridge = await startTestBridge();
    const { ws } = await openWs(bridge, `http://127.0.0.1:${bridge.ports.ws}`);
    const health = (await (await bridge.api("/health")).json()) as Record<string, unknown>;
    expect(health).toEqual({ ok: true, console: true, device: false, simulator: true, pending: 0, cia: { serving: false }, version: bridgeVersion(), startedBy: "manual", pid: process.pid });
    ws.close();
  });

  it("un WebSocket local con Origin propio recibe la vista y puede aprobar", async () => {
    bridge = await startTestBridge();
    const { ws, msgs } = await openWs(bridge, `http://127.0.0.1:${bridge.ports.ws}`);
    await waitFor(() => msgs.length > 0);
    expect(msgs[0]).toMatchObject({ t: "view", view: { request: null } });
    expect(bridge.store.consoleConnected).toBe(true);

    const pending = postJson("/permission", permissionBody("ls"), bridge).then((r) => r.json());
    await waitFor(() => msgs.at(-1)?.view?.request != null);
    ws.send(JSON.stringify({ t: "decision", requestId: msgs.at(-1).view.request.id, decision: "allow" }));
    expect(await pending).toEqual({ decision: "allow" });

    ws.close();
    await waitFor(() => !bridge.store.consoleConnected);
  });

  it("también acepta Origin http://localhost:<puerto>", async () => {
    bridge = await startTestBridge();
    const { ws } = await openWs(bridge, `http://localhost:${bridge.ports.ws}`);
    ws.close();
  });

  it("rechaza un Origin ajeno", async () => {
    bridge = await startTestBridge();
    await expect(openWs(bridge, "http://evil.example")).rejects.toThrow(/403/);
    await expect(openWs(bridge, `http://127.0.0.1:${bridge.ports.ws + 1}`)).rejects.toThrow(/403/);
    expect(bridge.store.consoleConnected).toBe(false);
  });

  it("un mensaje inválido cierra el WebSocket", async () => {
    bridge = await startTestBridge();
    const { ws } = await openWs(bridge);
    const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
    ws.send(JSON.stringify({ t: "otra-cosa" }));
    expect(await closed).toBe(1008);
  });
});

describe("archivos estáticos", () => {
  it("sirve archivos, 404 si no existen o falta la carpeta, y rechaza salir de ella", async () => {
    bridge = await startTestBridge(); // la carpeta estática no existe
    expect((await rawGet(bridge.ports.ws, "/")).status).toBe(404);
    await bridge.cleanup();

    const root = mkdtempSync(join(tmpdir(), "companion-static-"));
    mkdirSync(join(root, "pub"));
    writeFileSync(join(root, "pub", "index.html"), "<h1>sim</h1>");
    writeFileSync(join(root, "secreto.txt"), "no");
    bridge = await startTestBridge({ staticDir: join(root, "pub") });
    const p = bridge.ports.ws;
    const index = await rawGet(p, "/");
    expect(index.status).toBe(200);
    // las páginas .html reciben el token inyectado (lo usa el simulador para abrir el WebSocket); el resto del archivo no cambia
    expect(index.body).toBe(`<script>window.COMPANION_API_TOKEN="${bridge.apiToken}";</script><h1>sim</h1>`);
    expect((await rawGet(p, "/nada.js")).status).toBe(404);
    for (const bad of ["/../secreto.txt", "/%2e%2e/secreto.txt", "/..%2fsecreto.txt", "/%2e%2e%5csecreto.txt", "/a/../../secreto.txt"]) {
      const r = await rawGet(p, bad);
      expect(r.status, bad).toBeGreaterThanOrEqual(400);
      expect(r.body, bad).not.toBe("no");
    }
  });
});

describe("API HTTP: límites", () => {
  it("session_id de más de MAX_ID caracteres -> 400", async () => {
    bridge = await startTestBridge();
    const long = "s".repeat(MAX_ID + 1);
    expect((await postJson("/permission", permissionBody("ls", long), bridge)).status).toBe(400);
    expect((await postJson("/event", { session_id: long, event: "start" }, bridge)).status).toBe(400);
    expect(bridge.store.sessions).toEqual([]);
    const ok = "s".repeat(MAX_ID);
    expect((await postJson("/event", { session_id: ok, event: "start" }, bridge)).status).toBe(200);
  });
});

describe("API HTTP: identificadores y campos de /event", () => {
  it("session_id con caracteres fuera de [A-Za-z0-9_.:-] -> 400 en /permission, /event y no crea sesión", async () => {
    bridge = await startTestBridge();
    for (const bad of ["a b", "a/b", "a\\b", "ñandú", "a\u0001", "../x", ""]) {
      expect((await postJson("/permission", permissionBody("ls", bad), bridge)).status, JSON.stringify(bad)).toBe(400);
      expect((await postJson("/event", { session_id: bad, event: "start" }, bridge)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(bridge.store.sessions).toEqual([]);
    for (const ok of ["a.b:c_d-E9", "3f2c9a7e-1b2d-4c3e-8f90-123456789abc"]) {
      expect((await postJson("/event", { session_id: ok, event: "start" }, bridge)).status).toBe(200);
    }
    expect(bridge.store.sessions).toHaveLength(2);
  });

  it("/event acepta title, activity y last_message opcionales", async () => {
    bridge = await startTestBridge();
    const ev = { session_id: "e1", cwd: "/home/u/proy", kind: "gemini" };
    expect((await postJson("/event", { ...ev, event: "start", title: "Mi título" }, bridge)).status).toBe(200);
    expect((await postJson("/event", { ...ev, event: "working", activity: "Revisando", last_message: "Hola" }, bridge)).status).toBe(200);
    expect(bridge.store.getSession("e1")).toMatchObject({
      kind: "gemini",
      project: "proy",
      title: "Mi título",
      state: "working",
      activity: "Revisando",
      lastMessage: "Hola",
    });
    expect(bridge.store.displayName("e1")).toBe("Mi título");
    expect((await postJson("/event", { ...ev, event: "idle", title: 5 }, bridge)).status).toBe(400);
  });
});

describe("POST /hook/claude", () => {
  const hook = (body: string) => bridge.api("/hook/claude", { method: "POST", body });
  const json = (o: unknown) => hook(JSON.stringify(o));
  const base = { session_id: "h1", cwd: "C:\\work\\mi-portal" };

  it("responde 200 con cuerpo vacío y aplica el hook", async () => {
    bridge = await startTestBridge();
    const r = await json({ ...base, hook_event_name: "SessionStart", model: "Opus", session_title: "Hero" });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("");
    expect(bridge.store.getSession("h1")).toMatchObject({ kind: "claude", project: "mi-portal", model: "Opus", title: "Hero" });
    expect((await json({ ...base, hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/a/b/c.ts" } })).status).toBe(200);
    expect(bridge.store.getSession("h1")).toMatchObject({ state: "working", activity: "Leyendo c.ts" });
    expect((await json({ ...base, hook_event_name: "SessionEnd" })).status).toBe(200);
    expect(bridge.store.sessions).toEqual([]);
  });

  it("siempre 200 y vacío: JSON inválido, no objeto, campos raros, id inválido, cuerpo enorme", async () => {
    bridge = await startTestBridge();
    const bodies: string[] = [
      "{no es json",
      "",
      "null",
      "[1,2]",
      "42",
      JSON.stringify({ session_id: 5, hook_event_name: 7 }),
      JSON.stringify({ session_id: "con espacios", hook_event_name: "Stop" }),
      JSON.stringify({ session_id: "x".repeat(200), hook_event_name: "Stop" }),
      JSON.stringify({ hook_event_name: "Stop" }),
      JSON.stringify({ ...base, hook_event_name: { a: 1 }, tool_name: [], tool_input: 3, cwd: 9 }),
      JSON.stringify({ ...base, hook_event_name: "PreToolUse", tool_input: "texto" }),
      JSON.stringify({ ...base, hook_event_name: "Stop", last_assistant_message: { a: 1 } }),
      JSON.stringify({ ...base, hook_event_name: "Quien-sabe" }),
      "x".repeat(100 * 1024),
    ];
    for (const b of bodies) {
      const r = await hook(b);
      expect(r.status, String(b).slice(0, 40)).toBe(200);
      expect(await r.text()).toBe("");
    }
    // nada de lo anterior con id inválido creó sesiones raras
    expect(bridge.store.sessions.every((s) => /^[A-Za-z0-9_.:-]{1,48}$/.test(s.id))).toBe(true);
  });

  it("solo acepta POST, y respeta la protección de Origin y Host", async () => {
    bridge = await startTestBridge();
    expect((await bridge.api("/hook/claude")).status).toBe(405);
    const r = await bridge.api("/hook/claude", { method: "POST", body: "{}", headers: { Origin: "http://evil.example" } });
    expect(r.status).toBe(403);
  });

  it("un Stop deja la sesión como terminada con su último mensaje en la vista de la consola", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    await json({ ...base, hook_event_name: "Stop", last_assistant_message: "Listo, probado." });
    await waitFor(() => con.lastView?.sessions.some((s) => s.id === "h1") === true);
    con.send({ t: "focus", sessionId: "h1" });
    await waitFor(() => con.lastView?.detail?.sessionId === "h1");
    expect(con.lastView!.detail!.lastMessage).toEqual(["Listo, probado."]);
    expect(con.lastView!.face).toMatchObject({ kind: "claude", mood: "done" });
  });
});

describe("API HTTP", () => {
  it("JSON inválido -> 400, cuerpo con forma incorrecta -> 400", async () => {
    bridge = await startTestBridge();
    const bad = await bridge.api("/permission", { method: "POST", body: "{no es json" });
    expect(bad.status).toBe(400);
    expect((await postJson("/permission", { session_id: "x" }, bridge)).status).toBe(400);
    expect((await postJson("/event", { session_id: "x", event: "volar" }, bridge)).status).toBe(400);
  });

  it("cuerpo mayor de 64 KB -> 413", async () => {
    bridge = await startTestBridge();
    const big = { ...permissionBody(), tool_input: { command: "x".repeat(100 * 1024) } };
    expect((await postJson("/permission", big, bridge)).status).toBe(413);
  });

  it("rutas desconocidas 404; peticiones con Origin o Host ajeno 403", async () => {
    bridge = await startTestBridge();
    expect((await bridge.api("/nada")).status).toBe(404);
    expect((await bridge.api("/health", { headers: { Origin: "http://evil.example" } })).status).toBe(403);
    const r = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port: bridge.ports.api, path: "/health", headers: { Host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(r).toBe(403);
  });
});

describe("/permission: sí, no volver a preguntar", () => {
  const suggestions = [
    { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "ls -la" }], behavior: "allow", destination: "localSettings" },
  ];

  it("allow_always responde allow con las sugerencias como updatedPermissions y la vista trae `always`", async () => {
    bridge = await startTestBridge();
    const { ws, msgs } = await openWs(bridge, `http://127.0.0.1:${bridge.ports.ws}`);
    await waitFor(() => msgs.length > 0);
    const pending = postJson("/permission", { ...permissionBody("ls -la"), permission_suggestions: suggestions }, bridge).then((r) => r.json());
    await waitFor(() => msgs.at(-1)?.view?.request != null);
    expect(msgs.at(-1).view.request.always).toBe("Bash(ls -la)");
    ws.send(JSON.stringify({ t: "decision", requestId: msgs.at(-1).view.request.id, decision: "allow_always" }));
    expect(await pending).toEqual({ decision: "allow", updatedPermissions: suggestions });
    ws.close();
  });

  it("un allow normal no lleva updatedPermissions aunque haya sugerencias", async () => {
    bridge = await startTestBridge();
    const { ws, msgs } = await openWs(bridge, `http://127.0.0.1:${bridge.ports.ws}`);
    await waitFor(() => msgs.length > 0);
    const pending = postJson("/permission", { ...permissionBody("ls"), permission_suggestions: suggestions }, bridge).then((r) => r.json());
    await waitFor(() => msgs.at(-1)?.view?.request != null);
    ws.send(JSON.stringify({ t: "decision", requestId: msgs.at(-1).view.request.id, decision: "allow" }));
    expect(await pending).toEqual({ decision: "allow" });
    ws.close();
  });

  it("sugerencias mal formadas se ignoran: la solicitud sigue y no ofrece la opción", async () => {
    bridge = await startTestBridge();
    const { ws, msgs } = await openWs(bridge, `http://127.0.0.1:${bridge.ports.ws}`);
    await waitFor(() => msgs.length > 0);
    const pending = postJson("/permission", { ...permissionBody("ls"), permission_suggestions: "basura" }, bridge);
    await waitFor(() => msgs.at(-1)?.view?.request != null);
    expect("always" in msgs.at(-1).view.request).toBe(false);
    ws.send(JSON.stringify({ t: "decision", requestId: msgs.at(-1).view.request.id, decision: "allow_always" })); // sin sugerencias: allow a secas
    const r = await pending;
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ decision: "allow" });
    ws.close();
  });

describe("/permission ignora lo que no es un permiso", () => {
  it.each(["AskUserQuestion", "ExitPlanMode"])("%s se devuelve como ask sin crear solicitud", async (tool) => {
    bridge = await startTestBridge();
    const { ws, msgs } = await openWs(bridge, `http://127.0.0.1:${bridge.ports.ws}`);
    await waitFor(() => msgs.length > 0);
    const r = await postJson("/permission", { ...permissionBody("ls"), tool_name: tool, tool_input: { questions: [] } }, bridge);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ decision: "ask" });
    expect(bridge.store.pendingCount).toBe(0);
    ws.close();
  });
});
});

describe("carpetas elegidas (carpetas.json)", () => {
  const escribirConfig = (b: TestBridge, o: unknown) => {
    mkdirSync(join(b.tmp, "config"), { recursive: true });
    writeFileSync(join(b.tmp, "config", "carpetas.json"), typeof o === "string" ? o : JSON.stringify(o));
  };
  const hookClaude = (b: TestBridge, o: unknown) => b.api("/hook/claude", { method: "POST", body: JSON.stringify(o) });
  const fuera = { session_id: "f1", cwd: "C:/privado/x" };
  const dentro = { session_id: "d1", cwd: "C:/work/mi-portal/src" };

  it("/hook/claude ignora sesiones fuera de las carpetas y registra las de dentro; los cambios valen sin reiniciar", async () => {
    bridge = await startTestBridge();
    escribirConfig(bridge, { modo: "elegidas", carpetas: ["c:/WORK/mi-portal"] });
    expect((await hookClaude(bridge, { ...fuera, hook_event_name: "SessionStart" })).status).toBe(200);
    expect((await hookClaude(bridge, { ...dentro, hook_event_name: "SessionStart" })).status).toBe(200);
    expect(bridge.store.getSession("f1")).toBeUndefined();
    expect(bridge.store.getSession("d1")).toMatchObject({ project: "src" });
    escribirConfig(bridge, { modo: "todas", carpetas: [] });
    await hookClaude(bridge, { ...fuera, hook_event_name: "SessionStart" });
    expect(bridge.store.getSession("f1")).toBeDefined();
  });

  it("/permission, /question y /stop responden 'sin decisión' y no registran la sesión", async () => {
    bridge = await startTestBridge();
    escribirConfig(bridge, { modo: "elegidas", carpetas: ["C:/work"] });
    const cwd = "C:/privado/x";
    const p = await bridge.api("/permission", { method: "POST", body: JSON.stringify({ session_id: "f1", cwd, tool_name: "Bash", tool_input: { command: "ls" } }) });
    expect(await p.json()).toEqual({ decision: "ask" });
    const q = await bridge.api("/question", { method: "POST", body: JSON.stringify({ session_id: "f1", cwd, tool_input: { questions: [{ question: "?", header: "h", options: [{ label: "a", description: "b" }, { label: "c", description: "d" }], multiSelect: false }] } }) });
    expect(await q.json()).toEqual({ decision: "ask" });
    const s = await bridge.api("/stop", { method: "POST", body: JSON.stringify({ session_id: "f1", cwd }) });
    expect(await s.json()).toEqual({ decision: "none" });
    expect(bridge.store.getSession("f1")).toBeUndefined();
    expect(bridge.store.pendingCount).toBe(0);
  });

  it("archivo corrupto: ignora todo y deja un aviso en el log", async () => {
    const logs: string[] = [];
    bridge = await startTestBridge({ log: (m: string) => logs.push(m) });
    escribirConfig(bridge, "{roto");
    await hookClaude(bridge, { ...dentro, hook_event_name: "SessionStart" });
    expect(bridge.store.getSession("d1")).toBeUndefined();
    expect(logs.some((l) => l.includes("carpetas.json"))).toBe(true);
  });
});

// Token local de la API (auditoría 2026-11-17, punto 4): generación, archivos, 401 sin token o con uno malo en las rutas que deciden algo,
// el WebSocket del simulador con `?token=` y la página del simulador con el token inyectado.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { generateApiToken, readTokenFile, tokenMatches, writeTokenFile } from "../src/api-token.ts";
import { injectToken } from "../src/ws-server.ts";
import { TOKEN_PATHS } from "../src/http-api.ts";
import { permissionBody, startTestBridge, waitFor, type TestBridge } from "./helpers.ts";

let bridge: TestBridge | undefined;
let tmp: string | undefined;
afterEach(async () => {
  await bridge?.cleanup();
  bridge = undefined;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

const TOKEN_RE = /^[0-9a-f]{64}$/;
const crudo = (b: TestBridge, path: string, init: RequestInit = {}) => fetch(b.url + path, init); // sin token

describe("generación y archivos", () => {
  it("32 bytes al azar en hex, distinto cada vez", () => {
    const a = generateApiToken();
    expect(a).toMatch(TOKEN_RE);
    expect(generateApiToken()).not.toBe(a);
  });

  it("tokenMatches compara con exactitud y rechaza lo que no tiene la forma de un token", () => {
    const t = generateApiToken();
    expect(tokenMatches(t, t)).toBe(true);
    expect(tokenMatches(t, generateApiToken())).toBe(false);
    expect(tokenMatches(t, t.toUpperCase())).toBe(false);
    expect(tokenMatches(t, t.slice(1))).toBe(false);
    expect(tokenMatches(t, t + "0")).toBe(false);
    expect(tokenMatches(t, "")).toBe(false);
    expect(tokenMatches(t, undefined)).toBe(false);
    expect(tokenMatches(t, ["a", "b"])).toBe(false);
    expect(tokenMatches(t, 5)).toBe(false);
    expect(tokenMatches("", "")).toBe(false); // un puente sin token nunca deja pasar a nadie
  });

  it("writeTokenFile / readTokenFile: escritura atómica, lectura de la primera carpeta válida", () => {
    tmp = mkdtempSync(join(tmpdir(), "bridge-token-"));
    const t = generateApiToken();
    const ruta = writeTokenFile(join(tmp, "a", "b"), t);
    expect(readFileSync(ruta, "utf8")).toBe(t);
    expect(readTokenFile(join(tmp, "no-existe"), join(tmp, "a", "b"))).toBe(t);
    expect(readTokenFile(join(tmp, "no-existe"))).toBeUndefined();
    // un archivo con basura no sirve; se pasa a la siguiente carpeta
    mkdirSync(join(tmp, "x"));
    writeFileSync(join(tmp, "x", "api-token"), "basura");
    expect(readTokenFile(join(tmp, "x"), join(tmp, "a", "b"))).toBe(t);
    // sin temporales sueltos
    writeTokenFile(join(tmp, "a", "b"), generateApiToken());
    expect(readdirNames(join(tmp, "a", "b"))).toEqual(["api-token"]);
    // permisos 0600 donde el sistema los respeta
    if (process.platform !== "win32") expect(statSync(ruta).mode & 0o777).toBe(0o600);
  });

  it("el puente genera uno nuevo en cada arranque y lo deja en su carpeta de datos y en la de configuración", async () => {
    bridge = await startTestBridge();
    expect(bridge.apiToken).toMatch(TOKEN_RE);
    expect(readFileSync(join(bridge.dataDir, "api-token"), "utf8")).toBe(bridge.apiToken);
    expect(readFileSync(join(process.env.AGENT_COMPANION_CONFIG_DIR!, "api-token"), "utf8")).toBe(bridge.apiToken);
    const primero = bridge.apiToken;
    await bridge.cleanup();
    bridge = await startTestBridge();
    expect(bridge.apiToken).not.toBe(primero);
    expect(readFileSync(join(process.env.AGENT_COMPANION_CONFIG_DIR!, "api-token"), "utf8")).toBe(bridge.apiToken);
  });

  it("configDir: false no escribe la copia (pero la de la carpeta de datos siempre está)", async () => {
    bridge = await startTestBridge({ configDir: false });
    expect(readFileSync(join(bridge.dataDir, "api-token"), "utf8")).toBe(bridge.apiToken);
    expect(() => readFileSync(join(process.env.AGENT_COMPANION_CONFIG_DIR!, "api-token"), "utf8")).toThrow();
  });
});

function readdirNames(dir: string): string[] {
  return readdirSync(dir);
}

describe("la API exige el token donde se decide algo", () => {
  const cuerpos: Record<string, { method: string; body?: unknown }> = {
    "/pair": { method: "POST" },
    "/permission": { method: "POST", body: permissionBody() },
    "/question": { method: "POST", body: { session_id: "s1", tool_input: { questions: [] } } },
    "/stop": { method: "POST", body: { session_id: "s1" } },
    "/shutdown": { method: "POST" },
    "/event": { method: "POST", body: { session_id: "s1", event: "start" } },
    "/devices/forget": { method: "POST", body: { deviceId: "3ds-test" } },
  };

  it("las rutas protegidas son las siete que deciden o cambian algo", () => {
    expect([...TOKEN_PATHS].sort()).toEqual(Object.keys(cuerpos).sort());
  });

  it("sin token, con uno malo o con uno de otro formato: 401 en todas, sin cambiar nada", async () => {
    let apagado = 0;
    bridge = await startTestBridge({ onShutdown: () => apagado++ });
    for (const [ruta, { method, body }] of Object.entries(cuerpos)) {
      const init = (headers: Record<string, string>): RequestInit => ({
        method,
        headers: { "content-type": "application/json", "x-cronio": "shutdown", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const headers of [{} as Record<string, string>, { "x-cronio-token": generateApiToken() }, { "x-cronio-token": "" }, { "x-cronio-token": "x".repeat(64) }, { "x-cronio-token": bridge.apiToken.toUpperCase() }, { "x-cronio-token": bridge.apiToken + "0" }]) {
        const r = await crudo(bridge, ruta, init(headers));
        expect(r.status, `${ruta} con ${JSON.stringify(headers)}`).toBe(401);
      }
    }
    // nada de lo anterior hizo efecto
    expect(bridge.store.sessions).toEqual([]);
    expect(bridge.store.pendingCount).toBe(0);
    expect(bridge.pairing.hasPending).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(apagado).toBe(0);
  });

  it("con el token bueno funcionan como siempre", async () => {
    let apagado = 0;
    bridge = await startTestBridge({ onShutdown: () => apagado++ });
    const h = { "content-type": "application/json", "x-cronio-token": bridge.apiToken };
    expect((await crudo(bridge, "/pair", { method: "POST", headers: h })).status).toBe(200);
    expect((await crudo(bridge, "/event", { method: "POST", headers: h, body: JSON.stringify({ session_id: "s1", event: "start" }) })).status).toBe(200);
    expect((await crudo(bridge, "/stop", { method: "POST", headers: h, body: JSON.stringify({ session_id: "s1" }) })).status).toBe(200);
    const q = await crudo(bridge, "/question", { method: "POST", headers: h, body: JSON.stringify({ session_id: "s1", tool_input: { questions: [] } }) });
    expect(q.status).toBe(200);
    // /shutdown pide además la cabecera propia de siempre
    expect((await crudo(bridge, "/shutdown", { method: "POST", headers: h })).status).toBe(403);
    expect((await crudo(bridge, "/shutdown", { method: "POST", headers: { ...h, "x-cronio": "shutdown" } })).status).toBe(202);
    await waitFor(() => apagado === 1);
  });

  it("un permiso sin token nunca se aprueba ni llega a la consola: 401 y la solicitud no existe", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    const r = await crudo(bridge, "/permission", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(permissionBody()) });
    expect(r.status).toBe(401);
    expect(await r.json()).not.toHaveProperty("decision");
    await new Promise((res) => setTimeout(res, 50));
    expect(con.lastView?.request ?? null).toBeNull();
    expect(bridge.store.pendingCount).toBe(0);
  });

  it("/health y /hook/claude no llevan token: /health solo lee y /hook/claude solo recibe eventos informativos", async () => {
    bridge = await startTestBridge();
    expect((await crudo(bridge, "/health")).status).toBe(200);
    const hook = await crudo(bridge, "/hook/claude", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hook_event_name: "SessionStart", session_id: "h1", cwd: "C:\\p\\demo" }) });
    expect(hook.status).toBe(200);
    expect(await hook.text()).toBe("");
  });

  it("/hook/claude, aun sin token, no puede aprobar ni rechazar un permiso pendiente: a lo sumo lo retira y lo deja al PC", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    const decision = crudo(bridge, "/permission", { method: "POST", headers: { "content-type": "application/json", "x-cronio-token": bridge.apiToken }, body: JSON.stringify(permissionBody("ls", "h2")) })
      .then((r) => r.json() as Promise<{ decision: string }>);
    await waitFor(() => con.lastView?.request != null);
    // un evento informativo cualquiera sobre esa sesión (el hook del propio Claude Code lo mandaría al resolverse en la terminal)
    await crudo(bridge, "/hook/claude", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hook_event_name: "PostToolUse", session_id: "h2", cwd: "C:\\proyectos\\demo", tool_name: "Bash", tool_input: { command: "ls" } }) });
    expect((await decision).decision).toBe("ask"); // nunca allow ni deny
  });
});

describe("WebSocket del simulador", () => {
  const abrir = (url: string, headers: Record<string, string> = {}) =>
    new Promise<{ ok: boolean; status?: number; ws?: WebSocket }>((resolve) => {
      const ws = new WebSocket(url, { headers });
      ws.on("open", () => resolve({ ok: true, ws }));
      ws.on("unexpected-response", (_req, res) => resolve({ ok: false, status: res.statusCode }));
      ws.on("error", () => {});
    });

  it("sin token o con uno malo: 401 (con y sin Origin); con el bueno: conecta y recibe la vista", async () => {
    bridge = await startTestBridge();
    const base = `ws://127.0.0.1:${bridge.ports.ws}/ws`;
    for (const url of [base, `${base}?token=`, `${base}?token=${generateApiToken()}`, `${base}?token=${bridge.apiToken}0`, `${base}?otro=${bridge.apiToken}`]) {
      const r = await abrir(url);
      expect(r.ok, url).toBe(false);
      expect(r.status, url).toBe(401);
    }
    // con Origin del propio simulador pero sin token tampoco
    const origin = `http://127.0.0.1:${bridge.ports.ws}`;
    expect((await abrir(base, { Origin: origin })).status).toBe(401);
    // y nada de eso cuenta como simulador conectado
    expect(((await (await bridge.api("/health")).json()) as { simulator: boolean }).simulator).toBe(false);
    const ok = await abrir(`${base}?token=${bridge.apiToken}`, { Origin: origin });
    expect(ok.ok).toBe(true);
    ok.ws!.close();
  });

  it("la página del simulador recibe el token inyectado y los demás archivos no", async () => {
    tmp = mkdtempSync(join(tmpdir(), "bridge-sim-"));
    writeFileSync(join(tmp, "index.html"), "<!doctype html><html><head><title>x</title></head><body>hola</body></html>");
    writeFileSync(join(tmp, "app.js"), "console.log(1)");
    bridge = await startTestBridge({ staticDir: tmp });
    const pagina = await fetch(`http://127.0.0.1:${bridge.ports.ws}/`);
    const html = await pagina.text();
    expect(html).toContain(`window.COMPANION_API_TOKEN=${JSON.stringify(bridge.apiToken)}`);
    expect(html.indexOf("COMPANION_API_TOKEN")).toBeLessThan(html.indexOf("<title>")); // antes que cualquier otro script
    expect(pagina.headers.get("cache-control")).toBe("no-store");
    expect(pagina.headers.get("content-length")).toBe(String(Buffer.byteLength(html)));
    const js = await (await fetch(`http://127.0.0.1:${bridge.ports.ws}/app.js`)).text();
    expect(js).toBe("console.log(1)");
    // y con ese token se abre el WebSocket
    const r = await abrir(`ws://127.0.0.1:${bridge.ports.ws}/ws?token=${html.match(/COMPANION_API_TOKEN="([0-9a-f]{64})"/)![1]}`);
    expect(r.ok).toBe(true);
    r.ws!.close();
  });

  it("injectToken: tras <head>, o al comienzo si no hay", () => {
    const t = "ab".repeat(32);
    expect(injectToken("<html><head lang=x><meta></head></html>", t)).toBe(`<html><head lang=x><script>window.COMPANION_API_TOKEN="${t}";</script><meta></head></html>`);
    expect(injectToken("<p>hola</p>", t)).toBe(`<script>window.COMPANION_API_TOKEN="${t}";</script><p>hola</p>`);
  });
});

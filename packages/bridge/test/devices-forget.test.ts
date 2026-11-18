// Olvidar una consola emparejada: DeviceStore.remove, GET /devices (sin claves), POST /devices/forget (con token; borra la clave y corta la
// conexión) y `companion devices forget <id>` en la CLI.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DeviceStore } from "../src/devices.ts";
import { FakeConsole } from "./fake-console.ts";
import { postJson, startTestBridge, waitFor, type TestBridge } from "./helpers.ts";

let bridge: TestBridge | undefined;
let tmp: string | undefined;
afterEach(async () => {
  await bridge?.cleanup();
  bridge = undefined;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

const crudo = (b: TestBridge, path: string, init: RequestInit = {}) => fetch(b.url + path, init); // sin token
const dispositivo = (id: string, key = "ab".repeat(32)) => ({ deviceId: id, name: id, keyHex: key, pairedAt: "2026-11-17T10:00:00.000Z" });

describe("DeviceStore.remove", () => {
  it("borra solo ese dispositivo y dice si estaba", () => {
    tmp = mkdtempSync(join(tmpdir(), "devices-remove-"));
    const store = new DeviceStore(join(tmp, "devices.json"));
    store.add(dispositivo("3ds-a"));
    store.add(dispositivo("3ds-b", "cd".repeat(32)));
    expect(store.remove("3ds-a")).toBe(true);
    expect(store.list().map((d) => d.deviceId)).toEqual(["3ds-b"]);
    expect(store.remove("3ds-a")).toBe(false);
    expect(store.remove("nunca-estuvo")).toBe(false);
    expect(store.list()).toHaveLength(1);
  });

  it("sin archivo no falla", () => {
    tmp = mkdtempSync(join(tmpdir(), "devices-remove-"));
    expect(new DeviceStore(join(tmp, "devices.json")).remove("x")).toBe(false);
  });
});

describe("GET /devices", () => {
  it("lista id, nombre, fecha y si está conectada, y nunca la clave", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console("3ds-uno");
    await waitFor(() => con.views.length > 0);
    bridge.devices.add(dispositivo("3ds-dos"));
    const r = await crudo(bridge, "/devices"); // sin token: es de solo lectura, como /health
    expect(r.status).toBe(200);
    const texto = await r.text();
    const j = JSON.parse(texto) as { devices: { deviceId: string; name: string; pairedAt: string; connected: boolean }[] };
    const porId = Object.fromEntries(j.devices.map((d) => [d.deviceId, d]));
    expect(Object.keys(porId).sort()).toEqual(["3ds-dos", "3ds-uno"]);
    expect(porId["3ds-uno"]).toMatchObject({ name: "3ds-uno", connected: true });
    expect(porId["3ds-dos"]).toMatchObject({ pairedAt: "2026-11-17T10:00:00.000Z", connected: false });
    // nada que se parezca a una clave
    expect(texto).not.toContain("keyHex");
    expect(texto).not.toContain(bridge.devices.get("3ds-uno")!.keyHex);
    expect(texto).not.toContain("ab".repeat(32));
    expect(Object.keys(j.devices[0]!).sort()).toEqual(["connected", "deviceId", "name", "pairedAt"]);
  });

  it("sin consolas: lista vacía; con otro método: 405", async () => {
    bridge = await startTestBridge();
    expect(await (await crudo(bridge, "/devices")).json()).toEqual({ devices: [] });
    expect((await crudo(bridge, "/devices", { method: "POST" })).status).toBe(405);
  });
});

describe("POST /devices/forget", () => {
  it("exige el token local: sin él, con uno malo o de otro formato, 401 y no se borra nada", async () => {
    bridge = await startTestBridge();
    bridge.devices.add(dispositivo("3ds-a"));
    for (const headers of [{}, { "x-cronio-token": "0".repeat(64) }, { "x-cronio-token": "mal" }] as Record<string, string>[]) {
      const r = await crudo(bridge, "/devices/forget", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ deviceId: "3ds-a" }) });
      expect(r.status).toBe(401);
    }
    expect(bridge.devices.list()).toHaveLength(1);
  });

  it("borra la clave y corta la conexión de esa consola; las demás siguen", async () => {
    bridge = await startTestBridge();
    const a = await bridge.console("3ds-a");
    await waitFor(() => a.views.length > 0);
    const r = await postJson("/devices/forget", { deviceId: "3ds-a" }, bridge);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, forgotten: true, disconnected: true });
    await waitFor(() => a.closed, 2000, "conexión cortada");
    expect(bridge.devices.get("3ds-a")).toBeUndefined();
    await waitFor(() => !bridge!.store.consoleConnected, 2000, "ya no hay consola conectada");
    // el archivo tampoco guarda ya su clave
    expect(readFileSync(bridge.devices.path, "utf8")).not.toContain("3ds-a");
  });

  it("la consola olvidada ya no entra con su clave vieja: tiene que emparejarse de nuevo", async () => {
    bridge = await startTestBridge();
    const code = await bridge.pairCode();
    const a = await FakeConsole.connect({ port: bridge.ports.console, deviceId: "3ds-a", code });
    a.close();
    expect((await postJson("/devices/forget", { deviceId: "3ds-a" }, bridge)).status).toBe(200);
    // sin código vigente, el saludo con la clave anterior se rechaza
    await expect(FakeConsole.connect({ port: bridge.ports.console, deviceId: "3ds-a", code })).rejects.toThrow("auth");
    // con un código nuevo se empareja otra vez
    const otra = await FakeConsole.connect({ port: bridge.ports.console, deviceId: "3ds-a", code: await bridge.pairCode() });
    expect(otra.closed).toBe(false);
    otra.close();
  });

  it("una consola que no estaba conectada se olvida sin cortar nada", async () => {
    bridge = await startTestBridge();
    bridge.devices.add(dispositivo("3ds-b"));
    const r = await postJson("/devices/forget", { deviceId: "3ds-b" }, bridge);
    expect(await r.json()).toEqual({ ok: true, forgotten: true, disconnected: false });
    expect(bridge.devices.list()).toEqual([]);
  });

  it("id desconocido: 404; id con forma inválida o cuerpo roto: 400; método equivocado: 405", async () => {
    bridge = await startTestBridge();
    bridge.devices.add(dispositivo("3ds-a"));
    expect((await postJson("/devices/forget", { deviceId: "otra" }, bridge)).status).toBe(404);
    expect((await postJson("/devices/forget", { deviceId: "../x" }, bridge)).status).toBe(400);
    expect((await postJson("/devices/forget", { deviceId: 5 }, bridge)).status).toBe(400);
    expect((await postJson("/devices/forget", {}, bridge)).status).toBe(400);
    expect((await bridge.api("/devices/forget", { method: "POST", body: "{roto", headers: { "content-type": "application/json" } })).status).toBe(400);
    expect((await bridge.api("/devices/forget", { method: "GET" })).status).toBe(405);
    expect(bridge.devices.list()).toHaveLength(1);
  });
});

describe("companion devices forget <id> (CLI)", () => {
  const cli = new URL("../src/cli.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  /** Asíncrono a propósito: el puente de la prueba corre en este mismo proceso y un spawnSync lo dejaría sin responder. */
  const correr = (args: string[], env: Record<string, string> = {}) =>
    new Promise<{ status: number; stdout: string; stderr: string }>((ok) => {
      execFile(process.execPath, ["--import", "tsx", cli, ...args], { encoding: "utf8", timeout: 30_000, env: { ...process.env, ...env } }, (err, stdout, stderr) => {
        ok({ status: err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0, stdout, stderr });
      });
    });

  it("sin puente en marcha borra la clave del archivo", async () => {
    tmp = mkdtempSync(join(tmpdir(), "devices-cli-"));
    const store = new DeviceStore(join(tmp, "devices.json"));
    store.add(dispositivo("3ds-a"));
    store.add(dispositivo("3ds-b"));
    const sin = { AGENT_COMPANION_CONFIG_DIR: join(tmp, "config") };
    const r = await correr(["devices", "forget", "3ds-a", "--data-dir", tmp, "--api-port", "1"], sin);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Olvidé 3ds-a");
    expect(store.list().map((d) => d.deviceId)).toEqual(["3ds-b"]);
    const otra = await correr(["devices", "forget", "3ds-a", "--data-dir", tmp, "--api-port", "1"], sin);
    expect(otra.status).toBe(1);
    expect(otra.stderr).toContain("no está emparejado");
  });

  it("con el puente en marcha lo pide por la API y corta la conexión", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console("3ds-a");
    await waitFor(() => con.views.length > 0);
    const r = await correr(["devices", "forget", "3ds-a", "--data-dir", bridge.dataDir, "--api-port", String(bridge.ports.api)], { AGENT_COMPANION_CONFIG_DIR: join(bridge.tmp, "config") });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("corté su conexión");
    await waitFor(() => con.closed, 3000, "conexión cortada");
    expect(bridge.devices.list()).toEqual([]);
  });

  it("sin id o con un id raro: uso y código 1", async () => {
    expect((await correr(["devices", "forget"])).status).toBe(1);
    expect((await correr(["devices", "forget", "../etc"])).stderr).toContain("Uso:");
  });

  it("la lista (`devices`) sigue funcionando", async () => {
    tmp = mkdtempSync(join(tmpdir(), "devices-cli-"));
    new DeviceStore(join(tmp, "devices.json")).add(dispositivo("3ds-a"));
    const r = await correr(["devices", "--data-dir", tmp]);
    expect(r.stdout).toContain("3ds-a");
  });
});

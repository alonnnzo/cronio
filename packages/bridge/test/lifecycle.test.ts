import { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parentPidFromEnv, pidAlive, startedByFromEnv, watchParent } from "../src/lifecycle.ts";
import { bridgeVersion } from "../src/version.ts";
import { startTestBridge, waitFor, type TestBridge } from "./helpers.ts";

let bridge: TestBridge | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await bridge?.cleanup();
  bridge = undefined;
});

describe("/health dice quién es", () => {
  it("trae versión, pid y quién lo lanzó", async () => {
    bridge = await startTestBridge({ startedBy: "cronio" });
    const h = (await (await bridge.api("/health")).json()) as Record<string, unknown>;
    expect(h).toMatchObject({ ok: true, version: bridgeVersion(), pid: process.pid, startedBy: "cronio" });
    expect(bridgeVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("startedBy sale de COMPANION_STARTED_BY: cualquier otra cosa es manual", () => {
    expect(startedByFromEnv({ COMPANION_STARTED_BY: "cronio" })).toBe("cronio");
    expect(startedByFromEnv({})).toBe("manual");
    expect(startedByFromEnv({ COMPANION_STARTED_BY: "otro" })).toBe("manual");
  });
});

describe("POST /shutdown", () => {
  it("con la cabecera responde 202 y después llama al cierre", async () => {
    const onShutdown = vi.fn();
    bridge = await startTestBridge({ onShutdown });
    const r = await bridge.api("/shutdown", { method: "POST", headers: { "x-cronio": "shutdown" } });
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ ok: true, shuttingDown: true });
    await waitFor(() => onShutdown.mock.calls.length === 1);
  });

  it("sin la cabecera (o con otro valor) responde 403 y no cierra", async () => {
    const onShutdown = vi.fn();
    bridge = await startTestBridge({ onShutdown });
    expect((await bridge.api("/shutdown", { method: "POST" })).status).toBe(403);
    expect((await bridge.api("/shutdown", { method: "POST", headers: { "x-cronio": "otra" } })).status).toBe(403);
    await new Promise((r) => setTimeout(r, 120));
    expect(onShutdown).not.toHaveBeenCalled();
  });

  it("una página web (con Origin) o un Host ajeno no lo dispara", async () => {
    const onShutdown = vi.fn();
    bridge = await startTestBridge({ onShutdown });
    const headers = { "x-cronio": "shutdown", origin: "https://malo.example" };
    expect((await bridge.api("/shutdown", { method: "POST", headers })).status).toBe(403);
    await new Promise((r) => setTimeout(r, 120));
    expect(onShutdown).not.toHaveBeenCalled();
  });

  it("solo POST; sin manejador de cierre responde 501", async () => {
    bridge = await startTestBridge();
    expect((await bridge.api("/shutdown", { headers: { "x-cronio": "shutdown" } })).status).toBe(405);
    expect((await bridge.api("/shutdown", { method: "POST", headers: { "x-cronio": "shutdown" } })).status).toBe(501);
  });
});

describe("vigilancia del proceso padre", () => {
  it("COMPANION_PARENT_PID: solo un PID válido; sin la variable no se vigila nada", () => {
    expect(parentPidFromEnv({})).toBeUndefined();
    expect(parentPidFromEnv({ COMPANION_PARENT_PID: "abc" })).toBeUndefined();
    expect(parentPidFromEnv({ COMPANION_PARENT_PID: "0" })).toBeUndefined();
    expect(parentPidFromEnv({ COMPANION_PARENT_PID: String(process.pid) })).toBeUndefined();
    expect(parentPidFromEnv({ COMPANION_PARENT_PID: "4321" })).toBe(4321);
  });

  it("cierra una sola vez cuando el padre deja de existir (reloj simulado)", () => {
    vi.useFakeTimers();
    let vivo = true;
    const onGone = vi.fn();
    const w = watchParent(99999, onGone, { intervalMs: 5000, isAlive: () => vivo });
    vi.advanceTimersByTime(15000);
    expect(onGone).not.toHaveBeenCalled();
    vivo = false;
    vi.advanceTimersByTime(4999);
    expect(onGone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onGone).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30000);
    expect(onGone).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it("stop() cancela la vigilancia", () => {
    vi.useFakeTimers();
    const onGone = vi.fn();
    const w = watchParent(99999, onGone, { intervalMs: 1000, isAlive: () => false });
    w.stop();
    vi.advanceTimersByTime(10000);
    expect(onGone).not.toHaveBeenCalled();
  });

  it("con un proceso padre falso real: avisa cuando ese proceso muere", async () => {
    const padre = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    try {
      expect(padre.pid).toBeTypeOf("number");
      expect(pidAlive(padre.pid!)).toBe(true);
      const onGone = vi.fn();
      const w = watchParent(padre.pid!, onGone, { intervalMs: 50 });
      await new Promise((r) => setTimeout(r, 200));
      expect(onGone).not.toHaveBeenCalled();
      padre.kill();
      await waitFor(() => onGone.mock.calls.length === 1, 4000, "el aviso de padre muerto");
      w.stop();
      expect(pidAlive(padre.pid!)).toBe(false);
    } finally {
      padre.kill();
    }
  });
});

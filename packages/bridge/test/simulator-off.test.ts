// Auditoría 2026-11-17, punto 3: en el build empaquetado el programa del PC lanza el puente con COMPANION_SIMULATOR=0 y no se levanta el
// simulador (su WebSocket permite decisiones, instrucciones y respuestas a cualquier proceso local sin Origin).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestBridge, type TestBridge } from "./helpers.ts";

let bridge: TestBridge | undefined;
let previo: string | undefined;
beforeEach(() => {
  previo = process.env.COMPANION_SIMULATOR;
});
afterEach(async () => {
  if (previo === undefined) delete process.env.COMPANION_SIMULATOR;
  else process.env.COMPANION_SIMULATOR = previo;
  await bridge?.cleanup();
  bridge = undefined;
});

describe("simulador desactivable", () => {
  it("por defecto (desarrollo) se levanta, como siempre", async () => {
    delete process.env.COMPANION_SIMULATOR;
    bridge = await startTestBridge();
    expect(bridge.ports.ws).toBeGreaterThan(0);
  });

  it("con COMPANION_SIMULATOR=0 no se abre el puerto del WebSocket, pero la consola y la API siguen", async () => {
    process.env.COMPANION_SIMULATOR = "0";
    const logs: string[] = [];
    bridge = await startTestBridge({ log: (m) => logs.push(m) });
    expect((bridge.ports as { ws?: number }).ws).toBeUndefined();
    expect(logs.some((l) => l.includes("simulador desactivado"))).toBe(true);
    // la consola 3DS y la API local no dependen del simulador
    const salud = (await (await bridge.api("/health")).json()) as { ok: boolean; simulator: boolean; device: boolean };
    expect(salud.ok).toBe(true);
    expect(salud.simulator).toBe(false); // «hay un simulador conectado»: sin simulador, nunca
    const con = await bridge.console();
    await new Promise((r) => setTimeout(r, 20));
    expect(((await (await bridge.api("/health")).json()) as { device: boolean }).device).toBe(true);
    expect(con.closed).toBe(false);
  });

  it("la opción simulator manda sobre el entorno", async () => {
    process.env.COMPANION_SIMULATOR = "0";
    bridge = await startTestBridge({ simulator: true });
    expect(bridge.ports.ws).toBeGreaterThan(0);
    await bridge.cleanup();
    delete process.env.COMPANION_SIMULATOR;
    bridge = await startTestBridge({ simulator: false });
    expect((bridge.ports as { ws?: number }).ws).toBeUndefined();
  });
});

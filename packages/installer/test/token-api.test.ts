import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pedirCierrePuente } from "../src/bridge-proc.ts";
import { cabecerasApi, carpetaConfig, ENCABEZADO_TOKEN, leerTokenApi } from "../src/token-api.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cronio-token-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const TOKEN = "0123456789abcdef".repeat(4);

describe("token local de la API (programa del PC)", () => {
  it("la carpeta de configuración: AGENT_COMPANION_CONFIG_DIR, si no %APPDATA%/agent-companion", () => {
    expect(carpetaConfig({ AGENT_COMPANION_CONFIG_DIR: "X:\c", APPDATA: "Y:\a" })).toBe("X:\c");
    expect(carpetaConfig({ APPDATA: dir })).toBe(join(dir, "agent-companion"));
  });

  it("lee el token del archivo api-token; sin archivo o con basura no hay token", () => {
    expect(leerTokenApi(dir)).toBeUndefined();
    writeFileSync(join(dir, "api-token"), TOKEN + "\n");
    expect(leerTokenApi(dir)).toBe(TOKEN);
    writeFileSync(join(dir, "api-token"), "basura");
    expect(leerTokenApi(dir)).toBeUndefined();
    writeFileSync(join(dir, "api-token"), TOKEN.toUpperCase());
    expect(leerTokenApi(dir)).toBeUndefined();
  });

  it("cabecerasApi agrega X-Cronio-Token solo si hay token", () => {
    expect(cabecerasApi({ a: "1" }, dir)).toEqual({ a: "1" });
    writeFileSync(join(dir, "api-token"), TOKEN);
    expect(cabecerasApi({ a: "1" }, dir)).toEqual({ a: "1", [ENCABEZADO_TOKEN]: TOKEN });
  });

  it("pedirCierrePuente manda x-cronio y el token que está en la carpeta de configuración", async () => {
    const previo = process.env.AGENT_COMPANION_CONFIG_DIR;
    process.env.AGENT_COMPANION_CONFIG_DIR = dir;
    writeFileSync(join(dir, "api-token"), TOKEN);
    let visto: Record<string, unknown> = {};
    const server = createServer((req, res) => {
      visto = { ...req.headers };
      res.writeHead(202);
      res.end("{}");
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    try {
      expect(await pedirCierrePuente(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)).toBe(true);
      expect(visto["x-cronio"]).toBe("shutdown");
      expect(visto[ENCABEZADO_TOKEN]).toBe(TOKEN);
    } finally {
      server.closeAllConnections();
      await new Promise((ok) => server.close(ok));
      if (previo === undefined) delete process.env.AGENT_COMPANION_CONFIG_DIR;
      else process.env.AGENT_COMPANION_CONFIG_DIR = previo;
    }
  });
});

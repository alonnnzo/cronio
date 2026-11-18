// Usa un puerto libre elegido por el sistema: nunca ocupa 33334/33335/33337/33340.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { iniciarServidorCia } from "../src/cia-server.ts";
import type { ServidorCia } from "../src/cia-server.ts";

let dir: string;
let servidor: ServidorCia | undefined;
const contenido = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "companion-cia-"));
});
afterEach(async () => {
  await servidor?.cerrar();
  servidor = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe("servidor del .cia", () => {
  it("entrega el archivo con content-type y content-length", async () => {
    const cia = join(dir, "x.cia");
    writeFileSync(cia, contenido);
    servidor = await iniciarServidorCia(cia, 0, "127.0.0.1");
    const r = await fetch(`http://127.0.0.1:${servidor.puerto}/agent-companion.cia`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/octet-stream");
    expect(r.headers.get("content-length")).toBe("8");
    expect(Buffer.from(await r.arrayBuffer())).toEqual(contenido);
  });

  it("solo responde esa ruta y solo con GET", async () => {
    const cia = join(dir, "x.cia");
    writeFileSync(cia, contenido);
    servidor = await iniciarServidorCia(cia, 0, "127.0.0.1");
    const base = `http://127.0.0.1:${servidor.puerto}`;
    expect((await fetch(`${base}/otra`)).status).toBe(404);
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/agent-companion.cia`, { method: "POST" })).status).toBe(405);
  });

  it("si el .cia no existe responde 404", async () => {
    servidor = await iniciarServidorCia(join(dir, "no-existe.cia"), 0, "127.0.0.1");
    expect((await fetch(`http://127.0.0.1:${servidor.puerto}/agent-companion.cia`)).status).toBe(404);
  });
});

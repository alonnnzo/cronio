// El registro bridge.log: Cronio deja siempre una línea al arrancar el puente (o al decidir no lanzarlo) y avisa si no puede escribir.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProcesoPuente } from "../src/bridge-proc.ts";

// Un «puente» de mentira: responde /health y se cierra con POST /shutdown. Nunca toca el puerto real 33335.
const PUENTE_FALSO = `
const http = require("node:http");
const port = Number(process.argv[2]);
const srv = http.createServer((req, res) => {
  if (req.url === "/shutdown") { res.statusCode = 202; res.end(); setTimeout(() => process.exit(0), 20); return; }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, console: false, device: false, simulator: false, pending: 0, version: process.argv[3] || "0.0.1", pid: process.pid, startedBy: "cronio" }));
});
srv.listen(port, "127.0.0.1", () => console.log("Puente falso en marcha."));
`;

async function puertoLibre(): Promise<number> {
  return new Promise((ok) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });
}

let dir: string;
let puente: ProcesoPuente | undefined;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cronio-puente-"));
  writeFileSync(join(dir, "falso.cjs"), PUENTE_FALSO);
});
afterEach(async () => {
  await puente?.detenerOrdenado();
  puente?.matarSiQueda();
  puente = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe("registro del puente (ProcesoPuente)", () => {
  it("al arrancar escribe «arranque desde Cronio» y la salida del puente en bridge.log", async () => {
    const port = await puertoLibre();
    const logs = join(dir, "logs"); // no existe: se crea
    puente = new ProcesoPuente({ archivo: process.execPath, args: [join(dir, "falso.cjs"), String(port), "0.3.0"], cwd: dir, env: {} }, logs, "0.3.0", `http://127.0.0.1:${port}`);
    expect(await puente.iniciar()).toBe("iniciado");
    const texto = readFileSync(join(logs, "bridge.log"), "utf8");
    expect(texto).toContain("arranque desde Cronio");
    await new Promise((r) => setTimeout(r, 300));
    expect(readFileSync(join(logs, "bridge.log"), "utf8")).toContain("Puente falso en marcha.");
    expect((await puente.estado()).errorLog).toBeUndefined();
  });

  it("si ya corre un puente de esta versión no lanza otro, pero lo deja dicho en el registro", async () => {
    const port = await puertoLibre();
    const base = `http://127.0.0.1:${port}`;
    const ajeno = new ProcesoPuente({ archivo: process.execPath, args: [join(dir, "falso.cjs"), String(port), "0.3.0"], cwd: dir, env: {} }, join(dir, "otro"), "0.3.0", base);
    try {
      expect(await ajeno.iniciar()).toBe("iniciado");
      const logs = join(dir, "logs");
      puente = new ProcesoPuente({ archivo: process.execPath, args: ["-e", "process.exit(9)"], cwd: dir, env: {} }, logs, "0.3.0", base);
      expect(await puente.iniciar()).toBe("ya-corria");
      const texto = readFileSync(join(logs, "bridge.log"), "utf8");
      expect(texto).toContain("no lanza otro puente");
      expect(texto).toContain("0.3.0");
      expect(texto).not.toContain("arranque desde Cronio");
    } finally {
      await ajeno.detenerOrdenado();
    }
  });

  it("si el registro no se puede escribir, el estado lo dice en vez de callar", async () => {
    const port = await puertoLibre();
    const logs = join(dir, "logs");
    mkdirSync(logs);
    mkdirSync(join(logs, "bridge.log")); // una carpeta donde debería ir el archivo: appendFileSync falla
    puente = new ProcesoPuente({ archivo: process.execPath, args: [join(dir, "falso.cjs"), String(port)], cwd: dir, env: {} }, logs, undefined, `http://127.0.0.1:${port}`);
    await puente.iniciar();
    const estado = await puente.estado();
    expect(estado.errorLog).toContain("bridge.log");
    expect(existsSync(join(logs, "bridge.log"))).toBe(true);
  });
});

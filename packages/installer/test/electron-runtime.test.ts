// El puente empaquetado no corre con Node sino con el ejecutable de Electron en modo ELECTRON_RUN_AS_NODE (BoringSSL), cuyo node:crypto no
// trae `chacha20`. Estas pruebas corren el protocolo v2 y el puente de verdad dentro de ese runtime, que es donde falló la 0.3.0.
// Si Electron no está instalado, se saltan.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FrameSealer, deriveDeviceKey, sessionKeyV2 } from "@companion/protocol";
import { FakeConsole } from "../../bridge/test/fake-console.ts";

const aqui = __dirname;
const raiz = resolve(aqui, "..", "..", "..");

function rutaElectron(): string | undefined {
  try {
    const r = require("electron") as unknown;
    return typeof r === "string" && existsSync(r) ? r : undefined;
  } catch {
    return undefined;
  }
}
const electron = rutaElectron();
const conElectron = describe.skipIf(!electron);

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "cronio-electron-"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Corre un script (.mjs) con el ejecutable de Electron como Node y devuelve su salida estándar. */
function correrComoNode(script: string): string {
  return execFileSync(electron!, [script], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
}

async function puertoLibre(): Promise<number> {
  return new Promise((ok) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });
}

const TAMANOS = [0, 1, 63, 64, 65, 1000, 16384];
const datosDe = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + n) & 0xff);

const SCRIPT = `import { FrameSealer, FrameOpener, deriveDeviceKey, sessionKeyV2 } from "./protocolo.mjs";
const k = deriveDeviceKey("ABCD-EFGH-JKMN-PQRS", "dev-1");
const ks = sessionKeyV2(k, Buffer.alloc(16, 1), Buffer.alloc(16, 2));
const tramas = [];
for (const dir of [1, 2]) {
  const sealer = new FrameSealer(ks, dir, 2);
  const opener = new FrameOpener(ks, dir, 2);
  for (const n of ${JSON.stringify(TAMANOS)}) {
    const datos = Uint8Array.from({ length: n }, (_, i) => (i * 7 + n) & 0xff);
    const sellada = sealer.seal(1, datos);
    const abierta = opener.open(1, sellada);
    tramas.push({ dir, n, ok: Buffer.compare(Buffer.from(abierta), Buffer.from(datos)) === 0, sellada: Buffer.from(sellada).toString("hex") });
  }
}
console.log(JSON.stringify({ tramas }));
`;

conElectron("protocolo v2 dentro de Electron como Node", () => {
  it("sella y abre tramas de 0 a 16 KB en las dos direcciones, con los mismos bytes que en Node", async () => {
    // el protocolo (TypeScript) empaquetado a un solo archivo, y un script que sella y abre dentro de Electron
    await build({
      entryPoints: [resolve(raiz, "packages", "protocol", "src", "index.ts")],
      outfile: join(tmp, "protocolo.mjs"),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      logLevel: "silent",
    });
    const script = join(tmp, "ida-y-vuelta.mjs");
    writeFileSync(script, SCRIPT);
    const salida = correrComoNode(script).trim().split("\n").pop()!;
    const r = JSON.parse(salida) as { tramas: { dir: number; n: number; ok: boolean; sellada: string }[] };
    expect(r.tramas.length).toBe(TAMANOS.length * 2);
    for (const t of r.tramas) expect(t.ok, `trama de ${t.n} bytes (dir ${t.dir})`).toBe(true);

    // mismos bytes sellados que en este Node: la implementación es la misma en los dos runtimes
    const ks = sessionKeyV2(deriveDeviceKey("ABCD-EFGH-JKMN-PQRS", "dev-1"), Buffer.alloc(16, 1), Buffer.alloc(16, 2));
    for (const dir of [1, 2] as const) {
      const sealer = new FrameSealer(ks, dir, 2);
      for (const n of TAMANOS) {
        const esperada = Buffer.from(sealer.seal(1, datosDe(n))).toString("hex");
        expect(r.tramas.find((t) => t.dir === dir && t.n === n)!.sellada).toBe(esperada);
      }
    }
  }, 30000); // lanza Electron como Node: con la suite completa en paralelo puede pasar de los 5 s por defecto
});

conElectron("puente empaquetado dentro de Electron como Node", () => {
  let hijo: ChildProcess | undefined;
  let salida = "";
  afterAll(() => {
    if (hijo && hijo.exitCode === null) hijo.kill();
  });

  it("arranca, empareja una FakeConsole v2 y le entrega una vista", async () => {
    // el mismo empaquetado que va dentro de Cronio
    execFileSync(process.execPath, [join(aqui, "..", "scripts", "bundle-bridge.mjs")], { stdio: "ignore", timeout: 120_000 });
    const bundle = join(aqui, "..", "build", "bridge", "cli.mjs");
    expect(existsSync(bundle)).toBe(true);

    const [api, consola, ws, udp] = [await puertoLibre(), await puertoLibre(), await puertoLibre(), await puertoLibre()];
    const datos = join(tmp, "datos");
    const config = join(tmp, "config");
    mkdirSync(datos, { recursive: true });
    mkdirSync(config, { recursive: true });
    hijo = spawn(
      electron!,
      [bundle, "start", "--data-dir", datos, "--api-port", String(api), "--console-port", String(consola), "--ws-port", String(ws), "--udp-port", String(udp)],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", AGENT_COMPANION_CONFIG_DIR: config, COMPANION_SIMULATOR: "0", COMPANION_STARTED_BY: "manual" },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    hijo.stdout?.on("data", (t: Buffer) => (salida += t.toString()));
    hijo.stderr?.on("data", (t: Buffer) => (salida += t.toString()));

    const base = `http://127.0.0.1:${api}`;
    const limite = Date.now() + 30_000;
    for (;;) {
      if (hijo.exitCode !== null) throw new Error(`el puente terminó antes de responder:\n${salida}`);
      try {
        if ((await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) })).ok) break;
      } catch {
        // todavía no
      }
      if (Date.now() > limite) throw new Error(`el puente no respondió en 30 s:\n${salida}`);
      await new Promise((r) => setTimeout(r, 200));
    }

    const token = readFileSync(join(datos, "api-token"), "utf8").trim();
    const cabeceras = { "x-cronio-token": token };
    const { code } = (await (await fetch(`${base}/pair`, { method: "POST", headers: cabeceras })).json()) as { code: string };
    const con = await FakeConsole.connect({ port: consola, deviceId: "3ds-electron", code });
    try {
      const fin = Date.now() + 10_000;
      while (con.views.length === 0 && !con.closed && Date.now() < fin) await new Promise((r) => setTimeout(r, 50));
      expect(con.closed, `la conexión se cerró; registro del puente:\n${salida}`).toBe(false);
      expect(con.views.length).toBeGreaterThan(0);
      // una trama de vuelta, sellada en el puente, también se abre: ping/pong
      con.ping(new Uint8Array([1, 2, 3]));
      const fin2 = Date.now() + 5000;
      while (con.pongs.length === 0 && Date.now() < fin2) await new Promise((r) => setTimeout(r, 20));
      expect(con.pongs.length, `sin pong; registro del puente:\n${salida}`).toBeGreaterThan(0);
      expect(salida).not.toMatch(/Unknown cipher|trama o mensaje inválido|error en una conexión/);
    } finally {
      con.close();
      await fetch(`${base}/shutdown`, { method: "POST", headers: { ...cabeceras, "x-cronio": "shutdown" } }).catch(() => undefined);
      await new Promise<void>((ok) => {
        if (hijo!.exitCode !== null) return ok();
        hijo!.once("exit", () => ok());
        setTimeout(() => ok(), 5000);
      });
    }
  }, 120_000);
});

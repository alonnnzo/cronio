import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ciaSourceFromEnv, loadCia, readCiaVersion, startCiaServer, updateFor, versionFileOf, type CiaServer } from "../src/update.ts";
import { startTestBridge, waitFor, type TestBridge } from "./helpers.ts";

let dir: string;
let servidor: CiaServer | undefined;
let bridge: TestBridge | undefined;
const contenido = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "companion-update-"));
});
afterEach(async () => {
  await servidor?.close();
  await bridge?.cleanup();
  servidor = bridge = undefined;
  rmSync(dir, { recursive: true, force: true });
});

function crearCia(version?: string): string {
  const cia = join(dir, "agent-companion.cia");
  writeFileSync(cia, contenido);
  if (version !== undefined) writeFileSync(join(dir, "agent-companion.version"), version);
  return cia;
}

describe("versión del .cia", () => {
  it("el .version está al lado, con el mismo nombre", () => {
    expect(versionFileOf(join("x", "y", "agent-companion.cia"))).toBe(join("x", "y", "agent-companion.version"));
  });
  it("se lee y se normaliza a tres partes; sin archivo o con basura no hay versión", () => {
    expect(readCiaVersion(crearCia("0.3.0\n"))).toBe("0.3.0");
    expect(readCiaVersion(crearCia("0.3"))).toBe("0.3.0");
    expect(readCiaVersion(crearCia("basura"))).toBeUndefined();
    expect(readCiaVersion(join(dir, "otro.cia"))).toBeUndefined();
  });
  it("la ruta viene de COMPANION_CIA_PATH; sin ella el puente no sabe de ningún .cia", () => {
    const cia = crearCia("0.3.0");
    expect(ciaSourceFromEnv({ COMPANION_CIA_PATH: cia })).toEqual({ path: cia, version: "0.3.0" });
    expect(ciaSourceFromEnv({})).toBeUndefined();
  });
});

describe("loadCia", () => {
  it("lee el .cia a memoria con su tamaño y su sha256", () => {
    const f = loadCia(crearCia())!;
    expect(f.size).toBe(8);
    expect(f.bytes).toEqual(contenido);
    expect(f.sha256).toBe(sha(contenido));
  });
  it("recarga si el archivo cambia (tamaño o mtime) y reutiliza la memoria si no", () => {
    const cia = crearCia();
    const a = loadCia(cia)!;
    expect(loadCia(cia)).toBe(a);
    const nuevo = Buffer.from([9, 9, 9, 9, 9, 9, 9, 9]); // mismo tamaño: solo cambia el mtime
    writeFileSync(cia, nuevo);
    utimesSync(cia, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    const b = loadCia(cia)!;
    expect(b.sha256).toBe(sha(nuevo));
    writeFileSync(cia, Buffer.alloc(100, 7));
    expect(loadCia(cia)!.size).toBe(100);
  });
  it("sin archivo, vacío o de más de 8 MiB no hay nada que ofrecer", () => {
    expect(loadCia(join(dir, "no.cia"))).toBeUndefined();
    const vacio = join(dir, "vacio.cia");
    writeFileSync(vacio, Buffer.alloc(0));
    expect(loadCia(vacio)).toBeUndefined();
    const grande = join(dir, "grande.cia");
    writeFileSync(grande, Buffer.alloc(8 * 1024 * 1024 + 1));
    expect(loadCia(grande)).toBeUndefined();
  });
});

describe("updateFor", () => {
  const fuente = { path: "x.cia", version: "0.3.0" };
  beforeEach(() => {
    fuente.path = crearCia();
  });
  it("avisa solo a una versión menor, con la IP por la que llegó la consola, el tamaño y el sha256", () => {
    const hash = sha(contenido);
    expect(updateFor(fuente, "0.2.0", "192.168.0.20")).toEqual({ version: "0.3.0", url: "http://192.168.0.20:33337/agent-companion.cia", size: 8, sha256: hash });
    expect(updateFor(fuente, "0.2.0", "10.0.0.7", 40000)).toEqual({ version: "0.3.0", url: "http://10.0.0.7:40000/agent-companion.cia", size: 8, sha256: hash });
    expect(updateFor(fuente, "0.3.0", "192.168.0.20")).toBeUndefined();
    expect(updateFor(fuente, "0.4.0", "192.168.0.20")).toBeUndefined();
  });
  it("sin versión de la consola, sin versión del .cia, sin .cia o sin IP no hay aviso", () => {
    expect(updateFor(fuente, undefined, "192.168.0.20")).toBeUndefined();
    expect(updateFor(fuente, "basura", "192.168.0.20")).toBeUndefined();
    expect(updateFor({ path: "x.cia" }, "0.2.0", "192.168.0.20")).toBeUndefined();
    expect(updateFor(undefined, "0.2.0", "192.168.0.20")).toBeUndefined();
    expect(updateFor(fuente, "0.2.0", undefined)).toBeUndefined();
    // el .cia no se puede leer: sin tamaño ni hash no se ofrece
    expect(updateFor({ path: join(dir, "no-existe.cia"), version: "0.3.0" }, "0.2.0", "192.168.0.20")).toBeUndefined();
  });
});

describe("servidor del .cia del puente", () => {
  it("entrega el archivo con content-length (GET) y solo los encabezados (HEAD)", async () => {
    servidor = await startCiaServer({ path: crearCia() }, 0, "127.0.0.1");
    const url = `http://127.0.0.1:${servidor.port}/agent-companion.cia`;
    const r = await fetch(url);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/octet-stream");
    expect(r.headers.get("content-length")).toBe("8");
    expect(Buffer.from(await r.arrayBuffer())).toEqual(contenido);
    const h = await fetch(url, { method: "HEAD" });
    expect(h.status).toBe(200);
    expect(h.headers.get("content-length")).toBe("8");
    expect((await h.arrayBuffer()).byteLength).toBe(0);
  });
  it("solo esa ruta y solo GET/HEAD", async () => {
    servidor = await startCiaServer({ path: crearCia() }, 0, "127.0.0.1");
    const base = `http://127.0.0.1:${servidor.port}`;
    expect((await fetch(`${base}/otra`)).status).toBe(404);
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/agent-companion.cia/../x`)).status).toBe(404);
    const post = await fetch(`${base}/agent-companion.cia`, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
    expect((await fetch(`${base}/agent-companion.cia`, { method: "DELETE" })).status).toBe(405);
  });
  it("si el .cia desaparece responde 404", async () => {
    servidor = await startCiaServer({ path: join(dir, "no-existe.cia") }, 0, "127.0.0.1");
    expect((await fetch(`http://127.0.0.1:${servidor.port}/agent-companion.cia`)).status).toBe(404);
  });
});

describe("el puente avisa a la consola con una versión menor", () => {
  it("manda update con la IP del socket; sin versión, igual o mayor no manda nada", async () => {
    bridge = await startTestBridge({ cia: { path: crearCia("0.3.0"), version: "0.3.0" } });
    const url = `http://127.0.0.1:${bridge.ports.cia}/agent-companion.cia`;
    const vieja = await bridge.console("3ds-vieja", undefined, { appVersion: "0.2.0", install: "cia" });
    await waitFor(() => vieja.views.length > 0);
    expect(vieja.views.at(-1)!.view.update).toEqual({ version: "0.3.0", url, size: 8, sha256: sha(contenido) });
    vieja.close();
    for (const [id, hello] of [
      ["3ds-sin", {}],
      ["3ds-igual", { appVersion: "0.3.0", install: "cia" }],
      ["3ds-nueva", { appVersion: "0.4.0", install: "3dsx" }],
      ["3ds-basura", { appVersion: { x: 1 }, install: 5, protocolVersion: 1 }], // en la v2 una versión así ni siquiera pasa el saludo (ver hardening-v2)
      ["3ds-texto", { appVersion: "no es versión", protocolVersion: 1 }],
    ] as const) {
      const c = await bridge.console(id, undefined, hello);
      await waitFor(() => c.views.length > 0);
      expect(c.views.at(-1)!.view.update, id).toBeUndefined();
      c.close();
    }
  });
  it("una consola .3dsx con versión menor también recibe el dato (la tarjeta le explica)", async () => {
    bridge = await startTestBridge({ cia: { path: crearCia("0.3.0"), version: "0.3.0" } });
    const c = await bridge.console("3ds-hb", undefined, { appVersion: "0.2.0", install: "3dsx" });
    await waitFor(() => c.views.length > 0);
    expect(c.views.at(-1)!.view.update?.version).toBe("0.3.0");
  });
  it("el update sigue en las vistas siguientes de esa consola", async () => {
    bridge = await startTestBridge({ cia: { path: crearCia("0.3.0"), version: "0.3.0" } });
    const c = await bridge.console("3ds-vieja", undefined, { appVersion: "0.2.0", install: "cia" });
    await waitFor(() => c.views.length > 0);
    const antes = c.views.length;
    await bridge.api("/event", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session_id: "s1", event: "start", title: "T" }) });
    await waitFor(() => c.views.length > antes);
    expect(c.views.at(-1)!.view.update?.version).toBe("0.3.0");
  });
  it("/health dice si el puente sirve el .cia y en qué versión", async () => {
    bridge = await startTestBridge({ cia: { path: crearCia("0.3.0"), version: "0.3.0" } });
    const salud = (await (await bridge.api("/health")).json()) as { cia: unknown };
    expect(salud.cia).toEqual({ serving: true, port: bridge.ports.cia, version: "0.3.0" });
    expect(Number(bridge.ports.cia)).toBeGreaterThan(0);
    const r = await fetch(`http://127.0.0.1:${bridge.ports.cia}/agent-companion.cia`);
    expect(r.status).toBe(200);
  });
  it("sin .cia (o con la ruta rota) no se sirve nada y /health lo dice", async () => {
    bridge = await startTestBridge({ cia: { path: join(dir, "no-existe.cia"), version: "0.3.0" } });
    expect(bridge.ports.cia).toBeUndefined();
    const salud = (await (await bridge.api("/health")).json()) as { cia: unknown };
    expect(salud.cia).toEqual({ serving: false });
  });
  it("si el puerto del .cia está ocupado el puente arranca igual sin servirlo", async () => {
    servidor = await startCiaServer({ path: crearCia("0.3.0") }, 0, "127.0.0.1");
    bridge = await startTestBridge({ cia: { path: join(dir, "agent-companion.cia"), version: "0.3.0" }, ciaPort: servidor.port });
    const salud = (await (await bridge.api("/health")).json()) as { cia: unknown };
    expect(salud.cia).toEqual({ serving: false });
  });
});

describe("el puerto del .cia ocupado", () => {
  it("el puente arranca sin servirlo, lo reintenta y cuando se libera sirve y avisa a la consola", async () => {
    const { createServer } = await import("node:net");
    const ocupante = createServer();
    await new Promise<void>((ok) => ocupante.listen(0, "127.0.0.1", ok));
    const puerto = (ocupante.address() as { port: number }).port;
    bridge = await startTestBridge({ cia: { path: crearCia("0.3.0"), version: "0.3.0" }, ciaPort: puerto, ciaRetryMs: 40 });
    try {
      expect(bridge.ports.cia).toBeUndefined();
      expect(await (await bridge.api("/health")).json()).toMatchObject({ cia: { serving: false } });
      await new Promise<void>((ok) => ocupante.close(() => ok()));
      await waitFor(() => bridge!.ports.cia === puerto, 3000, "el puente toma el puerto del .cia");
      expect(await (await bridge.api("/health")).json()).toMatchObject({ cia: { serving: true, port: puerto, version: "0.3.0" } });
      const c = await bridge.console("3ds-vieja", undefined, { appVersion: "0.2.0", install: "cia" });
      await waitFor(() => c.views.length > 0);
      expect(c.views.at(-1)!.view.update?.version).toBe("0.3.0");
    } finally {
      if (ocupante.listening) ocupante.close();
    }
  });
});

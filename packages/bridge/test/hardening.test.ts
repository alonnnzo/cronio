// Endurecimiento del puente (auditoría 2026-11-17, punto 2): id de dispositivo estricto, registros con datos de la red saneados y con
// límite de ritmo, y cupos de conexión que no dejan a las sin autenticar ocupar todas las plazas.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FrameType, encodeFrame } from "@companion/protocol";
import { MAX_UNAUTHENTICATED, MAX_UNAUTHENTICATED_PER_IP, safeLog } from "../src/console-server.ts";
import { EventLog } from "../src/events.ts";
import { FakeConsole } from "./fake-console.ts";
import { startTestBridge, waitFor, type TestBridge } from "./helpers.ts";

let bridge: TestBridge | undefined;
const sockets: Socket[] = [];
let tmp: string | undefined;
afterEach(async () => {
  for (const s of sockets.splice(0)) s.destroy();
  await bridge?.cleanup();
  bridge = undefined;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

interface Raw {
  s: Socket;
  state: { closed: boolean; challenge: boolean };
}

/** Conexión cruda desde la IP de origen `from`; espera el desafío o el cierre. */
async function rawConnect(port: number, from = "127.0.0.1"): Promise<Raw> {
  const s = connect({ port, host: "127.0.0.1", localAddress: from });
  sockets.push(s);
  s.on("error", () => {});
  const state = { closed: false, challenge: false };
  s.on("data", () => (state.challenge = true));
  s.on("close", () => (state.closed = true));
  await waitFor(() => state.challenge || state.closed, 2000, "desafío o cierre");
  return { s, state };
}

const hello = (deviceId: unknown) =>
  encodeFrame(FrameType.JSON, Buffer.from(JSON.stringify({ t: "hello", v: 1, deviceId, nonceC: "ab".repeat(16), mac: "cd".repeat(32) })));

describe("deviceId del saludo", () => {
  it("solo letras, números, _ y -, de 1 a 64: lo demás cierra la conexión sin llegar a los registros ni a los archivos", async () => {
    const logs: string[] = [];
    bridge = await startTestBridge({ log: (m) => logs.push(m) });
    for (const mal of ["a b", "x\ny", "../etc", "id:con:dos", "a.b", "", "ñ", "x".repeat(65), "<script>", "a\u0000b", 5, null]) {
      const r = await rawConnect(bridge.ports.console);
      r.s.write(hello(mal));
      await waitFor(() => r.state.closed, 2000, `cierre por ${JSON.stringify(mal)}`);
    }
    // ni uno de esos ids llegó a un `saludo rechazado` (se descartan al validar el esquema) ni a la lista de dispositivos
    expect(logs.filter((l) => l.includes("saludo rechazado"))).toEqual([]);
    expect(bridge.devices.list()).toEqual([]);
  });

  it("un id válido (la consola genera 3ds- y 8 hex) se empareja como siempre", async () => {
    bridge = await startTestBridge();
    for (const ok of ["3ds-0a1b2c3d", "A_b-9", "x".repeat(64)]) {
      const c = await bridge.console(ok);
      expect(c.closed).toBe(false);
    }
  });
});

describe("registros con datos de la red", () => {
  it("safeLog escapa los saltos de línea y comillas y corta lo largo", () => {
    expect(safeLog("a\nb")).toBe('"a\\nb"');
    expect(safeLog('x"y')).toBe('"x\\"y"');
    expect(safeLog("a\u001b[31mrojo")).not.toContain("\u001b");
    expect(safeLog("z".repeat(500)).length).toBeLessThanOrEqual(82);
    expect(safeLog(undefined)).toBe('"undefined"');
  });

  it("el motivo de cierre de una consola autenticada va escapado y en una sola línea", async () => {
    const logs: string[] = [];
    bridge = await startTestBridge({ log: (m) => logs.push(m) });
    const con = await bridge.console();
    // un JSON roto con salto de línea y una línea falsa: el mensaje de JSON.parse puede citar un trozo de lo recibido
    con.sendSealed(FrameType.JSON, Buffer.from("abc\n[FALSO] consola conectada: intruso"));
    await waitFor(() => con.closed, 2000, "cierre por mensaje inválido");
    await waitFor(() => logs.some((l) => l.includes("consola desconectada")));
    const linea = logs.find((l) => l.includes("consola desconectada"))!;
    expect(linea).not.toMatch(/[\r\n]/);
    expect(linea).toContain("trama o mensaje inválido");
    expect(linea).toContain('"3ds-test"');
  });
});

describe("excepciones al procesar una conexión", () => {
  it("una consola autenticada con una trama inválida deja el error en el registro al instante y el puente sigue sirviendo", async () => {
    const logs: string[] = [];
    bridge = await startTestBridge({ log: (m) => logs.push(m) });
    const mala = await bridge.console("3ds-mala");
    mala.sendSealed(FrameType.JSON, Buffer.from("{no es json"));
    await waitFor(() => mala.closed, 2000, "cierre de la conexión con el error");
    const linea = logs.find((l) => l.includes("error en una conexión de consola"));
    expect(linea).toBeDefined();
    expect(linea).toContain('"3ds-mala"');
    expect(linea).toContain("trama o mensaje inválido");
    expect(linea).not.toMatch(/[\r\n]/);
    // el puente sigue sirviendo: una consola nueva se conecta y recibe su vista
    const buena = await bridge.console("3ds-buena");
    expect(buena.closed).toBe(false);
  });

  it("un saludo roto (antes de autenticar) también queda en el registro, con la IP y sin saltos de línea", async () => {
    const logs: string[] = [];
    bridge = await startTestBridge({ log: (m) => logs.push(m) });
    const r = await rawConnect(bridge.ports.console);
    r.s.write(encodeFrame(FrameType.JSON, Buffer.from("{roto\n[FALSO] consola conectada: intruso")));
    await waitFor(() => r.state.closed, 2000, "cierre por saludo roto");
    const linea = logs.find((l) => l.includes("error en una conexión de consola"));
    expect(linea).toBeDefined();
    expect(linea).toContain("sin autenticar");
    expect(linea).not.toMatch(/[\r\n]/);
  });
});

describe("saludos rechazados", () => {
  it("se registran como mucho una vez por IP cada 10 s", async () => {
    const logs: string[] = [];
    bridge = await startTestBridge({ log: (m) => logs.push(m) });
    for (let i = 0; i < 6; i++) {
      // sin código de emparejamiento vigente y con un dispositivo desconocido: rechazo
      await expect(FakeConsole.connect({ port: bridge.ports.console, deviceId: "3ds-intruso", code: "AAAA-BBBB" })).rejects.toThrow();
    }
    expect(logs.filter((l) => l.includes("saludo rechazado"))).toHaveLength(1);
    expect(logs.find((l) => l.includes("saludo rechazado"))).toContain('"3ds-intruso"');
  });

  it("otra IP tiene su propio turno", async () => {
    const logs: string[] = [];
    bridge = await startTestBridge({ log: (m) => logs.push(m) });
    const rechazo = async (from: string) => {
      const s = await rawConnect(bridge!.ports.console, from);
      s.s.write(hello("3ds-intruso"));
      await waitFor(() => s.state.closed);
    };
    await rechazo("127.0.0.1");
    await rechazo("127.0.0.1");
    await rechazo("127.0.0.2");
    expect(logs.filter((l) => l.includes("saludo rechazado"))).toHaveLength(2);
  });
});

describe("cupos de conexión", () => {
  it("las sin autenticar tienen tope total; una nueva desplaza a la más antigua y la autenticada nunca se toca", async () => {
    bridge = await startTestBridge();
    const port = bridge.ports.console;
    const con = await bridge.console(); // autenticada
    expect(MAX_UNAUTHENTICATED).toBe(8);
    expect(MAX_UNAUTHENTICATED_PER_IP).toBe(4);
    // dos IPs de origen: 4 + 4 = el tope total de sin autenticar
    const a: Raw[] = [];
    for (const from of ["127.0.0.2", "127.0.0.3"]) for (let i = 0; i < 4; i++) a.push(await rawConnect(port, from));
    expect(a.every((r) => r.state.challenge && !r.state.closed)).toBe(true);
    // una novena, de una tercera IP: entra y se lleva a la más antigua
    const novena = await rawConnect(port, "127.0.0.4");
    expect(novena.state.challenge).toBe(true);
    await waitFor(() => a[0]!.state.closed, 2000, "la más antigua sin autenticar se cierra");
    expect(a.slice(1).every((r) => !r.state.closed)).toBe(true);
    // la consola autenticada sigue ahí y sigue recibiendo vistas
    expect(con.closed).toBe(false);
    const antes = con.views.length;
    await bridge.api("/event", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session_id: "s1", event: "start", title: "T" }) });
    await waitFor(() => con.views.length > antes);
  });

  it("con las plazas sin autenticar llenas por IPs distintas una consola real todavía conecta", async () => {
    bridge = await startTestBridge();
    const port = bridge.ports.console;
    const code = await bridge.pairCode();
    for (const from of ["127.0.0.2", "127.0.0.3"]) for (let i = 0; i < 4; i++) await rawConnect(port, from);
    const con = await FakeConsole.connect({ port, deviceId: "3ds-real", code });
    expect(con.closed).toBe(false);
  });
});

describe("rotación de events.jsonl", () => {
  it("al pasar del tamaño renombra a .1 y reemplaza el anterior", () => {
    tmp = mkdtempSync(join(tmpdir(), "bridge-rot-"));
    const path = join(tmp, "events.jsonl");
    const log = new EventLog(path, 300);
    const lineas = () => readFileSync(path, "utf8").trim().split("\n");
    for (let i = 0; i < 8; i++) log.log("state", { i });
    expect(existsSync(`${path}.1`)).toBe(true);
    // el archivo actual nunca pasa mucho del tope y no se pierde la continuidad: lo último escrito está en el actual
    expect(readFileSync(path, "utf8").length).toBeLessThan(300 + 100);
    expect(JSON.parse(lineas().at(-1)!).i).toBe(7);
    const primera = readFileSync(`${path}.1`, "utf8");
    for (let i = 8; i < 60; i++) log.log("state", { i });
    // el .1 se reemplazó (no crece sin fin ni conserva lo primero)
    const ahora = readFileSync(`${path}.1`, "utf8");
    expect(ahora).not.toBe(primera);
    expect(ahora.length).toBeLessThan(300 + 100);
    expect(existsSync(`${path}.2`)).toBe(false);
  });

  it("mide el archivo que ya había al arrancar", () => {
    tmp = mkdtempSync(join(tmpdir(), "bridge-rot-"));
    const path = join(tmp, "events.jsonl");
    writeFileSync(path, "x".repeat(500) + "\n");
    new EventLog(path, 300).log("state");
    expect(readFileSync(`${path}.1`, "utf8").startsWith("xxxx")).toBe(true);
    expect(readFileSync(path, "utf8")).toContain('"type":"state"');
  });
});

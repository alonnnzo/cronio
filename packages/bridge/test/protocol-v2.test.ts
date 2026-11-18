// Protocolo v2 (tráfico cifrado, ChaCha20 + encrypt-then-MAC) y modo «solo actualizar» para consolas v1 (sin cifrado).
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FrameDecoder,
  FrameType,
  deriveDeviceKey,
  encodeFrame,
  helloMac,
  helloMacV2,
  parseBridgeMessage,
} from "@companion/protocol";
import { LEGACY_FACE_LINES } from "../src/legacy-view.ts";
import { FakeConsole } from "./fake-console.ts";
import { permissionBody, postJson, startTestBridge, waitFor, type TestBridge } from "./helpers.ts";

let bridge: TestBridge | undefined;
let tmp: string | undefined;
const sockets: Socket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.destroy();
  await bridge?.cleanup();
  bridge = undefined;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

const decisionOf = async (res: Promise<Response>) => ((await res).json() as Promise<{ decision: string }>).then((j) => j.decision);

const contenido = Buffer.from("cia de prueba");
function crearCia(version: string): string {
  tmp = mkdtempSync(join(tmpdir(), "companion-v2-"));
  const path = join(tmp, "agent-companion.cia");
  writeFileSync(path, contenido);
  writeFileSync(join(tmp, "agent-companion.version"), version);
  return path;
}

describe("v2: el tráfico va cifrado", () => {
  it("el saludo y las decisiones funcionan como siempre y por el cable no se lee nada del contenido", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    await waitFor(() => con.views.length > 0);
    const pending = decisionOf(postJson("/permission", permissionBody("rm -rf secreto-del-usuario"), bridge));
    await waitFor(() => con.lastView?.request != null);
    expect(con.lastView!.request!.lines.join(" ")).toContain("secreto-del-usuario");
    con.send({ t: "decision", requestId: con.lastView!.request!.id, decision: "allow" });
    expect(await pending).toBe("allow");

    // las tramas tal como llegaron al cliente: ni el JSON ni lo que dicen se leen
    expect(con.sealedFrames.length).toBeGreaterThan(1);
    for (const f of con.sealedFrames) {
      const text = Buffer.from(f).toString("latin1");
      expect(text).not.toContain("secreto-del-usuario");
      expect(text).not.toContain("sessions");
      expect(text).not.toContain('"t":');
    }
  });

  it("una trama alterada (un bit del texto cifrado, o de la etiqueta) cierra la conexión y no se aplica", async () => {
    for (const donde of ["cifrado", "etiqueta"] as const) {
      bridge = await startTestBridge();
      const con = await bridge.console();
      const pending = decisionOf(postJson("/permission", permissionBody(), bridge));
      await waitFor(() => con.lastView?.request != null);
      const id = con.lastView!.request!.id;
      const sealer = (con as unknown as { sealer: { seal(t: number, p: Uint8Array): Uint8Array } }).sealer;
      // se sella a mano y se altera antes de enviar: el puente nunca debe aplicar la decisión
      const sealed = sealer.seal(FrameType.JSON, Buffer.from(JSON.stringify({ t: "decision", requestId: id, decision: "allow" })));
      sealed[donde === "cifrado" ? 3 : sealed.length - 1]! ^= 1;
      con.sendRaw(encodeFrame(FrameType.JSON, sealed));
      await waitFor(() => con.closed, 2000, `cierre por alterar ${donde}`);
      // al caer la consola la solicitud vuelve al PC (`ask`): la decisión alterada nunca se aplicó
      expect(await pending).toBe("ask");
      await bridge.cleanup();
      bridge = undefined;
    }
  });

  it("una trama repetida (contador) cierra la conexión", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    await waitFor(() => con.views.length > 0);
    const bytes = con.send({ t: "skip" });
    con.sendRaw(bytes); // la misma, con el contador ya usado
    await waitFor(() => con.closed, 2000, "cierre por repetición");
  });

  it("un ping sellado se contesta con un pong cifrado con su propio contador", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    con.ping(Buffer.from("hola"));
    await waitFor(() => con.pongs.length === 1);
    expect(Buffer.from(con.pongs[0]!).toString()).toBe("hola");
  });
});

// ---- saludo a mano, para alterar campos ----

interface HelloOpts {
  deviceId: string;
  k: Buffer;
  /** `v` que sale en el hello. */
  helloV: number;
  /** Versión con la que se calcula el MAC. */
  macV: 1 | 2;
  appVersion?: string;
  install?: string;
  /** Lo que cubre el MAC (por defecto, lo mismo que se manda). */
  macAppVersion?: string;
  macInstall?: "cia" | "3dsx";
}

async function rawHello(port: number, o: HelloOpts): Promise<{ reply: { t: string; code?: string }; closed: () => boolean }> {
  const s = connect({ port, host: "127.0.0.1" });
  sockets.push(s);
  s.on("error", () => {});
  let isClosed = false;
  s.on("close", () => (isClosed = true));
  const dec = new FrameDecoder();
  const msgs: { t: string; nonceB?: string; code?: string }[] = [];
  s.on("data", (c: Buffer) => {
    for (const f of dec.push(c)) {
      if (msgs.length < 2) msgs.push(JSON.parse(Buffer.from(f.payload).toString("utf8")));
    }
  });
  await waitFor(() => msgs.length >= 1, 2000, "challenge");
  const nonceB = Buffer.from(msgs[0]!.nonceB!, "hex");
  const nonceC = Buffer.alloc(16, 9);
  const mac =
    o.macV === 2
      ? helloMacV2(o.k, nonceB, nonceC, o.deviceId, o.macAppVersion ?? o.appVersion, o.macInstall ?? (o.install as "cia" | "3dsx" | undefined))
      : helloMac(o.k, nonceB, nonceC);
  s.write(
    encodeFrame(
      FrameType.JSON,
      Buffer.from(
        JSON.stringify({
          t: "hello",
          v: o.helloV,
          deviceId: o.deviceId,
          nonceC: nonceC.toString("hex"),
          mac: mac.toString("hex"),
          ...(o.appVersion !== undefined ? { appVersion: o.appVersion } : {}),
          ...(o.install !== undefined ? { install: o.install } : {}),
        }),
      ),
    ),
  );
  await waitFor(() => msgs.length >= 2 || isClosed, 2000, "respuesta al hello");
  return { reply: msgs[1] ?? { t: "cerrada" }, closed: () => isClosed };
}

describe("v2: la versión negociada y los campos del saludo van autenticados", () => {
  async function paired() {
    bridge = await startTestBridge();
    const code = await bridge.pairCode();
    (await bridge.console("3ds-hs", code)).close();
    return { port: bridge.ports.console, k: deriveDeviceKey(code, "3ds-hs"), deviceId: "3ds-hs" };
  }

  it("un hello v2 bien firmado, con appVersion e install, recibe el welcome", async () => {
    const p = await paired();
    const r = await rawHello(p.port, { ...p, helloV: 2, macV: 2, appVersion: "0.3.0", install: "cia" });
    expect(r.reply.t).toBe("welcome");
  });

  it("forzar la v1: un hello v2 con la versión cambiada a 1 falla (el MAC era de la v2)", async () => {
    const p = await paired();
    const r = await rawHello(p.port, { ...p, helloV: 1, macV: 2, appVersion: "0.3.0", install: "cia" });
    expect(r.reply).toEqual({ t: "error", code: "auth" });
  });

  it("subir la versión: un hello v1 con la versión cambiada a 2 falla", async () => {
    const p = await paired();
    const r = await rawHello(p.port, { ...p, helloV: 2, macV: 1 });
    expect(r.reply).toEqual({ t: "error", code: "auth" });
  });

  it("alterar appVersion o install en el camino falla", async () => {
    const p = await paired();
    const a = await rawHello(p.port, { ...p, helloV: 2, macV: 2, appVersion: "9.9.9", install: "cia", macAppVersion: "0.2.0" });
    expect(a.reply).toEqual({ t: "error", code: "auth" });
    const b = await rawHello(p.port, { ...p, helloV: 2, macV: 2, appVersion: "0.2.0", install: "3dsx", macInstall: "cia" });
    expect(b.reply).toEqual({ t: "error", code: "auth" });
    // quitar el campo también cambia lo firmado
    const c = await rawHello(p.port, { ...p, helloV: 2, macV: 2, install: undefined, macInstall: "cia" });
    expect(c.reply).toEqual({ t: "error", code: "auth" });
  });

  it("en la v2 una appVersion o un install mal formados no pasan (cierre sin welcome)", async () => {
    const p = await paired();
    const a = await rawHello(p.port, { ...p, helloV: 2, macV: 2, appVersion: "no es versión" });
    expect(a.reply.t).toBe("cerrada");
    const b = await rawHello(p.port, { ...p, helloV: 2, macV: 2, install: "exe" });
    expect(b.reply.t).toBe("cerrada");
    const c = await rawHello(p.port, { ...p, helloV: 3, macV: 2 });
    expect(c.reply.t).toBe("cerrada");
  });

  it("un hello v1 bien firmado sigue recibiendo su welcome (queda en modo solo actualizar)", async () => {
    const p = await paired();
    const v1 = await rawHello(p.port, { ...p, helloV: 1, macV: 1 });
    expect(v1.reply.t).toBe("welcome");
  });
});

// ---- consola v1: solo actualizar ----

describe("consola v1 (sin cifrado): solo puede actualizarse", () => {
  it("recibe una vista mínima, sin sesiones ni solicitudes, con el aviso y la oferta de actualización", async () => {
    bridge = await startTestBridge({ cia: { path: crearCia("0.3.0"), version: "0.3.0" } });
    // hay actividad real que la consola v1 no debe ver
    await postJson("/event", { session_id: "s1", event: "start", title: "Trabajo privado" }, bridge);
    const old = await bridge.console("3ds-vieja", undefined, { appVersion: "0.2.9", install: "cia", protocolVersion: 1 });
    await waitFor(() => old.views.length > 0);
    const v = old.lastView!;
    expect(v.sessions).toEqual([]);
    expect(v.request).toBeNull();
    expect(v.detail).toBeNull();
    expect(v.notice).toBeUndefined();
    expect(v.settings).toBeUndefined();
    expect(v.pendingCount).toBe(0);
    expect(v.face.lines).toEqual([...LEGACY_FACE_LINES]);
    expect(v.update).toEqual({
      version: "0.3.0",
      url: `http://127.0.0.1:${bridge.ports.cia}/agent-companion.cia`,
      size: contenido.length,
      sha256: createHash("sha256").update(contenido).digest("hex"),
    });
    // la vista llega una sola vez, aunque pase de todo en el puente
    await postJson("/event", { session_id: "s2", event: "start", title: "Otra cosa" }, bridge);
    await new Promise((r) => setTimeout(r, 150));
    expect(old.views).toHaveLength(1);
    expect(JSON.stringify(old.views)).not.toContain("Trabajo privado");
  });

  it("no cuenta como consola conectada: un permiso se contesta en el PC, y nada de lo que mande se aplica", async () => {
    const logs: string[] = [];
    bridge = await startTestBridge({ cia: { path: crearCia("0.3.0"), version: "0.3.0" }, log: (m) => logs.push(m) });
    const old = await bridge.console("3ds-vieja", undefined, { appVersion: "0.2.9", install: "cia", protocolVersion: 1 });
    await waitFor(() => old.views.length > 0);
    expect(bridge.store.consoleConnected).toBe(false);

    // un permiso pendiente (con una consola de verdad conectada, para que quede en cola)
    const real = await bridge.console("3ds-real");
    const pending = decisionOf(postJson("/permission", permissionBody("rm -rf build"), bridge));
    await waitFor(() => real.lastView?.request != null);
    const id = real.lastView!.request!.id;

    old.send({ t: "decision", requestId: id, decision: "allow" });
    old.send({ t: "answer", requestId: id, pc: true });
    old.send({ t: "instruct", sessionId: "s1", text: "borra todo" });
    old.send({ t: "read", sessionId: "s1" });
    old.send({ t: "setting", key: "sound", value: false });
    old.send({ t: "focus", sessionId: "s1" });
    old.ping(Buffer.from("vivo"));
    await waitFor(() => old.pongs.length === 1);
    old.send({ t: "hold", seconds: 30 });
    old.ping(Buffer.from("vivo2"));
    await waitFor(() => old.pongs.length === 2);

    // sigue pendiente, no hubo respuesta a `read`, y los ajustes no cambiaron
    expect(bridge.store.pendingCount).toBe(1);
    expect(old.texts).toEqual([]);
    expect(old.closed).toBe(false);
    expect(real.lastView!.settings?.sound).not.toBe(false);
    expect(logs.filter((l) => l.includes("ignorado (solo puede actualizarse)")).map((l) => l.replace(/^.*: /, ""))).toEqual(
      ['"decision"', '"answer"', '"instruct"', '"read"', '"setting"', '"focus"'],
    );
    // la consola de verdad sí aprueba
    real.send({ t: "decision", requestId: id, decision: "allow" });
    expect(await pending).toBe("allow");
  });

  it("no reemplaza a la consola v2 conectada ni la desconecta", async () => {
    bridge = await startTestBridge();
    const real = await bridge.console("3ds-real");
    await waitFor(() => real.views.length > 0);
    const old = await bridge.console("3ds-vieja", undefined, { protocolVersion: 1 });
    await waitFor(() => old.views.length > 0);
    await new Promise((r) => setTimeout(r, 100));
    expect(real.closed).toBe(false);
    expect(bridge.store.consoleConnected).toBe(true);
    old.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(bridge.store.consoleConnected).toBe(true);
  });

  it("sin oferta de .cia sigue recibiendo la vista mínima (el aviso de la cara), sin update", async () => {
    bridge = await startTestBridge();
    const old = await bridge.console("3ds-vieja", undefined, { appVersion: "0.2.9", protocolVersion: 1 });
    await waitFor(() => old.views.length > 0);
    expect(old.lastView!.update).toBeUndefined();
    expect(old.lastView!.face.lines).toEqual([...LEGACY_FACE_LINES]);
  });

  it("un mensaje ilegible de una consola v1 cierra la conexión, como en la v2", async () => {
    bridge = await startTestBridge();
    const old = await bridge.console("3ds-vieja", undefined, { protocolVersion: 1 });
    await waitFor(() => old.views.length > 0);
    old.sendSealed(FrameType.JSON, Buffer.from("esto no es json"));
    await waitFor(() => old.closed, 2000, "cierre");
  });

  it("los mensajes del puente a una consola v1 pasan por su parser (forma de la vista mínima)", async () => {
    bridge = await startTestBridge({ cia: { path: crearCia("0.3.0"), version: "0.3.0" } });
    const old = await bridge.console("3ds-vieja", undefined, { appVersion: "0.2.9", install: "cia", protocolVersion: 1 });
    await waitFor(() => old.views.length > 0);
    // lo que salió por el cable (en claro + etiqueta) se valida con el esquema del protocolo
    const sealed = old.sealedFrames[0]!;
    const msg = parseBridgeMessage(JSON.parse(Buffer.from(sealed.subarray(3, sealed.length - 16)).toString("utf8")));
    expect(msg.t).toBe("view");
    void FakeConsole;
  });
});

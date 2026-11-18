import { afterEach, describe, expect, it } from "vitest";
import { FrameType } from "@companion/protocol";
import { permissionBody, postJson, startTestBridge, waitFor, type TestBridge } from "./helpers.ts";
import { FakeConsole } from "./fake-console.ts";
import { bridgeVersion } from "../src/version.ts";

let bridge: TestBridge;
afterEach(async () => {
  await bridge?.cleanup();
});

const decisionOf = async (res: Promise<Response>) => ((await res).json() as Promise<{ decision: string }>).then((j) => j.decision);

describe("integración: consola TCP + API de hooks", () => {
  it("emparejar, pedir permiso, ver la solicitud y aprobar -> allow", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    await waitFor(() => con.views.length > 0, 2000, "vista inicial");
    expect(bridge.store.consoleConnected).toBe(true);
    expect(bridge.devices.list().map((d) => d.deviceId)).toEqual(["3ds-test"]);

    const pending = decisionOf(postJson("/permission", permissionBody("rm -rf build"), bridge));
    await waitFor(() => con.lastView?.request != null, 2000, "solicitud en la vista");
    const req = con.lastView!.request!;
    expect(req.title).toBe("Claude pide permiso");
    expect(req.lines.join(" ")).toContain("rm -rf build");
    expect(req.risk).toBe("high");
    expect(con.lastView!.sessions[0]).toMatchObject({ id: "s1", project: "demo", state: "ask" });
    expect(req).toMatchObject({ sessionId: "s1", position: 1, total: 1 });
    expect(con.lastView!.pendingCount).toBe(1);

    con.send({ t: "decision", requestId: req.id, decision: "allow" });
    expect(await pending).toBe("allow");
    await waitFor(() => con.lastView?.request == null, 2000, "vista sin solicitud");
    expect(con.lastView!.sessions[0]!.state).toBe("working");
    expect(con.lastView!.pendingCount).toBe(0);
    // rev crece
    const revs = con.views.map((v) => v.rev);
    expect(revs).toEqual([...revs].sort((a, b) => a - b));
  });

  it("rechazo -> deny", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    const pending = decisionOf(postJson("/permission", permissionBody(), bridge));
    await waitFor(() => con.lastView?.request != null);
    con.send({ t: "decision", requestId: con.lastView!.request!.id, decision: "deny" });
    expect(await pending).toBe("deny");
  });

  it("plazo vencido -> ask", async () => {
    bridge = await startTestBridge({ requestTimeoutMs: 150 });
    await bridge.console();
    const t0 = Date.now();
    expect(await decisionOf(postJson("/permission", permissionBody(), bridge))).toBe("ask");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
  });

  it("sin plazo por defecto: la solicitud sigue en la cola y expiresInS vale 0", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    const pending = decisionOf(postJson("/permission", permissionBody(), bridge));
    await waitFor(() => con.lastView?.request != null);
    await new Promise((r) => setTimeout(r, 300));
    expect(bridge.store.pendingCount).toBe(1);
    expect(con.lastView!.request!.expiresInS).toBe(0);
    con.send({ t: "decision", requestId: con.lastView!.request!.id, decision: "allow" });
    expect(await pending).toBe("allow");
  });

  it("PostToolUse por /hook/claude retira la solicitud (HTTP recibe ask) y la cara avisa", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    const pending = decisionOf(postJson("/permission", permissionBody("ls -la"), bridge));
    await waitFor(() => con.lastView?.request != null);
    await postJson(
      "/hook/claude",
      { session_id: "s1", hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls -la" } },
      bridge,
    );
    expect(await pending).toBe("ask");
    await waitFor(() => con.lastView?.request == null, 2000, "solicitud retirada");
    expect(con.lastView!.face.lines[0]).toBe("Respondido en el PC");
  });

  it("/event con cancel_pending retira las solicitudes de la sesión", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    const pending = decisionOf(postJson("/permission", permissionBody(), bridge));
    await waitFor(() => con.lastView?.request != null);
    const res = await postJson("/event", { session_id: "s1", event: "working", cancel_pending: true }, bridge);
    expect(res.status).toBe(200);
    expect(await pending).toBe("ask");
    await waitFor(() => con.lastView?.request == null);
  });

  it("el aviso del hook que muere dura lo que dice faceNoticeMs", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    const ac = new AbortController();
    const p = postJson("/permission", permissionBody(), bridge, ac.signal).catch((e: Error) => e.name);
    await waitFor(() => con.lastView?.request != null);
    ac.abort();
    await p;
    await waitFor(() => con.lastView?.face.lines[0] === "Permiso retirado", 2000, "aviso");
  });

  it("sin consola -> ask inmediato", async () => {
    bridge = await startTestBridge();
    const t0 = Date.now();
    expect(await decisionOf(postJson("/permission", permissionBody(), bridge))).toBe("ask");
    expect(Date.now() - t0).toBeLessThan(1000);
    const health = (await (await bridge.api("/health")).json()) as Record<string, unknown>;
    expect(health).toEqual({ ok: true, console: false, device: false, simulator: false, pending: 0, cia: { serving: false }, version: bridgeVersion(), startedBy: "manual", pid: process.pid });
  });

  it("/health distingue la consola real (TCP) del simulador (WebSocket)", async () => {
    bridge = await startTestBridge();
    const health = async () => (await (await bridge.api("/health")).json()) as Record<string, unknown>;
    const con = await bridge.console();
    expect(await health()).toMatchObject({ console: true, device: true, simulator: false });
    con.close();
    for (let i = 0; i < 50 && (await health()).device === true; i++) await new Promise((r) => setTimeout(r, 20));
    expect(await health()).toMatchObject({ console: false, device: false, simulator: false });
  });

  it("/health recuerda la IP local por la que llegó la consola, aunque se desconecte", async () => {
    bridge = await startTestBridge();
    const health = async () => (await (await bridge.api("/health")).json()) as Record<string, unknown>;
    expect(await health()).not.toHaveProperty("consoleLocalIp");
    const con = await bridge.console();
    // la consola de prueba llega por el loopback: esa es la IP local de su socket
    expect(await health()).toMatchObject({ console: true, consoleLocalIp: "127.0.0.1" });
    con.close();
    for (let i = 0; i < 50 && (await health()).device === true; i++) await new Promise((r) => setTimeout(r, 20));
    expect(await health()).toMatchObject({ console: false, consoleLocalIp: "127.0.0.1" });
  });

  it("/health trae la versión de la app de la 3DS si la dijo en su saludo", async () => {
    bridge = await startTestBridge();
    const health = async () => (await (await bridge.api("/health")).json()) as Record<string, unknown>;
    expect(await health()).not.toHaveProperty("consoleVersion");
    await bridge.console("3ds-version", undefined, { appVersion: "0.2.5", install: "cia" });
    expect(await health()).toMatchObject({ console: true, consoleVersion: "0.2.5" });
  });

  it("consola con clave incorrecta rechazada", async () => {
    bridge = await startTestBridge();
    await bridge.pairCode();
    await expect(
      FakeConsole.connect({ port: bridge.ports.console, deviceId: "3ds-x", code: "AAAA-AAAA-AAAA-AAAA" }),
    ).rejects.toThrow("auth");
    expect(bridge.store.consoleConnected).toBe(false);
    expect(bridge.devices.list()).toEqual([]);
  });

  it("trama repetida (mismos bytes sellados) cierra la conexión", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    const bytes = con.send({ t: "focus", sessionId: "nadie" });
    await new Promise((r) => setTimeout(r, 50));
    expect(con.closed).toBe(false);
    con.sendRaw(bytes);
    await waitFor(() => con.closed, 2000, "cierre por repetición");
    await waitFor(() => !bridge.store.consoleConnected);
  });

  it("el cliente HTTP aborta -> la solicitud desaparece de la vista", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    const ac = new AbortController();
    const p = postJson("/permission", permissionBody(), bridge, ac.signal).catch((e: Error) => e.name);
    await waitFor(() => con.lastView?.request != null);
    ac.abort();
    expect(await p).toBe("AbortError");
    await waitFor(() => con.lastView?.request == null, 2000, "solicitud retirada");
    expect(bridge.store.pendingCount).toBe(0);
  });

  it("PING recibe PONG con el mismo contenido", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    con.ping(Buffer.from("hola"));
    await waitFor(() => con.pongs.length === 1);
    expect(Buffer.from(con.pongs[0]!).toString()).toBe("hola");
  });

  it("antes del saludo, una trama que no es JSON cierra la conexión", async () => {
    bridge = await startTestBridge();
    const { connect } = await import("node:net");
    const s = connect({ port: bridge.ports.console, host: "127.0.0.1" });
    s.on("error", () => {});
    s.resume();
    const closed = new Promise<void>((r) => s.on("close", () => r()));
    s.on("connect", () => s.write(Buffer.from([FrameType.PING, 0, 0])));
    await closed;
  });

  it("sin completar el saludo en el plazo, se cierra", async () => {
    bridge = await startTestBridge({ handshakeTimeoutMs: 100 });
    const { connect } = await import("node:net");
    const s = connect({ port: bridge.ports.console, host: "127.0.0.1" });
    s.on("error", () => {});
    s.resume();
    await new Promise<void>((r) => s.on("close", () => r()));
  });

  it("cierra tras el tiempo sin recibir nada", async () => {
    bridge = await startTestBridge({ idleTimeoutMs: 150 });
    const con = await bridge.console();
    await waitFor(() => con.closed, 2000, "cierre por inactividad");
    await waitFor(() => !bridge.store.consoleConnected);
  });

  it("/event cambia el estado del agente en la vista", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    const ev = { session_id: "e1", cwd: "/home/u/proy", kind: "gemini", model: "g-1" };
    await postJson("/event", { ...ev, event: "start" }, bridge);
    await postJson("/event", { ...ev, event: "working" }, bridge);
    await waitFor(() => con.lastView?.sessions.find((a) => a.id === "e1")?.state === "working");
    expect(con.lastView!.sessions[0]).toMatchObject({ kind: "gemini", project: "proy", model: "g-1" });
    expect(con.lastView!.led).toBe("working");
    await postJson("/event", { ...ev, event: "end" }, bridge);
    await waitFor(() => con.lastView!.sessions.length === 0);
  });
});

describe("emparejamiento", () => {
  it("el código es de un solo uso", async () => {
    bridge = await startTestBridge();
    const code = await bridge.pairCode();
    const a = await FakeConsole.connect({ port: bridge.ports.console, deviceId: "dev-a", code });
    expect(a.closed).toBe(false);
    await expect(FakeConsole.connect({ port: bridge.ports.console, deviceId: "dev-b", code })).rejects.toThrow("auth");
    // dev-a ya conocido: reconecta con su clave guardada
    const again = await FakeConsole.connect({ port: bridge.ports.console, deviceId: "dev-a", code });
    expect(again.closed).toBe(false);
  });

  it("el código caduca", async () => {
    bridge = await startTestBridge({ pairingTtlMs: 80 });
    const code = await bridge.pairCode();
    await new Promise((r) => setTimeout(r, 150));
    await expect(FakeConsole.connect({ port: bridge.ports.console, deviceId: "dev-a", code })).rejects.toThrow("auth");
  });

  const BAD = "ZZZZ-ZZZZ-ZZZZ-ZZZZ";
  const tryPair = (deviceId: string, code: string) => FakeConsole.connect({ port: bridge.ports.console, deviceId, code });

  it("muchos saludos fallidos no invalidan el código", async () => {
    let now = 1_000_000;
    bridge = await startTestBridge({ pairingNow: () => now, pairingIpIntervalMs: 1000, pairingGlobalPerSecond: 5 });
    const code = await bridge.pairCode();
    for (let i = 0; i < 12; i++) {
      await expect(tryPair(`mal-${i}`, BAD)).rejects.toThrow("auth");
      now += 1100;
    }
    expect(bridge.pairing.hasPending).toBe(true);
    const ok = await tryPair("bueno", code);
    expect(ok.closed).toBe(false);
    expect(bridge.devices.list().map((d) => d.deviceId)).toEqual(["bueno"]);
  });

  it("el limitador por IP rechaza el exceso sin evaluar el código", async () => {
    let now = 1_000_000;
    bridge = await startTestBridge({ pairingNow: () => now, pairingIpIntervalMs: 1000, pairingGlobalPerSecond: 5 });
    const code = await bridge.pairCode();
    await expect(tryPair("mal", BAD)).rejects.toThrow("auth"); // primer intento: evaluado
    // inmediatamente después, ni siquiera el código correcto se evalúa
    await expect(tryPair("bueno", code)).rejects.toThrow("auth");
    expect(bridge.devices.list()).toEqual([]);
    expect(bridge.pairing.hasPending).toBe(true);
    now += 1000;
    expect((await tryPair("bueno", code)).closed).toBe(false);
  });

  it("el tope global de 5 intentos por segundo rechaza el exceso", async () => {
    let now = 1_000_000;
    bridge = await startTestBridge({ pairingNow: () => now, pairingIpIntervalMs: 0, pairingGlobalPerSecond: 5 });
    const code = await bridge.pairCode();
    for (let i = 0; i < 5; i++) await expect(tryPair(`mal-${i}`, BAD)).rejects.toThrow("auth");
    await expect(tryPair("bueno", code)).rejects.toThrow("auth"); // sexto en el mismo segundo
    now += 1000;
    expect((await tryPair("bueno", code)).closed).toBe(false);
  });

  it("un dispositivo ya emparejado se re-empareja con un código nuevo", async () => {
    bridge = await startTestBridge();
    const code1 = await bridge.pairCode();
    (await tryPair("dev-a", code1)).close();
    const oldKey = bridge.devices.get("dev-a")!.keyHex;
    const code2 = await bridge.pairCode();
    const again = await tryPair("dev-a", code2);
    expect(again.closed).toBe(false);
    expect(bridge.devices.get("dev-a")!.keyHex).not.toBe(oldKey);
    expect(bridge.pairing.hasPending).toBe(false); // el código se consumió
    again.close();
    // la clave vieja ya no vale; la nueva sí
    await expect(tryPair("dev-a", code1)).rejects.toThrow("auth");
    expect((await tryPair("dev-a", code2)).closed).toBe(false);
  });

  it("sin código vigente solo vale la clave guardada", async () => {
    bridge = await startTestBridge();
    const code1 = await bridge.pairCode();
    (await tryPair("dev-a", code1)).close();
    const code2 = "AAAA-BBBB-CCCC-DDDD"; // nunca se creó
    await expect(tryPair("dev-a", code2)).rejects.toThrow("auth");
    expect((await tryPair("dev-a", code1)).closed).toBe(false);
  });

  it("un tercero sin el código no puede reemplazar la clave de un dispositivo conocido", async () => {
    bridge = await startTestBridge();
    const code1 = await bridge.pairCode();
    (await tryPair("dev-a", code1)).close();
    const stored = bridge.devices.get("dev-a")!.keyHex;
    await bridge.pairCode(); // hay un código vigente, que el tercero no conoce
    await expect(tryPair("dev-a", BAD)).rejects.toThrow("auth");
    expect(bridge.devices.get("dev-a")!.keyHex).toBe(stored);
    expect(bridge.pairing.hasPending).toBe(true);
    expect((await tryPair("dev-a", code1)).closed).toBe(false);
  });

  it("una segunda consola reemplaza a la primera sin soltar las pendientes", async () => {
    bridge = await startTestBridge();
    const first = await bridge.console("dev-1");
    const second = await bridge.console("dev-2");
    await waitFor(() => first.closed, 2000, "primera cerrada");
    expect(bridge.store.consoleConnected).toBe(true);
    await waitFor(() => second.views.length > 0);
    const pending = decisionOf(postJson("/permission", permissionBody(), bridge));
    await waitFor(() => second.lastView?.request != null);
    second.send({ t: "decision", requestId: second.lastView!.request!.id, decision: "allow" });
    expect(await pending).toBe("allow");
  });

  it("devices.json se escribe con la clave y sin dejar temporales", async () => {
    bridge = await startTestBridge();
    await bridge.console("dev-z");
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(bridge.tmp).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    const d = bridge.devices.get("dev-z")!;
    expect(d.keyHex).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("robustez del servidor TCP", () => {
  /** Abre una conexión cruda y espera el desafío (prueba de que el puente la aceptó) o el cierre. */
  const rawConnect = async (port: number) => {
    const { connect } = await import("node:net");
    const s = connect({ port, host: "127.0.0.1" });
    s.on("error", () => {});
    const state = { closed: false, gotChallenge: false };
    s.on("data", () => (state.gotChallenge = true));
    s.on("close", () => (state.closed = true));
    await waitFor(() => state.gotChallenge || state.closed, 2000, "desafío o cierre");
    return { s, state };
  };

  it("la quinta conexión sin autenticar desde la misma IP se cierra; una autenticada no cuenta", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console(); // autenticada: no cuenta para el límite
    const raws: Awaited<ReturnType<typeof rawConnect>>[] = [];
    for (let i = 0; i < 4; i++) raws.push(await rawConnect(bridge.ports.console));
    expect(raws.every((r) => r.state.gotChallenge && !r.state.closed)).toBe(true);
    expect(con.closed).toBe(false);
    const fifth = await rawConnect(bridge.ports.console);
    expect(fifth.state.closed).toBe(true);
    expect(fifth.state.gotChallenge).toBe(false);
    // al cerrarse una sin autenticar, entra otra
    raws[0]!.s.destroy();
    await waitFor(() => raws[0]!.state.closed);
    const again = await rawConnect(bridge.ports.console);
    expect(again.state.gotChallenge).toBe(true);
    for (const r of [...raws, again]) r.s.destroy();
  });
});

describe("casos de extremo a extremo", () => {
  it("reenviar al puente una trama que él mismo selló cierra la conexión", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    await waitFor(() => con.sealedFrames.length > 0, 2000, "primera vista");
    expect(con.closed).toBe(false);
    con.sendRaw(con.sealedFrames[0]!);
    await waitFor(() => con.closed, 2000, "cierre por reflexión");
    await waitFor(() => !bridge.store.consoleConnected);
  });

  it("decidir después del plazo vencido no cambia nada", async () => {
    bridge = await startTestBridge({ requestTimeoutMs: 150 });
    const con = await bridge.console();
    const pending = decisionOf(postJson("/permission", permissionBody(), bridge));
    await waitFor(() => con.lastView?.request != null);
    const requestId = con.lastView!.request!.id;
    expect(await pending).toBe("ask");
    await waitFor(() => con.lastView?.request == null, 2000, "solicitud retirada por plazo");
    const stateBefore = bridge.store.sessions[0]!.state;
    const viewsBefore = con.views.length;

    con.send({ t: "decision", requestId, decision: "allow" });
    await new Promise((r) => setTimeout(r, 100));
    expect(con.closed).toBe(false);
    expect(bridge.store.consoleConnected).toBe(true);
    expect(bridge.store.pendingCount).toBe(0);
    expect(bridge.store.sessions[0]!.state).toBe(stateBefore);
    expect(con.views.length).toBe(viewsBefore);
    expect(con.lastView!.request).toBeNull();
  });

  it("la consola se desconecta con una solicitud pendiente -> el HTTP recibe ask", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    const pending = decisionOf(postJson("/permission", permissionBody(), bridge));
    await waitFor(() => con.lastView?.request != null);
    con.close();
    expect(await pending).toBe("ask");
    await waitFor(() => bridge.store.pendingCount === 0);
  });
});

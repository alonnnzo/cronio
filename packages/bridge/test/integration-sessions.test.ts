import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ViewModelSchema } from "@companion/protocol";
import { startBridge } from "../src/main.ts";
import { permissionBody, postJson, startTestBridge, waitFor, type TestBridge } from "./helpers.ts";

let bridge: TestBridge;
afterEach(async () => {
  await bridge?.cleanup();
});

const decisionOf = async (res: Promise<Response>) => ((await res).json() as Promise<{ decision: string }>).then((j) => j.decision);

/** Registra dos sesiones de Claude en proyectos distintos y devuelve la consola conectada. */
async function twoSessions() {
  bridge = await startTestBridge();
  const con = await bridge.console();
  await waitFor(() => con.views.length > 0, 2000, "vista inicial");
  for (const [id, cwd] of [["s1", "/w/mi-portal"], ["s2", "/w/OTRO-SISTEMA"]] as const) {
    await postJson("/event", { session_id: id, cwd, kind: "claude", event: "start" }, bridge);
  }
  return con;
}

describe("integración: dos sesiones piden permiso a la vez", () => {
  it("la consola recibe la primera con 1 de 2, la aprueba, recibe la segunda con 1 de 1, la rechaza", async () => {
    const con = await twoSessions();
    const a = decisionOf(postJson("/permission", permissionBody("npm install sharp", "s1"), bridge));
    await waitFor(() => con.lastView?.pendingCount === 1, 2000, "primera");
    const b = decisionOf(postJson("/permission", permissionBody("rm -rf node_modules", "s2"), bridge));
    await waitFor(() => con.lastView?.pendingCount === 2, 2000, "segunda");

    const first = con.lastView!.request!;
    expect(first).toMatchObject({ sessionId: "s1", position: 1, total: 2 });
    expect(first.lines.join(" ")).toContain("npm install sharp");
    expect(con.lastView!.face).toMatchObject({ kind: "claude", mood: "ask" });
    expect(con.lastView!.face.lines[0]).toBe("Claude necesita permiso (1 de 2)");
    expect(con.lastView!.led).toBe("ask");
    expect(ViewModelSchema.safeParse(con.lastView).success).toBe(true);

    con.send({ t: "decision", requestId: first.id, decision: "allow" });
    expect(await a).toBe("allow");
    await waitFor(() => con.lastView?.request?.sessionId === "s2" && con.lastView.pendingCount === 1, 2000, "segunda en pantalla");
    const second = con.lastView!.request!;
    expect(second).toMatchObject({ position: 1, total: 1, risk: "high" });
    expect(second.lines.join(" ")).toContain("rm -rf node_modules");

    con.send({ t: "decision", requestId: second.id, decision: "deny" });
    expect(await b).toBe("deny");
    await waitFor(() => con.lastView?.request === null && con.lastView.pendingCount === 0, 2000, "sin pendientes");
    expect(con.lastView!.sessions.map((s) => s.state)).toEqual(["working", "working"]);
  });

  it("modo manual por la consola: sin request hasta abrir la sesión; decidir la abierta", async () => {
    const con = await twoSessions();
    con.send({ t: "mode", mode: "manual" });
    await waitFor(() => con.lastView?.mode === "manual");
    const a = decisionOf(postJson("/permission", permissionBody("uno", "s1"), bridge));
    const b = decisionOf(postJson("/permission", permissionBody("dos", "s2"), bridge));
    await waitFor(() => con.lastView?.pendingCount === 2);
    expect(con.lastView!.request).toBeNull();
    expect(con.lastView!.face.lines).toEqual(["2 permisos pendientes", "Claude"]);

    con.send({ t: "skip" }); // se ignora en manual
    con.send({ t: "focus", sessionId: "s2" });
    await waitFor(() => con.lastView?.request?.sessionId === "s2");
    expect(con.lastView!.request).toMatchObject({ position: 2, total: 2 });
    expect(con.lastView!.detail!.sessionId).toBe("s2");
    con.send({ t: "decision", requestId: con.lastView!.request!.id, decision: "allow" });
    expect(await b).toBe("allow");

    con.send({ t: "focus", sessionId: "s1" });
    await waitFor(() => con.lastView?.request?.sessionId === "s1");
    con.send({ t: "decision", requestId: con.lastView!.request!.id, decision: "deny" });
    expect(await a).toBe("deny");
    con.send({ t: "focus", sessionId: null });
    await waitFor(() => con.lastView?.detail === null);
  });

  it("modo queue: skip pasa a la siguiente, y se puede decidir una solicitud no enfocada", async () => {
    const con = await twoSessions();
    const a = decisionOf(postJson("/permission", permissionBody("uno", "s1"), bridge));
    await waitFor(() => con.lastView?.pendingCount === 1);
    const b = decisionOf(postJson("/permission", permissionBody("dos", "s2"), bridge));
    await waitFor(() => con.lastView?.pendingCount === 2);
    const firstId = con.lastView!.request!.id;
    con.send({ t: "skip" });
    await waitFor(() => con.lastView?.request?.sessionId === "s2");
    expect(con.lastView!.request).toMatchObject({ position: 2, total: 2 });
    // la primera ya no está en pantalla, pero sigue pendiente y se puede decidir
    con.send({ t: "decision", requestId: firstId, decision: "deny" });
    expect(await a).toBe("deny");
    await waitFor(() => con.lastView?.pendingCount === 1);
    con.send({ t: "decision", requestId: con.lastView!.request!.id, decision: "allow" });
    expect(await b).toBe("allow");
  });

  it("mensajes inválidos de la consola cierran la conexión (focus con id raro)", async () => {
    const con = await twoSessions();
    con.sendSealed(1, Buffer.from(JSON.stringify({ t: "focus", sessionId: "con espacios" })));
    await waitFor(() => con.closed, 2000, "cierre por mensaje inválido");
  });
});

describe("integración: simulador por WebSocket", () => {
  it("decision, focus, skip y mode también valen por el WebSocket local", async () => {
    bridge = await startTestBridge();
    const msgs: any[] = [];
    const ws = new WebSocket(bridge.wsUrl());
    ws.on("message", (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.on("open", r));
    const last = () => msgs.at(-1)?.view;
    await waitFor(() => msgs.length > 0);
    for (const [id, cwd] of [["w1", "/w/uno"], ["w2", "/w/dos"]] as const) {
      await postJson("/event", { session_id: id, cwd, kind: "codex", event: "start" }, bridge);
    }
    const a = decisionOf(postJson("/permission", permissionBody("a", "w1"), bridge));
    const b = decisionOf(postJson("/permission", permissionBody("b", "w2"), bridge));
    await waitFor(() => last()?.pendingCount === 2);
    ws.send(JSON.stringify({ t: "skip" }));
    await waitFor(() => last()?.request?.sessionId === "w2");
    ws.send(JSON.stringify({ t: "mode", mode: "manual" }));
    await waitFor(() => last()?.mode === "manual" && last()?.request === null);
    ws.send(JSON.stringify({ t: "focus", sessionId: "w1" }));
    await waitFor(() => last()?.request?.sessionId === "w1");
    ws.send(JSON.stringify({ t: "decision", requestId: last().request.id, decision: "allow" }));
    expect(await a).toBe("allow");
    ws.send(JSON.stringify({ t: "mode", mode: "queue" }));
    await waitFor(() => last()?.request?.sessionId === "w2");
    ws.send(JSON.stringify({ t: "decision", requestId: last().request.id, decision: "deny" }));
    expect(await b).toBe("deny");
    ws.close();
  });
});

describe("integración: cara, abandono y persistencia", () => {
  it("la consola ve la cara: terminar da un aviso done y luego Todo tranquilo", async () => {
    bridge = await startTestBridge({ faceNoticeMs: 150 });
    const con = await bridge.console();
    await postJson("/event", { session_id: "f1", cwd: "/w/p", kind: "gemini", event: "start" }, bridge);
    await postJson("/event", { session_id: "f1", kind: "gemini", event: "done", last_message: "Todo listo" }, bridge);
    await waitFor(() => con.lastView?.face.mood === "done");
    expect(con.lastView!.face.lines[0]).toBe("¡Gemini terminó!");
    expect(con.lastView!.led).toBe("done");
    await waitFor(() => con.lastView?.face.mood === "idle", 2000, "vuelve al ambiente");
    expect(con.lastView!.face.lines).toEqual(["Todo tranquilo"]);
    expect(con.lastView!.led).toBe("done"); // la tarjeta "Terminó" sigue sin "Visto": el LED la recuerda
    expect(con.lastView!.notice).toMatchObject({ kind: "done", title: "Terminó", lines: ["Todo listo"] });
    con.send({ t: "ack", id: con.lastView!.notice!.id });
    await waitFor(() => con.lastView?.notice === undefined, 2000, "Visto retira la tarjeta");
    expect(con.lastView!.led).toBe("off");
  });

  it("el puente barre las sesiones abandonadas", async () => {
    bridge = await startTestBridge({ sessionMaxAgeMs: 60, sessionSweepIntervalMs: 20 });
    const con = await bridge.console();
    await postJson("/event", { session_id: "old", cwd: "/w/p", kind: "claude", event: "start" }, bridge);
    await waitFor(() => con.lastView?.sessions.length === 1);
    await waitFor(() => con.lastView?.sessions.length === 0, 2000, "sesión retirada");
  });

  it("el modo se guarda en settings.json y sobrevive a un reinicio del puente", async () => {
    const dir = mkdtempSync(join(tmpdir(), "companion-persist-"));
    const opts = { dataDir: dir, configDir: join(dir, "config"), consolePort: 0, apiPort: 0, wsPort: 0, consoleHost: "127.0.0.1", beacon: false, staticDir: join(dir, "x") };
    try {
      const one = await startBridge(opts);
      expect(one.store.mode).toBe("queue");
      one.store.setMode("manual");
      await one.stop();
      const two = await startBridge(opts);
      expect(two.store.mode).toBe("manual");
      await two.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("integración: dos clientes a la vez (consola y WebSocket)", () => {
  it("cada decisión se aplica al requestId enviado aunque el otro cliente cambie el enfoque; una ya resuelta se ignora", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    const msgs: any[] = [];
    const ws = new WebSocket(bridge.wsUrl());
    ws.on("message", (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.on("open", r));
    const wsView = () => msgs.at(-1)?.view;
    await waitFor(() => con.views.length > 0 && msgs.length > 0, 2000, "vistas iniciales");
    for (const [id, cwd] of [["s1", "/w/uno"], ["s2", "/w/dos"], ["s3", "/w/tres"]] as const) {
      await postJson("/event", { session_id: id, cwd, kind: "claude", event: "start" }, bridge);
    }
    con.send({ t: "mode", mode: "manual" });
    await waitFor(() => wsView()?.mode === "manual");

    const p1 = decisionOf(postJson("/permission", permissionBody("uno", "s1"), bridge));
    const p2 = decisionOf(postJson("/permission", permissionBody("dos", "s2"), bridge));
    const p3 = decisionOf(postJson("/permission", permissionBody("tres", "s3"), bridge));
    await waitFor(() => wsView()?.pendingCount === 3 && con.lastView?.pendingCount === 3, 2000, "tres pendientes");

    // el enfoque es único en el puente: la consola ve s1, el WebSocket lo cambia a s2
    const id = (s: string) => bridge.store.pending.find((p) => p.sessionId === s)!.id;
    con.send({ t: "focus", sessionId: "s1" });
    await waitFor(() => con.lastView?.request?.sessionId === "s1");
    ws.send(JSON.stringify({ t: "focus", sessionId: "s2" }));
    await waitFor(() => con.lastView?.request?.sessionId === "s2");

    const [id1, id2, id3] = [id("s1"), id("s2"), id("s3")];

    // la consola decide s1 (que ya no está enfocada): se aplica a s1, no a la enfocada (s2)
    con.send({ t: "decision", requestId: id1, decision: "allow" });
    expect(await p1).toBe("allow");
    expect(bridge.store.pending.map((p) => p.sessionId)).toEqual(["s2", "s3"]);

    // el WebSocket decide s3 (tampoco enfocada)
    ws.send(JSON.stringify({ t: "decision", requestId: id3, decision: "deny" }));
    expect(await p3).toBe("deny");
    expect(bridge.store.pending.map((p) => p.sessionId)).toEqual(["s2"]);

    // decisiones sobre solicitudes ya resueltas (o desconocidas) se ignoran y no tocan la que sigue pendiente
    ws.send(JSON.stringify({ t: "decision", requestId: id1, decision: "deny" }));
    con.send({ t: "decision", requestId: id3, decision: "allow" });
    con.send({ t: "decision", requestId: "00000000-0000-0000-0000-000000000000", decision: "allow" });
    await new Promise((r) => setTimeout(r, 100));
    expect(bridge.store.pending.map((p) => p.id)).toEqual([id2]);

    con.send({ t: "decision", requestId: id2, decision: "allow" });
    expect(await p2).toBe("allow");
    await waitFor(() => wsView()?.pendingCount === 0 && con.lastView?.pendingCount === 0, 2000, "sin pendientes");
    ws.close();
  });
});

describe("integración: leer el mensaje completo (read → text)", () => {
  it("la consola pide leer y recibe el texto solo ella; el WebSocket recibe el suyo; sesión desconocida llega vacía", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    const wsTexts: any[] = [];
    const ws = new WebSocket(bridge.wsUrl());
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      if (m.t === "text") wsTexts.push(m);
    });
    await new Promise((r) => ws.on("open", r));
    await postJson("/event", { session_id: "s1", cwd: "/w/demo", kind: "claude", event: "start" }, bridge);
    await postJson("/event", { session_id: "s1", cwd: "/w/demo", kind: "claude", event: "idle", last_message: "# Listo\n\nTodo **pasa**.\n- a\n- b" }, bridge);

    con.send({ t: "read", sessionId: "s1" });
    await waitFor(() => con.texts.length === 1, 2000, "texto en la consola");
    expect(con.texts[0]).toEqual({ t: "text", sessionId: "s1", lines: ["Listo", "", "Todo pasa.", "• a", "• b"], truncated: false, mode: "full" });

    con.send({ t: "read", sessionId: "no-existe" });
    await waitFor(() => con.texts.length === 2, 2000, "texto vacío");
    expect(con.texts[1]).toEqual({ t: "text", sessionId: "no-existe", lines: [], truncated: false, mode: "full" });

    expect(wsTexts).toHaveLength(0); // la respuesta de la consola no llega al WebSocket
    ws.send(JSON.stringify({ t: "read", sessionId: "s1" }));
    await waitFor(() => wsTexts.length === 1, 2000, "texto en el WebSocket");
    expect(wsTexts[0].lines[0]).toBe("Listo");

    await new Promise((r) => setTimeout(r, 50));
    expect(con.texts).toHaveLength(2); // y la del WebSocket no llega a la consola
    expect(con.closed).toBe(false);
    ws.close();
  });

  it("read con mode summary devuelve el resumen; sin mode o con un mode inválido, el mensaje entero", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    await postJson("/event", { session_id: "s1", cwd: "/w/demo", kind: "claude", event: "start" }, bridge);
    const msg = "Listo: migré la tabla.\n\n" + Array.from({ length: 20 }, (_, i) => `- Cambio ${i + 1} en el módulo`).join("\n");
    await postJson("/event", { session_id: "s1", cwd: "/w/demo", kind: "claude", event: "idle", last_message: msg }, bridge);

    con.send({ t: "read", sessionId: "s1", mode: "summary" });
    await waitFor(() => con.texts.length === 1, 2000, "resumen");
    expect(con.texts[0]!.mode).toBe("summary");
    expect(con.texts[0]!.lines.length).toBeLessThanOrEqual(12);
    expect(con.texts[0]!.lines[0]).toBe("Listo: migré la tabla.");

    con.send({ t: "read", sessionId: "s1" });
    await waitFor(() => con.texts.length === 2, 2000, "completo");
    expect(con.texts[1]!.mode).toBe("full");
    expect(con.texts[1]!.lines.length).toBeGreaterThan(20);

    con.send({ t: "read", sessionId: "s1", mode: "brief" } as never); // inválido: la consola no se cierra y no hay respuesta
    await new Promise((r) => setTimeout(r, 80));
    expect(con.texts).toHaveLength(2);
  });
});

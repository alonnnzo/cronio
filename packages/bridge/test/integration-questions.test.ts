import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { postJson, startTestBridge, waitFor, type TestBridge } from "./helpers.ts";

let bridge: TestBridge;
afterEach(async () => {
  await bridge?.cleanup();
});

const TOOL_INPUT = {
  questions: [
    {
      question: "¿Qué fondo uso en el hero?",
      header: "Fondo",
      options: [
        { label: "Video (Recommended)", description: "Pesa más" },
        { label: "Gradiente", description: "Liviano" },
      ],
      multiSelect: false,
    },
    {
      question: "¿Qué secciones?",
      header: "Secciones",
      options: [
        { label: "Hero", description: "Portada" },
        { label: "Footer", description: "Pie" },
      ],
      multiSelect: true,
    },
  ],
};
const body = (over: Record<string, unknown> = {}) => ({ session_id: "s1", cwd: "C:\\proyectos\\demo", tool_input: TOOL_INPUT, ...over });
const ask = (b: unknown, signal?: AbortSignal) => postJson("/question", b, bridge, signal).then((r) => r.json());

describe("POST /question", () => {
  it("sin consola responde ask en el acto", async () => {
    bridge = await startTestBridge();
    expect(await ask(body())).toEqual({ decision: "ask" });
    expect(bridge.store.pendingCount).toBe(0);
  });

  it("entrada inválida: ask con 200; cuerpo inválido: 400; método distinto de POST: 405", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    for (const input of [undefined, {}, { questions: [] }, { questions: [{ question: "x", options: [{ label: "solo" }] }] }]) {
      expect(await ask(body({ tool_input: input }))).toEqual({ decision: "ask" });
    }
    expect(bridge.store.pendingCount).toBe(0);
    expect((await postJson("/question", { cwd: "x" }, bridge)).status).toBe(400);
    expect((await bridge.api("/question")).status).toBe(405);
    con.close();
  });

  it("con el ajuste questions apagado responde ask en el acto aunque haya consola", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    con.send({ t: "setting", key: "questions", value: false });
    await waitFor(() => con.lastView?.settings?.questions === false);
    expect(await ask(body())).toEqual({ decision: "ask" });
    expect(con.lastView!.request).toBeNull();
    con.close();
  });

  it("la consola TCP recibe la pregunta y la responde con índices: el puente traduce a etiquetas completas", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    const pending = ask(body());
    await waitFor(() => con.lastView?.request?.kind === "question", 2000, "pregunta en la vista");
    const r = con.lastView!.request!;
    expect(r.questions![0]!.options[0]).toEqual({ label: "Video", desc: ["Pesa más"], recommended: true });
    con.send({ t: "answer", requestId: r.id, answers: [{ choose: [0] }, { choose: [0, 1] }] });
    expect(await pending).toEqual({
      decision: "answer",
      answers: { "¿Qué fondo uso en el hero?": "Video (Recommended)", "¿Qué secciones?": "Hero, Footer" },
    });
    await waitFor(() => con.lastView?.request === null);
    con.close();
  });

  it("'Otra' con texto y 'Responder en el PC'", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    let pending = ask(body());
    await waitFor(() => con.lastView?.request?.kind === "question");
    con.send({ t: "answer", requestId: con.lastView!.request!.id, answers: [{ other: "Un fondo con ñ y \"comillas\"" }, { choose: [1] }] });
    expect(await pending).toEqual({
      decision: "answer",
      answers: { "¿Qué fondo uso en el hero?": "Un fondo con ñ y \"comillas\"", "¿Qué secciones?": "Footer" },
    });
    await waitFor(() => con.lastView?.request === null);

    pending = ask(body());
    await waitFor(() => con.lastView?.request?.kind === "question");
    con.send({ t: "answer", requestId: con.lastView!.request!.id, pc: true });
    expect(await pending).toEqual({ decision: "ask" });
    con.close();
  });

  it("un answer inválido se ignora y no cierra la conexión: la pregunta sigue esperando", async () => {
    const logs: string[] = [];
    bridge = await startTestBridge({ log: (m: string) => logs.push(m) });
    const con = await bridge.console();
    const pending = ask(body());
    await waitFor(() => con.lastView?.request?.kind === "question");
    const id = con.lastView!.request!.id;
    const bad = [
      { t: "answer", requestId: id, answers: [{ choose: [9] }, { choose: [0] }] },
      { t: "answer", requestId: id, answers: "no" },
      { t: "answer", requestId: id },
      { t: "answer", requestId: id, answers: [{ choose: [0] }] },
      { t: "answer", requestId: id, pc: "sí" },
      { t: "answer", requestId: "no-existe", pc: true },
    ];
    for (const m of bad) con.send(m as never);
    con.ping(new Uint8Array([1]));
    await waitFor(() => con.pongs.length === 1, 2000, "la conexión sigue viva");
    expect(con.closed).toBe(false);
    expect(bridge.store.pendingCount).toBe(1);
    expect(logs.filter((l) => l.includes("respuesta ignorada")).length).toBe(bad.length);
    con.send({ t: "answer", requestId: id, pc: true });
    expect(await pending).toEqual({ decision: "ask" });
    con.close();
  });

  it("una decisión sobre la pregunta no la aprueba ni la rechaza", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    const pending = ask(body());
    await waitFor(() => con.lastView?.request?.kind === "question");
    const id = con.lastView!.request!.id;
    con.send({ t: "decision", requestId: id, decision: "allow" });
    con.send({ t: "decision", requestId: id, decision: "allow_always" });
    con.send({ t: "decision", requestId: id, decision: "deny" });
    con.ping(new Uint8Array([1]));
    await waitFor(() => con.pongs.length === 1);
    expect(bridge.store.pendingCount).toBe(1);
    con.send({ t: "answer", requestId: id, pc: true });
    await pending;
    con.close();
  });

  it("si la consola se desconecta mientras espera, la pregunta vuelve al PC", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    const pending = ask(body());
    await waitFor(() => con.lastView?.request?.kind === "question");
    con.close();
    expect(await pending).toEqual({ decision: "ask" });
    expect(bridge.store.pendingCount).toBe(0);
  });

  it("si el hook cierra la conexión (Claude Code lo mató o se respondió en el PC), la pregunta se retira", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    const ac = new AbortController();
    const pending = ask(body(), ac.signal).catch(() => "abortado");
    await waitFor(() => con.lastView?.request?.kind === "question");
    ac.abort();
    expect(await pending).toBe("abortado");
    await waitFor(() => con.lastView?.request === null);
    con.close();
  });

  it("respondida en el PC: el PostToolUse de AskUserQuestion (con answers en tool_input) cierra el /question abierto con ask", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    const pending = ask(body());
    await waitFor(() => con.lastView?.request?.kind === "question");
    const hook = { hook_event_name: "PostToolUse", session_id: "s1", cwd: "C:\proyectos\demo", tool_name: "AskUserQuestion", tool_input: { ...TOOL_INPUT, answers: { "¿Qué fondo uso en el hero?": "Gradiente" } } };
    expect((await postJson("/hook/claude", hook, bridge)).status).toBe(200);
    expect(await pending).toEqual({ decision: "ask" });
    await waitFor(() => con.lastView?.request === null);
    expect(bridge.store.pendingCount).toBe(0);
    con.close();
  });

  it("el simulador (WebSocket) responde igual", async () => {
    bridge = await startTestBridge();
    const msgs: any[] = [];
    const ws = new WebSocket(bridge.wsUrl());
    ws.on("message", (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise<void>((r) => ws.on("open", () => r()));
    await waitFor(() => msgs.length > 0);
    const pending = ask(body());
    await waitFor(() => msgs.at(-1)?.view?.request?.kind === "question");
    ws.send(JSON.stringify({ t: "answer", requestId: msgs.at(-1).view.request.id, answers: [{ choose: [1] }, { choose: [0] }] }));
    expect(await pending).toEqual({
      decision: "answer",
      answers: { "¿Qué fondo uso en el hero?": "Gradiente", "¿Qué secciones?": "Hero" },
    });
    ws.close();
  });

  it("/permission sigue devolviendo ask para AskUserQuestion sin crear solicitud", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    const r = await postJson("/permission", { session_id: "s1", tool_name: "AskUserQuestion", tool_input: TOOL_INPUT }, bridge);
    expect(await r.json()).toEqual({ decision: "ask" });
    expect(bridge.store.pendingCount).toBe(0);
    con.close();
  });
});

describe("hold: el teclado del sistema congela la consola", () => {
  it("sin hold la consola callada se corta por silencio; con hold no, y al volver rige el plazo normal", async () => {
    bridge = await startTestBridge({ idleTimeoutMs: 250 });
    const held = await bridge.console("3ds-held");
    held.send({ t: "hold", seconds: 2 });
    await new Promise((r) => setTimeout(r, 700)); // más del doble del plazo normal
    expect(held.closed).toBe(false);
    // al volver (cualquier trama) el plazo normal vuelve a regir
    held.ping(new Uint8Array([7]));
    await waitFor(() => held.pongs.length === 1);
    await waitFor(() => held.closed, 2000, "cierre por inactividad tras volver");
  });

  it("el hold también termina solo: pasado su plazo sin volver, se corta", async () => {
    bridge = await startTestBridge({ idleTimeoutMs: 150 });
    const con = await bridge.console();
    con.send({ t: "hold", seconds: 1 });
    await new Promise((r) => setTimeout(r, 500));
    expect(con.closed).toBe(false);
    await waitFor(() => con.closed, 3000, "cierre tras vencer el hold");
  });

  it("una consola sin hold se corta como siempre", async () => {
    bridge = await startTestBridge({ idleTimeoutMs: 150 });
    const con = await bridge.console();
    await waitFor(() => con.closed, 2000, "cierre por inactividad");
  });

  it("un hold inválido cierra la conexión (forma inválida, como cualquier mensaje mal formado)", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    con.send({ t: "hold", seconds: 301 } as never);
    await waitFor(() => con.closed);
  });
});

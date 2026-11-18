import { afterEach, describe, expect, it } from "vitest";
import { postJson, startTestBridge, waitFor, type TestBridge } from "./helpers.ts";

let bridge: TestBridge;
afterEach(async () => {
  await bridge?.cleanup();
});

const stop = (b: Record<string, unknown> = {}, signal?: AbortSignal) =>
  postJson("/stop", { session_id: "s1", cwd: "C:\proyectos\demo", stop_hook_active: false, last_assistant_message: "Terminé el login. ¿Algo más?", ...b }, bridge, signal).then((r) => r.json());

describe("POST /stop", () => {
  it("sin cola ni modo responde none en el acto, con o sin consola", async () => {
    bridge = await startTestBridge();
    expect(await stop()).toEqual({ decision: "none" });
    const con = await bridge.console();
    expect(await stop()).toEqual({ decision: "none" });
    expect(bridge.store.pendingCount).toBe(0);
    con.close();
  });

  it("cuerpo inválido: 400; método distinto de POST: 405", async () => {
    bridge = await startTestBridge();
    expect((await postJson("/stop", { cwd: "x" }, bridge)).status).toBe(400);
    expect((await bridge.api("/stop")).status).toBe(405);
  });

  it("una instrucción escrita en la consola se entrega en el próximo Stop", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    expect(await stop()).toEqual({ decision: "none" }); // crea la sesión
    con.send({ t: "instruct", sessionId: "s1", text: "Agrega pruebas" });
    con.send({ t: "instruct", sessionId: "s1", text: "Y documéntalo" });
    await waitFor(() => bridge.store.instructionsOf("s1").length === 2, 2000, "dos en cola");
    con.send({ t: "focus", sessionId: "s1" });
    await waitFor(() => con.lastView?.detail?.instructions?.count === 2, 2000, "cola en la vista");
    expect(await stop()).toEqual({ decision: "instruct", text: "Agrega pruebas\n\nY documéntalo" });
    expect(await stop()).toEqual({ decision: "none" });
    con.close();
  });

  it("con Esperar mi respuesta y consola: retiene hasta instruct; la tarjeta llega a la consola", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    await stop();
    con.send({ t: "setting", key: "sessionWait", sessionId: "s1", value: true });
    await waitFor(() => bridge.store.getSession("s1")!.waitForMe, 2000, "modo encendido");
    const pending = stop();
    await waitFor(() => con.lastView?.request?.kind === "instruction", 2000, "tarjeta de instrucción");
    const r = con.lastView!.request!;
    expect(r.lines.join(" ")).toContain("Terminé el login");
    expect(con.lastView!.sessions[0]!.state).toBe("ask");
    con.send({ t: "instruct", sessionId: "s1", text: "Sigue con el logout" });
    expect(await pending).toEqual({ decision: "instruct", text: "Sigue con el logout" });
    await waitFor(() => con.lastView?.request === null, 2000, "tarjeta retirada");
    con.close();
  });

  it("release libera la retención sin instrucción", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    await stop();
    con.send({ t: "setting", key: "sessionWait", sessionId: "s1", value: true });
    await waitFor(() => bridge.store.getSession("s1")!.waitForMe, 2000);
    const pending = stop();
    await waitFor(() => con.lastView?.request?.kind === "instruction", 2000);
    con.send({ t: "release", requestId: con.lastView!.request!.id });
    expect(await pending).toEqual({ decision: "none" });
    con.close();
  });

  it("si la consola se desconecta, la retención se libera; si el hook cierra, se retira", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    await stop();
    bridge.store.setSessionWait("s1", true);
    const pending = stop();
    await waitFor(() => bridge.store.pendingCount === 1, 2000);
    con.close();
    expect(await pending).toEqual({ decision: "none" });

    const con2 = await bridge.console();
    const ac = new AbortController();
    const p2 = stop({}, ac.signal).catch(() => "cortado");
    await waitFor(() => bridge.store.pendingCount === 1, 2000);
    ac.abort();
    await p2;
    await waitFor(() => bridge.store.pendingCount === 0, 2000, "retención retirada");
    con2.close();
  });

  it("el hook http de estado (/hook/claude) no retira la retención y deja la sesión en ask", async () => {
    bridge = await startTestBridge();
    const con = await bridge.console();
    await stop();
    bridge.store.setSessionWait("s1", true);
    const pending = stop();
    await waitFor(() => bridge.store.pendingCount === 1, 2000);
    await postJson("/hook/claude", { hook_event_name: "Stop", session_id: "s1", last_assistant_message: "Listo." }, bridge);
    expect(bridge.store.pendingCount).toBe(1);
    expect(bridge.store.getSession("s1")!.state).toBe("ask");
    bridge.store.releaseSessionInstruction("s1");
    await pending;
    con.close();
  });
});

// Prueba de extremo a extremo de las instrucciones por texto (Fase 2b, paso 6) con un puente desechable en puertos efímeros y el
// script real del hook (packages/hooks/permission-hook.mjs). No toca el puente en marcha ni la consola.
// Uso: npx tsx packages/bridge/scripts/e2e-instrucciones.mts
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { startBridge } from "../src/main.ts";

const HOOK = new URL("../../hooks/permission-hook.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dir = mkdtempSync(join(tmpdir(), "e2e-instr-"));
// carpeta de configuración propia: el hook lee de ahí el token y las carpetas elegidas, y nunca se toca el %APPDATA% real
const configDir = join(dir, "config");
process.env.AGENT_COMPANION_CONFIG_DIR = configDir;
const bridge = await startBridge({ dataDir: dir, configDir, consolePort: 0, apiPort: 0, wsPort: 0, udpPort: 0, beacon: false });
const BRIDGE_URL = `http://127.0.0.1:${bridge.ports.api}`;
let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok   " : "FALLA"} ${what}`);
  if (!ok) failed++;
};

function hook(input: object): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], { env: { ...process.env, BRIDGE_URL, HOOK_WATCH_PID: "0" }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout }));
    child.stdin.end(JSON.stringify(input));
  });
}
const stopInput = { hook_event_name: "Stop", session_id: "s1", cwd: "C:\\proyectos\\demo", stop_hook_active: false, last_assistant_message: "Listo el login. ¿Algo más?" };
const post = (path: string, body: object) => fetch(BRIDGE_URL + path, { method: "POST", headers: { "content-type": "application/json", "x-cronio-token": bridge.apiToken }, body: JSON.stringify(body) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, what: string, ms = 5000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("tiempo agotado esperando: " + what);
    await sleep(25);
  }
}

// consola falsa por el WebSocket del simulador
const ws = new WebSocket(`ws://127.0.0.1:${bridge.ports.ws!}/ws?token=${bridge.apiToken}`);
let lastView: any = null;
ws.on("message", (d) => {
  const m = JSON.parse(String(d));
  if (m.t === "view") lastView = m.view;
});
await new Promise<void>((r) => ws.once("open", () => r()));
const send = (m: object) => ws.send(JSON.stringify(m));
await waitFor(() => lastView !== null, "primera vista");

try {
  await post("/hook/claude", { hook_event_name: "SessionStart", session_id: "s1", cwd: "C:\\proyectos\\demo" });

  // 1) sin cola ni modo: el hook no demora y no imprime nada
  let t0 = Date.now();
  let r = await hook(stopInput);
  check(r.code === 0 && r.stdout === "" && Date.now() - t0 < 3000, "sin cola ni Esperar: sin salida y sin demora");

  // 2) una instrucción en cola se entrega en el Stop como `block`
  send({ t: "instruct", sessionId: "s1", text: "Agrega pruebas para el login" });
  send({ t: "instruct", sessionId: "s1", text: "Y documéntalo" });
  await waitFor(() => bridge.store.instructionsOf("s1").length === 2, "dos instrucciones en cola");
  r = await hook(stopInput);
  const out = JSON.parse(r.stdout || "null");
  check(r.code === 0 && out?.decision === "block" && out.reason === "Instrucción desde la 3DS:\nAgrega pruebas para el login\n\nY documéntalo", "cola entregada como block con las dos instrucciones");
  check(bridge.store.instructionsOf("s1").length === 0, "la cola quedó vacía");
  r = await hook(stopInput);
  check(r.stdout === "", "el siguiente Stop ya no trae nada");

  // 3) Esperar mi respuesta + consola: retenido hasta `instruct`
  send({ t: "setting", key: "sessionWait", sessionId: "s1", value: true });
  await waitFor(() => bridge.store.getSession("s1")!.waitForMe, "modo encendido");
  let pending = hook(stopInput);
  await waitFor(() => lastView?.request?.kind === "instruction", "tarjeta de instrucción en la consola");
  check(lastView.request.lines.join(" ").includes("Listo el login"), "la tarjeta muestra el comienzo del último mensaje");
  check(lastView.sessions[0].state === "ask" && lastView.sessions[0].activity === "Espera tu instrucción", "la sesión está en ask con Espera tu instrucción");
  await post("/hook/claude", stopInput); // el hook http de estado llega en paralelo
  check(lastView?.request?.kind === "instruction" && bridge.store.getSession("s1")!.state === "ask", "el hook http de estado no la libera ni la marca terminada");
  let settled = false;
  void pending.then(() => (settled = true));
  await sleep(400);
  check(!settled, "el hook sigue retenido mientras nadie responde");
  send({ t: "instruct", sessionId: "s1", text: "Sigue con el logout" });
  r = await pending;
  check(JSON.parse(r.stdout).reason === "Instrucción desde la 3DS:\nSigue con el logout", "instruct entrega el texto al hook retenido");
  await waitFor(() => lastView?.request === null, "tarjeta retirada");
  check(bridge.store.getSession("s1")!.state === "working", "la sesión vuelve a trabajar");

  // 4) retenido y liberado con "Seguir en el PC"
  pending = hook(stopInput);
  await waitFor(() => lastView?.request?.kind === "instruction", "segunda tarjeta");
  send({ t: "release", requestId: lastView.request.id });
  r = await pending;
  check(r.code === 0 && r.stdout === "", "release libera sin salida: Claude termina normal");

  // 5) retenido y la consola se desconecta: se libera solo
  pending = hook(stopInput);
  await waitFor(() => lastView?.request?.kind === "instruction", "tercera tarjeta");
  ws.close();
  r = await pending;
  check(r.code === 0 && r.stdout === "", "al desconectarse la consola el hook se libera sin salida");
  check(bridge.store.pendingCount === 0, "no queda nada pendiente");

  // 6) sin consola ya no se retiene aunque el modo siga encendido
  t0 = Date.now();
  r = await hook(stopInput);
  check(r.stdout === "" && Date.now() - t0 < 3000, "sin consola no se retiene");
} catch (err) {
  console.log("FALLA", String(err));
  failed++;
}
try {
  ws.close();
} catch {
  /* ya cerrado */
}
await bridge.stop();
rmSync(dir, { recursive: true, force: true });
console.log(failed === 0 ? "\nTodo bien" : `\n${failed} fallo(s)`);
process.exit(failed === 0 ? 0 : 1);

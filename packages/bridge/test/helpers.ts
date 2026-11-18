import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBridge, type Bridge, type BridgeOptions } from "../src/main.ts";
import { FakeConsole } from "./fake-console.ts";

/** El puente de pruebas siempre levanta el simulador (salvo `simulator: false`): `ports.ws` es un número. */
export interface TestBridge extends Omit<Bridge, "ports"> {
  ports: Bridge["ports"] & { ws: number };
  url: string;
  tmp: string;
  /** Petición a la API local con el token (`X-Cronio-Token`) de este puente, salvo que `init.headers` ya traiga uno. */
  api(path: string, init?: RequestInit): Promise<Response>;
  /** Dirección del WebSocket del simulador, con el token. */
  wsUrl(): string;
  pairCode(): Promise<string>;
  /** Empareja (o reconecta) una consola falsa. */
  console(deviceId?: string, code?: string, hello?: { appVersion?: unknown; install?: unknown; protocolVersion?: 1 | 2; helloVersionOverride?: unknown }): Promise<FakeConsole>;
  cleanup(): Promise<void>;
}

/** Puente en el mismo proceso: puertos efímeros, carpeta temporal, sin aviso UDP. */
export async function startTestBridge(options: BridgeOptions = {}): Promise<TestBridge> {
  const tmp = mkdtempSync(join(tmpdir(), "companion-test-"));
  // las pruebas nunca leen el carpetas.json real: carpeta de configuración propia (sin archivo = todas las carpetas)
  process.env.AGENT_COMPANION_CONFIG_DIR = join(tmp, "config");
  const bridge = await startBridge({
    dataDir: tmp,
    configDir: join(tmp, "config"),
    consolePort: 0,
    apiPort: 0,
    wsPort: 0,
    consoleHost: "127.0.0.1",
    beacon: false,
    // sin limitador de emparejamiento por defecto: las pruebas que lo ejercitan lo piden y fijan un reloj
    pairingIpIntervalMs: 0,
    pairingGlobalPerSecond: 1_000_000,
    staticDir: join(tmp, "no-existe"),
    // sin .cia por defecto (ni el del entorno); las pruebas del .cia lo piden y usan un puerto libre
    cia: false,
    ciaPort: 0,
    ciaHost: "127.0.0.1",
    ...options,
  });
  const url = `http://127.0.0.1:${bridge.ports.api}`;
  const api = (path: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("x-cronio-token")) headers.set("x-cronio-token", bridge.apiToken);
    return fetch(url + path, { ...init, headers });
  };
  const wsUrl = () => `ws://127.0.0.1:${bridge.ports.ws}/ws?token=${bridge.apiToken}`;
  const pairCode = async () => ((await (await api("/pair", { method: "POST" })).json()) as { code: string }).code;
  return {
    ...bridge,
    ports: bridge.ports as TestBridge["ports"],
    url,
    tmp,
    api,
    wsUrl,
    pairCode,
    async console(deviceId = "3ds-test", code?: string, hello = {}) {
      return FakeConsole.connect({ port: bridge.ports.console, deviceId, code: code ?? (await pairCode()), ...hello });
    },
    async cleanup() {
      await bridge.stop();
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}

export async function waitFor(cond: () => boolean, ms = 2000, what = "condición"): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`tiempo agotado esperando: ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

export function postJson(path: string, body: unknown, bridge: TestBridge, signal?: AbortSignal): Promise<Response> {
  return bridge.api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

export const permissionBody = (command = "ls -la", session = "s1") => ({
  session_id: session,
  cwd: "C:\\proyectos\\demo",
  tool_name: "Bash",
  tool_input: { command },
});

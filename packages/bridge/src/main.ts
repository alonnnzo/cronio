import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { BridgeStore } from "./store.ts";
import { EventLog } from "./events.ts";
import { DeviceStore } from "./devices.ts";
import { PairingManager } from "./pairing.ts";
import { ConsoleCounter, ViewFeed } from "./feed.ts";
import { FaceController } from "./face.ts";
import { startHttpApi } from "./http-api.ts";
import { startConsoleServer } from "./console-server.ts";
import type { ConsoleServerHandle } from "./console-server.ts";
import { startWsServer } from "./ws-server.ts";
import { startBeacon } from "./beacon.ts";
import { startedByFromEnv, type StartedBy } from "./lifecycle.ts";
import { bridgeVersion } from "./version.ts";
import { CIA_PORT, ciaSourceFromEnv, startCiaServer, type CiaSource } from "./update.ts";
import { generateApiToken, writeTokenFile } from "./api-token.ts";
import { carpetaDatos } from "../../hooks/carpetas.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

export const DEFAULT_PORTS = { udp: 33333, console: 33334, api: 33335, ws: 33340 } as const;
export const defaultDataDir = (): string => join(REPO_ROOT, ".companion");

export interface BridgeOptions {
  /** Carpeta de datos (`devices.json`, `events.jsonl`, `settings.json`). Por defecto `<repo>/.companion`. */
  dataDir?: string;
  /** Puertos; 0 = efímero. */
  consolePort?: number;
  apiPort?: number;
  wsPort?: number;
  udpPort?: number;
  /** Interfaz de la consola TCP. Por defecto 0.0.0.0. */
  consoleHost?: string;
  /** Aviso UDP. Por defecto true. */
  beacon?: boolean;
  beaconIntervalMs?: number;
  /** Carpeta estática del simulador. Por defecto `packages/simulator/public`. */
  staticDir?: string;
  /**
   * Carpeta donde se deja una copia del token local (`api-token`) para los hooks y el programa del PC: la de configuración de la app
   * (AGENT_COMPANION_CONFIG_DIR, o `%APPDATA%/agent-companion`). `false` no la escribe. El token también queda siempre en `<dataDir>/api-token`.
   */
  configDir?: string | false;
  /**
   * Levanta el simulador (página + WebSocket en 127.0.0.1:33340). Por defecto sí, salvo que el entorno diga `COMPANION_SIMULATOR=0`, que es lo que
   * pone el programa del PC en el build empaquetado: su WebSocket deja decidir permisos y mandar instrucciones a cualquier proceso local sin Origin.
   */
  simulator?: boolean;
  requestTimeoutMs?: number;
  resetAfterMs?: number;
  /** Reloj de las sesiones y de los avisos de la cara (por defecto `Date.now`). */
  now?: () => number;
  /** Cada cuánto se barren las sesiones abandonadas (por defecto 60 000 ms). */
  sessionSweepIntervalMs?: number;
  /** Antigüedad sin eventos para retirar una sesión (por defecto 30 min). */
  sessionMaxAgeMs?: number;
  /** Duración de un aviso de la cara (por defecto 5 000 ms). */
  faceNoticeMs?: number;
  /** Rotación de la cara ambiente (por defecto 6 000 ms). */
  faceRotateMs?: number;
  handshakeTimeoutMs?: number;
  idleTimeoutMs?: number;
  /**
   * El .cia que el puente sirve (GET /agent-companion.cia) y avisa a las consolas con una versión menor. Por defecto sale del
   * entorno (COMPANION_CIA_PATH y el `.version` que está al lado); `false` no sirve nada.
   */
  cia?: CiaSource | false;
  /** Puerto del servidor del .cia (0 = efímero). Por defecto 33337. */
  ciaPort?: number;
  /** Interfaz del servidor del .cia. Por defecto 0.0.0.0 (la consola está en la LAN). */
  ciaHost?: string;
  /** Cada cuánto se reintenta el puerto del .cia si estaba ocupado (por defecto 5 000 ms; 0 = no reintenta). */
  ciaRetryMs?: number;
  /** Quién lo lanzó, para /health (por defecto, COMPANION_STARTED_BY: `cronio` o `manual`). */
  startedBy?: StartedBy;
  /** Qué hacer cuando alguien pide cerrar el puente por `POST /shutdown` (el CLI lo detiene y sale). Sin él responde 501. */
  onShutdown?: () => void;
  pairingTtlMs?: number;
  /** Separación mínima entre intentos de emparejamiento de una misma IP (por defecto 1000 ms; 0 = sin límite). */
  pairingIpIntervalMs?: number;
  /** Tope global de intentos de emparejamiento por segundo (por defecto 5). */
  pairingGlobalPerSecond?: number;
  /** Reloj del emparejamiento (para pruebas). */
  pairingNow?: () => number;
  log?: (msg: string) => void;
}

export interface Bridge {
  store: BridgeStore;
  face: FaceController;
  pairing: PairingManager;
  devices: DeviceStore;
  /** `ws` (el simulador) falta si no se levantó (`simulator: false` o `COMPANION_SIMULATOR=0`). */
  ports: { console: number; api: number; ws?: number; cia?: number };
  /** El .cia que se sirve (ausente si el puente no lo conoce o no pudo abrir el puerto). */
  cia?: CiaSource;
  dataDir: string;
  /** El token local de esta ejecución (el que exigen las rutas de la API y el WebSocket del simulador). */
  apiToken: string;
  stop(): Promise<void>;
}

export async function startBridge(options: BridgeOptions = {}): Promise<Bridge> {
  const dataDir = options.dataDir ?? defaultDataDir();
  const log = options.log ?? (() => {});
  const store = new BridgeStore({
    requestTimeoutMs: options.requestTimeoutMs,
    resetAfterMs: options.resetAfterMs,
    now: options.now,
    sweepIntervalMs: options.sessionSweepIntervalMs,
    sessionMaxAgeMs: options.sessionMaxAgeMs,
    settingsPath: join(dataDir, "settings.json"),
    notifyModesPath: join(dataDir, "notify-modes.json"),
    waitProjectsPath: join(dataDir, "wait-projects.json"),
    events: new EventLog(join(dataDir, "events.jsonl")),
  });
  const devices = new DeviceStore(join(dataDir, "devices.json"));
  const pairing = new PairingManager(devices, {
    ttlMs: options.pairingTtlMs,
    perIpIntervalMs: options.pairingIpIntervalMs,
    globalPerSecond: options.pairingGlobalPerSecond,
    now: options.pairingNow,
  });
  const face = new FaceController(store, { noticeMs: options.faceNoticeMs, rotateMs: options.faceRotateMs });
  const feed = new ViewFeed(store, face);
  const counter = new ConsoleCounter(store);

  // token local: nuevo en cada arranque; se escribe ANTES de abrir ningún puerto para que un hook que llegue enseguida ya lo encuentre
  const apiToken = generateApiToken();
  for (const dir of [dataDir, options.configDir === undefined ? carpetaDatos() : options.configDir]) {
    if (dir === false) continue;
    try {
      writeTokenFile(dir, apiToken);
    } catch (err) {
      log(`no se pudo guardar el token local en ${JSON.stringify(dir)}: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`);
    }
  }

  const closers: (() => void | Promise<void>)[] = [];
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    for (const c of closers.reverse()) await c();
    feed.close();
    face.dispose();
    store.dispose();
  };

  try {
    // el .cia: lo sirve el puente (y no el programa del PC) para que la consola pueda actualizarse sola, con el paso 4 cerrado
    const cia = options.cia === false ? undefined : (options.cia ?? ciaSourceFromEnv());
    let ciaServing: { source: CiaSource; port: number } | undefined;
    if (cia && !existsSync(cia.path)) {
      log(`.cia no encontrado, no se sirve: ${cia.path}`);
    } else if (cia) {
      const ciaPort = options.ciaPort ?? CIA_PORT;
      const abrirCia = async (): Promise<boolean> => {
        try {
          const server = await startCiaServer(cia, ciaPort, options.ciaHost, log);
          if (stopped) {
            await server.close();
            return true;
          }
          closers.push(() => server.close());
          ciaServing = { source: cia, port: server.port };
          log(`sirviendo el .cia (${cia.version ? `versión ${cia.version}` : "sin versión"}) en el puerto ${server.port}`);
          return true;
        } catch (err) {
          log(`no se pudo abrir el puerto ${ciaPort} para el .cia: ${err instanceof Error ? err.message : String(err)}`);
          return false;
        }
      };
      if (!(await abrirCia())) {
        // otro programa tiene el puerto: el puente arranca igual y lo reintenta hasta poder (cuando se libere, la 3DS ya recibe el aviso)
        const retryMs = options.ciaRetryMs ?? 5000;
        if (retryMs > 0) {
          let intentando = false;
          const timer = setInterval(() => {
            if (intentando || ciaServing || stopped) return;
            intentando = true;
            void abrirCia().then((ok) => {
              intentando = false;
              if (ok) clearInterval(timer);
            });
          }, retryMs);
          timer.unref();
          closers.push(() => clearInterval(timer));
        }
      }
    }
    let consoleLocalIp: string | undefined;
    let consoleVersion: string | undefined;
    // el servidor de consola se crea después de la API: se enlazan por aquí
    let consoleCtl: Pick<ConsoleServerHandle, "disconnect" | "connectedIds"> | undefined;
    const api = await startHttpApi({
      store,
      pairing,
      counter,
      port: options.apiPort ?? DEFAULT_PORTS.api,
      apiToken,
      devices,
      disconnectDevice: (id) => consoleCtl?.disconnect(id) ?? false,
      connectedDevices: () => consoleCtl?.connectedIds() ?? [],
      cia: () => (ciaServing ? { serving: true, port: ciaServing.port, ...(ciaServing.source.version ? { version: ciaServing.source.version } : {}) } : { serving: false }),
      consoleLocalIp: () => consoleLocalIp,
      consoleVersion: () => consoleVersion,
      info: { version: bridgeVersion(), startedBy: options.startedBy ?? startedByFromEnv() },
      onShutdown: options.onShutdown,
      log,
    });
    closers.push(() => api.close());
    const simulatorOn = options.simulator ?? process.env.COMPANION_SIMULATOR !== "0";
    let ws: { port: number; close(): Promise<void> } | undefined;
    if (simulatorOn) {
      ws = await startWsServer({
        store,
        feed,
        counter,
        port: options.wsPort ?? DEFAULT_PORTS.ws,
        staticDir: options.staticDir ?? process.env.COMPANION_STATIC_DIR ?? join(REPO_ROOT, "packages/simulator/public"),
        apiToken,
        log,
      });
      const abierto = ws;
      closers.push(() => abierto.close());
    } else {
      log("simulador desactivado (COMPANION_SIMULATOR=0): no se abre el puerto del WebSocket");
    }
    const consoleServer = await startConsoleServer({
      store,
      feed,
      counter,
      devices,
      pairing,
      port: options.consolePort ?? DEFAULT_PORTS.console,
      host: options.consoleHost,
      handshakeTimeoutMs: options.handshakeTimeoutMs,
      idleTimeoutMs: options.idleTimeoutMs,
      ciaNow: () => ciaServing,
      onConsoleLocalIp: (ip) => {
        consoleLocalIp = ip;
      },
      onConsoleVersion: (v) => {
        consoleVersion = v;
      },
      log,
    });
    consoleCtl = consoleServer;
    closers.push(() => consoleServer.close());
    if (options.beacon !== false) {
      const beacon = startBeacon({
        consolePort: consoleServer.port,
        udpPort: options.udpPort ?? DEFAULT_PORTS.udp,
        intervalMs: options.beaconIntervalMs,
      });
      closers.push(() => beacon.stop());
    }
    return {
      store,
      face,
      pairing,
      devices,
      dataDir,
      apiToken,
      // `cia` se consulta en vivo: el puerto puede conseguirse más tarde (reintento)
      ports: {
        console: consoleServer.port,
        api: api.port,
        ws: ws?.port,
        get cia() {
          return ciaServing?.port;
        },
      },
      ...(ciaServing ? { cia: ciaServing.source } : {}),
      stop,
    };
  } catch (err) {
    await stop();
    throw err;
  }
}

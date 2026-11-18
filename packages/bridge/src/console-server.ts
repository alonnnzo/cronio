import { createServer, type Server, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  FrameDecoder,
  FrameOpener,
  FrameSealer,
  FrameType,
  encodeFrame,
  helloMac,
  helloMacV2,
  macEquals,
  parseConsoleMessage,
  parseVersion,
  sessionKey,
  sessionKeyV2,
  welcomeMac,
  welcomeMacV2,
  type InstallKind,
  type BridgeMessage,
  type UpdateView,
} from "@companion/protocol";
import type { BridgeStore } from "./store.ts";
import type { DeviceStore } from "./devices.ts";
import type { PairingManager } from "./pairing.ts";
import { applyConsoleMessage, type ConsoleCounter, type ViewFeed } from "./feed.ts";
import { updateFor, type CiaSource } from "./update.ts";
import { legacyView } from "./legacy-view.ts";

export interface ConsoleServerOptions {
  store: BridgeStore;
  feed: ViewFeed;
  counter: ConsoleCounter;
  devices: DeviceStore;
  pairing: PairingManager;
  port: number;
  /** Por defecto 0.0.0.0 (la consola está en la LAN). */
  host?: string;
  /** Plazo para completar el saludo. Por defecto 5 s. */
  handshakeTimeoutMs?: number;
  /** Cierre tras este tiempo sin recibir nada. Por defecto 15 s. */
  idleTimeoutMs?: number;
  /** El .cia que el puente sirve (con su versión): a la consola con una versión menor se le avisa con `update` en la vista. */
  cia?: CiaSource;
  /** Puerto desde el que se sirve el .cia (el de la dirección que lleva `update.url`). Por defecto 33337. */
  ciaPort?: number;
  /** Como `cia` + `ciaPort`, pero se consulta en cada saludo: sirve cuando el puente consigue el puerto del .cia más tarde. Tiene prioridad. */
  ciaNow?: () => { source: CiaSource; port: number } | undefined;
  /** Se llama con la IPv4 local del socket cada vez que una consola completa el saludo (la IP del PC que esa consola alcanza). */
  onConsoleLocalIp?: (ip: string) => void;
  /** Versión de la app de la consola que acaba de conectarse (undefined si no la dijo). */
  onConsoleVersion?: (version: string | undefined) => void;
  log?: (msg: string) => void;
}

const HelloSchema = z.object({
  t: z.literal("hello"),
  // 1: consola anterior, sin cifrado (el puente solo la deja actualizarse); 2: cifrada. La versión entra en el MAC del hello de la v2.
  v: z.union([z.literal(1), z.literal(2)]),
  // el id llega de la red y acaba en logs y archivos: solo letras, números, _ y - (la consola genera "3ds-" + 8 hex)
  deviceId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  nonceC: z.string().regex(/^[0-9a-f]{32}$/i),
  mac: z.string().regex(/^[0-9a-f]{64}$/i),
  // opcionales y sin validar aquí (un cliente anterior no los manda): una versión que no se entiende cuenta como desconocida.
  // En la v2 entran tal cual en el MAC del hello y se exigen bien formados (ver onHello)
  appVersion: z.unknown().optional(),
  install: z.unknown().optional(),
});

const text = new TextDecoder();

/**
 * Topes de conexiones: simultáneas del servidor, sin autenticar en total (así quedan MAX_CONNECTIONS - MAX_UNAUTHENTICATED plazas
 * reservadas para las autenticadas) y sin autenticar por IP remota. Con las plazas sin autenticar llenas, la conexión nueva desplaza a la
 * más antigua sin autenticar: quien las ocupe sin hablar no puede dejar fuera a la consola de verdad.
 */
export const MAX_CONNECTIONS = 16;
export const MAX_UNAUTHENTICATED = 8;
export const MAX_UNAUTHENTICATED_PER_IP = 4;
/** Los saludos rechazados se registran como mucho una vez por IP cada tanto: un intruso no llena el registro. */
export const REJECT_LOG_INTERVAL_MS = 10_000;

/** Texto que llegó de la red, listo para un registro: entre comillas, escapado y corto (sin saltos de línea ni caracteres de control). */
export const safeLog = (value: unknown, max = 80): string => JSON.stringify(String(value).slice(0, max));

const normalizeIp = (addr: string | undefined): string => (addr ?? "desconocida").replace(/^::ffff:/i, "");
/** IPv4 local del socket (sin el prefijo de IPv4 mapeada en IPv6), o `undefined` si no es una IPv4. */
const normalizeLocalIp = (addr: string | undefined): string | undefined => {
  const ip = addr?.replace(/^::ffff:/i, "");
  return ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : undefined;
};

interface Handle {
  kick(): void;
}

export interface ConsoleServerHandle {
  port: number;
  /** Corta las conexiones de esa consola (la clave ya debe estar borrada de `devices.json`: al reconectar tendrá que emparejarse de nuevo). */
  disconnect(deviceId: string): boolean;
  /** Ids de las consolas con una conexión autenticada ahora mismo (también las v1, que solo pueden actualizarse). */
  connectedIds(): string[];
  close(): Promise<void>;
}

export async function startConsoleServer(options: ConsoleServerOptions): Promise<ConsoleServerHandle> {
  const { store, feed, counter, devices, pairing } = options;
  const handshakeMs = options.handshakeTimeoutMs ?? 5000;
  const idleMs = options.idleTimeoutMs ?? 15_000;
  const log = options.log ?? (() => {});
  const sockets = new Set<Socket>();
  /** Qué consola está detrás de cada conexión ya autenticada. */
  const deviceBySocket = new Map<Socket, string>();
  let current: Handle | null = null;
  const unauthenticatedByIp = new Map<string, number>();
  /** Conexiones sin autenticar, de la más antigua a la más nueva. */
  const unauthenticated = new Set<Socket>();
  const lastRejectLog = new Map<string, number>();
  /** Registra un rechazo como mucho una vez por IP (y tipo) cada REJECT_LOG_INTERVAL_MS. */
  const logRejectLimited = (ip: string, kind: string, msg: string) => {
    const now = Date.now();
    const key = `${kind}|${ip}`;
    if (now - (lastRejectLog.get(key) ?? -Infinity) < REJECT_LOG_INTERVAL_MS) return;
    if (lastRejectLog.size >= 256) for (const [k, t] of lastRejectLog) if (now - t >= REJECT_LOG_INTERVAL_MS) lastRejectLog.delete(k);
    lastRejectLog.set(key, now);
    log(msg);
  };

  const server: Server = createServer((socket) => {
    const remoteIp = normalizeIp(socket.remoteAddress);
    if ((unauthenticatedByIp.get(remoteIp) ?? 0) >= MAX_UNAUTHENTICATED_PER_IP) {
      socket.on("error", () => {});
      socket.destroy();
      return;
    }
    if (unauthenticated.size >= MAX_UNAUTHENTICATED || sockets.size >= MAX_CONNECTIONS) {
      const oldest = unauthenticated.values().next().value;
      if (!oldest) {
        // solo hay autenticadas: no se desplaza a nadie
        socket.on("error", () => {});
        socket.destroy();
        return;
      }
      unauthenticated.delete(oldest);
      sockets.delete(oldest);
      oldest.destroy();
    }
    unauthenticated.add(socket);
    unauthenticatedByIp.set(remoteIp, (unauthenticatedByIp.get(remoteIp) ?? 0) + 1);
    let counted = true;
    const markAuthenticated = () => {
      unauthenticated.delete(socket);
      if (!counted) return;
      counted = false;
      const n = (unauthenticatedByIp.get(remoteIp) ?? 1) - 1;
      if (n <= 0) unauthenticatedByIp.delete(remoteIp);
      else unauthenticatedByIp.set(remoteIp, n);
    };
    sockets.add(socket);
    socket.setNoDelay(true);

    const decoder = new FrameDecoder();
    const nonceB = randomBytes(16);
    let closed = false;
    let failed = false;
    let key: Buffer | null = null;
    let sealer: FrameSealer | null = null;
    let opener: FrameOpener | null = null;
    /** Consola v1 (en claro): solo puede actualizarse, ver `legacyView`. */
    let legacy = false;
    /** Tipos de mensaje de una consola v1 ya anotados como ignorados (uno por tipo y conexión: no llena el registro). */
    const ignoredLegacy = new Set<string>();
    let release: (() => void) | null = null;
    let unsubscribe: (() => void) | null = null;
    let deviceId: string | null = null;
    let connectedAt = 0;
    let closeCause: string | null = null;
    /** `update` para esta consola (hay una versión nueva): se calcula de nuevo en cada vista (si el .cia cambia en disco, el hash va al día). */
    let computeUpdate: () => UpdateView | undefined = () => undefined;
    /** Instante hasta el que la consola avisó (`hold`) que no hablará: el teclado del sistema congela la app. */
    let holdUntil = 0;
    const destroyBecause = (cause: string) => {
      closeCause ??= cause;
      socket.destroy();
    };
    /**
     * Una excepción al procesar esta conexión: queda en el registro con su mensaje (saneado y corto) en el momento, no solo al cerrar,
     * y cierra solo este socket. Las de conexiones sin autenticar se limitan por IP para que nadie llene el registro.
     */
    const failConnection = (what: string, err: unknown) => {
      const detail = `${what}: ${safeLog(err instanceof Error ? err.message : err, 200)}`;
      const who = deviceId !== null ? safeLog(deviceId) : `sin autenticar, ${safeLog(remoteIp)}`;
      const line = `error en una conexión de consola (${who}): ${detail}`;
      if (deviceId !== null) log(line);
      else logRejectLimited(remoteIp, "error", line);
      destroyBecause(detail);
    };
    socket.on("error", (err: NodeJS.ErrnoException) => {
      closeCause ??= `error de red ${safeLog(err.code ?? err.message, 60)}`;
    });
    const me: Handle = { kick: () => destroyBecause("reemplazada por otra conexión") };

    const handshakeTimer = setTimeout(() => socket.destroy(), handshakeMs);
    handshakeTimer.unref();
    let idleTimer: NodeJS.Timeout;
    const resetIdle = () => {
      clearTimeout(idleTimer);
      // durante un `hold` el silencio es esperado: el plazo cuenta desde que termina
      const wait = idleMs + Math.max(0, holdUntil - Date.now());
      idleTimer = setTimeout(() => destroyBecause(`sin datos durante ${Math.round(wait / 1000)} s`), wait);
      idleTimer.unref();
    };
    resetIdle();

    const sendPlain = (msg: unknown) => socket.write(encodeFrame(FrameType.JSON, Buffer.from(JSON.stringify(msg))));
    const sendSealed = (type: number, payload: Uint8Array) => {
      if (closed || !sealer) return;
      try {
        socket.write(encodeFrame(type, sealer.seal(type, payload)));
      } catch (err) {
        failConnection("error al enviar", err);
      }
    };
    const sendView = (msg: BridgeMessage) => {
      // se llama desde el feed, que sirve a otros suscriptores: una excepción aquí no debe salir de esta conexión
      try {
        const update = msg.t === "view" ? computeUpdate() : undefined;
        sendSealed(FrameType.JSON, Buffer.from(JSON.stringify(update && msg.t === "view" ? { ...msg, view: { ...msg.view, update } } : msg)));
      } catch (err) {
        failConnection("error al preparar la vista", err);
      }
    };

    const failHandshake = () => {
      failed = true;
      try {
        socket.end(encodeFrame(FrameType.JSON, Buffer.from(JSON.stringify({ t: "error", code: "auth" }))));
      } catch {
        socket.destroy();
      }
    };

    const onHello = (payload: Uint8Array) => {
      const hello = HelloSchema.parse(JSON.parse(text.decode(payload)));
      const nonceC = Buffer.from(hello.nonceC, "hex");
      const known = devices.get(hello.deviceId);
      const v2 = hello.v === 2;
      // v2: `appVersion` e `install` van en el MAC tal como llegaron, así que tienen que ser exactamente lo que la consola manda o nada
      let rawVersion: string | undefined;
      let rawInstall: InstallKind | undefined;
      if (v2) {
        if (hello.appVersion !== undefined) {
          if (typeof hello.appVersion !== "string" || !parseVersion(hello.appVersion)) throw new Error("appVersion inválido en el saludo v2");
          rawVersion = hello.appVersion;
        }
        if (hello.install !== undefined) {
          if (hello.install !== "cia" && hello.install !== "3dsx") throw new Error("install inválido en el saludo v2");
          rawInstall = hello.install;
        }
      }
      const macOk = (candidate: Buffer) =>
        macEquals(
          Buffer.from(hello.mac, "hex"),
          v2 ? helloMacV2(candidate, nonceB, nonceC, hello.deviceId, rawVersion, rawInstall) : helloMac(candidate, nonceB, nonceC),
        );
      let k: Buffer | null = null;
      let viaPairing = false;
      if (known) {
        const stored = Buffer.from(known.keyHex, "hex");
        if (macOk(stored)) k = stored;
      }
      if (!k && pairing.hasPending) {
        // dispositivo desconocido, o conocido cuya clave guardada falla: se prueba la clave derivada del código.
        // Es un intento de emparejamiento: se limita el ritmo y, si se excede, no se evalúa el código.
        if (!pairing.allowAttempt(remoteIp)) {
          logRejectLimited(remoteIp, "pairing", `intento de emparejamiento limitado desde ${safeLog(remoteIp)}`);
          return failHandshake();
        }
        const candidate = pairing.candidateKey(hello.deviceId);
        if (candidate && macOk(candidate)) {
          k = candidate;
          viaPairing = true;
        }
      }
      if (!k) {
        logRejectLimited(remoteIp, "hello", `saludo rechazado de ${safeLog(hello.deviceId)} desde ${safeLog(remoteIp)}`);
        return failHandshake();
      }
      if (viaPairing) {
        pairing.confirm(hello.deviceId, k);
        log(`dispositivo ${known ? "re-emparejado" : "emparejado"}: ${safeLog(hello.deviceId)}`);
      }
      key = k;
      markAuthenticated();
      clearTimeout(handshakeTimer);
      sendPlain({ t: "welcome", mac: (v2 ? welcomeMacV2(k, nonceB, nonceC) : welcomeMac(k, nonceB, nonceC)).toString("hex") });
      const ks = v2 ? sessionKeyV2(k, nonceB, nonceC) : sessionKey(k, nonceB, nonceC);
      sealer = new FrameSealer(ks, 1, v2 ? 2 : 1);
      opener = new FrameOpener(ks, 2, v2 ? 2 : 1);
      legacy = !v2;

      deviceId = hello.deviceId;
      deviceBySocket.set(socket, hello.deviceId);
      connectedAt = Date.now();
      // una consola v1 no cuenta como consola conectada (no puede aprobar nada: los permisos se contestan en el PC) ni reemplaza a la v2
      if (!legacy) {
        // la nueva consola reemplaza a la anterior; se registra antes para no soltar las pendientes
        release = counter.acquire("device");
        const previous = current;
        current = me;
        previous?.kick();
      }
      // versión de la app de la consola: sin `appVersion` (o ilegible) es desconocida y no se le avisa de nada
      const version = typeof hello.appVersion === "string" && parseVersion(hello.appVersion) ? hello.appVersion : undefined;
      const install = hello.install === "cia" || hello.install === "3dsx" ? hello.install : undefined;
      // la IP del PC que la consola puede alcanzar es la de este mismo socket
      const localIp = normalizeLocalIp(socket.localAddress);
      if (localIp) options.onConsoleLocalIp?.(localIp);
      options.onConsoleVersion?.(version);
      computeUpdate = () => {
        const ciaNow = options.ciaNow?.();
        return ciaNow
          ? updateFor(ciaNow.source, version, localIp, ciaNow.port)
          : options.ciaNow
            ? undefined
            : updateFor(options.cia, version, localIp, options.ciaPort);
      };
      const update = computeUpdate();
      if (legacy) {
        // solo la vista mínima, una vez: sin suscribirse a la vista del puente, nada de lo que pase en las sesiones llega por la v1
        sendSealed(FrameType.JSON, Buffer.from(JSON.stringify(legacyView(update))));
      } else {
        unsubscribe = feed.subscribe(sendView);
        sendView(feed.snapshot());
      }
      log(
        `consola conectada${legacy ? " en v1 (sin cifrado: solo puede actualizarse)" : ""}: ${safeLog(hello.deviceId)} (app ${version ? safeLog(version, 20) : "de versión desconocida"}${install ? `, ${install}` : ""})${update ? `; hay una versión nueva: ${update.version}` : ""}`,
      );
    };

    const onSealed = (type: number, payload: Uint8Array) => {
      const body = opener!.open(type, payload);
      // un `hold` anuncia silencio; cualquier otra trama es señal de que la consola volvió y el plazo normal rige de nuevo
      const msg = type === FrameType.JSON ? parseConsoleMessage(JSON.parse(text.decode(body))) : null;
      const heldBefore = holdUntil !== 0;
      holdUntil = msg?.t === "hold" ? Date.now() + msg.seconds * 1000 : 0;
      if (heldBefore || holdUntil !== 0) resetIdle();
      if (legacy) {
        // consola v1: del puente no sale contenido y nada de lo que mande se aplica. Solo se atienden `hold` (arriba) y los ping
        if (msg && msg.t !== "hold" && !ignoredLegacy.has(msg.t)) {
          ignoredLegacy.add(msg.t);
          log(`mensaje de una consola v1 ignorado (solo puede actualizarse): ${safeLog(msg.t, 30)}`);
        }
        if (type === FrameType.PING) sendSealed(FrameType.PONG, body);
        else if (!msg && type !== FrameType.AUDIO) throw new Error("tipo de trama desconocido");
      } else if (msg) {
        const reply = applyConsoleMessage(store, msg, log);
        if (reply) sendView(reply); // p. ej. `text` en respuesta a `read`: solo a esta consola
      } else if (type === FrameType.PING) {
        sendSealed(FrameType.PONG, body);
      } else if (type !== FrameType.AUDIO) {
        throw new Error("tipo de trama desconocido");
      }
    };

    socket.on("data", (chunk: Buffer) => {
      resetIdle();
      try {
        for (const frame of decoder.push(chunk)) {
          if (closed || failed) return;
          if (!key) {
            // antes del saludo solo se admite JSON
            if (frame.type !== FrameType.JSON) throw new Error("trama inesperada antes del saludo");
            onHello(frame.payload);
            if (!key) return;
          } else {
            onSealed(frame.type, frame.payload);
          }
        }
      } catch (err) {
        // el mensaje puede traer un trozo de lo que mandó el otro lado (p. ej. un JSON roto): va escapado y corto
        failConnection("trama o mensaje inválido", err);
      }
    });

    socket.on("close", () => {
      closed = true;
      if (deviceId !== null) {
        const secs = Math.round((Date.now() - connectedAt) / 1000);
        log(`consola desconectada: ${safeLog(deviceId)} (${closeCause ?? "la consola cerró la conexión"}) tras ${secs} s`);
      }
      markAuthenticated();
      sockets.delete(socket);
      deviceBySocket.delete(socket);
      clearTimeout(handshakeTimer);
      clearTimeout(idleTimer);
      unsubscribe?.();
      release?.();
      if (current === me) current = null;
    });

    // desafío inicial, sin etiqueta
    sendPlain({ t: "challenge", v: 1, nonceB: nonceB.toString("hex") });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host ?? "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });
  // el tope de verdad (MAX_CONNECTIONS, con plazas reservadas) lo aplica el manejador; este es solo la red de seguridad de Node
  server.maxConnections = MAX_CONNECTIONS * 2;
  // tras listen un error del servidor no debe tumbar el proceso: se registra y se sigue
  server.on("error", (err) => log(`error del servidor de consola: ${safeLog(err, 200)}`));
  const port = (server.address() as { port: number }).port;

  return {
    port,
    disconnect: (deviceId) => {
      let cut = false;
      for (const [s, id] of [...deviceBySocket]) {
        if (id !== deviceId) continue;
        cut = true;
        s.destroy();
      }
      return cut;
    },
    connectedIds: () => [...new Set(deviceBySocket.values())],
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

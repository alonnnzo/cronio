import { connect, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import {
  FrameDecoder,
  FrameOpener,
  FrameSealer,
  FrameType,
  deriveDeviceKey,
  encodeFrame,
  helloMac,
  helloMacV2,
  macEquals,
  parseBridgeMessage,
  sessionKey,
  sessionKeyV2,
  welcomeMac,
  welcomeMacV2,
  type BridgeMessage,
  type ConsoleMessage,
  type ViewModel,
} from "@companion/protocol";

export interface FakeConsoleOptions {
  port: number;
  host?: string;
  deviceId: string;
  /** Código de emparejamiento (o cualquier cadena, para probar una clave incorrecta). */
  code: string;
  /** Versión de la app que dice tener en el saludo (`appVersion`); sin ella, como un cliente anterior. Puede ser cualquier cosa (pruebas de basura). */
  appVersion?: unknown;
  /** `install` del saludo: `cia` o `3dsx`. */
  install?: unknown;
  /** Versión del protocolo que habla: 2 (cifrada, por defecto) o 1 (consola anterior, sin cifrado: el puente solo la deja actualizarse). */
  protocolVersion?: 1 | 2;
  /** Pruebas de ataque: el `v` que sale en el hello, aunque el MAC se calcule con `protocolVersion`. */
  helloVersionOverride?: unknown;
}

/**
 * Cliente de consola en TypeScript: saludo, sellado, vistas recibidas y decisiones enviadas.
 * Sirve de referencia para el cliente en C.
 */
export class FakeConsole {
  readonly views: { rev: number; view: ViewModel }[] = [];
  readonly pongs: Uint8Array[] = [];
  /** Mensajes `text` (respuesta a `read`) recibidos. */
  readonly texts: Extract<BridgeMessage, { t: "text" }>[] = [];
  /** Tramas selladas recibidas del puente, tal como llegaron (para reflejarlas de vuelta). */
  readonly sealedFrames: Uint8Array[] = [];
  closed = false;

  private readonly decoder = new FrameDecoder();
  private sealer: FrameSealer | null = null;
  private opener: FrameOpener | null = null;
  private readonly k: Buffer;
  private nonceC = randomBytes(16);
  private nonceB: Buffer | null = null;
  private readonly version: 1 | 2;
  private onReady!: { resolve: () => void; reject: (e: Error) => void };

  private constructor(private readonly socket: Socket, private readonly opts: FakeConsoleOptions) {
    this.k = deriveDeviceKey(opts.code, opts.deviceId);
    this.version = opts.protocolVersion ?? 2;
    socket.on("data", (chunk: Buffer) => {
      try {
        for (const f of this.decoder.push(chunk)) this.onFrame(f.type, f.payload);
      } catch (err) {
        this.onReady.reject(err as Error);
        socket.destroy();
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      this.closed = true;
      this.onReady.reject(new Error("cerrada antes del saludo"));
    });
  }

  /** Conecta y completa el saludo; rechaza con `Error("auth")` si el puente responde error. */
  static async connect(opts: FakeConsoleOptions): Promise<FakeConsole> {
    const socket = connect({ port: opts.port, host: opts.host ?? "127.0.0.1" });
    socket.setNoDelay(true);
    const c = new FakeConsole(socket, opts);
    const ready = new Promise<void>((resolve, reject) => (c.onReady = { resolve, reject }));
    await ready;
    return c;
  }

  private onFrame(type: number, payload: Uint8Array): void {
    if (!this.opener) {
      const msg = JSON.parse(Buffer.from(payload).toString("utf8")) as Record<string, string>;
      if (msg.t === "challenge") {
        this.nonceB = Buffer.from(msg.nonceB!, "hex");
        const mac = (
          this.version === 2
            ? helloMacV2(this.k, this.nonceB, this.nonceC, this.opts.deviceId, this.opts.appVersion as string | undefined, this.opts.install as "cia" | "3dsx" | undefined)
            : helloMac(this.k, this.nonceB, this.nonceC)
        ).toString("hex");
        this.socket.write(
          encodeFrame(
            FrameType.JSON,
            Buffer.from(JSON.stringify({
                t: "hello",
                v: this.opts.helloVersionOverride ?? this.version,
                deviceId: this.opts.deviceId,
                nonceC: this.nonceC.toString("hex"),
                mac,
                ...(this.opts.appVersion !== undefined ? { appVersion: this.opts.appVersion } : {}),
                ...(this.opts.install !== undefined ? { install: this.opts.install } : {}),
              })),
          ),
        );
      } else if (msg.t === "welcome") {
        const v2 = this.version === 2;
        const want = v2 ? welcomeMacV2(this.k, this.nonceB!, this.nonceC) : welcomeMac(this.k, this.nonceB!, this.nonceC);
        if (!macEquals(Buffer.from(msg.mac!, "hex"), want)) throw new Error("welcome inválido");
        const ks = v2 ? sessionKeyV2(this.k, this.nonceB!, this.nonceC) : sessionKey(this.k, this.nonceB!, this.nonceC);
        this.sealer = new FrameSealer(ks, 2, this.version);
        this.opener = new FrameOpener(ks, 1, this.version);
        this.onReady.resolve();
      } else if (msg.t === "error") {
        this.onReady.reject(new Error(msg.code));
      }
      return;
    }
    this.sealedFrames.push(encodeFrame(type, payload));
    const body = this.opener.open(type, payload);
    if (type === FrameType.JSON) {
      const msg = parseBridgeMessage(JSON.parse(Buffer.from(body).toString("utf8")));
      if (msg.t === "view") this.views.push({ rev: msg.rev, view: msg.view });
      else if (msg.t === "text") this.texts.push(msg);
    } else if (type === FrameType.PONG) {
      this.pongs.push(body);
    }
  }

  get lastView(): ViewModel | undefined {
    return this.views[this.views.length - 1]?.view;
  }

  /** Envía un mensaje sellado y devuelve los bytes exactos escritos (para repetirlos). */
  send(msg: ConsoleMessage): Uint8Array {
    return this.sendSealed(FrameType.JSON, Buffer.from(JSON.stringify(msg)));
  }

  ping(payload: Uint8Array): void {
    this.sendSealed(FrameType.PING, payload);
  }

  sendSealed(type: number, payload: Uint8Array): Uint8Array {
    const bytes = encodeFrame(type, this.sealer!.seal(type, payload));
    this.socket.write(bytes);
    return bytes;
  }

  /** Escribe bytes tal cual, sin sellar. */
  sendRaw(bytes: Uint8Array): void {
    this.socket.write(bytes);
  }

  close(): void {
    this.socket.destroy();
  }
}

import { deriveDeviceKey, generatePairingCode } from "@companion/protocol";
import type { DeviceStore } from "./devices.ts";

export interface AttemptLimiterOptions {
  /** Separación mínima entre intentos de una misma IP. Por defecto 1000 ms; 0 la desactiva. */
  perIpIntervalMs?: number;
  /** Tope de intentos por segundo entre todas las IP. Por defecto 5. */
  globalPerSecond?: number;
  now?: () => number;
}

/**
 * Limita el ritmo de intentos de emparejamiento: 1 por IP cada `perIpIntervalMs` y `globalPerSecond` en total.
 * Los intentos rechazados no consumen cupo.
 */
export class AttemptLimiter {
  private readonly lastByIp = new Map<string, number>();
  private recent: number[] = [];
  private readonly perIpIntervalMs: number;
  private readonly globalPerSecond: number;
  private readonly now: () => number;

  constructor(options: AttemptLimiterOptions = {}) {
    this.perIpIntervalMs = options.perIpIntervalMs ?? 1000;
    this.globalPerSecond = options.globalPerSecond ?? 5;
    this.now = options.now ?? Date.now;
  }

  /** ¿Se admite un intento desde `ip` ahora? Si sí, lo registra. */
  tryAcquire(ip: string): boolean {
    const t = this.now();
    this.recent = this.recent.filter((x) => t - x < 1000);
    for (const [k, last] of this.lastByIp) if (t - last >= this.perIpIntervalMs) this.lastByIp.delete(k);
    const last = this.lastByIp.get(ip);
    if (last !== undefined && t - last < this.perIpIntervalMs) return false;
    if (this.recent.length >= this.globalPerSecond) return false;
    this.lastByIp.set(ip, t);
    this.recent.push(t);
    return true;
  }
}

export interface PairingOptions extends AttemptLimiterOptions {
  /** Vigencia del código. Por defecto 5 minutos. */
  ttlMs?: number;
}

/**
 * Un único código pendiente a la vez: vigente y de un solo uso. El código no se invalida por fallos
 * (con 80 bits no aporta seguridad y permitiría sabotear el emparejamiento); en su lugar se limita el ritmo de intentos.
 */
export class PairingManager {
  private code: string | null = null;
  private expiresAt = 0;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly limiter: AttemptLimiter;

  constructor(private readonly devices: DeviceStore, options: PairingOptions = {}) {
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
    this.now = options.now ?? Date.now;
    this.limiter = new AttemptLimiter({ ...options, now: this.now });
  }

  /** Genera un código nuevo (reemplaza al pendiente, si lo hay). */
  createCode(): { code: string; expiresInS: number } {
    this.code = generatePairingCode();
    this.expiresAt = this.now() + this.ttlMs;
    return { code: this.code, expiresInS: Math.round(this.ttlMs / 1000) };
  }

  get hasPending(): boolean {
    if (this.code !== null && this.now() >= this.expiresAt) this.code = null;
    return this.code !== null;
  }

  /** Clave candidata para un deviceId, o null si no hay código vigente. */
  candidateKey(deviceId: string): Buffer | null {
    return this.hasPending ? deriveDeviceKey(this.code!, deviceId) : null;
  }

  /** Reserva un intento de emparejamiento para `ip`; false si excede el ritmo permitido. */
  allowAttempt(ip: string): boolean {
    return this.limiter.tryAcquire(ip);
  }

  /** Saludo correcto: guarda (o reemplaza) el dispositivo y consume el código. */
  confirm(deviceId: string, key: Buffer): void {
    const name = this.devices.get(deviceId)?.name ?? deviceId;
    this.devices.add({ deviceId, name, keyHex: key.toString("hex"), pairedAt: new Date().toISOString() });
    this.code = null;
  }
}

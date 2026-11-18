import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { chacha20Xor } from "./chacha20.ts";
import type { InstallKind } from "./version.ts";

export const TAG_LENGTH = 16;
const PAIR_SALT = "3dsac-pair-v1";
// Base32 de Crockford: sin I, L, O, U.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/** Código de 80 bits en 16 caracteres Crockford: "XXXX-XXXX-XXXX-XXXX". */
export function generatePairingCode(): string {
  const bytes = randomBytes(10);
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let chars = "";
  for (let i = 15; i >= 0; i--) chars += CROCKFORD[Number((bits >> BigInt(i * 5)) & 31n)];
  return chars.match(/.{4}/g)!.join("-");
}

export function normalizeCode(code: string): string {
  return code.replace(/-/g, "").toUpperCase();
}

export function deriveDeviceKey(code: string, deviceId: string): Buffer {
  const key = hkdfSync("sha256", Buffer.from(normalizeCode(code), "ascii"), PAIR_SALT, Buffer.from(deviceId, "utf8"), 32);
  return Buffer.from(key);
}

function hmac(key: Buffer, ...parts: (string | Uint8Array)[]): Buffer {
  const h = createHmac("sha256", key);
  for (const p of parts) h.update(p);
  return h.digest();
}

export function helloMac(k: Buffer, nonceB: Buffer, nonceC: Buffer): Buffer {
  return hmac(k, "hello", nonceB, nonceC);
}

export function welcomeMac(k: Buffer, nonceB: Buffer, nonceC: Buffer): Buffer {
  return hmac(k, "welcome", nonceC, nonceB);
}

export function sessionKey(k: Buffer, nonceB: Buffer, nonceC: Buffer): Buffer {
  return hmac(k, "session", nonceB, nonceC);
}

/** Compara en tiempo constante; false si los largos difieren. */
export function macEquals(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Versiones del protocolo de la consola. La v1 va en claro (solo autenticada): el puente la admite únicamente en modo «solo actualizar». La v2 cifra. */
export type ProtocolVersion = 1 | 2;
export const PROTOCOL_V2 = 2;

const u8 = (n: number): Buffer => Buffer.from([n & 0xff]);
/** Campo con largo (u8) delante: así dos campos contiguos no se confunden entre sí. */
const lp = (s: string): Buffer => {
  const b = Buffer.from(s, "utf8");
  if (b.length > 255) throw new AuthError("campo del saludo demasiado largo");
  return Buffer.concat([u8(b.length), b]);
};

/**
 * MAC del hello de la v2. Cubre la versión anunciada, el id, `appVersion` e `install` (la v1 los dejaba fuera): quien altere cualquiera
 * de ellos, incluida la versión para forzar la v1, hace fallar el saludo. `appVersion` ausente cuenta como cadena vacía; `install`
 * ausente, 0 (cia = 1, 3dsx = 2).
 */
export function helloMacV2(k: Buffer, nonceB: Buffer, nonceC: Buffer, deviceId: string, appVersion?: string, install?: InstallKind): Buffer {
  const inst = install === "cia" ? 1 : install === "3dsx" ? 2 : 0;
  return hmac(k, "hello2", nonceB, nonceC, u8(PROTOCOL_V2), lp(deviceId), lp(appVersion ?? ""), u8(inst));
}

/** MAC del welcome de la v2: con la versión dentro, la consola sabe que el puente contestó en v2 y no en otra. */
export function welcomeMacV2(k: Buffer, nonceB: Buffer, nonceC: Buffer): Buffer {
  return hmac(k, "welcome2", nonceC, nonceB, u8(PROTOCOL_V2));
}

/** Clave de sesión de la v2. Distinta de la de la v1 aunque los nonces y K sean los mismos. */
export function sessionKeyV2(k: Buffer, nonceB: Buffer, nonceC: Buffer): Buffer {
  return hmac(k, "session2", nonceB, nonceC, u8(PROTOCOL_V2));
}

/** Subclave de la v2 al estilo HKDF-Expand (un solo bloque: T(1) = HMAC(Ks, info | 0x01)); `label` distingue el uso y la dirección. */
export function subKeyV2(ks: Buffer, label: "enc-b2c" | "enc-c2b" | "mac-b2c" | "mac-c2b"): Buffer {
  return hmac(ks, `3dsac-v2 ${label}`, Buffer.from([1]));
}

/** El contador de tramas ocupa 32 bits y es parte del nonce de la v2: la trama con el contador 2^32-1 no se usa, para que no se repita nunca. */
const MAX_COUNTER = 0xffffffff;

function counterHead(dir: number, counter: number, type: number): Buffer {
  const head = Buffer.alloc(6);
  head[0] = dir;
  head.writeUInt32LE(counter >>> 0, 1);
  head[5] = type;
  return head;
}

/** ChaCha20 (RFC 8439) con bloque inicial 0 y nonce de 12 bytes: el contador de la trama (u32 LE) y ceros. En TypeScript puro porque el puente corre en Electron (BoringSSL), que no trae `chacha20` en node:crypto. */
function chacha(key: Buffer, counter: number, data: Uint8Array): Buffer {
  const nonce = new Uint8Array(12);
  new DataView(nonce.buffer).setUint32(0, counter >>> 0, true);
  const out = chacha20Xor(key, nonce, 0, data);
  return Buffer.from(out.buffer, out.byteOffset, out.length);
}

interface V2Keys {
  enc: Buffer;
  mac: Buffer;
}

function v2Keys(ks: Buffer, dir: 1 | 2): V2Keys {
  const d = dir === 1 ? "b2c" : "c2b";
  return { enc: subKeyV2(ks, `enc-${d}`), mac: subKeyV2(ks, `mac-${d}`) };
}

function tag(key: Buffer, dir: number, counter: number, type: number, payload: Uint8Array): Buffer {
  return hmac(key, counterHead(dir, counter, type), payload).subarray(0, TAG_LENGTH);
}

export class FrameSealer {
  private counter = 0;
  private readonly keys: V2Keys | null;
  /** `version` 1: contenido en claro + etiqueta (solo para consolas viejas y pruebas); 2: contenido cifrado con ChaCha20 + etiqueta sobre el texto cifrado. */
  constructor(private readonly ks: Buffer, private readonly dir: 1 | 2, readonly version: ProtocolVersion = 1) {
    this.keys = version === 2 ? v2Keys(ks, dir) : null;
  }

  /** Devuelve contenido (cifrado en la v2) + etiqueta de 16 bytes. */
  seal(type: number, payload: Uint8Array): Uint8Array {
    if (this.keys) {
      if (this.counter >= MAX_COUNTER) throw new AuthError("contador de tramas agotado");
      const body = chacha(this.keys.enc, this.counter, payload);
      const t = tag(this.keys.mac, this.dir, this.counter++, type, body);
      const out = new Uint8Array(body.length + TAG_LENGTH);
      out.set(body, 0);
      out.set(t, body.length);
      return out;
    }
    const t = tag(this.ks, this.dir, this.counter++, type, payload);
    const out = new Uint8Array(payload.length + TAG_LENGTH);
    out.set(payload, 0);
    out.set(t, payload.length);
    return out;
  }
}

export class FrameOpener {
  private counter = 0;
  private readonly keys: V2Keys | null;
  constructor(private readonly ks: Buffer, private readonly dir: 1 | 2, readonly version: ProtocolVersion = 1) {
    this.keys = version === 2 ? v2Keys(ks, dir) : null;
  }

  /** Verifica la etiqueta (antes de descifrar) y devuelve el contenido; lanza AuthError si no coincide. */
  open(type: number, sealed: Uint8Array): Uint8Array {
    if (sealed.length < TAG_LENGTH) throw new AuthError("trama más corta que la etiqueta");
    const body = sealed.subarray(0, sealed.length - TAG_LENGTH);
    const got = sealed.subarray(sealed.length - TAG_LENGTH);
    if (this.keys) {
      if (this.counter >= MAX_COUNTER) throw new AuthError("contador de tramas agotado");
      if (!macEquals(got, tag(this.keys.mac, this.dir, this.counter, type, body))) throw new AuthError("etiqueta inválida");
      const plain = chacha(this.keys.enc, this.counter, body);
      this.counter++;
      return new Uint8Array(plain);
    }
    const want = tag(this.ks, this.dir, this.counter, type, body);
    if (!macEquals(got, want)) throw new AuthError("etiqueta inválida");
    this.counter++;
    return body.slice();
  }
}

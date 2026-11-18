/**
 * ChaCha20 (RFC 8439) en TypeScript puro, sin `node:crypto`.
 *
 * El puente empaquetado corre con el ejecutable de Electron en modo Node (BoringSSL), que no trae
 * `chacha20` en `createCipheriv`. Esto funciona igual en Node, en Electron y en cualquier runtime.
 */

const SIGMA0 = 0x61707865;
const SIGMA1 = 0x3320646e;
const SIGMA2 = 0x79622d32;
const SIGMA3 = 0x6b206574;

function rotl(v: number, n: number): number {
  return (v << n) | (v >>> (32 - n));
}

function le32(b: Uint8Array, o: number): number {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}

/**
 * Cifra o descifra (es lo mismo) `data` con ChaCha20: clave de 32 bytes, nonce de 12 bytes y
 * bloque inicial `counter` (la v2 usa 0). Devuelve un arreglo nuevo; no modifica `data`.
 */
export function chacha20Xor(key: Uint8Array, nonce: Uint8Array, counter: number, data: Uint8Array): Uint8Array {
  if (key.length !== 32) throw new RangeError("la clave de ChaCha20 mide 32 bytes");
  if (nonce.length !== 12) throw new RangeError("el nonce de ChaCha20 mide 12 bytes");

  const out = new Uint8Array(data.length);
  // Estado inicial (constante, clave, contador, nonce) y copia de trabajo, reutilizados en todos los bloques.
  const s = new Uint32Array(16);
  const x = new Uint32Array(16);
  s[0] = SIGMA0;
  s[1] = SIGMA1;
  s[2] = SIGMA2;
  s[3] = SIGMA3;
  for (let i = 0; i < 8; i++) s[4 + i] = le32(key, i * 4);
  s[12] = counter >>> 0;
  for (let i = 0; i < 3; i++) s[13 + i] = le32(nonce, i * 4);

  const quarter = (a: number, b: number, c: number, d: number): void => {
    x[a] = (x[a]! + x[b]!) >>> 0;
    x[d] = rotl(x[d]! ^ x[a]!, 16) >>> 0;
    x[c] = (x[c]! + x[d]!) >>> 0;
    x[b] = rotl(x[b]! ^ x[c]!, 12) >>> 0;
    x[a] = (x[a]! + x[b]!) >>> 0;
    x[d] = rotl(x[d]! ^ x[a]!, 8) >>> 0;
    x[c] = (x[c]! + x[d]!) >>> 0;
    x[b] = rotl(x[b]! ^ x[c]!, 7) >>> 0;
  };

  for (let pos = 0; pos < data.length; pos += 64) {
    x.set(s);
    for (let r = 0; r < 10; r++) {
      quarter(0, 4, 8, 12);
      quarter(1, 5, 9, 13);
      quarter(2, 6, 10, 14);
      quarter(3, 7, 11, 15);
      quarter(0, 5, 10, 15);
      quarter(1, 6, 11, 12);
      quarter(2, 7, 8, 13);
      quarter(3, 4, 9, 14);
    }
    const n = Math.min(64, data.length - pos);
    for (let i = 0; i < n; i++) {
      const w = (x[i >> 2]! + s[i >> 2]!) >>> 0;
      out[pos + i] = data[pos + i]! ^ ((w >>> ((i & 3) * 8)) & 0xff);
    }
    s[12] = (s[12]! + 1) >>> 0;
  }
  return out;
}

// Tramas: [tipo: u8][largo: u16 little endian][contenido]
export const FrameType = { JSON: 1, AUDIO: 2, PING: 3, PONG: 4 } as const;
export const MAX_PAYLOAD = 16384;
const HEADER = 3;

export class FrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameError";
  }
}

export function encodeFrame(type: number, payload: Uint8Array): Uint8Array {
  if (payload.length > MAX_PAYLOAD) {
    throw new FrameError(`contenido de ${payload.length} bytes excede el máximo de ${MAX_PAYLOAD}`);
  }
  const out = new Uint8Array(HEADER + payload.length);
  out[0] = type & 0xff;
  out[1] = payload.length & 0xff;
  out[2] = (payload.length >> 8) & 0xff;
  out.set(payload, HEADER);
  return out;
}

export class FrameDecoder {
  private buf: Uint8Array = new Uint8Array(0);

  /** Acumula bytes y devuelve las tramas completas que ya se pueden extraer. */
  push(chunk: Uint8Array): { type: number; payload: Uint8Array }[] {
    if (chunk.length > 0) {
      const joined = new Uint8Array(this.buf.length + chunk.length);
      joined.set(this.buf, 0);
      joined.set(chunk, this.buf.length);
      this.buf = joined;
    }
    const frames: { type: number; payload: Uint8Array }[] = [];
    let off = 0;
    while (this.buf.length - off >= HEADER) {
      const len = this.buf[off + 1]! | (this.buf[off + 2]! << 8);
      if (len > MAX_PAYLOAD) throw new FrameError(`largo de trama ${len} excede el máximo de ${MAX_PAYLOAD}`);
      if (this.buf.length - off < HEADER + len) break;
      frames.push({
        type: this.buf[off]!,
        payload: this.buf.slice(off + HEADER, off + HEADER + len),
      });
      off += HEADER + len;
    }
    if (off > 0) this.buf = this.buf.slice(off);
    return frames;
  }
}

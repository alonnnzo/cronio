import { describe, expect, it } from "vitest";
import { FrameDecoder, FrameError, FrameType, MAX_PAYLOAD, encodeFrame } from "@companion/protocol";

const bytes = (...n: number[]) => new Uint8Array(n);

describe("tramas", () => {
  it("codifica con cabecera tipo + largo little endian", () => {
    const f = encodeFrame(FrameType.JSON, bytes(9, 8, 7));
    expect([...f]).toEqual([1, 3, 0, 9, 8, 7]);
    const big = encodeFrame(FrameType.AUDIO, new Uint8Array(0x1000));
    expect([big[0], big[1], big[2]]).toEqual([FrameType.AUDIO, 0x00, 0x10]);
  });

  it("ida y vuelta, incluido el contenido vacío", () => {
    const dec = new FrameDecoder();
    expect(dec.push(encodeFrame(FrameType.PING, new Uint8Array(0)))).toEqual([
      { type: FrameType.PING, payload: new Uint8Array(0) },
    ]);
    const payload = new Uint8Array(MAX_PAYLOAD).fill(0xab);
    const [f] = dec.push(encodeFrame(FrameType.JSON, payload));
    expect(f!.type).toBe(FrameType.JSON);
    expect(f!.payload).toEqual(payload);
  });

  it("reensambla una trama entregada byte a byte", () => {
    const wire = encodeFrame(FrameType.JSON, new TextEncoder().encode('{"t":"x"}'));
    const dec = new FrameDecoder();
    const out: { type: number; payload: Uint8Array }[] = [];
    for (const b of wire) out.push(...dec.push(bytes(b)));
    expect(out).toHaveLength(1);
    expect(new TextDecoder().decode(out[0]!.payload)).toBe('{"t":"x"}');
  });

  it("separa varias tramas en un solo chunk y conserva el resto parcial", () => {
    const a = encodeFrame(FrameType.JSON, bytes(1, 2));
    const b = encodeFrame(FrameType.PONG, bytes());
    const c = encodeFrame(FrameType.AUDIO, bytes(5, 6, 7, 8));
    const all = new Uint8Array([...a, ...b, ...c]);
    const dec = new FrameDecoder();
    const first = dec.push(all.subarray(0, all.length - 2));
    expect(first.map((f) => f.type)).toEqual([FrameType.JSON, FrameType.PONG]);
    const rest = dec.push(all.subarray(all.length - 2));
    expect(rest).toEqual([{ type: FrameType.AUDIO, payload: bytes(5, 6, 7, 8) }]);
  });

  it("rechaza contenido mayor al máximo al codificar y al decodificar", () => {
    expect(() => encodeFrame(FrameType.JSON, new Uint8Array(MAX_PAYLOAD + 1))).toThrow(FrameError);
    const len = MAX_PAYLOAD + 1;
    expect(() => new FrameDecoder().push(bytes(1, len & 0xff, len >> 8))).toThrow(FrameError);
  });
});

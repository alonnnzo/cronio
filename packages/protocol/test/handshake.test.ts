import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FrameDecoder, FrameOpener, FrameSealer, helloMacV2, sessionKey, sessionKeyV2, subKeyV2, welcomeMacV2 } from "@companion/protocol";
import { buildHandshake } from "../fixtures/generate.ts";

const file = JSON.parse(readFileSync(new URL("../fixtures/handshake.json", import.meta.url), "utf8"));

describe("handshake.json", () => {
  it("coincide con lo que calcula el código (regenerar con npm run fixtures -w @companion/protocol)", () => {
    expect(file).toEqual(buildHandshake());
  });

  it("las tramas selladas se abren con la clave de sesión del archivo", () => {
    const ks = Buffer.from(file.ks, "hex");
    expect(ks).toEqual(sessionKey(Buffer.from(file.k, "hex"), Buffer.from(file.nonceB, "hex"), Buffer.from(file.nonceC, "hex")));
    for (const [dir, list] of [[1, file.bridgeToConsole], [2, file.consoleToBridge]] as const) {
      const opener = new FrameOpener(ks, dir);
      const dec = new FrameDecoder();
      for (const f of list) {
        const [frame] = dec.push(Buffer.from(f.frameHex, "hex"));
        expect(frame!.type).toBe(f.type);
        expect(Buffer.from(opener.open(frame!.type, frame!.payload)).toString("hex")).toBe(f.payloadHex);
      }
    }
  });

  it("v2: los macs, las subclaves y las tramas cifradas del archivo salen del código y se abren con la clave de sesión v2", () => {
    const v2 = file.v2;
    const k = Buffer.from(file.k, "hex");
    const nb = Buffer.from(file.nonceB, "hex");
    const nc = Buffer.from(file.nonceC, "hex");
    expect(v2.helloMac).toBe(helloMacV2(k, nb, nc, file.deviceId).toString("hex"));
    expect(v2.helloMacApp).toBe(helloMacV2(k, nb, nc, file.deviceId, v2.appVersion, v2.install).toString("hex"));
    expect(v2.welcomeMac).toBe(welcomeMacV2(k, nb, nc).toString("hex"));
    const ks = Buffer.from(v2.ks, "hex");
    expect(ks).toEqual(sessionKeyV2(k, nb, nc));
    expect(v2.encB2c).toBe(subKeyV2(ks, "enc-b2c").toString("hex"));
    for (const [dir, list] of [[1, v2.bridgeToConsole], [2, v2.consoleToBridge]] as const) {
      const opener = new FrameOpener(ks, dir, 2);
      const dec = new FrameDecoder();
      expect(list.length).toBeGreaterThanOrEqual(3);
      for (const f of list) {
        const [frame] = dec.push(Buffer.from(f.frameHex, "hex"));
        // el texto en claro no aparece en el cable
        expect(f.frameHex).not.toContain(f.payloadHex.slice(0, 24));
        expect(Buffer.from(opener.open(frame!.type, frame!.payload)).toString("hex")).toBe(f.payloadHex);
      }
      // el sellador reproduce los mismos bytes
      const sealer = new FrameSealer(ks, dir, 2);
      for (const f of list) expect(Buffer.from(sealer.seal(f.type, Buffer.from(f.payloadHex, "hex"))).toString("hex")).toBe(f.sealedHex);
    }
  });
});

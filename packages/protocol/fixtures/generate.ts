// Genera fixtures/handshake.json con valores fijos. Uso: npx tsx packages/protocol/fixtures/generate.ts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  FrameSealer,
  FrameType,
  deriveDeviceKey,
  encodeFrame,
  helloMac,
  helloMacV2,
  sessionKey,
  sessionKeyV2,
  subKeyV2,
  welcomeMac,
  welcomeMacV2,
} from "../src/index.ts";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

export const INPUTS = {
  code: "ABCD-EFGH-JKMN-PQRS",
  deviceId: "3ds-test-0001",
  nonceB: "000102030405060708090a0b0c0d0e0f",
  nonceC: "f0e1d2c3b4a5968778695a4b3c2d1e0f",
};

const BRIDGE_PAYLOADS = ['{"t":"error","code":"test-0"}', '{"t":"error","code":"test-1"}'];
// En la v2 el tercer contenido es largo (más de 64 bytes: varios bloques de ChaCha20).
const LONG_BRIDGE_PAYLOAD = JSON.stringify({ t: "error", code: "long-" + "0123456789".repeat(15) });
const LONG_CONSOLE_PAYLOAD = JSON.stringify({ t: "instruct", sessionId: "s1", text: "x".repeat(40) + "ñandú " + "0123456789".repeat(10) });
const V2_APP = { appVersion: "0.3.0", install: "cia" as const };
const CONSOLE_PAYLOADS = ['{"t":"select","agentId":"s1"}', '{"t":"decision","requestId":"r1","decision":"allow"}'];

export function buildHandshake() {
  const { code, deviceId } = INPUTS;
  const nonceB = Buffer.from(INPUTS.nonceB, "hex");
  const nonceC = Buffer.from(INPUTS.nonceC, "hex");
  const k = deriveDeviceKey(code, deviceId);
  const ks = sessionKey(k, nonceB, nonceC);

  // Tramas selladas por dirección: contador 0 y 1. "frame" es la trama completa en el cable.
  const sealed = (dir: 1 | 2, payloads: string[]) => {
    const sealer = new FrameSealer(ks, dir);
    return payloads.map((text, counter) => {
      const payload = Buffer.from(text, "utf8");
      const body = sealer.seal(FrameType.JSON, payload);
      return {
        counter,
        type: FrameType.JSON,
        payloadHex: hex(payload),
        sealedHex: hex(body),
        frameHex: hex(encodeFrame(FrameType.JSON, body)),
      };
    });
  };

  // v2: el contenido va cifrado (ChaCha20) y la etiqueta cubre el texto cifrado. "frame" es la trama completa en el cable.
  const ks2 = sessionKeyV2(k, nonceB, nonceC);
  const sealed2 = (dir: 1 | 2, payloads: string[]) => {
    const sealer = new FrameSealer(ks2, dir, 2);
    return payloads.map((text, counter) => {
      const payload = Buffer.from(text, "utf8");
      const body = sealer.seal(FrameType.JSON, payload);
      return {
        counter,
        type: FrameType.JSON,
        payloadHex: hex(payload),
        sealedHex: hex(body),
        frameHex: hex(encodeFrame(FrameType.JSON, body)),
      };
    });
  };
  const v2 = {
    description:
      "Saludo y tramas de 3dsac v2 con los mismos valores. helloMac es sin appVersion ni install; helloMacApp con appVersion e install.",
    appVersion: V2_APP.appVersion,
    install: V2_APP.install,
    helloMac: hex(helloMacV2(k, nonceB, nonceC, deviceId)),
    helloMacApp: hex(helloMacV2(k, nonceB, nonceC, deviceId, V2_APP.appVersion, V2_APP.install)),
    welcomeMac: hex(welcomeMacV2(k, nonceB, nonceC)),
    ks: hex(ks2),
    encB2c: hex(subKeyV2(ks2, "enc-b2c")),
    encC2b: hex(subKeyV2(ks2, "enc-c2b")),
    macB2c: hex(subKeyV2(ks2, "mac-b2c")),
    macC2b: hex(subKeyV2(ks2, "mac-c2b")),
    bridgeToConsole: sealed2(1, [...BRIDGE_PAYLOADS, LONG_BRIDGE_PAYLOAD]),
    consoleToBridge: sealed2(2, [...CONSOLE_PAYLOADS, LONG_CONSOLE_PAYLOAD]),
  };

  return {
    description: "Saludo completo de 3dsac con valores fijos (v1 arriba, v2 en `v2`). dir 1 = puente->consola, dir 2 = consola->puente.",
    code,
    normalizedCode: code.replace(/-/g, "").toUpperCase(),
    deviceId,
    nonceB: INPUTS.nonceB,
    nonceC: INPUTS.nonceC,
    k: hex(k),
    helloMac: hex(helloMac(k, nonceB, nonceC)),
    welcomeMac: hex(welcomeMac(k, nonceB, nonceC)),
    ks: hex(ks),
    bridgeToConsole: sealed(1, BRIDGE_PAYLOADS),
    consoleToBridge: sealed(2, CONSOLE_PAYLOADS),
    v2,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = fileURLToPath(new URL("./handshake.json", import.meta.url));
  writeFileSync(out, JSON.stringify(buildHandshake(), null, 2) + "\n");
  console.log("escrito", out);
}

import { createCipheriv, createHmac, getCiphers, hkdfSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AuthError,
  FrameOpener,
  FrameSealer,
  chacha20Xor,
  deriveDeviceKey,
  generatePairingCode,
  helloMac,
  helloMacV2,
  sessionKey,
  sessionKeyV2,
  subKeyV2,
  welcomeMac,
  welcomeMacV2,
} from "@companion/protocol";

const nonceB = Buffer.alloc(16, 1);
const nonceC = Buffer.alloc(16, 2);
const k = deriveDeviceKey("ABCD-EFGH-JKMN-PQRS", "dev-1");
const ks = sessionKey(k, nonceB, nonceC);
const msg = Buffer.from('{"t":"select","agentId":"a"}');

describe("código y clave", () => {
  it("genera 16 caracteres Crockford con guiones", () => {
    for (let i = 0; i < 50; i++) expect(generatePairingCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(generatePairingCode()).not.toBe(generatePairingCode());
  });

  it("deriva K de forma determinista y coincide con HKDF directo", () => {
    expect(deriveDeviceKey("ABCD-EFGH-JKMN-PQRS", "dev-1")).toEqual(k);
    expect(deriveDeviceKey("abcd-efgh-jkmn-pqrs", "dev-1")).toEqual(k);
    expect(deriveDeviceKey("ABCDEFGHJKMNPQRS", "dev-1")).toEqual(k);
    expect(deriveDeviceKey("ABCD-EFGH-JKMN-PQRS", "dev-2")).not.toEqual(k);
    expect(k).toHaveLength(32);
    const ref = Buffer.from(hkdfSync("sha256", Buffer.from("ABCDEFGHJKMNPQRS"), "3dsac-pair-v1", Buffer.from("dev-1"), 32));
    expect(k).toEqual(ref);
  });
});

describe("macs del saludo", () => {
  it("coinciden con HMAC-SHA256 calculado a mano y dependen del orden de los nonces", () => {
    const h = (...p: Buffer[]) => createHmac("sha256", k).update(Buffer.concat(p)).digest();
    expect(helloMac(k, nonceB, nonceC)).toEqual(h(Buffer.from("hello"), nonceB, nonceC));
    expect(welcomeMac(k, nonceB, nonceC)).toEqual(h(Buffer.from("welcome"), nonceC, nonceB));
    expect(sessionKey(k, nonceB, nonceC)).toEqual(h(Buffer.from("session"), nonceB, nonceC));
    expect(helloMac(k, nonceB, nonceC)).not.toEqual(welcomeMac(k, nonceB, nonceC));
    expect(helloMac(k, nonceC, nonceB)).not.toEqual(helloMac(k, nonceB, nonceC));
  });

  it("una clave distinta produce macs distintos", () => {
    const other = deriveDeviceKey("0000-0000-0000-0000", "dev-1");
    expect(helloMac(other, nonceB, nonceC)).not.toEqual(helloMac(k, nonceB, nonceC));
  });
});

describe("sellado de tramas", () => {
  it("sella y abre varias tramas en orden", () => {
    const sealer = new FrameSealer(ks, 2);
    const opener = new FrameOpener(ks, 2);
    for (let i = 0; i < 5; i++) {
      const sealed = sealer.seal(1, msg);
      expect(sealed).toHaveLength(msg.length + 16);
      expect(Buffer.from(opener.open(1, sealed))).toEqual(msg);
    }
  });

  it("la misma carga sellada dos veces produce etiquetas distintas (contador)", () => {
    const sealer = new FrameSealer(ks, 1);
    expect(sealer.seal(1, msg)).not.toEqual(sealer.seal(1, msg));
  });

  it("una trama repetida falla", () => {
    const sealer = new FrameSealer(ks, 1);
    const opener = new FrameOpener(ks, 1);
    const first = sealer.seal(1, msg);
    opener.open(1, first);
    expect(() => opener.open(1, first)).toThrow(AuthError);
  });

  it("una trama fuera de orden falla", () => {
    const sealer = new FrameSealer(ks, 1);
    const opener = new FrameOpener(ks, 1);
    sealer.seal(1, msg);
    const second = sealer.seal(1, msg);
    expect(() => opener.open(1, second)).toThrow(AuthError);
  });

  it("una etiqueta alterada falla, y también un contenido o tipo alterado", () => {
    const sealer = new FrameSealer(ks, 1);
    const sealed = sealer.seal(1, msg);
    const badTag = sealed.slice();
    badTag[badTag.length - 1]! ^= 1;
    expect(() => new FrameOpener(ks, 1).open(1, badTag)).toThrow(AuthError);
    const badBody = sealed.slice();
    badBody[0]! ^= 1;
    expect(() => new FrameOpener(ks, 1).open(1, badBody)).toThrow(AuthError);
    expect(() => new FrameOpener(ks, 1).open(2, sealed)).toThrow(AuthError);
    expect(() => new FrameOpener(ks, 1).open(1, new Uint8Array(5))).toThrow(AuthError);
  });

  it("la dirección equivocada falla", () => {
    const sealed = new FrameSealer(ks, 1).seal(1, msg);
    expect(() => new FrameOpener(ks, 2).open(1, sealed)).toThrow(AuthError);
  });

  it("una clave de sesión distinta falla", () => {
    const sealed = new FrameSealer(ks, 1).seal(1, msg);
    const ks2 = sessionKey(k, nonceC, nonceB);
    expect(() => new FrameOpener(ks2, 1).open(1, sealed)).toThrow(AuthError);
  });

  it("tras una etiqueta inválida el contador no avanza", () => {
    const sealer = new FrameSealer(ks, 1);
    const opener = new FrameOpener(ks, 1);
    const sealed = sealer.seal(1, msg);
    const bad = sealed.slice();
    bad[0]! ^= 1;
    expect(() => opener.open(1, bad)).toThrow(AuthError);
    expect(Buffer.from(opener.open(1, sealed))).toEqual(msg);
  });
});

// ---- v2: ChaCha20 + encrypt-then-MAC ----

const hexb = (h: string) => Buffer.from(h.replace(/\s+/g, ""), "hex");
const ks2 = sessionKeyV2(k, nonceB, nonceC);

describe("ChaCha20 propio frente a los vectores del RFC 8439", () => {
  const key = Uint8Array.from({ length: 32 }, (_, i) => i);

  it("2.3.2: bloque con contador 1 (flujo de claves = cifrar ceros)", () => {
    const ksBlock = chacha20Xor(key, hexb("000000090000004a00000000"), 1, new Uint8Array(64));
    expect(Buffer.from(ksBlock).toString("hex")).toBe(
      hexb(`10f1e7e4d13b5915500fdd1fa32071c4c7d1f4c733c068030422aa9ac3d46c4e
            d2826446079faa0914c2d705d98b02a2b5129cd1de164eb9cbd083e8a2503c4e`).toString("hex"),
    );
  });

  it("2.4.2: cifrado de la frase del RFC con contador 1", () => {
    const plain = Buffer.from(
      "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
    );
    const out = chacha20Xor(key, hexb("000000000000004a00000000"), 1, plain);
    expect(Buffer.from(out).toString("hex")).toBe(
      hexb(`6e2e359a2568f98041ba0728dd0d6981e97e7aec1d4360c20a27afccfd9fae0b
            f91b65c5524733ab8f593dabcd62b3571639d624e65152ab8f530c359f0861d8
            07ca0dbf500d6a6156a38e088a22b65e52bc514d16ccf806818ce91ab7793736
            5af90bbf74a35be6b40b8eedf2785e42874d`).toString("hex"),
    );
  });

  it("descifrar es cifrar de nuevo, y no modifica la entrada", () => {
    const plain = Buffer.from("hola, Cronio");
    const copy = Buffer.from(plain);
    const ct = chacha20Xor(key, new Uint8Array(12), 0, plain);
    expect(plain).toEqual(copy);
    expect(Buffer.from(chacha20Xor(key, new Uint8Array(12), 0, ct))).toEqual(plain);
  });

  it("rechaza claves y nonces de largo equivocado", () => {
    expect(() => chacha20Xor(new Uint8Array(16), new Uint8Array(12), 0, new Uint8Array(1))).toThrow(RangeError);
    expect(() => chacha20Xor(key, new Uint8Array(8), 0, new Uint8Array(1))).toThrow(RangeError);
  });

  it("coincide con el ChaCha20 de OpenSSL de Node en tamaños de trama (0 a 16 KB, límites de bloque)", () => {
    // Solo si este Node trae el cifrado (Electron/BoringSSL no lo trae; ahí lo cubre la prueba de Electron).
    if (!getCiphers().includes("chacha20")) return;
    for (const n of [0, 1, 63, 64, 65, 127, 128, 1000, 16384]) {
      const data = Buffer.alloc(n, 0xa5).map((v, i) => (v + i * 7) & 0xff);
      const nonce = hexb("0a0b0c0d0e0f101112131415");
      const iv = Buffer.alloc(16);
      iv.writeUInt32LE(0, 0);
      nonce.copy(iv, 4);
      const c = createCipheriv("chacha20", key, iv);
      const ref = Buffer.concat([c.update(data), c.final()]);
      expect(Buffer.from(chacha20Xor(key, nonce, 0, data))).toEqual(ref);
    }
  });
});

describe("macs y claves del saludo v2", () => {
  const id = "dev-1";
  it("coinciden con HMAC-SHA256 calculado a mano (con largos delante de los campos)", () => {
    const h = (...p: Buffer[]) => createHmac("sha256", k).update(Buffer.concat(p)).digest();
    const lp = (s: string) => Buffer.concat([Buffer.from([Buffer.byteLength(s)]), Buffer.from(s)]);
    expect(helloMacV2(k, nonceB, nonceC, id, "0.3.0", "cia")).toEqual(h(Buffer.from("hello2"), nonceB, nonceC, Buffer.from([2]), lp(id), lp("0.3.0"), Buffer.from([1])));
    expect(helloMacV2(k, nonceB, nonceC, id)).toEqual(h(Buffer.from("hello2"), nonceB, nonceC, Buffer.from([2]), lp(id), lp(""), Buffer.from([0])));
    expect(welcomeMacV2(k, nonceB, nonceC)).toEqual(h(Buffer.from("welcome2"), nonceC, nonceB, Buffer.from([2])));
    expect(ks2).toEqual(h(Buffer.from("session2"), nonceB, nonceC, Buffer.from([2])));
  });

  it("cada campo del hello cambia el mac (id, appVersion, install) y no coincide con el de la v1", () => {
    const base = helloMacV2(k, nonceB, nonceC, id, "0.3.0", "cia");
    expect(helloMacV2(k, nonceB, nonceC, "dev-2", "0.3.0", "cia")).not.toEqual(base);
    expect(helloMacV2(k, nonceB, nonceC, id, "0.3.1", "cia")).not.toEqual(base);
    expect(helloMacV2(k, nonceB, nonceC, id, undefined, "cia")).not.toEqual(base);
    expect(helloMacV2(k, nonceB, nonceC, id, "0.3.0", "3dsx")).not.toEqual(base);
    expect(helloMacV2(k, nonceB, nonceC, id, "0.3.0")).not.toEqual(base);
    expect(helloMacV2(k, nonceC, nonceB, id, "0.3.0", "cia")).not.toEqual(base);
    expect(base).not.toEqual(helloMac(k, nonceB, nonceC));
    expect(welcomeMacV2(k, nonceB, nonceC)).not.toEqual(welcomeMac(k, nonceB, nonceC));
    expect(ks2).not.toEqual(ks);
  });

  it("las cuatro subclaves son distintas entre sí (por uso y por dirección) y de la clave de sesión", () => {
    const labels = ["enc-b2c", "enc-c2b", "mac-b2c", "mac-c2b"] as const;
    const keys = labels.map((l) => subKeyV2(ks2, l).toString("hex"));
    expect(new Set([...keys, ks2.toString("hex")]).size).toBe(5);
    const ref = createHmac("sha256", ks2).update(Buffer.concat([Buffer.from("3dsac-v2 enc-b2c"), Buffer.from([1])])).digest("hex");
    expect(keys[0]).toBe(ref);
  });
});

describe("sellado de tramas v2 (cifrado)", () => {
  const seal = (dir: 1 | 2) => new FrameSealer(ks2, dir, 2);
  const open = (dir: 1 | 2) => new FrameOpener(ks2, dir, 2);

  it("ida y vuelta de varias tramas, de largo 0 a varios bloques, en las dos direcciones", () => {
    for (const dir of [1, 2] as const) {
      const s = seal(dir);
      const o = open(dir);
      for (const len of [0, 1, 27, 63, 64, 65, 200, 5000]) {
        const plain = Buffer.alloc(len, "abc");
        const sealed = s.seal(1, plain);
        expect(sealed).toHaveLength(len + 16);
        expect(Buffer.from(o.open(1, sealed))).toEqual(plain);
      }
    }
  });

  it("el contenido no viaja en claro y la misma carga cifra distinto en cada trama", () => {
    const s = seal(1);
    const a = s.seal(1, msg);
    const b = s.seal(1, msg);
    expect(Buffer.from(a).includes(msg.subarray(0, 12))).toBe(false);
    expect(Buffer.from(a.subarray(0, msg.length))).not.toEqual(msg);
    expect(a).not.toEqual(b);
  });

  it("una trama alterada falla (cada bit del texto cifrado y de la etiqueta), también el tipo", () => {
    const sealed = seal(1).seal(1, msg);
    for (let i = 0; i < sealed.length; i++) {
      const bad = sealed.slice();
      bad[i]! ^= 1;
      expect(() => open(1).open(1, bad), `byte ${i}`).toThrow(AuthError);
    }
    expect(() => open(1).open(3, sealed)).toThrow(AuthError);
    expect(() => open(1).open(1, new Uint8Array(5))).toThrow(AuthError);
  });

  it("el contador: repetida y fuera de orden fallan; tras un fallo no avanza", () => {
    const s = seal(1);
    const o = open(1);
    const first = s.seal(1, msg);
    const second = s.seal(1, msg);
    expect(() => o.open(1, second)).toThrow(AuthError);
    expect(Buffer.from(o.open(1, first))).toEqual(msg);
    expect(() => o.open(1, first)).toThrow(AuthError);
    expect(Buffer.from(o.open(1, second))).toEqual(msg);
  });

  it("las dos direcciones usan claves distintas: la trama de una no abre en la otra", () => {
    const sealed = seal(1).seal(1, msg);
    expect(() => open(2).open(1, sealed)).toThrow(AuthError);
    const a = seal(1).seal(1, msg);
    const b = seal(2).seal(1, msg);
    expect(Buffer.from(a.subarray(0, msg.length))).not.toEqual(Buffer.from(b.subarray(0, msg.length)));
  });

  it("una clave de sesión distinta, o la de la v1, falla; una trama v1 no abre como v2 ni al revés", () => {
    const sealed = seal(1).seal(1, msg);
    expect(() => new FrameOpener(ks, 1, 2).open(1, sealed)).toThrow(AuthError);
    expect(() => new FrameOpener(sessionKeyV2(k, nonceC, nonceB), 1, 2).open(1, sealed)).toThrow(AuthError);
    expect(() => new FrameOpener(ks2, 1, 1).open(1, sealed)).toThrow(AuthError);
    expect(() => open(1).open(1, new FrameSealer(ks2, 1, 1).seal(1, msg))).toThrow(AuthError);
  });

  it("el contador agotado (2^32 - 1) no se usa: ni se sella ni se abre", () => {
    const s = seal(1) as unknown as { counter: number; seal(t: number, p: Uint8Array): Uint8Array };
    s.counter = 0xfffffffe;
    expect(() => s.seal(1, msg)).not.toThrow();
    expect(() => s.seal(1, msg)).toThrow(AuthError);
    const o = open(1) as unknown as { counter: number; open(t: number, p: Uint8Array): Uint8Array };
    o.counter = 0xffffffff;
    expect(() => o.open(1, new Uint8Array(20))).toThrow(AuthError);
  });
});

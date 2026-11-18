import { describe, expect, it } from "vitest";
import { FrameSealer, FrameType, MAX_PAYLOAD, MAX_READ_LINES, MAX_READ_TEXT, encodeFrame, parseBridgeMessage } from "@companion/protocol";
import { BridgeStore, MAX_STORED_MESSAGE } from "../src/store.ts";
import { buildText, MAX_TEXT_JSON_BYTES } from "../src/reader.ts";

function storeWith(message: string, question = ""): BridgeStore {
  const store = new BridgeStore();
  store.upsertSession({ sessionId: "s1", kind: "claude", project: "demo" });
  store.setLastMessage("s1", message);
  if (question !== "") store.setQuestion("s1", question);
  return store;
}

/** Tamaño real en el cable: JSON sellado y enmarcado, como lo manda la consola real. */
function wireBytes(msg: unknown): number {
  const sealer = new FrameSealer(Buffer.alloc(32, 7), 1);
  const sealed = sealer.seal(FrameType.JSON, Buffer.from(JSON.stringify(msg)));
  return encodeFrame(FrameType.JSON, sealed).length;
}

describe("buildText", () => {
  it("sesión desconocida: sin líneas, sin fallar", () => {
    const store = new BridgeStore();
    expect(buildText(store, "nada")).toEqual({ t: "text", sessionId: "nada", lines: [], truncated: false, mode: "full" });
  });

  it("mensaje corto: sin markdown, en líneas de hasta MAX_READ_TEXT, sin truncar", () => {
    const m = buildText(storeWith("# Listo\n\nSe **migró** la tabla `users`.\n- uno\n- dos"), "s1");
    expect(m).toEqual({ t: "text", sessionId: "s1", lines: ["Listo", "", "Se migró la tabla users.", "• uno", "• dos"], truncated: false, mode: "full" });
    expect(parseBridgeMessage(m)).toEqual(m);
  });

  it("incluye la pregunta pendiente (hasta 3 líneas)", () => {
    const m = buildText(storeWith("Hecho.", "¿Aplico la migración en producción ahora mismo o prefieres esperar a mañana?"), "s1");
    expect(m.question!.length).toBeGreaterThan(0);
    expect(m.question!.length).toBeLessThanOrEqual(3);
    expect(m.question!.every((l) => l.length <= MAX_READ_TEXT)).toBe(true);
    expect(parseBridgeMessage(m)).toEqual(m);
  });

  it("sin pregunta, no hay campo question", () => {
    expect("question" in buildText(storeWith("Hola"), "s1")).toBe(false);
  });

  it("se guardan 8000 caracteres del último mensaje", () => {
    const store = storeWith("a".repeat(9000));
    expect(store.getSession("s1")!.lastMessage).toHaveLength(MAX_STORED_MESSAGE);
    expect(MAX_STORED_MESSAGE).toBe(8000);
  });

  it("un mensaje largo se corta por líneas y marca truncated", () => {
    const m = buildText(storeWith(Array.from({ length: 400 }, (_, i) => `l${i}`).join("\n")), "s1");
    expect(m.lines).toHaveLength(MAX_READ_LINES);
    expect(m.truncated).toBe(true);
    expect(m.lines[0]).toBe("l0");
  });

  // peor caso: 8000 caracteres con acentos (2 bytes) y comillas (2 bytes escapadas), sin espacios para que cada
  // línea llegue a los 48 caracteres
  const cases: [string, string][] = [
    ["acentos", "á".repeat(8000)],
    ["comillas", '"'.repeat(8000)],
    ["barras invertidas", "\\".repeat(8000)],
    ["español con espacios", "Ñandú pingüino ".repeat(600)],
    ["japonés (3 bytes)", "あ".repeat(8000)],
  ];
  for (const [name, text] of cases) {
    it(`peor caso (${name}): la trama sellada cabe y la vista es válida`, () => {
      const m = buildText(storeWith(text, "¿" + "ñ".repeat(200) + "?"), "s1");
      const json = Buffer.byteLength(JSON.stringify(m), "utf8");
      expect(json).toBeLessThanOrEqual(MAX_TEXT_JSON_BYTES);
      expect(wireBytes(m)).toBeLessThanOrEqual(3 + MAX_PAYLOAD);
      if (name !== "español con espacios") expect(m.truncated).toBe(true); // este cabe entero en menos de 8000 caracteres
      expect(parseBridgeMessage(JSON.parse(JSON.stringify(m)))).toEqual(m);
    });
  }

  it("mide el peor caso real", () => {
    const worst = buildText(storeWith('"'.repeat(8000), "¿" + "ñ".repeat(200) + "?"), "s1");
    const json = Buffer.byteLength(JSON.stringify(worst), "utf8");
    console.log(`peor caso: ${worst.lines.length} líneas, JSON ${json} bytes, trama sellada ${wireBytes(worst)} bytes (límite ${MAX_PAYLOAD + 3})`);
    expect(json).toBeLessThan(MAX_PAYLOAD - 16);
  });

  it("al truncar no termina en una línea en blanco", () => {
    const text = Array.from({ length: 300 }, (_, i) => `p${i}\n`).join("\n");
    const m = buildText(storeWith(text), "s1");
    expect(m.truncated).toBe(true);
    expect(m.lines[m.lines.length - 1]).not.toBe("");
  });
});

describe("ancho del lector", () => {
  it("las líneas llegan a MAX_READ_TEXT (48) y la pregunta se parte con el mismo ancho", () => {
    const m = buildText(storeWith("palabra ".repeat(60), "¿" + "palabra ".repeat(12) + "?"), "s1");
    const widths = m.lines.map((l) => l.length);
    expect(Math.max(...widths)).toBeGreaterThan(38);
    expect(Math.max(...widths)).toBeLessThanOrEqual(MAX_READ_TEXT);
    expect(Math.max(...m.question!.map((l) => l.length))).toBeGreaterThan(38);
    expect(m.question!.every((l) => l.length <= MAX_READ_TEXT)).toBe(true);
  });
});

describe("modo resumen (paso 5)", () => {
  const long = "Listo: migré la tabla.\n\n" + Array.from({ length: 20 }, (_, i) => `- Cambio ${i + 1} en el módulo`).join("\n") + "\n\n¿Sigo con el exportador?";

  it("full por defecto: lleva mode full y nunca short", () => {
    const m = buildText(storeWith(long), "s1");
    expect(m.mode).toBe("full");
    expect("short" in m).toBe(false);
    expect(buildText(storeWith(long), "s1", "full")).toEqual(m);
  });

  it("summary: líneas del resumen, mode summary, sin truncar y válido para el protocolo", () => {
    const m = buildText(storeWith(long), "s1", "summary");
    expect(m.mode).toBe("summary");
    expect(m.truncated).toBe(false);
    expect("short" in m).toBe(false);
    expect(m.lines.length).toBeLessThanOrEqual(12);
    expect(m.lines[0]).toBe("Listo: migré la tabla.");
    expect(m.lines.length).toBeLessThan(buildText(storeWith(long), "s1").lines.length);
    expect(parseBridgeMessage(m)).toEqual(m);
  });

  it("summary de un mensaje que ya cabe: es el mensaje y lleva short", () => {
    const m = buildText(storeWith("# Listo\n\nSe **migró** la tabla `users`.\n- uno\n- dos"), "s1", "summary");
    expect(m).toEqual({ t: "text", sessionId: "s1", lines: ["Listo", "", "Se migró la tabla users.", "• uno", "• dos"], truncated: false, mode: "summary", short: true });
    expect(parseBridgeMessage(m)).toEqual(m);
  });

  it("summary no repite la pregunta pendiente, que sigue yendo aparte", () => {
    const m = buildText(storeWith(long, "¿Sigo con el exportador?"), "s1", "summary");
    expect(m.question).toEqual(["¿Sigo con el exportador?"]);
    expect(m.lines.join("\n")).not.toContain("exportador");
    const sin = buildText(storeWith(long), "s1", "summary");
    expect(sin.lines.join("\n")).toContain("exportador");
  });

  it("sesión desconocida en summary: sin líneas y con su mode", () => {
    expect(buildText(new BridgeStore(), "nada", "summary")).toEqual({ t: "text", sessionId: "nada", lines: [], truncated: false, mode: "summary" });
  });

  it("el resumen pasa por la costura Summarizer (otro resumidor se enchufa sin tocar nada más)", () => {
    const fake = { name: "fake", summarize: () => ({ lines: ["resumen de prueba"], short: false }) };
    expect(buildText(storeWith(long), "s1", "summary", fake).lines).toEqual(["resumen de prueba"]);
  });
});

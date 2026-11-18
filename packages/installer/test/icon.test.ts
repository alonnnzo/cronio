import { describe, expect, it } from "vitest";
import { crearIconoPng } from "../src/icon.ts";

describe("icono generado", () => {
  it("es un PNG válido del tamaño pedido", () => {
    const png = crearIconoPng(32);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(32); // ancho en IHDR
    expect(png.readUInt32BE(20)).toBe(32); // alto
    expect(png.subarray(-8, -4).toString("ascii")).toBe("IEND");
  });

  it("las variantes de la bandeja (apagado, con punto) son PNG válidos y distintos del normal", () => {
    const normal = crearIconoPng(32);
    const apagado = crearIconoPng(32, { apagado: true });
    const punto = crearIconoPng(32, { punto: true });
    for (const png of [apagado, punto]) {
      expect(png.readUInt32BE(16)).toBe(32);
      expect(png.subarray(-8, -4).toString("ascii")).toBe("IEND");
    }
    expect(apagado.equals(normal)).toBe(false);
    expect(punto.equals(normal)).toBe(false);
    expect(apagado.equals(punto)).toBe(false);
    // sin opciones es el mismo ícono de siempre
    expect(crearIconoPng(32, {}).equals(normal)).toBe(true);
  });
});

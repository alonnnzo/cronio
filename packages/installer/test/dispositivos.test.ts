import { describe, expect, it } from "vitest";
import { cuerpoOlvidar, leerConsolas } from "../src/setup/dispositivos.ts";

describe("leerConsolas (respuesta de GET /devices)", () => {
  it("toma los cuatro campos conocidos y ordena lo más reciente primero", () => {
    const r = leerConsolas({
      devices: [
        { deviceId: "3ds-vieja", name: "3ds-vieja", pairedAt: "2026-10-01T10:00:00.000Z", connected: false },
        { deviceId: "3ds-nueva", name: "Mi New 3DS", pairedAt: "2026-11-16T09:30:00.000Z", connected: true },
      ],
    });
    expect(r).toEqual([
      { deviceId: "3ds-nueva", name: "Mi New 3DS", pairedAt: "2026-11-16T09:30:00.000Z", connected: true },
      { deviceId: "3ds-vieja", name: "3ds-vieja", pairedAt: "2026-10-01T10:00:00.000Z", connected: false },
    ]);
  });

  it("no deja pasar claves ni campos de más, aunque el puente los mandara", () => {
    const r = leerConsolas({ devices: [{ deviceId: "3ds-a", name: "a", pairedAt: "x", connected: false, keyHex: "ab".repeat(32), secreto: 1 }] });
    expect(Object.keys(r[0]!).sort()).toEqual(["connected", "deviceId", "name", "pairedAt"]);
    expect(JSON.stringify(r)).not.toContain("ab".repeat(32));
  });

  it("sin nombre usa el id; descarta lo que no tiene la forma esperada", () => {
    const r = leerConsolas({ devices: [{ deviceId: "3ds-a" }, { deviceId: "../x" }, { deviceId: 5 }, null, "x", { name: "sin id" }, { deviceId: "3ds-b", name: "  ", connected: "si" }] });
    expect(r.map((c) => c.deviceId)).toEqual(["3ds-a", "3ds-b"]);
    expect(r.every((c) => c.name === c.deviceId && c.connected === false)).toBe(true);
  });

  it("cualquier otra cosa es una lista vacía", () => {
    for (const x of [undefined, null, 5, "x", [], {}, { devices: "no" }, { devices: {} }]) expect(leerConsolas(x)).toEqual([]);
  });
});

describe("cuerpoOlvidar", () => {
  it("arma el JSON solo con un id válido", () => {
    expect(cuerpoOlvidar("3ds-7f")).toBe('{"deviceId":"3ds-7f"}');
    for (const x of ["", "a b", "../x", "x".repeat(65), 5, null, undefined, {}]) expect(cuerpoOlvidar(x)).toBeUndefined();
  });
});

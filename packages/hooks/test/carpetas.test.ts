import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { carpetaDatos, carpetaPermitida, cwdPermitido, leerConfig, normalizarRuta } from "../carpetas.mjs";

let dir: string;
let env: Record<string, string>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "companion-carpetas-"));
  env = { AGENT_COMPANION_CONFIG_DIR: dir };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const escribir = (texto: string) => writeFileSync(join(dir, "carpetas.json"), texto, "utf8");

describe("normalizarRuta", () => {
  it("ignora mayúsculas, tipo de barra, separador final y barras repetidas", () => {
    expect(normalizarRuta("C:\\Users\\Yo\\Repo\\")).toBe("c:/users/yo/repo");
    expect(normalizarRuta("c:/users//yo/repo/")).toBe("c:/users/yo/repo");
    expect(normalizarRuta("C:\\")).toBe("c:");
    expect(normalizarRuta(undefined)).toBe("");
    expect(normalizarRuta(42)).toBe("");
  });
});

describe("carpetaPermitida", () => {
  const cfg = { modo: "elegidas" as const, carpetas: ["C:\\Users\\yo\\repo", "D:/trabajo/"] };
  it("la carpeta y sus subcarpetas, sin distinguir mayúsculas ni barras", () => {
    expect(carpetaPermitida("C:\\Users\\yo\\repo", cfg)).toBe(true);
    expect(carpetaPermitida("c:/users/YO/repo/", cfg)).toBe(true);
    expect(carpetaPermitida("C:\\Users\\yo\\repo\\src\\app", cfg)).toBe(true);
    expect(carpetaPermitida("d:\\trabajo\\x", cfg)).toBe(true);
  });
  it("no cubre carpetas hermanas con el mismo prefijo ni el padre", () => {
    expect(carpetaPermitida("C:\\Users\\yo\\repo-otro", cfg)).toBe(false);
    expect(carpetaPermitida("C:\\Users\\yo", cfg)).toBe(false);
    expect(carpetaPermitida("E:\\repo", cfg)).toBe(false);
  });
  it("sin cwd o con lista vacía no se permite; \"todas\" permite todo", () => {
    expect(carpetaPermitida(undefined, cfg)).toBe(false);
    expect(carpetaPermitida("C:\\x", { modo: "elegidas", carpetas: [] })).toBe(false);
    expect(carpetaPermitida(undefined, { modo: "todas", carpetas: [] })).toBe(true);
  });
  it("una raíz de disco cubre todo el disco", () => {
    expect(carpetaPermitida("C:\\cualquiera\\cosa", { modo: "elegidas", carpetas: ["C:\\"] })).toBe(true);
    expect(carpetaPermitida("D:\\cosa", { modo: "elegidas", carpetas: ["C:\\"] })).toBe(false);
  });
});

describe("leerConfig", () => {
  it("archivo ausente: todas", () => {
    expect(leerConfig(env)).toMatchObject({ modo: "todas", estado: "ausente" });
    expect(cwdPermitido("C:\\lo\\que\\sea", env)).toBe(true);
  });
  it("archivo válido", () => {
    escribir(JSON.stringify({ modo: "elegidas", carpetas: ["C:\\a"] }));
    expect(leerConfig(env)).toEqual({ modo: "elegidas", carpetas: ["C:\\a"], estado: "ok" });
    expect(cwdPermitido("C:\\a\\b", env)).toBe(true);
    expect(cwdPermitido("C:\\z", env)).toBe(false);
  });
  it("los cambios se ven sin reiniciar (lectura fresca)", () => {
    escribir(JSON.stringify({ modo: "elegidas", carpetas: [] }));
    expect(cwdPermitido("C:\\a", env)).toBe(false);
    escribir(JSON.stringify({ modo: "todas", carpetas: [] }));
    expect(cwdPermitido("C:\\a", env)).toBe(true);
  });
  it.each(["{no es json", "", "null", JSON.stringify({ modo: "otra", carpetas: [] }), JSON.stringify({ modo: "elegidas", carpetas: [1] }), JSON.stringify({ modo: "elegidas" })])(
    "archivo corrupto (%s): nada permitido y con aviso",
    (texto) => {
      escribir(texto);
      const c = leerConfig(env);
      expect(c.estado).toBe("corrupto");
      expect(c.aviso).toContain("carpetas.json");
      expect(cwdPermitido("C:\\a", env)).toBe(false);
    },
  );
});

describe("carpetaDatos", () => {
  it("usa AGENT_COMPANION_CONFIG_DIR, luego APPDATA", () => {
    expect(carpetaDatos({ AGENT_COMPANION_CONFIG_DIR: "X:\\c" })).toBe("X:\\c");
    expect(carpetaDatos({ APPDATA: "C:\\Roaming" }).replace(/\\/g, "/")).toBe("C:/Roaming/agent-companion");
  });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { conCarpeta, crearPorDefecto, guardarCarpetas, leerCarpetas, rutaCarpetas, sinCarpeta } from "../src/setup/carpetas.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "companion-carpetas-ui-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("carpetas.json del instalador", () => {
  it("ausente = todas; corrupto = elegidas sin carpetas y con aviso", () => {
    expect(leerCarpetas(dir)).toMatchObject({ modo: "todas", estado: "ausente" });
    writeFileSync(rutaCarpetas(dir), "{roto");
    expect(leerCarpetas(dir)).toMatchObject({ modo: "elegidas", carpetas: [], estado: "corrupto" });
    expect(leerCarpetas(dir).aviso).toBeTruthy();
  });

  it("guarda y vuelve a leer", () => {
    guardarCarpetas(dir, { modo: "elegidas", carpetas: ["C:/a"] });
    expect(leerCarpetas(dir)).toMatchObject({ modo: "elegidas", carpetas: ["C:/a"], estado: "ok" });
  });

  it("agregar no duplica aunque cambien mayúsculas o barras; quitar también ignora eso", () => {
    let c = conCarpeta({ modo: "elegidas", carpetas: [] }, "C:/Users/yo/Repo");
    c = conCarpeta(c, "c:\\users\\yo\\repo\\");
    expect(c.carpetas).toEqual(["C:/Users/yo/Repo"]);
    expect(sinCarpeta(c, "C:\\USERS\\yo\\repo").carpetas).toEqual([]);
  });

  it("crearPorDefecto no pisa un archivo existente", () => {
    expect(crearPorDefecto(dir)).toBe(true);
    guardarCarpetas(dir, { modo: "todas", carpetas: [] });
    expect(crearPorDefecto(dir)).toBe(false);
    expect(leerCarpetas(dir).modo).toBe("todas");
  });
});

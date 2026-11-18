// Prueba la escritura en disco con carpetas temporales: nunca toca el ~/.claude/settings.json real.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agregarHooks, quitarHooks, revisarHooks } from "../src/setup/apply.ts";
import type { RutasHooks } from "../src/setup/apply.ts";
import { guardarCarpetas, leerCarpetas } from "../src/setup/carpetas.ts";

let dir: string;
let rutas: RutasHooks;
const AHORA = new Date(2026, 10, 16, 10, 0, 0);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "companion-instalador-"));
  const origen = join(dir, "origen-hook.mjs");
  writeFileSync(origen, "// hook de prueba\n");
  const carpetasOrigen = join(dir, "origen-carpetas.mjs");
  writeFileSync(carpetasOrigen, "// carpetas de prueba\n");
  rutas = { settingsPath: join(dir, ".claude", "settings.json"), hooksDir: join(dir, "appdata", "hooks"), hookOrigen: origen, carpetasOrigen, datosDir: join(dir, "appdata") };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("agregarHooks / quitarHooks", () => {
  it("sin settings previo: lo crea, copia el hook y no hay respaldo", () => {
    const r = agregarHooks(rutas, AHORA);
    expect(r.respaldo).toBeUndefined();
    expect(existsSync(join(rutas.hooksDir, "permission-hook.mjs"))).toBe(true);
    expect(revisarHooks(rutas).ok).toBe(true);
  });

  it("copia carpetas.mjs junto al hook y deja 'elegidas' sin carpetas en una instalación nueva", () => {
    agregarHooks(rutas, AHORA);
    expect(existsSync(join(rutas.hooksDir, "carpetas.mjs"))).toBe(true);
    expect(leerCarpetas(rutas.datosDir)).toMatchObject({ modo: "elegidas", carpetas: [], estado: "ok" });
  });

  it("si ya había avisos o ya hay carpetas.json, no cambia el modo (quien ya lo usa sigue igual)", () => {
    agregarHooks(rutas, AHORA);
    guardarCarpetas(rutas.datosDir, { modo: "todas", carpetas: [] });
    agregarHooks(rutas, AHORA); // reinstalar
    expect(leerCarpetas(rutas.datosDir).modo).toBe("todas");
    rmSync(join(rutas.datosDir, "carpetas.json"));
    agregarHooks(rutas, AHORA); // avisos ya presentes: no se vuelve opt-in
    expect(leerCarpetas(rutas.datosDir).estado).toBe("ausente");
  });

  it("con settings previo: respalda el original y conserva lo ajeno", () => {
    agregarHooks(rutas, AHORA); // crea la carpeta
    const original = JSON.stringify({ model: "m", hooks: { Foo: [{ hooks: [{ type: "command", command: "x" }] }] } }, null, 2) + "\n";
    writeFileSync(rutas.settingsPath, original);
    const r = agregarHooks(rutas, AHORA);
    expect(r.respaldo).toMatch(/settings\.json\.bak-companion-20261116-100000$/);
    expect(readFileSync(r.respaldo!, "utf8")).toBe(original);
    const nuevo = JSON.parse(readFileSync(rutas.settingsPath, "utf8"));
    expect(nuevo.model).toBe("m");
    expect(nuevo.hooks.Foo).toHaveLength(1);
  });

  it("quitar deja el settings sin nuestras entradas y con respaldo", () => {
    agregarHooks(rutas, AHORA);
    const r = quitarHooks(rutas, new Date(2026, 10, 16, 10, 0, 5));
    expect(r.respaldo).toBeDefined();
    expect(revisarHooks(rutas).presentes).toEqual([]);
    expect(readdirSync(join(dir, ".claude")).filter((f) => f.includes(".bak-companion-"))).toHaveLength(1);
  });

  it("un settings malformado no se toca", () => {
    agregarHooks(rutas, AHORA);
    writeFileSync(rutas.settingsPath, "{ roto");
    expect(() => agregarHooks(rutas, AHORA)).toThrow(/JSON válido/);
    expect(readFileSync(rutas.settingsPath, "utf8")).toBe("{ roto");
  });
});

// Hooks desactualizados (auditoría 2026-11-17): una copia instalada de antes del token local no manda X-Cronio-Token; el puente la rechaza con 401 y los
// permisos se preguntan en el PC. El paso 2 lo detecta (copia distinta de la del programa) y ofrece actualizarla.
describe("hooks desactualizados", () => {
  it("recién copiados: al día; con el hook o carpetas.mjs distintos del programa: desactualizados y ok = false", () => {
    agregarHooks(rutas, AHORA);
    expect(revisarHooks(rutas)).toMatchObject({ ok: true, desactualizados: [] });
    // el programa trae un hook nuevo (con token): la copia instalada ya es vieja
    writeFileSync(rutas.hookOrigen, "// hook nuevo con token\n");
    const r = revisarHooks(rutas);
    expect(r.ok).toBe(false);
    expect(r.faltan).toEqual([]); // están todos los eventos: solo la copia es vieja
    expect(r.scriptsFaltantes).toEqual([]);
    expect(r.desactualizados).toEqual([join(rutas.hooksDir, "permission-hook.mjs").split(sep).join("/")]);
    // «Hacerlo por mí» (o «Actualizar») la deja al día
    agregarHooks(rutas, AHORA);
    expect(revisarHooks(rutas)).toMatchObject({ ok: true, desactualizados: [] });
    // lo mismo con carpetas.mjs
    writeFileSync(rutas.carpetasOrigen, "// carpetas nuevo\n");
    expect(revisarHooks(rutas).ok).toBe(false);
    agregarHooks(rutas, AHORA);
    expect(revisarHooks(rutas).ok).toBe(true);
  });

  it("no cuenta la diferencia entre CRLF y LF", () => {
    agregarHooks(rutas, AHORA);
    writeFileSync(rutas.hookOrigen, "// hook de prueba\r\n");
    expect(revisarHooks(rutas)).toMatchObject({ ok: true, desactualizados: [] });
  });

  it("un settings que apunta al script del programa mismo (desarrollo) no cuenta como copia vieja", () => {
    // los originales del programa, con el nombre real del script (así el settings los reconoce como nuestros)
    mkdirSync(join(dir, "repo"));
    rutas.hookOrigen = join(dir, "repo", "permission-hook.mjs");
    rutas.carpetasOrigen = join(dir, "repo", "carpetas.mjs");
    writeFileSync(rutas.hookOrigen, "// original\n");
    writeFileSync(rutas.carpetasOrigen, "// original\n");
    agregarHooks(rutas, AHORA);
    const actual = JSON.parse(readFileSync(rutas.settingsPath, "utf8")) as { hooks: Record<string, { hooks: { command?: string }[] }[]> };
    for (const grupos of Object.values(actual.hooks)) for (const g of grupos) for (const h of g.hooks) if (h.command) h.command = `node ${rutas.hookOrigen.split(sep).join("/")}`;
    writeFileSync(rutas.settingsPath, JSON.stringify(actual));
    expect(revisarHooks(rutas)).toMatchObject({ ok: true, desactualizados: [] });
  });

  it("sin las rutas del programa no se puede comparar: no inventa avisos", () => {
    agregarHooks(rutas, AHORA);
    writeFileSync(rutas.hookOrigen, "// otro\n");
    expect(revisarHooks({ settingsPath: rutas.settingsPath })).toMatchObject({ ok: true, desactualizados: [] });
  });
});

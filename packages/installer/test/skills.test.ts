import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { archivoSkill, carpetaSkill, esNuestra, instalarSkill, quitarSkill, revisarSkill, SkillAjenaError } from "../src/setup/skills.ts";

const NUESTRA = "---\nname: grill-me\ndescription: algo\nmetadata:\n  creador: cronio\n---\n\n# Cuerpo\n";
const AJENA = "---\nname: grill-me\ndescription: la mía\n---\n\nOtra cosa\n";

let dir: string;
let home: string;
let origen: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "companion-skill-"));
  home = join(dir, "home"); // HOME temporal: nunca el ~/.claude real
  mkdirSync(home, { recursive: true });
  origen = join(dir, "SKILL.md");
  writeFileSync(origen, NUESTRA);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("esNuestra", () => {
  it("reconoce la marca del frontmatter", () => {
    expect(esNuestra(NUESTRA)).toBe(true);
    expect(esNuestra(NUESTRA.replace(/\n/g, "\r\n"))).toBe(true);
    expect(esNuestra("---\nname: x\nmetadata: cronio\n---\n")).toBe(true);
    expect(esNuestra('---\nname: x\nmetadata:\n  otro: 1\n  creador: "Cronio"\n---\n')).toBe(true);
  });
  it("lo demás es ajeno", () => {
    expect(esNuestra(AJENA)).toBe(false);
    expect(esNuestra("# sin frontmatter\ncreador: cronio\n")).toBe(false);
    expect(esNuestra("---\nname: x\nmetadata:\n  creador: otro\n---\n")).toBe(false);
    // la marca fuera del frontmatter no cuenta
    expect(esNuestra("---\nname: x\n---\nmetadata:\n  creador: cronio\n")).toBe(false);
    expect(esNuestra("")).toBe(false);
  });
  it("la skill real del repo lleva la marca y los campos obligatorios", () => {
    const real = readFileSync(join(__dirname, "..", "..", "hooks", "skills", "grill-me", "SKILL.md"), "utf8");
    expect(esNuestra(real)).toBe(true);
    expect(real).toMatch(/^---\r?\nname: grill-me\r?\ndescription: .+/);
  });
});

describe("instalar y quitar", () => {
  it("escribe en <home>/.claude/skills/grill-me/SKILL.md y no en otro lado", () => {
    expect(archivoSkill(home)).toBe(join(home, ".claude", "skills", "grill-me", "SKILL.md"));
    expect(revisarSkill({ home, origen })).toMatchObject({ estado: "ausente", ok: false });
    instalarSkill({ home, origen });
    expect(readFileSync(archivoSkill(home), "utf8")).toBe(NUESTRA);
    expect(revisarSkill({ home, origen })).toMatchObject({ estado: "nuestra", ok: true, desactualizada: false });
  });

  it("actualiza una nuestra desactualizada", () => {
    instalarSkill({ home, origen });
    writeFileSync(origen, `${NUESTRA}\nnuevo\n`);
    expect(revisarSkill({ home, origen }).desactualizada).toBe(true);
    instalarSkill({ home, origen });
    expect(revisarSkill({ home, origen }).desactualizada).toBe(false);
  });

  it("no pisa una skill ajena ni la quita", () => {
    mkdirSync(carpetaSkill(home), { recursive: true });
    writeFileSync(archivoSkill(home), AJENA);
    expect(revisarSkill({ home, origen }).estado).toBe("ajena");
    expect(() => instalarSkill({ home, origen })).toThrow(SkillAjenaError);
    expect(() => quitarSkill({ home, origen })).toThrow(SkillAjenaError);
    expect(readFileSync(archivoSkill(home), "utf8")).toBe(AJENA);
  });

  it("una carpeta grill-me con otras cosas y sin SKILL.md también es ajena", () => {
    mkdirSync(carpetaSkill(home), { recursive: true });
    writeFileSync(join(carpetaSkill(home), "notas.txt"), "mías");
    expect(revisarSkill({ home, origen }).estado).toBe("ajena");
    expect(() => instalarSkill({ home, origen })).toThrow(SkillAjenaError);
  });

  it("una carpeta vacía no estorba", () => {
    mkdirSync(carpetaSkill(home), { recursive: true });
    instalarSkill({ home, origen });
    expect(revisarSkill({ home, origen }).ok).toBe(true);
  });

  it("quitar borra el archivo y la carpeta vacía; deja lo que el usuario puso", () => {
    instalarSkill({ home, origen });
    expect(quitarSkill({ home, origen })).toEqual({ quitada: true });
    expect(existsSync(carpetaSkill(home))).toBe(false);
    expect(quitarSkill({ home, origen })).toEqual({ quitada: false });
    instalarSkill({ home, origen });
    writeFileSync(join(carpetaSkill(home), "extra.md"), "x");
    quitarSkill({ home, origen });
    expect(existsSync(archivoSkill(home))).toBe(false);
    expect(existsSync(join(carpetaSkill(home), "extra.md"))).toBe(true);
  });

  it("no copia un origen sin marca ni uno que falta", () => {
    writeFileSync(origen, AJENA);
    expect(() => instalarSkill({ home, origen })).toThrow(/marca/);
    expect(() => instalarSkill({ home, origen: join(dir, "nada.md") })).toThrow(/No encuentro/);
    expect(existsSync(carpetaSkill(home))).toBe(false);
  });
});

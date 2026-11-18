// Skill «grill-me» de Claude Code: instalarla en ~/.claude/skills/grill-me/SKILL.md, revisarla y quitarla.
// La carpeta de inicio (HOME) llega por parámetro: las pruebas usan una carpeta temporal y nunca tocan el ~/.claude real.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import { join } from "node:path";

export const SKILL_NOMBRE = "grill-me";
export const SKILL_ARCHIVO = "SKILL.md";

export interface RutasSkill {
  /** Carpeta de inicio del usuario (`os.homedir()`); la skill va en `<home>/.claude/skills/grill-me/SKILL.md`. */
  home: string;
  /** SKILL.md del repo o de `resources` (viene de `paths.ts`). */
  origen: string;
}

export type EstadoSkill = "ausente" | "nuestra" | "ajena";

export interface VistaSkill {
  estado: EstadoSkill;
  /** Archivo que se escribe (o que está escrito). */
  archivo: string;
  carpeta: string;
  /** Hay una skill nuestra instalada pero distinta de la versión que trae esta app. */
  desactualizada: boolean;
  /** ✓: el archivo está y es el nuestro. */
  ok: boolean;
  /** El archivo que se copia existe (si no, la app está mal empaquetada). */
  origenExiste: boolean;
}

export function carpetaSkill(home: string): string {
  return join(home, ".claude", "skills", SKILL_NOMBRE);
}

export function archivoSkill(home: string): string {
  return join(carpetaSkill(home), SKILL_ARCHIVO);
}

/** Bloque de frontmatter (lo que va entre los dos `---` del comienzo), o undefined si no hay. */
function frontmatter(texto: string): string | undefined {
  const m = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(texto);
  return m ? m[1] : undefined;
}

/**
 * ¿Es una skill de Cronio? Lo dice el frontmatter: `metadata:` con una línea `creador: cronio` debajo (o `metadata: cronio`).
 * Cualquier otra cosa (sin frontmatter, otro creador) es ajena.
 */
export function esNuestra(texto: string): boolean {
  const fm = frontmatter(texto);
  if (fm === undefined) return false;
  const lineas = fm.split(/\r?\n/);
  const sinComillas = (v: string) => v.trim().replace(/^["']|["']$/g, "").toLowerCase();
  for (let i = 0; i < lineas.length; i++) {
    const m = /^metadata:[ \t]*(.*)$/.exec(lineas[i]!);
    if (!m) continue;
    if (sinComillas(m[1]!) === "cronio") return true;
    for (let j = i + 1; j < lineas.length && /^[ \t]+\S/.test(lineas[j]!); j++) {
      const c = /^[ \t]+creador:[ \t]*(.*)$/.exec(lineas[j]!);
      if (c && sinComillas(c[1]!) === "cronio") return true;
    }
  }
  return false;
}

function leer(ruta: string): string | undefined {
  try {
    return readFileSync(ruta, "utf8");
  } catch {
    return undefined;
  }
}

export function revisarSkill(rutas: RutasSkill): VistaSkill {
  const carpeta = carpetaSkill(rutas.home);
  const archivo = archivoSkill(rutas.home);
  const origenExiste = existsSync(rutas.origen);
  const texto = leer(archivo);
  let estado: EstadoSkill;
  if (texto !== undefined) estado = esNuestra(texto) ? "nuestra" : "ajena";
  else if (existsSync(carpeta) && readdirSync(carpeta).length > 0) estado = "ajena"; // una carpeta con otras cosas: no es nuestra
  else estado = "ausente";
  const desactualizada = estado === "nuestra" && origenExiste && leer(rutas.origen) !== texto;
  return { estado, archivo, carpeta, desactualizada, ok: estado === "nuestra", origenExiste };
}

export class SkillAjenaError extends Error {
  constructor(public readonly carpeta: string) {
    super(`Ya existe la carpeta ${carpeta} y no es de Cronio, así que no la toqué. Si quieres usar la nuestra, renombra o mueve esa carpeta y vuelve a intentarlo.`);
    this.name = "SkillAjenaError";
  }
}

/** Copia la skill. Si ya hay una de Cronio la actualiza; si hay una ajena lanza `SkillAjenaError` sin tocar nada. */
export function instalarSkill(rutas: RutasSkill): { archivo: string } {
  const origen = leer(rutas.origen);
  if (origen === undefined) throw new Error(`No encuentro el archivo de la skill en ${rutas.origen}.`);
  if (!esNuestra(origen)) throw new Error("El archivo de la skill que trae la app no lleva la marca de Cronio; no lo copio.");
  const vista = revisarSkill(rutas);
  if (vista.estado === "ajena") throw new SkillAjenaError(vista.carpeta);
  mkdirSync(vista.carpeta, { recursive: true });
  copyFileSync(rutas.origen, vista.archivo);
  return { archivo: vista.archivo };
}

/** Quita solo la skill de Cronio: el archivo y, si queda vacía, su carpeta. Una ajena no se toca. */
export function quitarSkill(rutas: RutasSkill): { quitada: boolean } {
  const vista = revisarSkill(rutas);
  if (vista.estado === "ajena") throw new SkillAjenaError(vista.carpeta);
  if (vista.estado === "ausente") return { quitada: false };
  rmSync(vista.archivo, { force: true });
  try {
    rmdirSync(vista.carpeta); // solo si quedó vacía
  } catch {
    /* tiene otros archivos del usuario: se dejan */
  }
  return { quitada: true };
}

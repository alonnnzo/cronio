// Aplica y retira los hooks en disco. Todas las rutas se reciben por parámetro: las pruebas usan carpetas
// temporales y nunca tocan el ~/.claude/settings.json real.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { estadoHooks, fusionarSettings, HOOK_SCRIPT, leerSettings, nombreRespaldo, quitarDeSettings, serializarSettings } from "./settings.ts";
import type { EstadoHooks } from "./settings.ts";
import { crearPorDefecto } from "./carpetas.ts";

export interface RutasHooks {
  /** settings.json de Claude Code (normalmente ~/.claude/settings.json). */
  settingsPath: string;
  /** Carpeta estable donde se copia el hook (%APPDATA%/agent-companion/hooks). */
  hooksDir: string;
  /** permission-hook.mjs original del repo. */
  hookOrigen: string;
  /** carpetas.mjs original del repo: el hook lo importa, así que se copia al lado. */
  carpetasOrigen: string;
  /** Carpeta de datos de la app (%APPDATA%/agent-companion), donde vive carpetas.json. */
  datosDir: string;
}

export interface ResultadoCambio {
  /** Ruta del respaldo, si había un settings.json previo. */
  respaldo?: string;
  scriptPath: string;
}

function leer(ruta: string): string | undefined {
  return existsSync(ruta) ? readFileSync(ruta, "utf8") : undefined;
}

/** Ruta del script con "/" (Claude Code ejecuta el comando con node, y "/" evita problemas de comillas). */
export function rutaScript(hooksDir: string): string {
  return join(hooksDir, HOOK_SCRIPT).replace(/\\/g, "/");
}

/** Cuántos respaldos `settings.json.bak-companion-*` se conservan (los más nuevos). */
export const RESPALDOS_A_CONSERVAR = 5;

/**
 * Escritura atómica: escribe en un archivo temporal de la misma carpeta y lo renombra encima del destino. Si el proceso o el PC se cortan a
 * medias, queda el settings.json anterior entero y no uno cortado (Claude Code dejaría de leer sus ajustes).
 */
export function escribirAtomico(ruta: string, texto: string): void {
  const temporal = `${ruta}.tmp-companion-${process.pid}`;
  try {
    writeFileSync(temporal, texto, "utf8");
    renameSync(temporal, ruta);
  } catch (err) {
    rmSync(temporal, { force: true });
    throw err;
  }
}

/** Borra los respaldos de Cronio más viejos y deja los `conservar` últimos (los nombres llevan la fecha, así que ordenan por tiempo). */
export function podarRespaldos(carpeta: string, conservar: number = RESPALDOS_A_CONSERVAR): string[] {
  let nombres: string[];
  try {
    nombres = readdirSync(carpeta).filter((n) => /^settings\.json\.bak-companion-\d{8}-\d{6}$/.test(n)).sort();
  } catch {
    return [];
  }
  const borrar = nombres.slice(0, Math.max(0, nombres.length - conservar));
  for (const n of borrar) rmSync(join(carpeta, n), { force: true });
  return borrar;
}

function respaldar(settingsPath: string, texto: string | undefined, ahora: Date): string | undefined {
  if (texto === undefined) return undefined;
  const destino = join(dirname(settingsPath), nombreRespaldo(ahora));
  writeFileSync(destino, texto, "utf8");
  podarRespaldos(dirname(settingsPath));
  return destino;
}

/** Copia el hook, respalda el settings y lo fusiona. */
export function agregarHooks(rutas: RutasHooks, ahora: Date = new Date()): ResultadoCambio {
  const texto = leer(rutas.settingsPath);
  const actual = leerSettings(texto); // si está malformado lanza antes de tocar nada
  mkdirSync(rutas.hooksDir, { recursive: true });
  copyFileSync(rutas.hookOrigen, join(rutas.hooksDir, HOOK_SCRIPT));
  copyFileSync(rutas.carpetasOrigen, join(rutas.hooksDir, "carpetas.mjs"));
  // instalación nueva (sin avisos previos ni carpetas.json): empieza en "solo en las carpetas que elija"
  if (estadoHooks(actual, () => false).presentes.length === 0) crearPorDefecto(rutas.datosDir);
  const scriptPath = rutaScript(rutas.hooksDir);
  const respaldo = respaldar(rutas.settingsPath, texto, ahora);
  mkdirSync(dirname(rutas.settingsPath), { recursive: true });
  escribirAtomico(rutas.settingsPath, serializarSettings(fusionarSettings(actual, scriptPath)));
  return { respaldo, scriptPath };
}

/** Respalda el settings y retira solo nuestras entradas. Deja el script copiado donde está. */
export function quitarHooks(rutas: RutasHooks, ahora: Date = new Date()): ResultadoCambio {
  const scriptPath = rutaScript(rutas.hooksDir);
  const texto = leer(rutas.settingsPath);
  if (texto === undefined) return { scriptPath };
  const actual = leerSettings(texto);
  const respaldo = respaldar(rutas.settingsPath, texto, ahora);
  escribirAtomico(rutas.settingsPath, serializarSettings(quitarDeSettings(actual)));
  return { respaldo, scriptPath };
}

const sinSaltos = (t: string): string => t.replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10));

/** ¿El archivo `copia` existe y su contenido es distinto del de `origen`? (sin contar la diferencia entre CRLF y LF) */
function copiaDistinta(origen: string, copia: string): boolean {
  const o = leer(origen);
  const c = leer(copia);
  return o !== undefined && c !== undefined && sinSaltos(o) !== sinSaltos(c);
}

/**
 * Scripts del hook a los que apunta el settings que no son iguales a los del programa: una copia vieja (de antes de que el puente exigiera el
 * token local, p. ej.). El hook viejo no manda el token, el puente le responde 401 y los permisos se preguntan en el PC (nunca se aprueban solos)
 * hasta que se actualiza con «Hacerlo por mí». Un settings que apunta directamente al script del repo no cuenta: ese es el original.
 */
export function hooksDesactualizados(scripts: string[], origenes: { hookOrigen: string; carpetasOrigen: string }): string[] {
  const lista: string[] = [];
  for (const s of scripts) {
    if (resolve(s) === resolve(origenes.hookOrigen)) continue;
    if (copiaDistinta(origenes.hookOrigen, s) || copiaDistinta(origenes.carpetasOrigen, join(dirname(s), "carpetas.mjs"))) lista.push(s);
  }
  return lista;
}

/**
 * Estado actual de los hooks en el settings. Con `hookOrigen` y `carpetasOrigen` también dice si la copia instalada es vieja (`desactualizados`:
 * los scripts distintos de los del programa); en ese caso `ok` es falso aunque estén todos los eventos, para que el paso 2 ofrezca actualizarla.
 */
export function revisarHooks(
  rutas: Pick<RutasHooks, "settingsPath"> & Partial<Pick<RutasHooks, "hookOrigen" | "carpetasOrigen">>,
): EstadoHooks & { settingsExiste: boolean; desactualizados: string[] } {
  const texto = leer(rutas.settingsPath);
  const estado = estadoHooks(leerSettings(texto), existsSync);
  const desactualizados = rutas.hookOrigen && rutas.carpetasOrigen ? hooksDesactualizados(estado.scripts, { hookOrigen: rutas.hookOrigen, carpetasOrigen: rutas.carpetasOrigen }) : [];
  return { ...estado, ok: estado.ok && desactualizados.length === 0, desactualizados, settingsExiste: texto !== undefined };
}

// Carpetas donde la integración con la 3DS está activa. Sin dependencias: lo usan el hook (permission-hook.mjs, que el
// instalador copia junto a este archivo) y el puente.
//
// Archivo de configuración: <carpeta de datos>/carpetas.json
//   { "modo": "todas" | "elegidas", "carpetas": ["C:\Users\yo\repo", ...] }
// Carpeta de datos: env AGENT_COMPANION_CONFIG_DIR (pruebas), si no %APPDATA%/agent-companion, si no ~/.agent-companion.
//
// Reglas:
//   - archivo ausente           -> "todas" (no rompe a quien ya tenía todo instalado).
//   - archivo ilegible/corrupto -> NADA permitido (ante la duda no se avisa nada) y `aviso` explica por qué.
//   - modo "todas"              -> cualquier carpeta.
//   - modo "elegidas"           -> solo `cwd` dentro de alguna carpeta de la lista (una carpeta cubre sus subcarpetas).
// Comparación de rutas: sin distinguir mayúsculas, "/" y "\" son lo mismo, sin separador final, sin separadores repetidos.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const ARCHIVO_CARPETAS = 'carpetas.json';

/** Carpeta de datos de la app (donde vive carpetas.json). */
export function carpetaDatos(env = process.env) {
  if (env.AGENT_COMPANION_CONFIG_DIR) return env.AGENT_COMPANION_CONFIG_DIR;
  if (env.APPDATA) return join(env.APPDATA, 'agent-companion');
  return join(homedir(), '.agent-companion');
}

export function rutaConfig(env = process.env) {
  return join(carpetaDatos(env), ARCHIVO_CARPETAS);
}

/** Forma comparable de una ruta; '' si no es una ruta usable. */
export function normalizarRuta(ruta) {
  if (typeof ruta !== 'string') return '';
  let r = ruta.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').toLowerCase();
  while (r.length > 1 && r.endsWith('/')) r = r.slice(0, -1);
  return r;
}

/** ¿`cwd` es la carpeta `carpeta` o está dentro de ella? Ambas ya normalizadas. */
function dentroDe(cwd, carpeta) {
  if (carpeta === '' || cwd === '') return false;
  if (cwd === carpeta) return true;
  return cwd.startsWith(carpeta.endsWith('/') ? carpeta : `${carpeta}/`);
}

/**
 * Lee la configuración.
 * @returns {{ modo: 'todas'|'elegidas', carpetas: string[], estado: 'ausente'|'ok'|'corrupto', aviso?: string }}
 */
export function leerConfig(env = process.env) {
  const ruta = rutaConfig(env);
  if (!existsSync(ruta)) return { modo: 'todas', carpetas: [], estado: 'ausente' };
  try {
    const data = JSON.parse(readFileSync(ruta, 'utf8'));
    const valido =
      data !== null &&
      typeof data === 'object' &&
      (data.modo === 'todas' || data.modo === 'elegidas') &&
      Array.isArray(data.carpetas) &&
      data.carpetas.every(c => typeof c === 'string');
    if (!valido) throw new Error('formato inesperado');
    return { modo: data.modo, carpetas: data.carpetas, estado: 'ok' };
  } catch (e) {
    return { modo: 'elegidas', carpetas: [], estado: 'corrupto', aviso: `${ruta} no se pudo leer (${e?.message ?? e}); no se activa en ninguna carpeta` };
  }
}

/** ¿La integración está activa para esta carpeta de trabajo? */
export function carpetaPermitida(cwd, config) {
  if (config.modo === 'todas') return true;
  const c = normalizarRuta(cwd);
  return config.carpetas.some(f => dentroDe(c, normalizarRuta(f)));
}

/** Lee la configuración (siempre fresca) y responde si `cwd` está permitida. */
export function cwdPermitido(cwd, env = process.env) {
  return carpetaPermitida(cwd, leerConfig(env));
}

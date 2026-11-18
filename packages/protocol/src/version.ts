// Versión de la app de la consola (`APP_VERSION` del Makefile del cliente) y su comparación. Espejo de
// client-3ds/source/logic/version.c: las dos entienden lo mismo.

/** Largo máximo del texto de una versión (`appVersion` del saludo y `update.version` de la vista). */
export const MAX_VERSION_TEXT = 16;

export interface AppVersion {
  major: number;
  minor: number;
  micro: number;
}

/**
 * Lee `1`, `1.2` o `1.2.3` (cada parte de 0 a 65535, sin signos ni espacios); una `v` al comienzo se admite. Lo que falte
 * vale 0. Devuelve `undefined` si no es una versión: es lo que pasa con un cliente anterior, que no manda ninguna.
 */
export function parseVersion(texto: unknown): AppVersion | undefined {
  if (typeof texto !== "string" || texto.length === 0 || texto.length > MAX_VERSION_TEXT) return undefined;
  const m = /^v?(\d{1,5})(?:\.(\d{1,5}))?(?:\.(\d{1,5}))?$/.exec(texto);
  if (!m) return undefined;
  const n = [m[1], m[2] ?? "0", m[3] ?? "0"].map(Number);
  if (n.some((x) => x > 65535)) return undefined;
  return { major: n[0]!, minor: n[1]!, micro: n[2]! };
}

/**
 * Compara dos versiones: -1 si `a` es menor que `b`, 0 si son iguales, 1 si es mayor. `undefined` si alguna no se puede
 * leer (versión desconocida): no se puede decir cuál es más nueva.
 */
export function compareVersions(a: unknown, b: unknown): -1 | 0 | 1 | undefined {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return undefined;
  for (const k of ["major", "minor", "micro"] as const) {
    if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  }
  return 0;
}

/**
 * Cómo corre la app de la consola, según el saludo (`install`): `cia` instalada en el menú HOME (se puede actualizar sola) o
 * `3dsx` desde el Homebrew Launcher (no se puede). Ausente en un cliente anterior.
 */
export type InstallKind = "cia" | "3dsx";

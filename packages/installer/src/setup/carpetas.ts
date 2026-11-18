// Dónde se activa la integración con la 3DS: lectura y escritura de carpetas.json (ver packages/hooks/carpetas.mjs, que es
// quien lo interpreta en el hook y en el puente). Todas las rutas llegan por parámetro: las pruebas usan carpetas temporales.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ARCHIVO_CARPETAS = "carpetas.json";

export type ModoCarpetas = "todas" | "elegidas";

export interface ConfigCarpetas {
  modo: ModoCarpetas;
  carpetas: string[];
}

export interface VistaCarpetas extends ConfigCarpetas {
  /** "ausente": no hay archivo (vale "todas"). "corrupto": existe pero no se entiende (no se activa en ninguna). */
  estado: "ausente" | "ok" | "corrupto";
  aviso?: string;
  archivo: string;
}

export function rutaCarpetas(datosDir: string): string {
  return join(datosDir, ARCHIVO_CARPETAS);
}

/** Misma normalización que el hook: sin mayúsculas, "/" como separador, sin separador final. */
export function normalizar(ruta: string): string {
  let r = ruta.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").toLowerCase();
  while (r.length > 1 && r.endsWith("/")) r = r.slice(0, -1);
  return r;
}

export function leerCarpetas(datosDir: string): VistaCarpetas {
  const archivo = rutaCarpetas(datosDir);
  if (!existsSync(archivo)) return { modo: "todas", carpetas: [], estado: "ausente", archivo };
  try {
    const d = JSON.parse(readFileSync(archivo, "utf8")) as Partial<ConfigCarpetas> | null;
    const valido =
      d !== null && typeof d === "object" && (d.modo === "todas" || d.modo === "elegidas") && Array.isArray(d.carpetas) && d.carpetas.every((c) => typeof c === "string");
    if (!valido) throw new Error("formato inesperado");
    return { modo: d.modo!, carpetas: d.carpetas!, estado: "ok", archivo };
  } catch {
    return { modo: "elegidas", carpetas: [], estado: "corrupto", aviso: "El archivo de carpetas no se entiende, así que por seguridad no se activa en ninguna.", archivo };
  }
}

export function guardarCarpetas(datosDir: string, config: ConfigCarpetas): void {
  mkdirSync(datosDir, { recursive: true });
  const limpio: ConfigCarpetas = { modo: config.modo, carpetas: config.carpetas };
  writeFileSync(rutaCarpetas(datosDir), `${JSON.stringify(limpio, null, 2)}\n`, "utf8");
}

/** Agrega una carpeta sin duplicar (aunque cambien mayúsculas o barras). Devuelve una config nueva. */
export function conCarpeta(config: ConfigCarpetas, ruta: string): ConfigCarpetas {
  if (normalizar(ruta) === "") return config;
  if (config.carpetas.some((c) => normalizar(c) === normalizar(ruta))) return config;
  return { ...config, carpetas: [...config.carpetas, ruta] };
}

export function sinCarpeta(config: ConfigCarpetas, ruta: string): ConfigCarpetas {
  return { ...config, carpetas: config.carpetas.filter((c) => normalizar(c) !== normalizar(ruta)) };
}

/** Primera instalación: si no hay archivo, queda en "elegidas" y sin carpetas (opt-in). No pisa nada existente. */
export function crearPorDefecto(datosDir: string): boolean {
  if (existsSync(rutaCarpetas(datosDir))) return false;
  guardarCarpetas(datosDir, { modo: "elegidas", carpetas: [] });
  return true;
}

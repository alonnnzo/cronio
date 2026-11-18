// Ajustes del programa (no de Claude Code): `app.json` en la carpeta de datos (`%APPDATA%/agent-companion`, o la de
// AGENT_COMPANION_CONFIG_DIR en pruebas). La carpeta llega por parámetro: las pruebas usan carpetas temporales.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ARCHIVO_AJUSTES = "app.json";

export type OrigenActualizacion = "ninguno" | "local" | "github";

export interface AjustesActualizaciones {
  origen: OrigenActualizacion;
  /** Carpeta con `latest.yml` y el instalador; solo se usa con origen `local`. */
  carpeta?: string;
}

export interface AjustesApp {
  actualizaciones: AjustesActualizaciones;
  /** Última versión nueva de la que ya se mostró una notificación del sistema (una vez por versión). */
  ultimaVersionAvisada?: string;
  /** `actualizaciones` salió del valor por defecto (el archivo no lo tenía). */
  porDefecto: boolean;
}

export function rutaAjustes(datosDir: string): string {
  return join(datosDir, ARCHIVO_AJUSTES);
}

function leerCrudo(datosDir: string): Record<string, unknown> {
  try {
    const d = JSON.parse(readFileSync(rutaAjustes(datosDir), "utf8")) as unknown;
    return d !== null && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : {};
  } catch {
    return {}; // ausente o ilegible: se parte de los valores por defecto
  }
}

/**
 * Valor por defecto: si existe la carpeta de versiones de quien desarrolla (`carpetaLocalConocida`, que el programa trae anotada solo si se empaquetó con `npm run dist:installer:local`; al
 * empaquetarse, ver `scripts/dist.mjs`), el origen es `local` con esa carpeta; si no, `ninguno`. GitHub nunca es el valor por defecto.
 */
export function actualizacionesPorDefecto(carpetaLocalConocida: string | undefined): AjustesActualizaciones {
  if (carpetaLocalConocida && existsSync(carpetaLocalConocida)) return { origen: "local", carpeta: carpetaLocalConocida };
  return { origen: "ninguno" };
}

export function leerAjustesApp(datosDir: string, carpetaLocalConocida?: string): AjustesApp {
  const d = leerCrudo(datosDir);
  const a = d.actualizaciones as { origen?: unknown; carpeta?: unknown } | null | undefined;
  const ultima = typeof d.ultimaVersionAvisada === "string" ? d.ultimaVersionAvisada : undefined;
  const base = { ...(ultima ? { ultimaVersionAvisada: ultima } : {}) };
  if (a && typeof a === "object" && (a.origen === "ninguno" || a.origen === "local" || a.origen === "github")) {
    const carpeta = typeof a.carpeta === "string" && a.carpeta ? a.carpeta : undefined;
    return { ...base, actualizaciones: { origen: a.origen, ...(carpeta ? { carpeta } : {}) }, porDefecto: false };
  }
  return { ...base, actualizaciones: actualizacionesPorDefecto(carpetaLocalConocida), porDefecto: true };
}

function escribir(datosDir: string, d: Record<string, unknown>): void {
  mkdirSync(datosDir, { recursive: true });
  writeFileSync(rutaAjustes(datosDir), `${JSON.stringify(d, null, 2)}\n`, "utf8");
}

/** Guarda el origen; conserva el resto del archivo. */
export function guardarActualizaciones(datosDir: string, a: AjustesActualizaciones): void {
  const limpio: AjustesActualizaciones = { origen: a.origen, ...(a.carpeta ? { carpeta: a.carpeta } : {}) };
  escribir(datosDir, { ...leerCrudo(datosDir), actualizaciones: limpio });
}

export function guardarVersionAvisada(datosDir: string, version: string): void {
  escribir(datosDir, { ...leerCrudo(datosDir), ultimaVersionAvisada: version });
}

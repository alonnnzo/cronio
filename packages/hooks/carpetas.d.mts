export const ARCHIVO_CARPETAS: string;
export interface ConfigCarpetas {
  modo: "todas" | "elegidas";
  carpetas: string[];
  estado: "ausente" | "ok" | "corrupto";
  aviso?: string;
}
export function carpetaDatos(env?: Record<string, string | undefined>): string;
export function rutaConfig(env?: Record<string, string | undefined>): string;
export function normalizarRuta(ruta: unknown): string;
export function leerConfig(env?: Record<string, string | undefined>): ConfigCarpetas;
export function carpetaPermitida(cwd: unknown, config: Pick<ConfigCarpetas, "modo" | "carpetas">): boolean;
export function cwdPermitido(cwd: unknown, env?: Record<string, string | undefined>): boolean;

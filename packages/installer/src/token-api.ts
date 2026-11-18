// Token local de la API del puente (auditoría 2026-11-17, punto 4). El puente lo genera en cada arranque y deja una copia en
// <carpeta de configuración>/api-token (la misma carpeta de carpetas.json); las llamadas de este programa a /pair, /shutdown y /event lo mandan en
// la cabecera X-Cronio-Token, leyéndolo del archivo en cada llamada (un puente reiniciado deja uno nuevo). Sin archivo no se manda nada: un puente
// anterior, que no lo exige, responde igual, y uno nuevo responde 401.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const ENCABEZADO_TOKEN = "x-cronio-token";

/** Carpeta de configuración de la app: AGENT_COMPANION_CONFIG_DIR (pruebas) o %APPDATA%/agent-companion. */
export function carpetaConfig(env: Record<string, string | undefined> = process.env): string {
  if (env.AGENT_COMPANION_CONFIG_DIR) return env.AGENT_COMPANION_CONFIG_DIR;
  return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "agent-companion");
}

/** El token del puente en marcha, o `undefined` si no hay archivo o no tiene la forma de un token (64 hex). */
export function leerTokenApi(carpeta: string = carpetaConfig()): string | undefined {
  try {
    const t = readFileSync(join(carpeta, "api-token"), "utf8").trim();
    return /^[0-9a-f]{64}$/.test(t) ? t : undefined;
  } catch {
    return undefined;
  }
}

/** Cabeceras para una llamada a la API local: las de `extra` más el token si se conoce. */
export function cabecerasApi(extra: Record<string, string> = {}, carpeta?: string): Record<string, string> {
  const token = leerTokenApi(carpeta);
  return token ? { ...extra, [ENCABEZADO_TOKEN]: token } : { ...extra };
}

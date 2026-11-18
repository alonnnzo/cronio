// Token local de la API (auditoría 2026-11-17, punto 4). Al arrancar, el puente genera 32 bytes al azar (64 caracteres hex) y los guarda en
// `<carpeta de datos>/api-token` y, para los hooks y el programa del PC, en una copia en la carpeta de configuración de la app
// (`%APPDATA%/agent-companion/api-token`, o AGENT_COMPANION_CONFIG_DIR). Se regenera en cada arranque.
//
// La API local lo exige en la cabecera `X-Cronio-Token` en /pair, /permission, /question, /stop, /shutdown, /event y /devices/forget, y el WebSocket del
// simulador, en `?token=` (el simulador lo recibe inyectado en su página). /health y /hook/claude no lo llevan (ver docs/06-fase-1-diseno.md).
// El token no protege de código que corra con el mismo usuario (puede leer el archivo): protege de páginas web, de otros usuarios del PC y de
// procesos que no conocen la carpeta de configuración.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const TOKEN_HEADER = "x-cronio-token";
export const TOKEN_FILE = "api-token";
const TOKEN_RE = /^[0-9a-f]{64}$/;

export function generateApiToken(): string {
  return randomBytes(32).toString("hex");
}

/** ¿`given` (lo que llegó en la cabecera o la query) es el token esperado? Comparación en tiempo constante; cualquier otra cosa es no. */
export function tokenMatches(expected: string, given: unknown): boolean {
  if (typeof given !== "string" || !TOKEN_RE.test(given) || !TOKEN_RE.test(expected)) return false;
  // se comparan los hashes: mismo largo siempre y sin depender de dónde difieren los bytes
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
}

/** Lee el token de la primera carpeta que tenga un `api-token` válido; `undefined` si no hay ninguno (el puente no ha arrancado, o no es esta carpeta). */
export function readTokenFile(...dirs: string[]): string | undefined {
  for (const dir of dirs) {
    try {
      const text = readFileSync(join(dir, TOKEN_FILE), "utf8").trim();
      if (TOKEN_RE.test(text)) return text;
    } catch {
      // sin archivo en esta carpeta: se prueba la siguiente
    }
  }
  return undefined;
}

/**
 * Guarda el token en `<dir>/api-token` (crea la carpeta). Se escribe a un temporal y se renombra: quien lo lee (el hook) nunca ve el archivo a
 * medias. Con permisos 0600 donde el sistema los respeta.
 */
export function writeTokenFile(dir: string, token: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, TOKEN_FILE);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, token, { mode: 0o600 });
  renameSync(tmp, path);
  return path;
}

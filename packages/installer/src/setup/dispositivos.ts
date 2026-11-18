// Consolas emparejadas, tal como las muestra la tarjeta «Consolas emparejadas» de Ajustes. Lógica pura y probada: la llamada al puente
// (GET /devices y POST /devices/forget) está en main.ts.

export interface ConsolaEmparejada {
  deviceId: string;
  /** Nombre que se muestra (por defecto, el mismo id). */
  name: string;
  /** Fecha ISO del emparejamiento. */
  pairedAt: string;
  /** Tiene una conexión abierta con el puente ahora mismo. */
  connected: boolean;
}

/** Mismo formato que acepta el puente: letras, números, _ y -. */
export const FORMA_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Lee la respuesta de `GET /devices`. Se queda solo con los cuatro campos conocidos (aunque el puente mandara algo más, como una clave, no pasa
 * a la interfaz) y descarta lo que no tenga la forma esperada. Lo más reciente primero.
 */
export function leerConsolas(json: unknown): ConsolaEmparejada[] {
  const lista = typeof json === "object" && json !== null ? (json as { devices?: unknown }).devices : undefined;
  if (!Array.isArray(lista)) return [];
  const salida: ConsolaEmparejada[] = [];
  for (const d of lista) {
    if (typeof d !== "object" || d === null) continue;
    const { deviceId, name, pairedAt, connected } = d as Record<string, unknown>;
    if (typeof deviceId !== "string" || !FORMA_ID.test(deviceId)) continue;
    salida.push({
      deviceId,
      name: typeof name === "string" && name.trim() !== "" ? name.slice(0, 64) : deviceId,
      pairedAt: typeof pairedAt === "string" ? pairedAt : "",
      connected: connected === true,
    });
  }
  return salida.sort((a, b) => (a.pairedAt < b.pairedAt ? 1 : a.pairedAt > b.pairedAt ? -1 : a.deviceId.localeCompare(b.deviceId)));
}

/** Cuerpo de `POST /devices/forget`; `undefined` si el id no tiene la forma de un id de consola (no se manda nada). */
export function cuerpoOlvidar(deviceId: unknown): string | undefined {
  return typeof deviceId === "string" && FORMA_ID.test(deviceId) ? JSON.stringify({ deviceId }) : undefined;
}

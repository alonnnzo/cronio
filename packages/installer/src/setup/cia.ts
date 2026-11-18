// Dirección del archivo .cia que FBI descarga en la 3DS (y texto del QR).

export const CIA_PUERTO = 33337;
export const CIA_RUTA = "/agent-companion.cia";

/** URL que la 3DS abre. Es también el texto que va dentro del QR. */
export function urlCia(ip: string, puerto: number = CIA_PUERTO): string {
  return `http://${ip}:${puerto}${CIA_RUTA}`;
}

/** Lo que /health del puente dice del .cia (ausente en un puente anterior). */
export interface SaludCia {
  serving: boolean;
  port?: number;
  version?: string;
}

/**
 * Quién entrega el .cia en el paso 4:
 *  - `puente`: el puente lo sirve (siempre, no solo mientras este paso está abierto): el QR lleva su dirección y puerto.
 *  - `respaldo`: hay un puente, pero no lo sirve (uno de desarrollo o anterior, o sin la ruta del .cia): el paso levanta su propio servidor.
 *  - `sin-puente`: no hay puente; no se levanta nada (el puente lo servirá cuando se inicie, y dos servidores no deben chocar en el puerto).
 */
export type OrigenCia =
  | { tipo: "puente"; puerto: number; version?: string }
  | { tipo: "respaldo" }
  | { tipo: "sin-puente" }
  /** El puente es el propio (o todavía está arrancando) y aún no sirve el .cia: el paso no levanta nada, el puente reintenta el puerto solo. */
  | { tipo: "esperando" };

/**
 * `propio`: el puente que responde es el hijo que lanzó esta app. `arrancando`: el hijo todavía está arrancando (o a punto de).
 * El respaldo solo se levanta con un puente ajeno que, según /health, no sirve el .cia: con el propio, el servidor del paso
 * le quitaría el puerto 33337 y la 3DS no recibiría el aviso de versión.
 */
export function decidirOrigenCia(salud: { cia?: SaludCia } | undefined, contexto: { propio?: boolean; arrancando?: boolean } = {}): OrigenCia {
  if (!salud) return { tipo: "sin-puente" };
  const cia = salud.cia;
  if (cia?.serving) return { tipo: "puente", puerto: cia.port ?? CIA_PUERTO, ...(cia.version ? { version: cia.version } : {}) };
  if (contexto.propio || contexto.arrancando) return { tipo: "esperando" };
  return { tipo: "respaldo" };
}

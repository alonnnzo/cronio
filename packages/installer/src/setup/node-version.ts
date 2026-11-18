// Comprobar la versión de Node que usan los hooks.

export const NODE_MINIMO = 22;

export interface VersionNode {
  ok: boolean;
  /** Versión leída, p. ej. "24.11.1"; undefined si la salida no se entiende. */
  version?: string;
  mensaje: string;
}

/** Lee la salida de `node --version` ("v24.11.1"). */
export function comprobarNode(salida: string | undefined, minimo: number = NODE_MINIMO): VersionNode {
  const m = /v?(\d+)\.(\d+)\.(\d+)/.exec(salida ?? "");
  if (!m) return { ok: false, mensaje: "No se encontró Node. Instálalo desde nodejs.org (versión LTS) y vuelve a comprobar." };
  const version = `${m[1]}.${m[2]}.${m[3]}`;
  if (Number(m[1]) < minimo) {
    return { ok: false, version, mensaje: `Tienes Node ${version}, pero hace falta la ${minimo} o superior. Instala la versión LTS desde nodejs.org.` };
  }
  return { ok: true, version, mensaje: `Node ${version}: correcto.` };
}

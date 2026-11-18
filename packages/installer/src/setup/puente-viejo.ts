// Qué hacer con un puente que ya está corriendo cuando arranca Cronio. Todo puro: la decisión, el parseo de netstat y tasklist,
// y la regla para decidir si un PID se puede cerrar. Lo que toca el sistema está en bridge-proc.ts y main.ts.

/** Lo que el programa necesita saber de un puente que responde en /health. */
export interface PuenteEncontrado {
  /** Ausente en un puente anterior a que /health dijera su versión. */
  version?: string;
  pid?: number;
  startedBy?: string;
}

export type DecisionPuente = "sin-puente" | "usar" | "pedir-cierre" | "avisar";

/**
 * - sin puente: se arranca el propio.
 * - misma versión que el bundle de esta app: se usa (también el puente de desarrollo con la misma versión).
 * - otra versión, o sin versión (un puente viejo): se le pide cerrarse por `POST /shutdown`.
 * - si ese cierre no funcionó (no tiene /shutdown, o no soltó el puerto): se avisa al usuario para que lo detenga a mano.
 */
export function decidirPuenteExistente(o: { puente: PuenteEncontrado | undefined; versionBundle: string | undefined; cierreFallido?: boolean }): DecisionPuente {
  if (!o.puente) return "sin-puente";
  if (o.puente.version !== undefined && o.puente.version === o.versionBundle) return "usar";
  return o.cierreFallido ? "avisar" : "pedir-cierre";
}

const ESCUCHA = /LISTENING|ESCUCHANDO/i;

/**
 * PIDs que escuchan en 127.0.0.1:<puerto> (o en todas las interfaces, 0.0.0.0) según la salida de `netstat -ano`.
 * Acepta los estados en inglés y en español; ignora conexiones ya establecidas y otros puertos.
 */
export function parsearNetstat(salida: string, puerto: number): number[] {
  const pids: number[] = [];
  for (const linea of salida.split(/\r?\n/)) {
    const c = linea.trim().split(/\s+/);
    // TCP  <local>  <remoto>  <estado>  <pid>
    if (c.length < 5 || c[0]!.toUpperCase() !== "TCP") continue;
    if (!ESCUCHA.test(c[3]!)) continue;
    const local = c[1]!;
    if (local !== `127.0.0.1:${puerto}` && local !== `0.0.0.0:${puerto}`) continue;
    const pid = Number(c[4]);
    if (Number.isInteger(pid) && pid > 0 && !pids.includes(pid)) pids.push(pid);
  }
  return pids;
}

/** Nombre del ejecutable de un PID según `tasklist /FI "PID eq n" /FO CSV /NH`; undefined si no hay proceso. */
export function parsearTasklist(salida: string): string | undefined {
  const m = /^"([^"]+)","(\d+)"/m.exec(salida);
  return m ? m[1] : undefined;
}

const EJECUTABLES_PROPIOS = ["node.exe", "cronio.exe"];

/**
 * ¿Se puede cerrar este PID con taskkill? Solo si sigue escuchando en el puerto del puente y es node.exe o Cronio.exe.
 * Devuelve el motivo del rechazo para mostrarlo.
 */
export function evaluarCierrePid(o: { pid: number; escuchando: number[]; nombre: string | undefined; propio: number }): { ok: true } | { ok: false; motivo: string } {
  if (o.pid === o.propio) return { ok: false, motivo: "Ese es el proceso de Cronio: no se detiene desde aquí." };
  if (!o.escuchando.includes(o.pid)) return { ok: false, motivo: `El proceso ${o.pid} ya no escucha en el puerto del puente. No hice nada.` };
  if (!o.nombre) return { ok: false, motivo: `No encuentro el proceso ${o.pid}. No hice nada.` };
  if (!EJECUTABLES_PROPIOS.includes(o.nombre.toLowerCase())) return { ok: false, motivo: `El proceso ${o.pid} es ${o.nombre}, no un puente de Cronio (node.exe o Cronio.exe). No lo detengo.` };
  return { ok: true };
}

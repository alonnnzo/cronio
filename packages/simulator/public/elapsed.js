// Tiempo en el estado actual de una sesión (Fase 3, panel de agentes): funciones puras, sin DOM. Espejo de client-3ds/source/logic/elapsed.c.
//
// El reloj de la consola y el del PC pueden no coincidir, así que el puente no manda una hora sino `sinceS`: los segundos que la sesión
// llevaba en su estado cuando armó la vista. Quien dibuja le suma su propio tiempo desde que recibió esa vista.

export const MAX_SINCE_S = 99 * 86400;

// Segundos totales: sinceS + lo que pasó localmente desde que llegó la vista (viewAtMs -> nowMs). Un reloj que va hacia atrás no resta.
export function elapsedTotalS(sinceS, viewAtMs, nowMs) {
  const local = nowMs > viewAtMs ? Math.floor((nowMs - viewAtMs) / 1000) : 0;
  return sinceS + local;
}

// Texto corto: "ahora" (menos de 5 s), "hace 12 s", "hace 3 min", "hace 2 h", "hace 4 d" (se trunca, no se redondea).
export function elapsedLabel(secs) {
  if (secs < 5) return 'ahora';
  if (secs < 60) return `hace ${Math.floor(secs)} s`;
  if (secs < 3600) return `hace ${Math.floor(secs / 60)} min`;
  if (secs < 86400) return `hace ${Math.floor(secs / 3600)} h`;
  return `hace ${Math.floor(secs / 86400)} d`;
}

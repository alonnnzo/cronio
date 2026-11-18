// Guarda contra aprobaciones por accidente: una solicitud recién aparecida no se puede aprobar
// hasta pasados APPROVE_GUARD_MS, para que una segunda pulsación pensada para la solicitud anterior
// no apruebe una que aún no se leyó. Rechazar (B) nunca se retrasa. Sin DOM: la 3DS lo reproduce igual.

export const APPROVE_GUARD_MS = 500;

// nowMs y shownAtMs en la misma escala de tiempo (p. ej. performance.now()).
// shownAtMs es el instante en que apareció la solicitud actual; null/undefined = no hay solicitud.
export function canApprove(nowMs, shownAtMs) {
  if (shownAtMs === null || shownAtMs === undefined) return false;
  return nowMs - shownAtMs >= APPROVE_GUARD_MS;
}

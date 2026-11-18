// Avisos (Fase 2b, paso 3a): tarjetas de aviso con "Visto" y modo de aviso por sesión. Módulo puro (sin DOM ni red), espejo
// de lo que hace client-3ds/source/logic/input_logic.c con `view.notice`, `view.chime` y `view.detail.notify`.
//
// Reglas (las mismas que en la consola):
//  - Una tarjeta de aviso solo se muestra sin tarjeta de permiso: los permisos van siempre primero, aunque un puente con
//    errores mandara las dos (`noticeShown`).
//  - "Visto" es el mismo gesto que aprobar (guarda de 500 ms, anulado si cambia lo mostrado) pero en SU PROPIA máquina de
//    estados (approve.js, otra instancia) y emite `ack`, nunca `decision`: nada de lo que se pulse sobre un aviso puede
//    aprobar o rechazar, y una tarjeta de permiso que llega anula el gesto del aviso.
//  - Al agente no se le manda nada: `ack` solo retira la tarjeta en el puente.
//  - Y (o la franja) en el detalle, sin permiso, cambia el modo de aviso de la sesión: todo -> lo importante -> solo al
//    terminar -> silencio -> todo.
//  - `chime` (último aviso con sonido, con `seq`) todavía no suena: `chimeStep` solo decide qué sonaría (paso 3b).

export const NOTIFY_ORDER = ['all', 'important', 'end', 'silent'];
export const NOTIFY_LABEL = { all: 'todo', important: 'lo importante', end: 'solo al terminar', silent: 'silencio' };
export const NOTICE_COLOR = { done: '#3DBE6B', ask: '#1F8FC8', error: '#E5383B', idle: '#6B737F' };

// ¿Hay una tarjeta de aviso a la vista? Solo sin tarjeta de permiso.
export const noticeShown = view => !!(view && view.notice && !view.request);

// Lo que entra en la identidad del gesto de "Visto": cambia el id o las líneas y el gesto en curso se anula.
export function noticeApproval(view) {
  if (!noticeShown(view)) return null;
  return { id: view.notice.id, risk: 'normal', owner: 'aviso', lines: view.notice.lines };
}

export const ackMessage = id => ({ t: 'ack', id });

// L / R con varias tarjetas de aviso: pasar a la siguiente (con un permiso pendiente mandan los permisos).
export function skipNoticeMessages(view) {
  return noticeShown(view) && view.notice.total > 1 ? [{ t: 'skipNotice' }] : [];
}

export const nextNotify = mode => NOTIFY_ORDER[(NOTIFY_ORDER.indexOf(mode) + 1) % NOTIFY_ORDER.length];

// Modo de aviso de la sesión abierta, si el puente lo manda y el detalle es de esa sesión.
export function detailNotify(view, nav) {
  const d = view && view.detail;
  return d && d.notify && nav.level === 'detail' && d.sessionId === nav.sessionId ? d.notify : null;
}

// Y o la franja del detalle: siguiente modo. Solo sin permiso a la vista (con permiso, Y es "no volver a preguntar").
export function cycleNotifyMessages(view, nav) {
  if (!view || view.request) return [];
  const mode = detailNotify(view, nav);
  return mode ? [{ t: 'setting', key: 'sessionNotify', sessionId: nav.sessionId, value: nextNotify(mode) }] : [];
}

// Sonido: la consola suena una vez por `seq` nuevo y toma el primero que ve al conectarse como punto de partida (sin sonar),
// porque el puente guarda el último aviso aunque la consola llegue después. Un `seq` menor (el puente se reinició) toma
// de nuevo el punto de partida.
// Estado: { seq: number | null }. Devuelve { state, play: { kind, seq } | null }.
export function chimeStep(state, view) {
  const c = view && view.chime;
  if (!c) return { state: { seq: state.seq }, play: null };
  if (state.seq === null || c.seq < state.seq) return { state: { seq: c.seq }, play: null };
  if (c.seq === state.seq) return { state, play: null };
  return { state: { seq: c.seq }, play: { kind: c.kind, seq: c.seq } };
}
export const createChime = () => ({ seq: null });

// Lector del mensaje completo (Fase 2b, paso 1): desde el detalle de una sesión, A pide `read` y el puente contesta con
// `text` (las líneas ya limpias de markdown y cortadas en 48 caracteres: la consola no parte texto). Módulo puro (sin DOM
// ni red), espejo de client-3ds/source/logic/reader.c: dado el estado y un evento devuelve el estado nuevo y los mensajes
// que hay que enviar al puente.
//
// Estado: { open, loading, sessionId, top, stale, snap, doc, fromNotice, mode }
//   mode     'full' | 'summary': el modo que se pidió (paso 5); X lo alterna con el lector mostrando, A recarga en el mismo
//   fromNotice  se abrió con "Leer todo" de una tarjeta de aviso: esa tarjeta no lo cierra (la de permiso sí)
//   open     el lector está en pantalla (cargando o mostrando)
//   loading  se pidió y todavía no llegó la respuesta
//   top      índice de la primera línea visible
//   stale    llegó un mensaje nuevo después de pedir este: no salta, avisa ("mensaje nuevo · A recarga")
//   snap     extracto del último mensaje que mostraba el detalle al pedir (4 líneas), para detectar uno nuevo
//   doc      { sessionId, lines, truncated, question?, mode, short } de la última respuesta `text`
//            (mode: el modo de las líneas, 'full' si un puente anterior no lo manda; short: en resumen, el mensaje ya cabía entero)
//
// Reglas de seguridad: el lector nunca tapa ni intercepta aprobar o rechazar. Apenas aparece una tarjeta de permiso
// (view.request) o el detalle deja de ser el de su sesión, se cierra solo; con una tarjeta no se puede abrir. Una tarjeta de
// aviso lo cierra igual, salvo el lector que se abrió justamente con "Leer todo" de ese aviso (A no lo abre: marca "Visto").
//
// Eventos: { type: 'open', sessionId, view } | { type: 'text', msg } | { type: 'view', view, nav }
//        | { type: 'scroll', delta } | { type: 'page', dir } | { type: 'reload', view } | { type: 'toggle', view } | { type: 'close' }
//   (open con fromNotice: true lo abre desde la tarjeta de aviso; open abre en view.settings.readerDefault, 'full' si no hay)

import { noticeShown } from './notice.js';

export const ROW_PX = 15;             // alto de cada línea en la 3DS (la pantalla es de 320x240)
export const BODY_TOP = 24;           // debajo de la barra
export const FOOT_PX = 15;            // pie "X: resumen" / "X: completo"
export const BODY_BOTTOM = 238 - FOOT_PX;
export const STALE_PX = 18;           // aviso "mensaje nuevo" (16 + 2)
export const QUESTION_HEAD_PX = 17;
export const MAX_QUESTION_LINES = 3;

export const TRUNCATED_LINE = '… sigue en el PC';

export function createReader() {
  return { open: false, loading: false, sessionId: null, top: 0, stale: false, snap: null, doc: null, fromNotice: false, mode: 'full' };
}

export const READ_MODES = ['full', 'summary'];
// Modo en que se abre el lector: el ajuste del puente (readerDefault) o completo.
export const defaultMode = view => (view && view.settings && view.settings.readerDefault === 'summary' ? 'summary' : 'full');
// Modo de lo que se está viendo: el del documento (un puente anterior no lo manda: completo) y, cargando, el pedido.
export const shownMode = state => (state.doc && !state.loading ? (state.doc.mode === 'summary' ? 'summary' : 'full') : state.mode);
// Mensaje `read`: el modo completo se pide sin campo (igual que la consola real); el resumen, con mode.
export const readMessage = (sessionId, mode) => (mode === 'summary' ? { t: 'read', sessionId, mode } : { t: 'read', sessionId });

// Líneas que caben (mismas cuentas que reader_layout en C): 13 sin nada, 12 con el aviso, 8 con 3 líneas de pregunta.
export function visibleRows(questionLines, stale) {
  const q = Math.min(MAX_QUESTION_LINES, Math.max(0, questionLines | 0));
  let y = BODY_TOP + (stale ? STALE_PX : 0);
  if (q > 0) y += QUESTION_HEAD_PX + ROW_PX * q + 2 + 3;
  return Math.max(1, Math.floor((BODY_BOTTOM - y) / ROW_PX));
}

const shown = state => (state.open && !state.loading ? state.doc : null);

// Líneas recorribles: las del puente y, si se cortó, la de "… sigue en el PC".
export function allLines(doc) {
  if (!doc) return [];
  return doc.truncated ? [...doc.lines, TRUNCATED_LINE] : doc.lines;
}

export function rowsOf(state) {
  const doc = shown(state);
  return visibleRows(doc && doc.question ? doc.question.length : 0, state.stale);
}

const clampTop = state => {
  const doc = shown(state);
  const max = Math.max(0, allLines(doc).length - rowsOf(state));
  return { ...state, top: Math.min(max, Math.max(0, state.top)) };
};

// Primera y última línea visibles (desde 1) y total, para la cabecera. total 0 = nada que contar.
export function position(state) {
  const doc = shown(state);
  const total = allLines(doc).length;
  if (!doc || total === 0) return { first: 0, last: 0, total: 0 };
  return { first: state.top + 1, last: Math.min(total, state.top + rowsOf(state)), total };
}

export function visibleLines(state) {
  const doc = shown(state);
  return doc ? allLines(doc).slice(state.top, state.top + rowsOf(state)) : [];
}

const excerpt = (view, sessionId) => (view.detail && view.detail.sessionId === sessionId ? [...view.detail.lastMessage] : null);
const sameLines = (a, b) => a.length === b.length && a.every((l, i) => l === b[i]);
const result = (state, messages = []) => ({ state, messages });

// ¿Se puede abrir el lector (con A)? Solo en el detalle de una sesión y sin tarjeta de permiso ni de aviso (con una de aviso A
// marca "Visto"; se lee con su "Leer todo").
export function canOpen(nav, view) {
  return nav.level === 'detail' && !!nav.sessionId && !view.request && !noticeShown(view);
}

// ¿Debe cerrarse? Con una tarjeta, fuera del detalle o en el detalle de otra sesión.
export function mustClose(state, nav, view) {
  return state.open && (!!view.request || nav.level !== 'detail' || nav.sessionId !== state.sessionId || (noticeShown(view) && !state.fromNotice));
}

export function reduceReader(state, event) {
  switch (event.type) {
    case 'open':
    case 'reload':
    case 'toggle': {
      if (event.type === 'toggle' && (!state.open || state.loading || !state.doc)) return result(state); // solo con el lector mostrando
      const sessionId = event.type === 'open' ? event.sessionId : state.sessionId;
      const fromNotice = event.type === 'open' ? !!event.fromNotice : state.fromNotice;
      if (!sessionId || event.view.request) return result(state); // con tarjeta, A es aprobar
      if (noticeShown(event.view) && !fromNotice) return result(state); // con un aviso, A marca "Visto"
      const mode = event.type === 'open' ? defaultMode(event.view) : event.type === 'toggle' ? (shownMode(state) === 'summary' ? 'full' : 'summary') : shownMode(state);
      const next = { ...createReader(), open: true, loading: true, sessionId, fromNotice, mode, snap: excerpt(event.view, sessionId) };
      return result(next, [readMessage(sessionId, mode)]);
    }
    case 'close':
      return result(createReader());
    case 'text': {
      const m = event.msg;
      if (!state.open || !m || m.sessionId !== state.sessionId) return result(state); // respuesta de otra sesión o ya cerrado
      const doc = { sessionId: m.sessionId, lines: m.lines, truncated: !!m.truncated, question: m.question && m.question.length ? m.question : null, mode: m.mode === 'summary' ? 'summary' : 'full', short: !!m.short };
      return result(clampTop({ ...state, loading: false, doc, top: state.loading ? 0 : state.top }));
    }
    case 'view': {
      if (!state.open) return result(state);
      if (mustClose(state, event.nav, event.view)) return result(createReader());
      const now = excerpt(event.view, state.sessionId);
      if (!now) return result(state);
      if (!state.snap) return result({ ...state, snap: now }); // la primera vista que trae el detalle fija la foto sin avisar
      return result(sameLines(now, state.snap) ? state : { ...state, stale: true });
    }
    case 'scroll':
      return result(state.open && !state.loading ? clampTop({ ...state, top: state.top + event.delta }) : state);
    case 'page': {
      if (!state.open || state.loading) return result(state);
      const step = Math.max(1, rowsOf(state) - 1); // queda una línea de contexto
      return result(clampTop({ ...state, top: state.top + (event.dir < 0 ? -step : step) }));
    }
    default:
      return result(state);
  }
}

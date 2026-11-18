// Instrucciones por texto (Fase 2b, paso 6): máquina de estados pura (sin DOM ni red) de la tarjeta "Espera tu instrucción" y los mensajes
// del detalle. Espejo de client-3ds/source/logic/instruct.c y de lo que hace input_logic.c con `request.kind: 'instruction'`.
//
// Una sesión con "Esperar mi respuesta" que termina su turno deja su Stop retenido en el puente: la vista trae
// `request: { kind: 'instruction', lines: [comienzo del último mensaje] }` en la misma cola que los permisos y las preguntas.
// No se aprueba ni se rechaza: NUNCA sale `decision` de aquí. Filas, en orden:
//   atajos (Fase 3, `request.quick`, hasta 4, en dos columnas) -> { t: 'instruct', sessionId, text } con su texto fijo
//   Escribir         -> efecto { kind: 'write', sessionId } (la app pide el texto y lo manda con `instruct`)
//   Seguir en el PC  -> { t: 'release', requestId }: libera sin instrucción y Claude termina como siempre
// El cursor empieza en Escribir. Flechas arriba/abajo (y izquierda/derecha entre los atajos) mueven, A (o Enter, o tocar la fila) elige y
// B no hace nada: nunca envía, libera ni rechaza.
// Guarda: A no hace nada hasta pasados INSTRUCT_GUARD_MS desde que llegó la tarjeta. Otra tarjeta (otro id) empieza de cero.
//
// Estado: { connected, id, since, quick, cursor, sent }   (quick = cuántos atajos trae la tarjeta; las filas son quick + 2)
// Eventos (devuelven { state, messages, effect }):
//   { type: 'connection', connected } | { type: 'view', now, request } | { type: 'move', dy?, dx? } | { type: 'select', row }
//   { type: 'activate', now, row?, repeat? } | { type: 'text', sessionId?, text } -> lo escrito ('' o null = canceló)

import { APPROVE_GUARD_MS } from './approve-guard.js';

export const INSTRUCT_GUARD_MS = APPROVE_GUARD_MS;
export const MAX_INSTRUCTION_TEXT = 400;
export const MAX_QUEUED = 5;
export const WAIT_VALUES = [5, 10, 30];

export const isInstructionCard = view => !!(view && view.request && view.request.kind === 'instruction');
export const ROWS = [{ kind: 'write', label: 'Escribir', help: 'Teclado: lo que escribas se lo manda a la sesión' }, { kind: 'release', label: 'Seguir en el PC', help: 'Claude termina como siempre; sigues en el PC' }];

// Las filas de la tarjeta: los atajos de la solicitud y después las dos fijas.
export const rowsOf = request => [
  ...((request && request.kind === 'instruction' && Array.isArray(request.quick) ? request.quick : []).slice(0, MAX_QUICK).map(q => ({ kind: 'quick', label: q.label, text: q.text, help: q.text }))),
  ...ROWS,
];
export const MAX_QUICK = 4;

export function createInstruct() {
  return { connected: false, id: null, since: 0, quick: 0, cursor: 0, sent: false };
}

const out = (state, messages = [], effect = null) => ({ state, messages, effect });

export function instructReady(state, now) {
  return state.connected && state.id !== null && !state.sent && now - state.since >= INSTRUCT_GUARD_MS;
}

// Lo escrito en el teclado: los controles y saltos pasan a espacio, se recortan los extremos y se corta a 400 caracteres.
export function cleanInstruction(text) {
  if (typeof text !== 'string') return '';
  return Array.from(text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim()).slice(0, MAX_INSTRUCTION_TEXT).join('').trim();
}

export function reduceInstruct(state, ev, request) {
  switch (ev.type) {
    case 'connection':
      return out({ ...state, connected: !!ev.connected });

    case 'view': {
      if (!ev.request || ev.request.kind !== 'instruction') return out({ ...createInstruct(), connected: state.connected });
      if (state.id === ev.request.id) return out(state);   // la misma tarjeta: no reinicia nada
      const quick = rowsOf(ev.request).length - ROWS.length;
      return out({ ...createInstruct(), connected: state.connected, id: ev.request.id, since: ev.now, quick, cursor: quick });
    }

    case 'move': {
      if (state.id === null || state.sent) return out(state);
      const n = state.quick;
      const last = n + ROWS.length - 1;
      let c = state.cursor;
      const dy = Math.sign(ev.dy || 0);
      const dx = Math.sign(ev.dx || 0);
      if (dy > 0) c = c < n ? (c + 2 < n ? c + 2 : n) : Math.min(last, c + 1);   // los atajos bajan de a una fila; del último, a Escribir
      else if (dy < 0) c = c > n ? c - 1 : c === n ? (n > 0 ? n - 1 : n) : (c - 2 >= 0 ? c - 2 : c);
      else if (dx > 0 && c < n && c % 2 === 0 && c + 1 < n) c += 1;
      else if (dx < 0 && c < n && c % 2 === 1) c -= 1;
      return c === state.cursor ? out(state) : out({ ...state, cursor: c });
    }

    case 'select':
      if (state.id === null || state.sent || ev.row < 0 || ev.row >= state.quick + ROWS.length) return out(state);
      return out({ ...state, cursor: ev.row });

    case 'activate': {
      if (ev.repeat || !instructReady(state, ev.now) || !request || request.kind !== 'instruction') return out(state);
      const rows = rowsOf(request);
      const row = ev.row === undefined ? state.cursor : ev.row;
      if (row < 0 || row >= rows.length) return out(state);
      const at = { ...state, cursor: row };
      if (rows[row].kind === 'quick') {
        const text = cleanInstruction(rows[row].text);
        if (text === '') return out(state);
        return out({ ...at, sent: true }, [{ t: 'instruct', sessionId: request.sessionId, text }]);   // sale en el acto, una sola vez
      }
      if (rows[row].kind === 'write') return out(at, [], { kind: 'write', sessionId: request.sessionId });   // el teclado puede cancelarse
      return out({ ...at, sent: true }, [{ t: 'release', requestId: state.id }]);
    }

    case 'text': {
      // lo escrito para la sesión `ev.sessionId` (la de la tarjeta o la del detalle)
      const text = cleanInstruction(ev.text);
      if (text === '' || !ev.sessionId) return out(state);
      const fromCard = request && request.kind === 'instruction' && request.sessionId === ev.sessionId;
      return out(fromCard ? { ...state, sent: true } : state, [{ t: 'instruct', sessionId: ev.sessionId, text }]);
    }

    default:
      return out(state);
  }
}

// ---- detalle de la sesión (sin tarjeta) ----

// ¿Se le puede escribir a la sesión del detalle abierto? Sin tarjeta (ni de permiso ni de aviso) y solo si el puente manda
// `settings.instructWaitMax` (sabe de instrucciones por texto).
export function canInstruct(view, nav) {
  if (!view || view.request || (view.notice && !view.request) || nav.level !== 'detail' || !nav.sessionId) return false;
  return !!(view.detail && view.detail.sessionId === nav.sessionId && view.settings && view.settings.instructWaitMax !== undefined);
}

export const queuedOf = (view, nav) => (canInstruct(view, nav) && view.detail.instructions ? view.detail.instructions : null);
export const waitingOf = (view, nav) => !!(canInstruct(view, nav) && view.detail.waitForMe);

// X: escribir una instrucción (efecto, la app pide el texto).
export const writeEffect = (view, nav) => (canInstruct(view, nav) ? { kind: 'write', sessionId: nav.sessionId } : null);

// Izquierda/derecha: alterna "Esperar mi respuesta" de la sesión.
export function toggleWaitMessages(view, nav) {
  return canInstruct(view, nav) ? [{ t: 'setting', key: 'sessionWait', sessionId: nav.sessionId, value: !waitingOf(view, nav) }] : [];
}

// Abajo: borra la cola (solo si hay algo).
export function clearMessages(view, nav) {
  return queuedOf(view, nav) ? [{ t: 'instructClear', sessionId: nav.sessionId }] : [];
}

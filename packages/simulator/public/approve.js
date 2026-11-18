// Aprobar una solicitud: máquina de estados pura (sin DOM ni reloj propio). La 3DS la reproduce igual.
//
// Reglas:
//  - Un gesto es "pulsar A" (teclado o puntero) hasta soltar. Solo se emite una aprobación si lo mostrado
//    (id + dueño + líneas) al terminar el gesto es lo mismo que al empezarlo.
//  - El gesto debe empezar con la solicitud visible desde hace >= APPROVE_GUARD_MS; si no, queda anulado.
//  - Riesgo normal: se aprueba al soltar. Riesgo alto: al cumplirse HOLD_MS de retención (evento tick), sobre
//    la misma solicitud; soltar antes no aprueba.
//  - Cualquier cambio de lo mostrado (o que desaparezca) durante el gesto lo anula: hay que soltar y volver a pulsar.
//  - Sin conexión no se emite nada. Una solicitud ya respondida no se vuelve a aprobar.
//  - "Sí, no volver a preguntar" es el mismo gesto con `always: true` en down/up (tecla Y o su botón): mismas guardas,
//    misma retención en riesgo alto y mismas anulaciones. Solo arranca si la tarjeta lo ofrece (request.always, la
//    etiqueta) y solo lo termina el mismo botón (un up con otro `always` no hace nada). Emite decision 'allow_always'.
//
// Estado: { connected, shown: { key, id, risk, always, since } | null, decidedId, gesture: null | { source, id, key, risk, always, startedAt, dead, spent } }
// Eventos (todos devuelven { state, emit }; emit es null o { requestId, decision: 'allow' | 'allow_always' }):
//   { type: 'connection', connected }
//   { type: 'view', now, request: { id, risk, owner, lines, always? } | null }
//   { type: 'down', now, source: 'key' | 'pointer', repeat?, always? }
//   { type: 'up', now, source, always? }
//   { type: 'tick', now }              // avanza la retención de riesgo alto
//   { type: 'cancel' }                 // blur, el puntero salió del botón, etc.
//   { type: 'decided', id }            // se respondió por otra vía (rechazar): no se aprueba después
// Consultas: approveReady(state, now) -> bool (botón habilitado), holdProgress(state, now) -> 0..1.

import { APPROVE_GUARD_MS, canApprove } from './approve-guard.js';

export { APPROVE_GUARD_MS };
export const HOLD_MS = 1000;

export function createApproval() {
  return { connected: false, shown: null, decidedId: null, gesture: null };
}

// Identidad de lo mostrado: si cambia cualquiera de estos datos es "otra solicitud" para el usuario.
export function requestKey(request) {
  const base = [request.id, request.risk, request.owner || '', request.lines || []];
  // la etiqueta de "siempre" solo entra si la hay: una tarjeta sin ella conserva la misma llave de antes
  return JSON.stringify(request.always ? [...base, request.always] : base);
}

const out = (state, emit = null) => ({ state, emit });

const decisionOf = gesture => (gesture.always ? 'allow_always' : 'allow');

function emitAllow(state, gesture) {
  return out({ ...state, decidedId: gesture.id, gesture: { ...gesture, spent: true } }, { requestId: gesture.id, decision: decisionOf(gesture) });
}

// Lo mostrado ahora coincide con lo que había al empezar el gesto.
const sameShown = (state, g) => state.connected && state.shown !== null && state.shown.key === g.key && state.decidedId !== g.id;

export function approveReduce(state, ev) {
  switch (ev.type) {
    case 'connection': {
      const gesture = !ev.connected && state.gesture ? { ...state.gesture, dead: true } : state.gesture;
      return out({ ...state, connected: !!ev.connected, gesture });
    }

    case 'view': {
      const req = ev.request;
      if (!req) return out({ ...state, shown: null, gesture: state.gesture ? { ...state.gesture, dead: true } : null });
      const key = requestKey(req);
      if (state.shown && state.shown.key === key) return out(state);   // misma solicitud: no reinicia nada
      const shown = { key, id: req.id, risk: req.risk, always: !!req.always, since: ev.now };
      return out({ ...state, shown, gesture: state.gesture ? { ...state.gesture, dead: true } : null });
    }

    case 'down': {
      if (ev.repeat || state.gesture) return out(state);   // la repetición de tecla o un segundo gesto no reinician nada
      const shown = state.shown;
      const always = !!ev.always;
      const ok = state.connected && shown !== null && shown.id !== state.decidedId && canApprove(ev.now, shown.since) && (!always || shown.always);
      const gesture = {
        source: ev.source,
        id: shown ? shown.id : null,
        key: shown ? shown.key : null,
        risk: shown ? shown.risk : 'normal',
        always,
        startedAt: ev.now,
        dead: !ok,
        spent: false,
      };
      return out({ ...state, gesture });
    }

    case 'tick': {
      const g = state.gesture;
      if (!g || g.dead || g.spent || g.risk !== 'high') return out(state);
      if (!sameShown(state, g)) return out({ ...state, gesture: { ...g, dead: true } });
      if (ev.now - g.startedAt >= HOLD_MS) return emitAllow(state, g);
      return out(state);
    }

    case 'up': {
      const g = state.gesture;
      if (!g || g.source !== ev.source || g.always !== !!ev.always) return out(state);   // otro botón: ese gesto sigue en curso
      const next = { ...state, gesture: null };
      if (g.dead || g.spent || g.risk === 'high') return out(next);   // en riesgo alto solo vale completar la retención
      if (!sameShown(state, g)) return out(next);
      return out({ ...next, decidedId: g.id }, { requestId: g.id, decision: decisionOf(g) });
    }

    case 'cancel':
      return out({ ...state, gesture: null });

    case 'decided':
      return out({ ...state, decidedId: ev.id, gesture: state.gesture ? { ...state.gesture, dead: true } : null });

    default:
      return out(state);
  }
}

// Botón habilitado: hay solicitud sin responder, conexión y ya pasó la guarda.
export function approveReady(state, now) {
  const s = state.shown;
  return state.connected && s !== null && s.id !== state.decidedId && canApprove(now, s.since);
}

// El gesto en curso es el de "no volver a preguntar" (para dibujar su barra de retención).
export function holdIsAlways(state) {
  return !!state.gesture && state.gesture.always;
}

// Avance de la retención de riesgo alto (0 si no hay gesto válido en curso).
export function holdProgress(state, now) {
  const g = state.gesture;
  if (!g || g.dead || g.risk !== 'high') return 0;
  if (g.spent) return 0;
  return Math.min(1, Math.max(0, (now - g.startedAt) / HOLD_MS));
}

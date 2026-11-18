// Navegación de la pantalla inferior: agentes -> sesiones del agente -> detalle de la sesión.
// Módulo puro (sin DOM ni red): dado el estado, la vista del puente y una acción, devuelve el estado
// nuevo y los mensajes que hay que enviar al puente. La 3DS lo reproduce igual.
//
// Estado: { level: 'agents' | 'sessions' | 'detail', kind: string | null, sessionId: string | null, cursor: number }
//   agents:   cursor = índice del agente en KINDS (cuadrícula de GRID_COLS columnas)
//   sessions: cursor = índice dentro de las sesiones de `kind`, en el orden de view.sessions
//   detail:   cursor no se usa (0); además `confirmed` (el puente ya mostró este detalle) y `since` (instante de entrada)
//
// El enfoque de sesión es único en el puente: si otro cliente lo quita (focus null o skip), `sync` devuelve a sesiones
// sin enviar focus. Para no rebotar entre enviar focus y recibir la vista que lo confirma, la regla solo se aplica
// tras ver el detalle (`confirmed`) o pasado DETAIL_CONFIRM_MS desde la entrada.
//
// Acciones: { type: 'move', dx, dy } | { type: 'enter', index?, now? } | { type: 'back' } | { type: 'sync', now? }
//         | { type: 'openSession', sessionId, now? }   (abre el detalle desde cualquier nivel: "Leer todo" de una tarjeta de aviso)
// Resultado: { state, messages }. Entrar al detalle envía focus con la sesión; salir envía focus con null.

export const KINDS = ['claude', 'gemini', 'codex', 'cursor', 'hermes'];
export const GRID_COLS = 3;
export const DETAIL_CONFIRM_MS = 1000;

export function createNav() {
  return { level: 'agents', kind: null, sessionId: null, cursor: 0 };
}

export function sessionsOf(view, kind) {
  return (view.sessions || []).filter(s => s.kind === kind);
}

// Agentes ocultos en la configuración del puente (view.settings.hiddenAgents): no salen en la lista de agentes.
export function hiddenKinds(view) {
  return (view.settings && view.settings.hiddenAgents) || [];
}

// Agentes que se muestran, en el orden de la cuadrícula. En el nivel de agentes el cursor y los índices cuentan sobre esta lista.
export function visibleKinds(view) {
  const hidden = hiddenKinds(view);
  return KINDS.filter(k => !hidden.includes(k));
}

// Cuántos elementos tiene la lista del nivel actual.
export function itemCount(state, view) {
  if (state.level === 'agents') return visibleKinds(view).length;
  if (state.level === 'sessions') return sessionsOf(view, state.kind).length;
  return 0;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const focus = sessionId => ({ t: 'focus', sessionId });
const result = (state, messages = []) => ({ state, messages });

function moveCursor(state, view, dx, dy) {
  const count = itemCount(state, view);
  if (count === 0) return state;
  let c = state.cursor;
  if (state.level === 'agents') {
    if (dx) c = clamp(c + dx, 0, count - 1);
    if (dy) {
      const next = c + dy * GRID_COLS;
      c = next >= 0 && next < count ? next : c;   // en el borde de la cuadrícula se queda
    }
  } else {
    c = clamp(c + dx + dy, 0, count - 1);          // en la lista, cualquier flecha recorre
  }
  return c === state.cursor ? state : { ...state, cursor: c };
}

export function reduce(state, view, action) {
  switch (action.type) {
    case 'move':
      return result(moveCursor(state, view, action.dx || 0, action.dy || 0));

    case 'enter': {
      const index = action.index === undefined ? state.cursor : action.index;
      if (state.level === 'agents') {
        const kind = visibleKinds(view)[index];
        if (index < 0 || !kind) return result(state);
        return result({ level: 'sessions', kind, sessionId: null, cursor: 0 });
      }
      if (state.level === 'sessions') {
        const s = sessionsOf(view, state.kind)[index];
        if (!s) return result(state);
        return result({ level: 'detail', kind: state.kind, sessionId: s.id, cursor: 0, confirmed: false, since: action.now ?? 0 }, [focus(s.id)]);
      }
      return result(state);
    }

    case 'openSession': {
      const s = (view.sessions || []).find(x => x.id === action.sessionId);
      if (!s || hiddenKinds(view).includes(s.kind)) return result(state);
      if (state.level === 'detail' && state.sessionId === s.id) return result(state);   // ya está abierto: no se vuelve a enfocar
      return result({ level: 'detail', kind: s.kind, sessionId: s.id, cursor: 0, confirmed: false, since: action.now ?? 0 }, [focus(s.id)]);
    }

    case 'back': {
      if (state.level === 'detail') {
        const i = sessionsOf(view, state.kind).findIndex(s => s.id === state.sessionId);
        return result({ level: 'sessions', kind: state.kind, sessionId: null, cursor: Math.max(0, i) }, [focus(null)]);
      }
      if (state.level === 'sessions') {
        return result({ level: 'agents', kind: null, sessionId: null, cursor: Math.max(0, visibleKinds(view).indexOf(state.kind)) });
      }
      return result(state);
    }

    case 'sync': {
      // Tras cada vista nueva: si la sesión abierta desapareció, un nivel atrás; el cursor se mantiene en rango.
      // Si el agente de esta pantalla se ocultó en la configuración, de vuelta a la lista de agentes (y se suelta el enfoque).
      if (state.level !== 'agents' && hiddenKinds(view).includes(state.kind)) {
        return result({ level: 'agents', kind: null, sessionId: null, cursor: 0 }, state.level === 'detail' ? [focus(null)] : []);
      }
      if (state.level === 'detail' && !(view.sessions || []).some(s => s.id === state.sessionId)) {
        const count = sessionsOf(view, state.kind).length;
        return result({ level: 'sessions', kind: state.kind, sessionId: null, cursor: clamp(state.cursor, 0, Math.max(0, count - 1)) }, [focus(null)]);
      }
      if (state.level === 'detail') {
        if (view.detail && view.detail.sessionId === state.sessionId) {
          return result(state.confirmed ? state : { ...state, confirmed: true });
        }
        // El puente ya no tiene este enfoque (otro cliente lo quitó o hubo skip): no se envía focus.
        const timedOut = action.now !== undefined && action.now - state.since >= DETAIL_CONFIRM_MS;
        if (state.confirmed || timedOut) {
          const i = sessionsOf(view, state.kind).findIndex(s => s.id === state.sessionId);
          return result({ level: 'sessions', kind: state.kind, sessionId: null, cursor: Math.max(0, i) });
        }
        return result(state);
      }
      const count = itemCount(state, view);
      const c = clamp(state.cursor, 0, Math.max(0, count - 1));
      return result(c === state.cursor ? state : { ...state, cursor: c });
    }

    default:
      return result(state);
  }
}

// B: con tarjeta de permiso rechaza; con una pregunta (AskUserQuestion) vuelve a la pregunta anterior y nunca rechaza ni responde;
// sin tarjeta vuelve un nivel.
export function bAction(view) {
  if (view.request && view.request.kind === 'question') return 'question';
  if (view.request && view.request.kind === 'instruction') return 'instruction';   // B nunca envía, libera ni rechaza
  return view.request ? 'deny' : 'back';
}

// L / R: saltar al siguiente permiso, solo en modo "en fila" y con más de uno pendiente.
export function skipMessages(view) {
  return view.mode === 'queue' && view.request && view.pendingCount > 1 ? [{ t: 'skip' }] : [];
}

export function modeMessages(view) {
  return [{ t: 'mode', mode: view.mode === 'manual' ? 'queue' : 'manual' }];
}

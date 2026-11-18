// Menú de configuración (Fase 2b, paso 2): espejo de client-3ds/source/logic/menu.c. Módulo puro (sin DOM ni red): dado el
// estado, la vista del puente y un evento, devuelve el estado nuevo, los mensajes para el puente y, si hace falta, un
// efecto local (abrir la guía, alternar el diagnóstico, cerrar el menú). El puente decide y guarda los ajustes; aquí solo
// hay un cursor: los valores salen de view.settings y nada cambia hasta que el puente reenvía la vista.
//
// Entradas de la raíz:
//   notify  Avisos por defecto  -> { t: 'setting', key: 'notifyDefault', value }  (A o ←/→ cambian de valor)
//   ack     Pedir "Visto"       -> { t: 'setting', key: 'notifyAck', value }      (A o ←/→ alternan)
//   sound   Sonido              -> { t: 'setting', key: 'sound', value }          (A o ←/→ alternan; la consola real lo aplica con ndsp)
//   questions Preguntas en la 3DS -> { t: 'setting', key: 'questions', value }    (A o ←/→ alternan; apagado, las preguntas se responden en el PC)
//   reader  Abrir mensajes en   -> { t: 'setting', key: 'readerDefault', value }  (A o ←/→ alternan completo / resumen; paso 5)
//   instructWait Esperar instrucción hasta -> { t: 'setting', key: 'instructWaitMax', value: 5|10|30 }  (A o ←/→ cambian; paso 6; pide settings.instructWaitMax)
//   agents  Agentes             -> A entra al submenú: un interruptor por agente (hiddenAgents)
//   guide   Guía de botones     -> efecto { kind: 'guide' }
//   diag    Diagnóstico         -> efecto { kind: 'diag' }
// Las cinco primeras piden una vista con `settings`: sin ella salen desactivadas ("sin conexión").
//
// Seguridad: el menú nunca tapa ni intercepta aprobar o rechazar. Una tarjeta de permiso lo cierra (y a la guía que abrió),
// y con una tarjeta a la vista no se abre (ver mustClose y canOpen). Una tarjeta de aviso con "Visto" hace lo mismo.
//
// Eventos: { type: 'open' } | { type: 'close' } | { type: 'move', dy } | { type: 'activate', dir, cycleOnly }
//        | { type: 'back' } | { type: 'select', row }   (select: tocar una fila = moverse a ella y activarla)

import { KINDS } from './nav.js';
import { noticeShown } from './notice.js';

export const ROOT_ENTRIES = ['notify', 'ack', 'sound', 'questions', 'reader', 'instructWait', 'agents', 'guide', 'diag'];
export const WAIT_VALUES = [5, 10, 30];
export const READER_VALUES = ['full', 'summary'];
export const READER_LABEL = { full: 'completo', summary: 'resumen' };
export const NOTIFY_VALUES = ['all', 'important', 'end', 'silent'];
export const NOTIFY_LABEL = { all: 'todo', important: 'lo importante', end: 'solo al terminar', silent: 'silencio' };
export const ENTRY_TITLE = {
  notify: 'Avisos por defecto',
  ack: 'Pedir "Visto" en los avisos',
  sound: 'Sonido',
  questions: 'Preguntas en la 3DS',
  reader: 'Abrir mensajes en',
  instructWait: 'Esperar instrucción hasta',
  agents: 'Agentes',
  guide: 'Guía de botones',
  diag: 'Diagnóstico',
};
export const ENTRY_HINT = {
  notify: 'Sesiones nuevas · cada sesión cambia el suyo',
  ack: 'Cada aviso queda en una tarjeta con "Visto"',
  questions: 'Apagado, las preguntas se responden en el PC',
  reader: 'En el lector, X alterna completo y resumen',
};
export const soundOn = view => !(view && view.settings && view.settings.sound === false);
export const questionsOn = view => !(view && view.settings && view.settings.questions === false);
export const readerDefaultOf = view => (view && view.settings && view.settings.readerDefault === 'summary' ? 'summary' : 'full');
export const AGENTS_HINT = ['Un agente oculto no sale en la lista ni en la cara,', 'pero sus permisos sí llegan y se muestran.'];

export function createMenu() {
  return { open: false, level: 'root', cursor: 0, rootCursor: 0 };
}

const result = (state, messages = [], effect = null) => ({ state, messages, effect });
const setting = (key, value) => ({ t: 'setting', key, value });

export const hasSettings = view => !!(view && view.settings);
export const instructWaitOf = view => (view && view.settings && WAIT_VALUES.includes(view.settings.instructWaitMax) ? view.settings.instructWaitMax : 10);
export const entryEnabled = (entry, view) => entry === 'guide' || entry === 'diag' || (entry === 'instructWait' ? hasSettings(view) && view.settings.instructWaitMax !== undefined : hasSettings(view));
export const hiddenOf = view => (hasSettings(view) ? view.settings.hiddenAgents : []);

const rowCount = level => (level === 'agents' ? KINDS.length : ROOT_ENTRIES.length);

// ¿Debe cerrarse? Con una tarjeta de permiso o de aviso a la vista.
export const mustClose = (state, view) => state.open && !!(view && (view.request || noticeShown(view)));
// ¿Se puede abrir? Con una tarjeta a la vista no: primero se responde (o se marca "Visto").
export const canOpen = view => !(view && (view.request || noticeShown(view)));

export function reduceMenu(state, view, event) {
  switch (event.type) {
    case 'open':
      return canOpen(view) ? result({ ...createMenu(), open: true }) : result(state);
    case 'close':
      return result(createMenu());
    case 'move': {
      if (!state.open) return result(state);
      const n = rowCount(state.level);
      const c = Math.min(n - 1, Math.max(0, state.cursor + Math.sign(event.dy || 0)));
      return result({ ...state, cursor: c, rootCursor: state.level === 'root' ? c : state.rootCursor });
    }
    case 'select': {
      if (!state.open || event.row < 0 || event.row >= rowCount(state.level)) return result(state);
      const moved = { ...state, cursor: event.row, rootCursor: state.level === 'root' ? event.row : state.rootCursor };
      return reduceMenu(moved, view, { type: 'activate', dir: 1, cycleOnly: false });
    }
    case 'back': {
      if (!state.open) return result(state);
      if (state.level === 'agents') return result({ ...state, level: 'root', cursor: state.rootCursor });
      return result(createMenu(), [], { kind: 'close' });
    }
    case 'activate': {
      if (!state.open) return result(state);
      const step = event.dir < 0 ? -1 : 1;
      if (state.level === 'agents') {
        if (!hasSettings(view)) return result(state);
        const kind = KINDS[state.cursor];
        const hidden = hiddenOf(view);
        const next = hidden.includes(kind) ? hidden.filter(k => k !== kind) : [...hidden, kind];
        return result(state, [setting('hiddenAgents', KINDS.filter(k => next.includes(k)))]);
      }
      const entry = ROOT_ENTRIES[state.cursor];
      if (!entryEnabled(entry, view)) return result(state);
      switch (entry) {
        case 'notify': {
          const i = NOTIFY_VALUES.indexOf(view.settings.notifyDefault);
          const next = NOTIFY_VALUES[(i + step + NOTIFY_VALUES.length) % NOTIFY_VALUES.length];
          return result(state, [setting('notifyDefault', next)]);
        }
        case 'ack':
          return result(state, [setting('notifyAck', !view.settings.notifyAck)]);
        case 'sound':
          return result(state, [setting('sound', !soundOn(view))]);
        case 'questions':
          return result(state, [setting('questions', !questionsOn(view))]);
        case 'reader':
          return result(state, [setting('readerDefault', readerDefaultOf(view) === 'summary' ? 'full' : 'summary')]);
        case 'instructWait': {
          const at = WAIT_VALUES.indexOf(instructWaitOf(view));
          return result(state, [setting('instructWaitMax', WAIT_VALUES[(at + step + WAIT_VALUES.length) % WAIT_VALUES.length])]);
        }
        case 'agents':
          return event.cycleOnly ? result(state) : result({ ...state, level: 'agents', cursor: 0 });
        case 'guide':
          return event.cycleOnly ? result(state) : result(state, [], { kind: 'guide' });
        case 'diag':
          return event.cycleOnly ? result(state) : result(state, [], { kind: 'diag' });
        default:
          return result(state);
      }
    }
    default:
      return result(state);
  }
}

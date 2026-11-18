// Preguntas con alternativas (Fase 2b, paso 4): máquina de estados pura (sin DOM ni red) de la tarjeta de pregunta de la
// consola. Espejo de client-3ds/source/logic/question.c: la 3DS reproduce las mismas reglas.
//
// La vista trae `request.kind: 'question'` con `request.questions: [{ header, text, multi, options: [{ label, desc, recommended }] }]`.
// La consola responde con índices, nunca con textos (el puente traduce a las etiquetas completas):
//   { t: 'answer', requestId, answers: [{ choose: [0, 2] } | { other: 'texto' }, ...] }   una entrada por pregunta, en orden
//   { t: 'answer', requestId, pc: true }                                                    "Responder en el PC"
// NUNCA manda `decision`: una pregunta no se aprueba ni se rechaza.
//
// Filas de cada pregunta: sus opciones; en multiSelect, "Listo" (envía lo marcado, al menos una); "Otra…" (teclado: lo escrito es
// la respuesta de esa pregunta) y "Responder en el PC" (devuelve la pregunta a Claude Code).
// Teclas: arriba/abajo mueven, A elige (en multiSelect marca o desmarca), B vuelve a la pregunta anterior (en la primera no hace
// nada: B nunca responde ni rechaza). Con varias preguntas se avanza una por una y se envían todas juntas al final.
//
// Guarda: A no hace nada hasta pasados QUESTION_GUARD_MS desde que llegó la tarjeta (y desde cada cambio de pregunta). Una
// tarjeta distinta (otro id) empieza de cero; una vista repetida de la misma no reinicia nada.
//
// Estado: { connected, id, since, index, cursor, marks: boolean[][], answers: entry[], sent }
// Eventos (todos devuelven { state, messages, effect }; effect es null o { kind: 'other', index } = hay que pedir el texto):
//   { type: 'connection', connected }
//   { type: 'view', now, request }            request = view.request (cualquier tipo) o null
//   { type: 'move', dy }
//   { type: 'select', row }                   el cursor salta a esa fila (toque del lápiz/clic); no elige
//   { type: 'activate', now, row?, repeat? }  A (o toque sobre la fila `row`)
//   { type: 'back' }
//   { type: 'text', text }                    lo escrito en "Otra…" ('' o null = canceló)

import { APPROVE_GUARD_MS } from './approve-guard.js';

export const QUESTION_GUARD_MS = APPROVE_GUARD_MS;
export const MAX_OTHER_TEXT = 200;

export const isQuestionCard = view => !!(view && view.request && view.request.kind === 'question' && Array.isArray(view.request.questions));

export function createQuestion() {
  return { connected: false, id: null, since: 0, index: 0, cursor: 0, marks: [], answers: [], sent: false };
}

const out = (state, messages = [], effect = null) => ({ state, messages, effect });

// Filas de la pregunta `q`: opciones, "Listo" (solo multiSelect), "Otra…" y "Responder en el PC".
export function rowsOf(q) {
  const rows = q.options.map((o, i) => ({ kind: 'option', index: i, label: o.label, desc: o.desc, recommended: o.recommended }));
  if (q.multi) rows.push({ kind: 'done', label: 'Listo' });
  rows.push({ kind: 'other', label: 'Otra…' });
  rows.push({ kind: 'pc', label: 'Responder en el PC' });
  return rows;
}

// Las preguntas de la tarjeta que se está mostrando, o null.
const questionsOf = request => (request && request.kind === 'question' && Array.isArray(request.questions) ? request.questions : null);

export const currentQuestion = (state, request) => {
  const qs = questionsOf(request);
  return qs ? qs[Math.min(state.index, qs.length - 1)] : null;
};

// ¿Ya se puede usar A? Conexión, tarjeta sin enviar y pasada la guarda.
export function questionReady(state, now) {
  return state.connected && state.id !== null && !state.sent && now - state.since >= QUESTION_GUARD_MS;
}

const freshMarks = qs => qs.map(q => q.options.map(() => false));

// Pasa a la pregunta siguiente o, si era la última, arma el envío de todas las respuestas.
function advance(state, request, now, answers) {
  const qs = questionsOf(request);
  if (state.index + 1 < qs.length) {
    return out({ ...state, answers, index: state.index + 1, cursor: 0, since: now });
  }
  return out({ ...state, answers, sent: true }, [{ t: 'answer', requestId: state.id, answers }]);
}

export function reduceQuestion(state, ev, request) {
  switch (ev.type) {
    case 'connection':
      return out({ ...state, connected: !!ev.connected });

    case 'view': {
      const qs = questionsOf(ev.request);
      if (!qs) return out({ ...createQuestion(), connected: state.connected });
      if (state.id === ev.request.id) return out(state);   // la misma tarjeta: no reinicia nada
      return out({ ...createQuestion(), connected: state.connected, id: ev.request.id, since: ev.now, marks: freshMarks(qs) });
    }

    case 'move': {
      const q = currentQuestion(state, request);
      if (!q || state.sent) return out(state);
      const n = rowsOf(q).length;
      const c = Math.min(n - 1, Math.max(0, state.cursor + Math.sign(ev.dy || 0)));
      return c === state.cursor ? out(state) : out({ ...state, cursor: c });
    }

    case 'select': {
      const q = currentQuestion(state, request);
      if (!q || state.sent || ev.row < 0 || ev.row >= rowsOf(q).length) return out(state);
      return out({ ...state, cursor: ev.row });
    }

    case 'activate': {
      const q = currentQuestion(state, request);
      if (!q || ev.repeat || !questionReady(state, ev.now)) return out(state);
      const rows = rowsOf(q);
      const row = ev.row === undefined ? state.cursor : ev.row;
      if (row < 0 || row >= rows.length) return out(state);
      const at = { ...state, cursor: row };
      const r = rows[row];
      switch (r.kind) {
        case 'option': {
          if (q.multi) {
            const marks = state.marks.map((m, qi) => (qi === state.index ? m.map((v, oi) => (oi === r.index ? !v : v)) : m));
            return out({ ...at, marks });
          }
          const answers = [...state.answers.slice(0, state.index), { choose: [r.index] }];
          return advance(at, request, ev.now, answers);
        }
        case 'done': {
          const chosen = state.marks[state.index].map((v, i) => (v ? i : -1)).filter(i => i >= 0);
          if (chosen.length === 0) return out(at);   // al menos una
          const answers = [...state.answers.slice(0, state.index), { choose: chosen }];
          return advance(at, request, ev.now, answers);
        }
        case 'other':
          return out(at, [], { kind: 'other', index: state.index });
        case 'pc':
          return out({ ...at, sent: true }, [{ t: 'answer', requestId: state.id, pc: true }]);
      }
      return out(state);
    }

    case 'text': {
      const q = currentQuestion(state, request);
      const text = typeof ev.text === 'string' ? ev.text.replace(/\s+/g, ' ').trim().slice(0, MAX_OTHER_TEXT) : '';
      if (!q || state.sent || text === '') return out(state);   // cancelado o vacío: no pasa nada
      const answers = [...state.answers.slice(0, state.index), { other: text }];
      return advance(state, request, ev.now ?? state.since + QUESTION_GUARD_MS, answers);
    }

    case 'back': {
      // B nunca responde ni rechaza: vuelve a la pregunta anterior (la respuesta de la actual y de esa se rehacen); en la primera no hace nada
      if (state.sent || state.index === 0) return out(state);
      const index = state.index - 1;
      return out({ ...state, index, cursor: 0, answers: state.answers.slice(0, index) });
    }

    default:
      return out(state);
  }
}

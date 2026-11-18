// Pantalla inferior (320x240): agentes -> sesiones -> detalle, con la tarjeta de permiso encima. Solo DOM, sin red.
// Todo el texto del puente entra con textContent (nunca innerHTML). La lógica de navegación vive en nav.js.

import { AGENT_STYLES } from './face.js';
import { KINDS, sessionsOf, visibleKinds } from './nav.js';
import { AGENTS_HINT, ENTRY_HINT, ENTRY_TITLE, NOTIFY_LABEL, READER_LABEL, ROOT_ENTRIES, entryEnabled, hasSettings, hiddenOf, instructWaitOf, questionsOn, readerDefaultOf, soundOn } from './menu.js';
import { ROW_PX, position as readerPosition, rowsOf, shownMode, visibleLines } from './reader.js';
import { currentQuestion, isQuestionCard, rowsOf as questionRows } from './question.js';
import { elapsedLabel, elapsedTotalS } from './elapsed.js';
import { canInstruct, isInstructionCard, queuedOf, rowsOf as instructRows, waitingOf } from './instruct.js';
import { NOTICE_COLOR, NOTIFY_LABEL as SESSION_NOTIFY_LABEL, detailNotify, noticeShown } from './notice.js';
import { UPDATE_ONLY_CONSOLE, updateLines, updateShown } from './update.js';

export const STATE_LABEL = { idle: 'inactivo', working: 'trabajando', ask: 'te espera', done: 'terminó', error: 'error' };
export const MODE_LABEL = { queue: 'En fila', manual: 'Elijo yo' };

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const agentName = kind => (AGENT_STYLES[kind] ? AGENT_STYLES[kind].name : 'Agente');
const agentColor = kind => (AGENT_STYLES[kind] ? AGENT_STYLES[kind].color : '#6B737F');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Texto del dueño de la tarjeta de permiso (lo que el usuario lee como "de quién es"); app.js lo usa como parte
// de la identidad de lo mostrado (ver approve.js).
export function cardOwner(view) {
  const req = view.request;
  if (!req) return '';
  const session = view.sessions.find(s => s.id === req.sessionId);
  return session ? `${agentName(session.kind)} · ${session.title}` : req.title;
}

// Resumen del estado de un agente a partir de sus sesiones.
function kindSummary(list) {
  if (!list.length) return 'sin sesiones';
  if (list.some(s => s.state === 'ask')) return 'te espera';
  if (list.some(s => s.state === 'error')) return 'error';
  if (list.some(s => s.state === 'working')) return 'trabajando';
  if (list.some(s => s.state === 'done')) return 'terminó';
  return 'inactivo';
}

// Crea la pantalla dentro de `root` y devuelve { render({nav, view, reader, menu, overlay, diag}), setCountdown(s), setHold(0..1), setApproveEnabled(bool) }.
// `reader` es el estado del lector del mensaje completo (reader.js); si está abierto reemplaza al contenido.
// `menu` es el menú de configuración (menu.js); `overlay` ('guide' | 'diag' | null) lo que hay encima de él y `diag` los
// datos del diagnóstico. Abiertos, reemplazan al contenido (la tarjeta de permiso cierra el menú, así que nunca la tapan).
export function createBottom(root) {
  let viewAt = performance.now();   // cuándo llegó la vista (reloj local): base del tiempo en el estado actual de cada ficha
  root.textContent = '';

  // barra superior
  const bar = el('div', 'bar');
  const barTitle = el('b', 'bar-title');
  const barSub = el('span', 'bar-sub');
  const back = el('button', 'mini', 'B Volver');
  back.type = 'button';
  back.dataset.nav = 'back';
  const mode = el('button', 'mini mode');
  mode.type = 'button';
  mode.dataset.action = 'mode';
  mode.title = 'Cambiar el modo de permisos (M)';
  bar.append(barTitle, barSub, back, mode);

  const banner = el('div', 'banner');
  banner.hidden = true;

  const content = el('div', 'content');

  // tarjeta de permiso
  const card = el('div', 'card');
  card.hidden = true;
  const head = el('div', 'card-head');
  const owner = el('span', 'card-owner');
  const timer = el('span', 'card-timer');
  head.append(owner, timer);
  const queueRow = el('div', 'card-queue');
  const skipPrev = el('button', 'mini', '◂ L');
  skipPrev.type = 'button';
  skipPrev.dataset.action = 'skip';
  skipPrev.title = 'Pasar al siguiente permiso (L)';
  const position = el('span', 'card-pos');
  const skipNext = el('button', 'mini', 'R ▸');
  skipNext.type = 'button';
  skipNext.dataset.action = 'skip';
  skipNext.title = 'Pasar al siguiente permiso (R)';
  queueRow.append(skipPrev, position, skipNext);
  queueRow.hidden = true;
  const risk = el('div', 'card-risk', '¡Acción de riesgo! Mantén A 1 segundo');
  risk.hidden = true;
  const code = el('pre', 'card-lines');
  // "sí, no volver a preguntar": franja sobre los botones (solo si la solicitud la ofrece)
  const always = el('button', 'btn always');
  always.type = 'button';
  always.dataset.action = 'always';
  const alwaysLabel = el('span', 'btn-label');
  const alwaysBar = el('span', 'btn-bar');
  always.append(alwaysBar, alwaysLabel);
  always.hidden = true;
  const btns = el('div', 'card-btns');
  const approve = el('button', 'btn ok');
  approve.type = 'button';
  approve.dataset.action = 'approve';
  const approveLabel = el('span', 'btn-label', 'A · Aprobar');
  const holdBar = el('span', 'btn-bar');
  approve.append(holdBar, approveLabel);
  const deny = el('button', 'btn no', 'B · Rechazar');
  deny.type = 'button';
  deny.dataset.action = 'deny';
  btns.append(approve, deny);
  card.append(head, queueRow, risk, code, always, btns);

  // tarjeta de aviso con "Visto" (azul, distinta de la de permiso: nunca dice "permiso" y no tiene Aprobar/Rechazar)
  const ncard = el('div', 'card notice');
  ncard.hidden = true;
  const nhead = el('div', 'card-head');
  const nlabel = el('b', 'notice-label', 'AVISO');
  const nowner = el('span', 'card-owner');
  nhead.append(nlabel, nowner);
  const ntitle = el('div', 'notice-title');
  const nqueue = el('div', 'card-queue');
  const nprev = el('button', 'mini', '◂ L');
  nprev.type = 'button';
  nprev.dataset.action = 'skipNotice';
  nprev.title = 'Otro aviso (L)';
  const npos = el('span', 'card-pos');
  const nnext = el('button', 'mini', 'R ▸');
  nnext.type = 'button';
  nnext.dataset.action = 'skipNotice';
  nnext.title = 'Otro aviso (R)';
  nqueue.append(nprev, npos, nnext);
  nqueue.hidden = true;
  const nlines = el('pre', 'card-lines');
  const nbtns = el('div', 'card-btns');
  const ack = el('button', 'btn seen');
  ack.type = 'button';
  ack.dataset.action = 'ack';
  ack.append(el('span', 'btn-label', 'A: Visto'));
  const nread = el('button', 'btn no', 'Leer todo');
  nread.type = 'button';
  nread.dataset.action = 'noticeRead';
  nbtns.append(ack, nread);
  ncard.append(nhead, ntitle, nqueue, nlines, nbtns);

  // tarjeta de pregunta (AskUserQuestion): ocupa el lugar del contenido; se responde con `answer`, nunca con aprobar/rechazar
  const qcard = el('div', 'card question-card');
  qcard.hidden = true;

  // tarjeta "Espera tu instrucción" (paso 6): se responde con 'instruct' o 'release', nunca con aprobar/rechazar
  const icard = el('div', 'card question-card instruct-card');
  icard.hidden = true;

  // tarjeta de versión nueva de la app (solo aviso: actualizar se hace en la consola 3DS)
  const ucard = el('div', 'card notice update-card');
  ucard.hidden = true;
  const uhead = el('div', 'card-head');
  uhead.append(el('b', 'notice-label', 'ACTUALIZACIÓN'));
  const utitle = el('div', 'notice-title', 'Actualización disponible');
  const ulines = el('pre', 'card-lines');
  const ubtns = el('div', 'card-btns');
  const uyes = el('button', 'btn seen', 'A: Actualizar');
  uyes.type = 'button';
  uyes.dataset.action = 'updateDo';
  const uno = el('button', 'btn no', 'B: Ahora no');
  uno.type = 'button';
  uno.dataset.action = 'updateLater';
  ubtns.append(uyes, uno);
  ucard.append(uhead, utitle, ulines, ubtns);

  root.append(bar, banner, content, card, ncard, ucard, qcard, icard);

  let lastKey = '';
  let lastCursorKey = '';

  function renderBar(nav, view, reader, menu, overlay) {
    if (menu && menu.open) {
      barTitle.textContent = overlay === 'guide' ? 'Guía de botones' : overlay === 'diag' ? 'Diagnóstico' : menu.level === 'agents' ? 'Agentes' : 'Configuración';
      barTitle.style.color = '#1F8FC8';
      barSub.textContent = overlay ? 'SELECT/B: volver' : menu.level === 'agents' ? 'B: volver' : 'SELECT/B: cerrar';
      back.hidden = false;
      mode.textContent = MODE_LABEL[view.mode] ?? view.mode;
      mode.dataset.mode = view.mode;
      return;
    }
    if (reader && reader.open) {
      // lector del mensaje completo: agente, proyecto y posición "n-m/N"
      const s = view.sessions.find(x => x.id === reader.sessionId);
      const pos = readerPosition(reader);
      const where = pos.total > 0 ? (pos.first === pos.last ? `${pos.first}/${pos.total}` : `${pos.first}-${pos.last}/${pos.total}`) : '';
      barTitle.textContent = s ? agentName(s.kind) : 'Agente';
      barTitle.style.color = '';
      barSub.textContent = [s ? s.project : '', where, !reader.loading ? (shownMode(reader) === 'summary' ? 'Resumen' : 'Completo') : ''].filter(Boolean).join(' · ');
      back.hidden = false;
      mode.textContent = MODE_LABEL[view.mode] ?? view.mode;
      mode.dataset.mode = view.mode;
      return;
    }
    if (nav.level === 'agents') {
      barTitle.textContent = 'Agentes';
      barTitle.style.color = '';
      const n = view.sessions.length;
      barSub.textContent = plural(n, 'sesión', 'sesiones');
    } else if (nav.level === 'sessions') {
      barTitle.textContent = agentName(nav.kind);
      barTitle.style.color = '';
      barSub.textContent = plural(sessionsOf(view, nav.kind).length, 'sesión', 'sesiones');
    } else {
      const s = view.sessions.find(x => x.id === nav.sessionId);
      barTitle.textContent = agentName(nav.kind);
      barTitle.style.color = '';
      barSub.textContent = s ? s.title : '';
    }
    back.hidden = nav.level === 'agents';
    mode.textContent = MODE_LABEL[view.mode] ?? view.mode;
    mode.dataset.mode = view.mode;
  }

  function renderBanner(view) {
    const show = !view.request && view.pendingCount > 0;
    banner.hidden = !show;
    if (show) {
      banner.textContent = `${plural(view.pendingCount, 'permiso pendiente', 'permisos pendientes')} · entra a la sesión que lo pide`;
    }
  }

  function agentsGrid(nav, view) {
    const grid = el('div', 'grid');
    const kinds = visibleKinds(view);
    if (!kinds.length) return el('div', 'empty', 'Todos los agentes están ocultos (SELECT > Agentes)');
    kinds.forEach((kind, i) => {
      const list = sessionsOf(view, kind);
      const asking = list.some(s => s.state === 'ask');
      const tile = el('button', 'tile');
      tile.type = 'button';
      tile.dataset.index = String(i);
      tile.style.color = agentColor(kind);
      if (!list.length) tile.classList.add('off');
      if (asking) tile.classList.add('ask');
      if (i === nav.cursor) { tile.classList.add('cur'); tile.setAttribute('aria-current', 'true'); }
      if (list.length) tile.append(el('div', 'badge', String(list.length)));
      const dot = el('i');
      dot.style.background = agentColor(kind);
      const name = el('b', '', agentName(kind));
      const status = el('span', '', kindSummary(list));
      tile.append(dot, name, status);
      grid.append(tile);
    });
    return grid;
  }

  function sessionsList(nav, view) {
    const list = sessionsOf(view, nav.kind);
    if (!list.length) return el('div', 'empty', `No hay sesiones abiertas de ${agentName(nav.kind)}`);
    const wrap = el('div', 'list');
    list.forEach((s, i) => {
      const row = el('button', 'sess');
      row.type = 'button';
      row.dataset.index = String(i);
      row.style.color = agentColor(s.kind);
      if (s.state === 'ask') row.classList.add('ask');
      if (i === nav.cursor) { row.classList.add('cur'); row.setAttribute('aria-current', 'true'); }
      const title = el('b', '', s.title);
      const st = el('em', 'st-' + s.state, `${s.model ? s.model + ' · ' : ''}${STATE_LABEL[s.state] ?? s.state}`);
      // segunda línea: la actividad y, en gris a la derecha, cuánto lleva en este estado (lo actualiza tickElapsed con el reloj local)
      const act = el('span', s.sinceS === undefined ? 'solo' : '', s.activity);
      row.append(title, st, act);
      if (s.sinceS !== undefined) {
        const since = el('small', 'since', '');
        since.dataset.since = String(s.sinceS);
        since.textContent = elapsedLabel(elapsedTotalS(s.sinceS, viewAt, performance.now()));
        row.append(since);
      }
      wrap.append(row);
    });
    return wrap;
  }

  function detailPane(nav, view) {
    const s = view.sessions.find(x => x.id === nav.sessionId);
    const pane = el('div', 'detail');
    if (!s) return pane;
    const field = (label, value) => {
      const p = el('p');
      p.append(el('b', '', label + ' '), document.createTextNode(value));
      return p;
    };
    pane.append(
      field('Proyecto:', s.project),
      field('Modelo:', `${s.model || '—'} · ${STATE_LABEL[s.state] ?? s.state}`),
      field('Ahora:', s.activity || '—'),
    );
    const mine = view.detail && view.detail.sessionId === s.id ? view.detail : null;
    if (mine && mine.question && mine.question.length) {
      // la pregunta que espera respuesta, completa y resaltada, antes del último mensaje
      const q = el('p', 'question');
      q.append(el('b', '', 'Te pregunta:'), el('br'), document.createTextNode(mine.question.join('\n')));
      pane.append(q);
    }
    const last = mine ? mine.lastMessage : [];
    const msg = el('p', 'last');
    msg.append(el('b', '', 'Último mensaje:'), el('br'), document.createTextNode(last.length ? last.join('\n') : '—'));
    pane.append(msg);
    if (!view.request) {
      // al pie: A (o este botón) abre el lector del mensaje completo -solo sin aviso: con una tarjeta de aviso A marca "Visto"-
      // y el modo de aviso de la sesión (Y o este botón); con tarjeta de permiso A aprueba e Y es "siempre": ninguna se ofrece
      const strips = el('div', 'strips');
      if (!noticeShown(view)) {
        const read = el('button', 'read-btn', 'A: leer todo el mensaje');
        read.type = 'button';
        read.dataset.action = 'read';
        strips.append(read);
      }
      const mode = detailNotify(view, nav);
      if (mode) {
        const nb = el('button', 'read-btn notify-btn', 'Y: avisos · ' + (SESSION_NOTIFY_LABEL[mode] || mode));
        nb.type = 'button';
        nb.dataset.action = 'notify';
        nb.dataset.notify = mode;
        strips.append(nb);
      }
      if (strips.childNodes.length) pane.append(strips);
      if (canInstruct(view, nav)) {
        // instrucciones por texto (paso 6): X escribe, izquierda/derecha alternan "Esperar mi respuesta", abajo borra la cola
        const istrips = el('div', 'strips');
        const wr = el('button', 'read-btn write-btn', 'X: escribir instrucción');
        wr.type = 'button';
        wr.dataset.action = 'instruct';
        const wt = el('button', 'read-btn wait-btn', '◂▸ Esperar: ' + (waitingOf(view, nav) ? 'sí' : 'no'));
        wt.type = 'button';
        wt.dataset.action = 'wait';
        wt.dataset.wait = waitingOf(view, nav) ? 'on' : 'off';
        istrips.append(wr, wt);
        pane.append(istrips);
        const q = queuedOf(view, nav);
        if (q) {
          const box = el('div', 'queue-box');
          box.append(el('span', '', 'En cola (' + q.count + '): ' + q.first));
          const clear = el('button', 'mini', '↓ borrar');
          clear.type = 'button';
          clear.dataset.action = 'clearQueue';
          box.append(clear);
          pane.append(box);
          pane.append(el('p', 'queue-hint', s.state === 'working' ? 'Sale cuando termine este turno.' : 'Ya terminó: escríbele desde el PC para que siga.'));
        }
      }
    }
    return pane;
  }

  // Lector del mensaje completo: el puente manda las líneas ya cortadas; aquí solo se muestra la ventana visible.
  function readerPane(reader) {
    const pane = el('div', 'reader');
    if (reader.stale) {
      const stale = el('button', 'reader-stale', 'mensaje nuevo · A recarga');
      stale.type = 'button';
      stale.dataset.action = 'reload';
      pane.append(stale);
    }
    if (reader.loading) {
      pane.append(el('div', 'empty', 'Cargando…'));
      return pane;
    }
    const doc = reader.doc;
    if (doc && doc.question) {
      const q = el('p', 'question');
      q.append(el('b', '', 'Te pregunta:'), el('br'), document.createTextNode(doc.question.join('\n')));
      pane.append(q);
    }
    const lines = visibleLines(reader);
    if (!lines.length) pane.append(el('div', 'empty', 'Sin mensaje todavía'));
    else {
      const pre = el('pre', 'reader-lines', lines.join('\n'));
      pre.style.height = rowsOf(reader) * ROW_PX + 'px';
      pane.append(pre);
    }
    // pie: el otro modo (X o tocar); si el resumen es el mensaje entero lo dice
    const other = shownMode(reader) === 'summary' ? 'completo' : 'resumen';
    const foot = el('button', 'reader-foot', (doc && doc.short && shownMode(reader) === 'summary' ? 'Mensaje corto · ' : '') + 'X: ' + other);
    foot.type = 'button';
    foot.dataset.action = 'readerMode';
    pane.append(foot);
    return pane;
  }

  // Menú de configuración: filas con su valor (de view.settings) y la ayuda; sin ajustes, "sin conexión".
  function menuPane(menu, view, overlay, diag) {
    if (overlay === 'guide') return guidePane();
    if (overlay === 'diag') return diagPane(diag);
    const pane = el('div', 'menu');
    const on = hasSettings(view);
    const row = (i, title, value, cls = '', hint = '') => {
      const b = el('button', 'menu-row ' + cls);
      b.type = 'button';
      b.dataset.menuRow = String(i);
      if (i === menu.cursor) { b.classList.add('cur'); b.setAttribute('aria-current', 'true'); }
      const top = el('span', 'menu-line');
      top.append(el('b', '', title), el('em', '', value));
      b.append(top);
      if (hint) b.append(el('small', '', hint));
      return b;
    };
    if (menu.level === 'agents') {
      const hidden = hiddenOf(view);
      KINDS.forEach((kind, i) => {
        const off = hidden.includes(kind);
        const r = row(i, agentName(kind), !on ? 'sin conexión' : off ? 'oculto' : 'visible', (on ? '' : 'dis ') + (off ? 'off' : 'on'));
        r.style.setProperty('--agent', agentColor(kind));
        pane.append(r);
      });
      const help = el('p', 'menu-help');
      help.textContent = AGENTS_HINT.join(' ');
      pane.append(help);
      return pane;
    }
    ROOT_ENTRIES.forEach((entry, i) => {
      const enabled = entryEnabled(entry, view);
      let value = '';
      if (!enabled) value = entry === 'instructWait' && hasSettings(view) ? 'el puente no lo ofrece' : 'sin conexión';
      else if (entry === 'notify') value = NOTIFY_LABEL[view.settings.notifyDefault] || '?';
      else if (entry === 'ack') value = view.settings.notifyAck ? 'sí' : 'no';
      else if (entry === 'sound') value = soundOn(view) ? 'sí' : 'no';
      else if (entry === 'questions') value = questionsOn(view) ? 'sí' : 'no';
      else if (entry === 'reader') value = READER_LABEL[readerDefaultOf(view)];
      else if (entry === 'instructWait') value = instructWaitOf(view) + ' min';
      else if (entry === 'agents') { const n = view.settings.hiddenAgents.length; value = n === 0 ? 'todos visibles' : n === 1 ? '1 oculto' : n + ' ocultos'; }
      else if (entry === 'guide') value = '>';
      else if (entry === 'diag') value = diag && diag.on ? 'activo' : 'apagado';
      pane.append(row(i, ENTRY_TITLE[entry], value, enabled ? '' : 'dis', ENTRY_HINT[entry] || ''));
    });
    pane.append(el('p', 'menu-help', 'Arriba/abajo: elegir · A o Enter: cambiar · B: cerrar'));
    return pane;
  }

  // Guía de botones del simulador: las teclas (el simulador no tiene botones físicos).
  function guidePane() {
    const pane = el('div', 'menu-text');
    const lines = [
      'A / Enter: aprobar, entrar, leer el mensaje',
      'X en el lector: mensaje completo o resumen',
      'Y: sí, no volver a preguntar (si la tarjeta lo ofrece)',
      'B: rechazar con tarjeta; si no, volver un nivel',
      'Flechas: mover · L / R (Q / W): siguiente permiso',
      'M: modo de permisos · S o Retroceso: configuración',
      'Aviso (tarjeta azul): A: Visto · L / R: otro aviso',
      'Y en el detalle: modo de aviso de la sesión',
      'X en el detalle: escribir una instrucción a la sesión',
      'Izq/der en el detalle: Esperar mi respuesta · Abajo: borrar la cola',
      'Esc: cierra el lector, el menú o esta guía',
    ];
    lines.forEach(l => pane.append(el('p', '', l)));
    return pane;
  }

  // Diagnóstico del simulador: estado de la conexión y de la vista (la 3DS muestra red, memoria y cuadros por segundo).
  function diagPane(diag) {
    const pane = el('div', 'menu-text');
    const d = diag || {};
    [
      'Conexión: ' + (d.connected ? 'conectado al puente' : 'sin conexión'),
      'Sesiones: ' + (d.sessions ?? 0),
      'Permisos pendientes: ' + (d.pending ?? 0),
      'Modo: ' + (MODE_LABEL[d.mode] ?? d.mode ?? '—'),
      'Ajustes del puente: ' + (d.settings ? 'sí' : 'no'),
    ].forEach(l => pane.append(el('p', '', l)));
    return pane;
  }

  function renderContent(nav, view, reader, menu, overlay, diag) {
    // Se reconstruye solo si cambia algo visible; así no se pierde un clic a medias ni el desplazamiento.
    const reading = !!(reader && reader.open);
    const inMenu = !!(menu && menu.open);
    const key = JSON.stringify([nav, view.sessions, nav.level === 'detail' ? view.detail : null, !!view.request, noticeShown(view), reading ? reader : null, view.settings || null, inMenu ? [menu, overlay, diag] : null]);
    if (key === lastKey) return;
    lastKey = key;
    const prevScroll = content.firstChild ? content.scrollTop : 0;
    const cursorKey = nav.level + '|' + nav.kind + '|' + nav.sessionId + '|' + nav.cursor;
    content.textContent = '';
    content.append(inMenu ? menuPane(menu, view, overlay, diag) : reading ? readerPane(reader) : nav.level === 'agents' ? agentsGrid(nav, view) : nav.level === 'sessions' ? sessionsList(nav, view) : detailPane(nav, view));
    content.scrollTop = prevScroll;
    if (cursorKey !== lastCursorKey) {
      const cur = content.querySelector('.cur');
      if (cur) cur.scrollIntoView({ block: 'nearest' });
      else content.scrollTop = 0;
    }
    lastCursorKey = cursorKey;
  }

  function renderCard(view) {
    const req = view.request && view.request.kind !== 'question' && view.request.kind !== 'instruction' ? view.request : null; // la pregunta y la instrucción tienen su propia tarjeta
    root.classList.toggle('has-request', !!req);
    card.hidden = !req;
    if (!req) return;
    const session = view.sessions.find(s => s.id === req.sessionId);
    const kind = session ? session.kind : null;
    owner.textContent = cardOwner(view);
    card.style.setProperty('--agent', agentColor(kind));
    const many = req.total > 1;
    queueRow.hidden = !many;
    position.textContent = many ? `${req.position} de ${req.total}` : '';
    const canSkip = view.mode === 'queue';
    skipPrev.hidden = skipNext.hidden = !canSkip;
    code.textContent = req.lines.join('\n');
    const high = req.risk === 'high';
    card.classList.toggle('high', high);
    risk.hidden = !high;
    approveLabel.textContent = high ? 'Mantén A · Aprobar' : 'A · Aprobar';
    always.hidden = !req.always;
    alwaysLabel.textContent = req.always ? (high ? 'Mantén ' : '') + 'Y: sí, siempre · ' + req.always : '';
  }

  function renderNotice(view) {
    const shown = noticeShown(view);
    ncard.hidden = !shown;
    root.classList.toggle('has-notice', shown);
    if (!shown) return;
    const n = view.notice;
    const session = view.sessions.find(s => s.id === n.sessionId);
    ncard.style.setProperty('--agent', agentColor(session ? session.kind : null));
    ncard.style.setProperty('--kind', NOTICE_COLOR[n.kind] || '#6B737F');
    nowner.textContent = `${n.agent} · ${n.project}`;
    ntitle.textContent = n.title;
    const many = n.total > 1;
    nqueue.hidden = !many;
    npos.textContent = many ? `${n.position} de ${n.total}` : '';
    nlines.textContent = n.lines.join('\n');
  }

  // Tarjeta de pregunta: pregunta `question.index` de la tarjeta, sus opciones una por fila (★ la recomendada, ☐/☑ en multiSelect),
  // "Otra…" y "Responder en el PC" al final; la descripción de la fila marcada va debajo.
  let lastQuestionKey = '';
  function renderQuestion(view, question) {
    const shown = isQuestionCard(view) && question !== null;
    qcard.hidden = !shown;
    root.classList.toggle('has-question', shown);
    if (!shown) { lastQuestionKey = ''; return; }
    const req = view.request;
    const key = JSON.stringify([req, question.index, question.cursor, question.marks, question.sent]);
    if (key === lastQuestionKey) return;
    lastQuestionKey = key;
    const session = view.sessions.find(s => s.id === req.sessionId);
    qcard.style.setProperty('--agent', agentColor(session ? session.kind : null));
    qcard.textContent = '';
    const qs = req.questions;
    const q = currentQuestion(question, req);
    const head = el('div', 'card-head');
    head.append(el('span', 'card-owner', cardOwner(view)), el('span', 'card-timer', qs.length > 1 ? `${question.index + 1}/${qs.length}` : ''));
    qcard.append(head);
    if (req.total > 1) {
      const queue = el('div', 'card-queue');
      const prev = el('button', 'mini', '◂ L');
      prev.type = 'button';
      prev.dataset.action = 'skip';
      const pos = el('span', 'card-pos', `${req.position} de ${req.total}`);
      const next = el('button', 'mini', 'R ▸');
      next.type = 'button';
      next.dataset.action = 'skip';
      prev.hidden = next.hidden = view.mode !== 'queue';
      queue.append(prev, pos, next);
      qcard.append(queue);
    }
    qcard.append(el('div', 'q-header', q.header), el('div', 'q-text', q.text.join('\n')));
    const rows = questionRows(q);
    const list = el('div', 'q-rows');
    rows.forEach((r, i) => {
      const b = el('button', 'q-row ' + r.kind);
      b.type = 'button';
      b.dataset.qRow = String(i);
      if (i === question.cursor) { b.classList.add('cur'); b.setAttribute('aria-current', 'true'); }
      let label = r.label;
      if (r.kind === 'option' && q.multi) label = (question.marks[question.index][r.index] ? '☑ ' : '☐ ') + label;
      b.append(el('span', 'q-label', label));
      if (r.recommended) b.append(el('span', 'q-star', '★'));
      list.append(b);
    });
    qcard.append(list);
    const cur = rows[question.cursor];
    const desc = cur && cur.kind === 'option' ? cur.desc.join('\n') : cur && cur.kind === 'other' ? 'Escribir una respuesta con el teclado' : cur && cur.kind === 'pc' ? 'Claude Code muestra la pregunta en el PC' : cur && cur.kind === 'done' ? 'Enviar lo marcado' : '';
    qcard.append(el('div', 'q-desc', desc));
    qcard.append(el('div', 'q-hint', q.multi ? 'A: marcar · B: anterior' : 'A: elegir · B: anterior'));
  }

  // Tarjeta "Espera tu instrucción": agente, comienzo del último mensaje y las dos filas.
  let lastInstructKey = '';
  function renderInstruct(view, instruct) {
    const shown = isInstructionCard(view) && instruct !== null;
    icard.hidden = !shown;
    root.classList.toggle('has-question', shown || isQuestionCard(view)); // ocupa el lugar del contenido, como la pregunta
    if (!shown) { lastInstructKey = ''; return; }
    const req = view.request;
    const key = JSON.stringify([req, instruct.cursor, instruct.sent]);
    if (key === lastInstructKey) return;
    lastInstructKey = key;
    const session = view.sessions.find(s => s.id === req.sessionId);
    icard.style.setProperty('--agent', agentColor(session ? session.kind : null));
    icard.textContent = '';
    const head = el('div', 'card-head');
    head.append(el('span', 'card-owner', cardOwner(view)), el('span', 'card-timer', ''));
    icard.append(head);
    if (req.total > 1) {
      const queue = el('div', 'card-queue');
      const prev = el('button', 'mini', '◂ L');
      prev.type = 'button';
      prev.dataset.action = 'skip';
      const pos = el('span', 'card-pos', req.position + ' de ' + req.total);
      const next = el('button', 'mini', 'R ▸');
      next.type = 'button';
      next.dataset.action = 'skip';
      prev.hidden = next.hidden = view.mode !== 'queue';
      queue.append(prev, pos, next);
      icard.append(queue);
    }
    icard.append(el('div', 'q-header', req.title), el('div', 'q-text', req.lines.join('\n')));
    // atajos en dos columnas (Fase 3) y, debajo, Escribir y Seguir en el PC
    const rows = instructRows(req);
    const quickRows = rows.filter(r => r.kind === 'quick');
    const rowButton = (r, i) => {
      const b = el('button', 'q-row ' + r.kind);
      b.type = 'button';
      b.dataset.iRow = String(i);
      if (i === instruct.cursor) { b.classList.add('cur'); b.setAttribute('aria-current', 'true'); }
      b.append(el('span', 'q-label', r.label));
      return b;
    };
    if (quickRows.length > 0) {
      const grid = el('div', 'q-quick');
      quickRows.forEach((r, i) => grid.append(rowButton(r, i)));
      icard.append(grid);
    }
    const list = el('div', 'q-rows');
    rows.forEach((r, i) => { if (r.kind !== 'quick') list.append(rowButton(r, i)); });
    icard.append(list);
    icard.append(el('div', 'q-desc', rows[instruct.cursor].help));
    icard.append(el('div', 'q-hint', 'A: elegir · B no hace nada'));
  }

  // Versión nueva de la app: la consola la muestra a pantalla completa cuando nada más pide atención y el menú y el lector no la tapan.
  let updateNote = '';
  function renderUpdate(view, dismissed, covered) {
    const shown = !covered && updateShown(view, dismissed);
    ucard.hidden = !shown;
    root.classList.toggle('has-update', shown);
    if (!shown) { updateNote = ''; return; }
    ulines.textContent = updateLines(view).join('\n');
    uyes.textContent = updateNote || 'A: Actualizar';
  }
  // «Actualizar» en el simulador no instala nada: dice dónde se hace.
  function noteUpdateOnlyConsole() { updateNote = UPDATE_ONLY_CONSOLE; uyes.textContent = UPDATE_ONLY_CONSOLE; }

  function render({ nav, view, reader = null, menu = null, overlay = null, diag = null, question = null, instruct = null, updateDismissed = false }) {
    renderBar(nav, view, reader, menu, overlay);
    renderBanner(view);
    renderContent(nav, view, reader, menu, overlay, diag);
    renderCard(view);
    renderNotice(view);
    renderUpdate(view, updateDismissed, !!(menu && menu.open) || !!(reader && reader.open));
    renderQuestion(view, question);
    renderInstruct(view, instruct);
  }

  function setCountdown(seconds) { timer.textContent = seconds === null ? '' : seconds + ' s'; }
  // Mientras la solicitud recién apareció, aprobar se ve deshabilitado (ver approve-guard.js).
  function setApproveEnabled(enabled) {
    if (approve.disabled === !enabled) return;
    approve.disabled = !enabled;
    approve.classList.toggle('guarded', !enabled);
    always.disabled = !enabled;
    always.classList.toggle('guarded', !enabled);
  }
  // "A: Visto" usa la misma guarda de 500 ms que aprobar, pero en su propia máquina de estados.
  function setAckEnabled(enabled) {
    if (ack.disabled === !enabled) return;
    ack.disabled = !enabled;
    ack.classList.toggle('guarded', !enabled);
  }
  // La barra de retención va en el botón del gesto en curso (aprobar o "siempre").
  function setHold(fraction, isAlways = false) {
    const w = Math.round(Math.min(1, Math.max(0, fraction)) * 100) + '%';
    holdBar.style.width = isAlways ? '0%' : w;
    alwaysBar.style.width = isAlways ? w : '0%';
  }

  // Las filas de la pregunta se ven apagadas mientras pasa la guarda de 500 ms (misma regla que aprobar).
  function setQuestionEnabled(enabled) {
    qcard.classList.toggle('guarded', !enabled);
  }
  function setInstructEnabled(enabled) {
    icard.classList.toggle('guarded', !enabled);
  }

  // El reloj de la consola, no el del PC: a `sinceS` de cada ficha se le suma lo que pasó desde que llegó la vista (`at`, performance.now()).
  function setViewAt(at) { viewAt = at; }
  function tickElapsed(now) {
    root.querySelectorAll('.since[data-since]').forEach(n => {
      const text = elapsedLabel(elapsedTotalS(Number(n.dataset.since), viewAt, now));
      if (n.textContent !== text) n.textContent = text;
    });
  }

  return { render, noteUpdateOnlyConsole, setViewAt, tickElapsed, setCountdown, setHold, setApproveEnabled, setAckEnabled, setQuestionEnabled, setInstructEnabled };
}

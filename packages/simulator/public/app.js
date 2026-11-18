// Simulador de la consola: conexión con el puente, estado, entrada y bucle de dibujo.

import { drawFace, createLocalState } from './face.js';
import { createBottom, cardOwner } from './bottom.js';
import { createNav, reduce, bAction, skipMessages, modeMessages } from './nav.js';
import { createReader, reduceReader, canOpen } from './reader.js';
import { createMenu, reduceMenu, mustClose as menuMustClose, canOpen as menuCanOpen } from './menu.js';
import { ackMessage, chimeStep, createChime, cycleNotifyMessages, noticeApproval, noticeShown, skipNoticeMessages } from './notice.js';
import { createQuestion, isQuestionCard, questionReady, reduceQuestion } from './question.js';
import { clearMessages, createInstruct, instructReady, isInstructionCard, reduceInstruct, toggleWaitMessages, writeEffect } from './instruct.js';
import { updateShown } from './update.js';
import { createApproval, approveReduce, approveReady, holdProgress, holdIsAlways } from './approve.js';

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 5000;
const EMPTY_VIEW = { sessions: [], request: null, pendingCount: 0, mode: 'queue', face: { kind: null, mood: 'idle', lines: ['Todo tranquilo'] }, detail: null, led: 'off' };

const $ = id => document.getElementById(id);
const canvas = $('top');
const ctx = canvas.getContext('2d');
const consoleEl = $('console');
const ledEl = $('led');
const connEl = $('conn');
const bottom = createBottom($('bottom'));
const localState = createLocalState();

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const applyMotion = () => { localState.reducedMotion = motionQuery.matches; };
applyMotion();
motionQuery.addEventListener('change', applyMotion);

let view = EMPTY_VIEW;
let nav = createNav();           // estado de la pantalla inferior (ver nav.js)
let reader = createReader();     // lector del mensaje completo (ver reader.js): se cierra solo si aparece una tarjeta
// Menú de configuración (SELECT, ver menu.js). `overlay` es lo que hay encima: la guía de teclas o el diagnóstico.
let menu = createMenu();
let overlay = null;              // null | 'guide' | 'diag'
let ws = null;
let connected = false;
let attempts = 0;
let reconnectTimer = null;
let requestDeadline = 0;         // instante (performance.now) en que vence la solicitud actual
let approval = createApproval(); // aprobar: guarda, retención y gestos (ver approve.js)
// "Visto" de la tarjeta de aviso: el mismo gesto que aprobar pero en su propia máquina de estados (otra instancia de approve.js):
// emite `ack`, nunca `decision`. Ver notice.js.
let seen = createApproval();
// Pregunta con alternativas (AskUserQuestion, ver question.js): su propia máquina de estados. Responde con `answer`, nunca con `decision`.
let question = createQuestion();
// Fin de turno retenido ("Espera tu instrucción", ver instruct.js): su propia máquina de estados. Responde con 'instruct' o 'release', nunca con 'decision'.
let instruct = createInstruct();
let chime = createChime();       // sonido del último aviso (seq): todavía no suena (paso 3b); solo se anota el que sonaría
let updateDismissed = false;     // «Ahora no» en la tarjeta de versión nueva: oculta hasta recargar (en la consola, hasta el próximo arranque)

// ---------- conexión ----------
function setConnected(on, label) {
  connected = on;
  approve({ type: 'connection', connected: on });
  ackApprove({ type: 'connection', connected: on });
  applyQuestion({ type: 'connection', connected: on });
  applyInstruct({ type: 'connection', connected: on });
  if (on) chime = createChime();   // al (re)conectar el primer `chime` que se ve es el punto de partida: no suena
  consoleEl.classList.toggle('offline', !on);
  connEl.dataset.state = on ? 'on' : 'off';
  connEl.textContent = label;
  if (!on && reader.open) applyReader({ type: 'close' });   // sin conexión no hay a quién pedirle el texto
  renderAll();
}

function connect() {
  clearTimeout(reconnectTimer);
  setConnected(false, attempts ? 'Reconectando…' : 'Conectando…');
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  let sock;
  try { sock = new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(window.COMPANION_API_TOKEN || '')}`); } catch { return scheduleReconnect(); }
  ws = sock;
  sock.addEventListener('open', () => {
    attempts = 0;
    setConnected(true, 'Conectado al puente');
    if (nav.level === 'detail') send({ t: 'focus', sessionId: nav.sessionId });   // el puente pudo reiniciarse
  });
  sock.addEventListener('message', ev => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg && msg.t === 'view' && msg.view) applyView(msg.view);
    else if (msg && msg.t === 'text') applyReader({ type: 'text', msg });   // respuesta a read
  });
  sock.addEventListener('close', () => { if (ws === sock) { ws = null; setConnected(false, 'Sin conexión'); scheduleReconnect(); } });
  sock.addEventListener('error', () => { try { sock.close(); } catch { /* ya cerrado */ } });
}

function scheduleReconnect() {
  const wait = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempts);
  attempts++;
  reconnectTimer = setTimeout(connect, wait);
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ---------- vista ----------
function applyView(v) {
  view = v;
  bottom.setViewAt(performance.now());
  const req = v.request;
  if (req) requestDeadline = performance.now() + req.expiresInS * 1000;
  // una pregunta no es un permiso: la máquina de aprobar nunca la ve
  approve({ type: 'view', now: performance.now(), request: req && req.kind !== 'question' && req.kind !== 'instruction' ? { id: req.id, risk: req.risk, owner: cardOwner(v), lines: req.lines, always: req.always } : null });
  applyQuestion({ type: 'view', now: performance.now(), request: isQuestionCard(v) ? req : null });
  applyInstruct({ type: 'view', now: performance.now(), request: isInstructionCard(v) ? req : null });
  // la tarjeta de aviso tiene su propia identidad (id + líneas): si cambia o llega un permiso, el gesto de "Visto" se anula
  const na = noticeApproval(v);
  ackApprove({ type: 'view', now: performance.now(), request: na });
  const c = chimeStep(chime, v);
  chime = c.state;
  consoleEl.dataset.chime = c.play ? c.play.kind + ':' + c.play.seq : consoleEl.dataset.chime || '';   // sin sonido todavía (paso 3b)
  applyNav({ type: 'sync' });   // cursor en rango; si la sesión abierta desapareció, un nivel atrás
  applyReader({ type: 'view', view: v, nav });   // una tarjeta cierra el lector; un mensaje nuevo solo avisa
  if (menuMustClose(menu, v)) closeMenu();       // una tarjeta de permiso cierra el menú (y la guía que abrió): manda la tarjeta
  ledEl.dataset.led = v.led;
  ledEl.title = 'LED: ' + v.led;
  tickCountdown();
}

function tickCountdown() {
  // expiresInS 0 = sin límite: sin cuenta atrás
  const limited = view.request && view.request.expiresInS > 0;
  bottom.setCountdown(limited ? Math.max(0, Math.ceil((requestDeadline - performance.now()) / 1000)) : null);
}

// ---------- decisiones ----------
// Toda la lógica de aprobar vive en approve.js; aquí solo se conectan los eventos.
function approve(ev) {
  const r = approveReduce(approval, ev);
  approval = r.state;
  if (r.emit) send({ t: 'decision', requestId: r.emit.requestId, decision: r.emit.decision });
}

// "Visto": toda la lógica del gesto es la de approve.js, con su propia instancia. Lo que emite es un `ack` (retira la tarjeta
// en el puente; al agente no se le manda nada), nunca una decisión de permiso.
function ackApprove(ev) {
  const r = approveReduce(seen, ev);
  seen = r.state;
  if (r.emit) send(ackMessage(r.emit.requestId));
}

// Pregunta con alternativas: toda la lógica vive en question.js. Un answer solo sale con conexión.
function applyQuestion(event) {
  const r = reduceQuestion(question, event, view.request);
  question = r.state;
  if (connected) r.messages.forEach(send);
  if (r.effect && r.effect.kind === 'other') askOther();
  renderAll();
}

// "Otra…": el teclado del sistema congela la consola, así que antes se avisa con `hold` (el puente no corta por silencio).
// En el simulador el "teclado" es un cuadro de texto del navegador.
function askOther() {
  if (connected) send({ t: 'hold', seconds: 300 });
  const text = window.prompt('Otra respuesta (hasta 200 caracteres):', '');
  applyQuestion({ type: 'text', text, now: performance.now() });
}

// Instrucciones por texto: toda la lógica vive en instruct.js. Lo que sale es 'instruct' / 'release' / 'sessionWait' / 'instructClear'.
function applyInstruct(event) {
  const r = reduceInstruct(instruct, event, view.request);
  instruct = r.state;
  if (connected) r.messages.forEach(send);
  if (r.effect && r.effect.kind === 'write') askInstruction(r.effect.sessionId);
  renderAll();
}

// El teclado del sistema congela la consola: antes se avisa con 'hold'. En el simulador el "teclado" es un cuadro de texto del navegador.
function askInstruction(sessionId) {
  if (connected) send({ t: 'hold', seconds: 300 });
  const text = window.prompt('Instrucción para la sesión (hasta 400 caracteres):', '');
  applyInstruct({ type: 'text', sessionId, text });
}

// Detalle sin tarjeta: escribir una instrucción (X o el botón), alternar "Esperar mi respuesta" (izquierda/derecha) y borrar la cola (abajo).
function writeInstruction() {
  if (menu.open || reader.open) return;
  const eff = writeEffect(view, nav);
  if (eff) askInstruction(eff.sessionId);
}
function toggleWait() {
  if (connected && !menu.open && !reader.open) toggleWaitMessages(view, nav).forEach(send);
}
function clearQueue() {
  if (connected && !menu.open && !reader.open) clearMessages(view, nav).forEach(send);
}

function deny() {
  const req = view.request;
  if (!connected || !req || req.kind === 'question' || req.kind === 'instruction' || req.id === approval.decidedId) return;
  approve({ type: 'decided', id: req.id });
  send({ t: 'decision', requestId: req.id, decision: 'deny' });
}

// ---------- navegación, salto y modo ----------
function renderAll() {
  bottom.render({ nav, view, reader, menu, overlay, question, instruct, updateDismissed, diag: { on: overlay === 'diag', connected, sessions: view.sessions.length, pending: view.pendingCount, mode: view.mode, settings: !!view.settings } });
}

function applyNav(action) {
  const r = reduce(nav, view, { ...action, now: performance.now() });
  nav = r.state;
  if (connected) r.messages.forEach(send);
  renderAll();
}

// Lector del mensaje completo: A (o Enter, o el botón) en el detalle, sin tarjeta; B/Esc vuelven; flechas desplazan.
function applyReader(event) {
  const r = reduceReader(reader, event);
  reader = r.state;
  if (connected) r.messages.forEach(send);
  renderAll();
}

// Menú de configuración. SELECT (S o Retroceso) lo abre y lo cierra; con una tarjeta de permiso a la vista no se abre.
function closeMenu() {
  menu = createMenu();
  overlay = null;
  approve({ type: 'cancel' });   // lo que se pulsó antes no debe actuar sobre la app de debajo
  ackApprove({ type: 'cancel' });
  renderAll();
}

function applyMenu(event) {
  const r = reduceMenu(menu, view, event);
  menu = r.state;
  if (connected) r.messages.forEach(send);       // { t: 'setting', ... }: el puente guarda y reenvía la vista
  if (r.effect) {
    if (r.effect.kind === 'guide') overlay = 'guide';
    else if (r.effect.kind === 'diag') overlay = overlay === 'diag' ? null : 'diag';
    else if (r.effect.kind === 'close') { closeMenu(); return; }
  }
  renderAll();
}

// SELECT: abre el menú, o lo cierra (con la guía o el diagnóstico encima, cierra solo esa capa). Con una tarjeta (de permiso o de
// aviso) a la vista no se abre: primero se responde o se marca "Visto".
function toggleMenu() {
  if (menu.open) { if (overlay) { overlay = null; renderAll(); } else closeMenu(); return; }
  if (menuCanOpen(view)) { menu = reduceMenu(menu, view, { type: 'open' }).state; approve({ type: 'cancel' }); ackApprove({ type: 'cancel' }); renderAll(); }
}

// B / Esc con el menú abierto: la capa de encima, o un nivel atrás, o cerrar.
function menuBack() {
  if (overlay) { overlay = null; renderAll(); return; }
  applyMenu({ type: 'back' });
}

function openReader() {
  if (!menu.open && !reader.open && canOpen(nav, view)) applyReader({ type: 'open', sessionId: nav.sessionId, view });
}

// L / R: el siguiente permiso; sin permisos, la siguiente tarjeta de aviso.
function skip() {
  if (!connected) return;
  const perms = skipMessages(view);
  (perms.length ? perms : skipNoticeMessages(view)).forEach(send);
}

// Y (o la franja del detalle): siguiente modo de aviso de la sesión abierta; no con un permiso (ahí Y es "siempre").
function cycleNotify() {
  if (connected && !menu.open && !reader.open) cycleNotifyMessages(view, nav).forEach(send);
}

// "Leer todo" de la tarjeta de aviso: abre el detalle de esa sesión y su lector; el aviso sigue ahí y B vuelve a él.
function openNoticeReader() {
  if (menu.open || reader.open || !noticeShown(view)) return;
  const sessionId = view.notice.sessionId;
  if (!view.sessions.some(s => s.id === sessionId)) return;
  applyNav({ type: 'openSession', sessionId });
  applyReader({ type: 'open', sessionId, view, fromNotice: true });
}

function toggleMode() {
  if (connected) modeMessages(view).forEach(send);
}

// ---------- entrada ----------
const MOVES = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };

window.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  // SELECT (S o Retroceso): menú de configuración. Nunca tapa una tarjeta de permiso (ver toggleMenu y applyView).
  if (k === 's' || k === 'backspace') { e.preventDefault(); if (!e.repeat) toggleMenu(); return; }
  // con el menú abierto (y sin tarjeta: una tarjeta lo cierra) las teclas son suyas; lo que no usa se traga
  if (menu.open && !view.request && !noticeShown(view)) {
    e.preventDefault();
    if (k === 'escape' || k === 'b') { if (!e.repeat) menuBack(); }
    else if (overlay) { /* la guía y el diagnóstico solo se cierran */ }
    else if (k === 'arrowup' || k === 'arrowdown') applyMenu({ type: 'move', dy: k === 'arrowup' ? -1 : 1 });
    else if (k === 'a' || k === 'enter') { if (!e.repeat) applyMenu({ type: 'activate', dir: 1, cycleOnly: false }); }
    else if ((k === 'arrowleft' || k === 'arrowright') && !e.repeat) applyMenu({ type: 'activate', dir: k === 'arrowleft' ? -1 : 1, cycleOnly: true });
    return;
  }
  // versión nueva de la app (solo aviso): A dice que se hace en la consola, B la oculta; sin menú ni lector ni más tarjetas
  if (!menu.open && !reader.open && updateShown(view, updateDismissed)) {
    if (k === 'a' || k === 'enter') { e.preventDefault(); if (!e.repeat) bottom.noteUpdateOnlyConsole(); return; }
    if (k === 'b' || k === 'escape') { e.preventDefault(); if (!e.repeat) { updateDismissed = true; renderAll(); } return; }
  }
  // pregunta con alternativas a la vista: arriba/abajo, A elige, B vuelve a la pregunta anterior (nunca rechaza), L/R saltan; el resto se traga
  if (isQuestionCard(view)) {
    e.preventDefault();
    if (k === 'arrowup' || k === 'arrowdown') applyQuestion({ type: 'move', dy: k === 'arrowup' ? -1 : 1 });
    else if (k === 'a' || k === 'enter') applyQuestion({ type: 'activate', now: performance.now(), repeat: e.repeat });
    else if (k === 'b' || k === 'escape') { if (!e.repeat) applyQuestion({ type: 'back' }); }
    else if ((k === 'l' || k === 'r' || k === 'q' || k === 'w') && !e.repeat) skip();
    return;
  }
  // fin de turno retenido: arriba/abajo, A elige, B no hace nada (nunca envía ni libera), L/R saltan; el resto se traga
  if (isInstructionCard(view)) {
    e.preventDefault();
    if (k === 'arrowup' || k === 'arrowdown') applyInstruct({ type: 'move', dy: k === 'arrowup' ? -1 : 1 });
    else if (k === 'arrowleft' || k === 'arrowright') applyInstruct({ type: 'move', dx: k === 'arrowleft' ? -1 : 1 });
    else if (k === 'a' || k === 'enter') applyInstruct({ type: 'activate', now: performance.now(), repeat: e.repeat });
    else if ((k === 'l' || k === 'r' || k === 'q' || k === 'w') && !e.repeat) skip();
    return;
  }
  if (k === 'a') {
    e.preventDefault();
    approve({ type: 'down', now: performance.now(), source: 'key', repeat: e.repeat });
    // con una tarjeta de aviso, A solo la marca "Visto" (gesto propio): no entra ni lee; se lee con "Leer todo"
    if (noticeShown(view) && !reader.open) ackApprove({ type: 'down', now: performance.now(), source: 'key', repeat: e.repeat });
    // en el detalle, sin tarjeta, A abre el lector (recarga si hay un mensaje nuevo); con tarjeta de permiso solo aprueba
    else if (!e.repeat) { if (reader.open) { if (reader.stale) applyReader({ type: 'reload', view }); } else openReader(); }
  }
  // Y: "sí, no volver a preguntar", solo si la tarjeta lo ofrece; el mismo gesto que A
  else if (k === 'y') {
    e.preventDefault();
    if (view.request) { if (view.request.always) approve({ type: 'down', now: performance.now(), source: 'key', repeat: e.repeat, always: true }); }
    else if (!e.repeat) cycleNotify();   // sin permiso, en el detalle: modo de aviso de la sesión
  }
  else if (k === 'b') {
    e.preventDefault();
    if (e.repeat) return;
    if (bAction(view) === 'deny') deny();
    else if (reader.open) applyReader({ type: 'close' });
    else applyNav({ type: 'back' });
  }
  else if (k === 'escape') { if (reader.open) { e.preventDefault(); applyReader({ type: 'close' }); } }
  else if (MOVES[k] && !reader.open && !e.repeat && writeEffect(view, nav) && (k === 'arrowleft' || k === 'arrowright' || k === 'arrowdown')) {
    e.preventDefault();
    if (k === 'arrowdown') clearQueue();
    else toggleWait();
  }
  else if (MOVES[k]) {
    e.preventDefault();
    if (reader.open) applyReader(k === 'arrowup' || k === 'arrowdown' ? { type: 'scroll', delta: MOVES[k][1] } : { type: 'page', dir: MOVES[k][0] });
    else applyNav({ type: 'move', dx: MOVES[k][0], dy: MOVES[k][1] });
  }
  else if (k === 'enter') { e.preventDefault(); if (!e.repeat) { if (reader.open) { if (reader.stale) applyReader({ type: 'reload', view }); } else if (noticeShown(view)) { /* con un aviso se traga: A lo marca "Visto" */ } else if (nav.level === 'detail') openReader(); else applyNav({ type: 'enter' }); } }
  else if (k === 'l' || k === 'r') { e.preventDefault(); if (reader.open) { if (!e.repeat) applyReader({ type: 'page', dir: k === 'l' ? -1 : 1 }); } else if (!e.repeat) skip(); }
  else if (k === 'q' || k === 'w') { e.preventDefault(); if (!e.repeat && !reader.open) skip(); }
  else if (k === 'm') { e.preventDefault(); if (!e.repeat && !reader.open) toggleMode(); }
  // X: en el lector, el otro modo (completo / resumen); en el detalle de una sesión, escribirle una instrucción; fuera de ellos no hace nada
  else if (k === 'x') { e.preventDefault(); if (!e.repeat) { if (reader.open) applyReader({ type: 'toggle', view }); else writeInstruction(); } }
});
window.addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  if (k === 'a') { approve({ type: 'up', now: performance.now(), source: 'key' }); ackApprove({ type: 'up', now: performance.now(), source: 'key' }); }
  else if (k === 'y') approve({ type: 'up', now: performance.now(), source: 'key', always: true });
});
window.addEventListener('blur', () => { approve({ type: 'cancel' }); ackApprove({ type: 'cancel' }); });

const bottomEl = $('bottom');
// Botón de aprobar o de "siempre" bajo el puntero: 'approve', 'always' o null
const approveButtonOf = e => {
  const b = e.target.closest && e.target.closest('[data-action="approve"], [data-action="always"]');
  return b ? b.dataset.action : null;
};
const ackButtonOf = e => !!(e.target.closest && e.target.closest('[data-action="ack"]'));
bottomEl.addEventListener('pointerdown', e => {
  if (e.button > 0) return;
  if (ackButtonOf(e)) { ackApprove({ type: 'down', now: performance.now(), source: 'pointer' }); return; }
  const which = approveButtonOf(e);
  if (!which) return;
  approve({ type: 'down', now: performance.now(), source: 'pointer', always: which === 'always' });
});
// Soltar fuera del botón (o en el otro), salir de él o cancelar el toque anula el gesto.
window.addEventListener('pointerup', e => {
  ackApprove(ackButtonOf(e) ? { type: 'up', now: performance.now(), source: 'pointer' } : { type: 'cancel' });
  const which = approveButtonOf(e);
  approve(which ? { type: 'up', now: performance.now(), source: 'pointer', always: which === 'always' } : { type: 'cancel' });
  if (which && approval.gesture && approval.gesture.source === 'pointer') approve({ type: 'cancel' }); // soltó en el otro botón
}, true);
window.addEventListener('pointercancel', () => { approve({ type: 'cancel' }); ackApprove({ type: 'cancel' }); }, true);
bottomEl.addEventListener('pointerleave', () => { approve({ type: 'cancel' }); ackApprove({ type: 'cancel' }); }, true);
// La rueda desplaza el lector de a 3 líneas (el lápiz de la 3DS arrastra).
bottomEl.addEventListener('wheel', e => {
  if (!reader.open) return;
  e.preventDefault();
  applyReader({ type: 'scroll', delta: Math.sign(e.deltaY) * 3 });
}, { passive: false });
bottomEl.addEventListener('click', e => {
  const a = e.target.closest('[data-action]');
  if (a) {
    const action = a.dataset.action;
    if (action === 'deny') deny();
    // aprobar y "siempre" se resuelven con pointerdown/pointerup (approve.js); el click no aprueba
    else if (action === 'skip' || action === 'skipNotice') skip();
    else if (action === 'noticeRead') openNoticeReader();
    else if (action === 'updateDo') bottom.noteUpdateOnlyConsole(); // el simulador no instala nada: solo dice dónde se hace
    else if (action === 'updateLater') { updateDismissed = true; renderAll(); }
    else if (action === 'notify') cycleNotify();
    else if (action === 'mode') { if (!reader.open && !menu.open) toggleMode(); }
    else if (action === 'read') openReader();
    else if (action === 'reload') applyReader({ type: 'reload', view });
    else if (action === 'readerMode') applyReader({ type: 'toggle', view });
    else if (action === 'instruct') writeInstruction();
    else if (action === 'wait') toggleWait();
    else if (action === 'clearQueue') clearQueue();
    return;
  }
  const irow = e.target.closest('[data-i-row]');
  if (irow && isInstructionCard(view)) { applyInstruct({ type: 'activate', now: performance.now(), row: Number(irow.dataset.iRow) }); return; }
  const qrow = e.target.closest('[data-q-row]');
  if (qrow && isQuestionCard(view)) { applyQuestion({ type: 'activate', now: performance.now(), row: Number(qrow.dataset.qRow) }); return; }
  if (menu.open && !view.request) {
    if (e.target.closest('[data-nav="back"]')) return menuBack();
    const row = e.target.closest('[data-menu-row]');
    if (row && !overlay) applyMenu({ type: 'select', row: Number(row.dataset.menuRow) });
    return;
  }
  if (e.target.closest('[data-nav="back"]')) return reader.open ? applyReader({ type: 'close' }) : applyNav({ type: 'back' });
  const item = e.target.closest('[data-index]');
  if (item) applyNav({ type: 'enter', index: Number(item.dataset.index) });
});

// ---------- bucle ----------
function loop(now) {
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  drawFace(ctx, view.face, now, localState);
  const t = performance.now();
  approve({ type: 'tick', now: t });
  bottom.setHold(holdProgress(approval, t), holdIsAlways(approval));
  tickCountdown();
  bottom.tickElapsed(t);
  bottom.setApproveEnabled(approveReady(approval, t));
  bottom.setQuestionEnabled(questionReady(question, t));
  bottom.setInstructEnabled(instructReady(instruct, t));
  ackApprove({ type: 'tick', now: t });
  bottom.setAckEnabled(approveReady(seen, t));
  if (nav.level === 'detail' && !nav.confirmed && reduce(nav, view, { type: 'sync', now: t }).state !== nav) applyNav({ type: 'sync' });
  requestAnimationFrame(loop);
}

renderAll();
connect();
requestAnimationFrame(loop);

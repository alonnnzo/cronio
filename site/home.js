// Menú de funciones al estilo de las consolas portátiles: dos pantallas apiladas. Abajo, una cuadrícula de canales con un cursor
// celeste; arriba, el banner de la función elegida. Es un tablist: flechas, Inicio/Fin, Tab, Enter o A para "abrir" (repite la animación).
(() => {
  'use strict';
  const { AGENTS, $, bar, permCard, questionCard, instructCard, sessionRows, faceHTML, setFace } = window.Cronio;
  const root = $('funciones');
  if (!root) return;

  const ic = body => `<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true" focusable="false">${body}</svg>`;
  const CHANNELS = [
    {
      id: 'permisos', name: 'Permisos', phrase: 'Aprueba o rechaza lo que Claude quiere ejecutar. El riesgo alto pide mantener A.',
      keys: ['A aprueba', 'B rechaza', 'Mantén A si es riesgo alto'],
      icon: ic('<path d="M20 4.5 33 9.5v10c0 8-5.6 13.2-13 16-7.4-2.8-13-8-13-16v-10z" class="i-fill"/><path d="m13 20 5 5 9-10" class="i-line"/>'),
      art: () => ({ bs: bar('Claude', 'mi-portal', { color: AGENTS.claude.color, mode: '' }) + `<div class="detail"><p><b>Ahora:</b> Pide permiso</p></div>` + permCard('Claude · mi-portal', 'rm -rf node_modules', { risk: true }) }),
    },
    {
      id: 'preguntas', name: 'Preguntas', phrase: 'Responde las preguntas con opciones. La recomendada va marcada con una estrella.',
      keys: ['Flechas eligen', 'A responde'],
      icon: ic('<path d="M8 7h24a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3H19l-8 6v-6H8a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3z" class="i-fill"/><path d="M16.5 15.5a3.6 3.6 0 1 1 5.4 3.1c-1.3.8-1.9 1.4-1.9 2.9" class="i-line"/><circle cx="20" cy="25.2" r="1.5" class="i-dot"/>'),
      art: () => ({ bs: bar('Claude', 'mi-portal', { color: AGENTS.claude.color, mode: '' }) + questionCard(0) }),
    },
    {
      id: 'instrucciones', name: 'Instrucciones', phrase: 'Escribe con el teclado de la consola o toca un atajo: «Sigue», «Corre las pruebas».',
      keys: ['A elige', 'Teclado de la consola'],
      icon: ic('<rect x="4.5" y="10" width="31" height="20" rx="4" class="i-fill"/><path d="M10 16h2.5M16 16h2.5M22 16h2.5M28 16h2M10 22h2M30 22h-2M15 24h10" class="i-line thin"/>'),
      art: () => ({ bs: bar('Claude', 'mi-portal', { color: AGENTS.claude.color, mode: '' }) + instructCard(0) }),
    },
    {
      id: 'avisos', name: 'Avisos', phrase: 'La cara cambia de ánimo y suena cuando Claude termina o te espera.',
      keys: ['Sonido', 'Luz de aviso'],
      icon: ic('<path d="M11 27V19a9 9 0 0 1 18 0v8l3 3.5H8z" class="i-fill"/><path d="M16.5 34a3.5 3.5 0 0 0 7 0" class="i-line"/>'),
      art: () => ({ face: ['done', '¡Claude terminó!', 'mi-portal · 128 pruebas pasan'], waves: true }),
    },
    {
      id: 'sesiones', name: 'Sesiones', phrase: 'Todas tus sesiones, con su modelo, su estado y cuánto llevan así.',
      keys: ['Cruceta mueve', 'A abre el detalle'],
      icon: ic('<rect x="5" y="6" width="30" height="8" rx="3" class="i-fill"/><rect x="5" y="16.5" width="30" height="8" rx="3" class="i-fill"/><rect x="5" y="27" width="30" height="8" rx="3" class="i-fill"/><circle cx="10.5" cy="10" r="1.6" class="i-dot"/><circle cx="10.5" cy="20.5" r="1.6" class="i-dot"/><circle cx="10.5" cy="31" r="1.6" class="i-dot"/>'),
      art: () => ({ bs: bar('Claude', '4 sesiones', { color: AGENTS.claude.color, mode: '' }) + `<div class="list">${sessionRows()}</div>` }),
    },
    {
      id: 'lector', name: 'Lector', phrase: 'Lee el último mensaje del agente completo o resumido, en letra de consola.',
      keys: ['A lee todo', 'Cruceta recorre'],
      icon: ic('<path d="M6 8c5-2 10-1.500 14 1.500 4-3 9-3.500 14-1.500v22c-5-2-10-1.500-14 1.500-4-3-9-3.500-14-1.500z" class="i-fill"/><path d="M20 9.500v22M10.500 14.500h5M10.500 19h5M24.500 14.500h5M24.500 19h5" class="i-line thin"/>'),
      art: () => ({
        bs: bar('Claude', 'OTRO-SISTEMA · 1-9/38', { color: AGENTS.claude.color, mode: '' }) +
          '<pre class="reader-lines"><span class="h">Te pregunta:</span>\n¿Publico la rama ahora o prefieres\nrevisarla antes conmigo?\n\nAgregué el módulo de reportes:\n- ficha con foto e instrumento\n- listado con filtro por cátedra\n\nLa suite pasa completa (128).</pre>',
      }),
    },
    {
      id: 'tres-d', name: '3D y temas', phrase: 'La cara en 3D estereoscópico con el control 3D de la consola. Tema claro y oscuro.',
      keys: ['Control 3D', 'Tema claro', 'Tema oscuro'],
      icon: ic('<path d="M20 4.500 33.500 12v16L20 35.500 6.500 28V12z" class="i-fill"/><path d="M6.500 12 20 19.500 33.500 12M20 19.500v16" class="i-line thin"/>'),
      art: () => ({ face: ['working', 'Claude en mi-portal', 'Editando hero.astro'], tilt: true }),
    },
    {
      id: 'actualizaciones', name: 'Actualizaciones', phrase: 'El programa del PC y la app de la consola se actualizan con un botón.',
      keys: ['A actualiza', 'Ahora no'],
      icon: ic('<circle cx="20" cy="20" r="14.500" class="i-fill"/><path d="M20 27V13.500M13.500 19.500 20 13l6.500 6.500" class="i-line"/>'),
      art: () => ({ bs: bar('Cronio', 'Versión nueva', { color: '#3fb0e6', mode: '' }) + `<div class="card notice"><div class="card-head"><b class="notice-label">NOVEDAD</b></div><div class="notice-title upd">Hay una versión nueva</div><pre class="card-lines">La app se instala desde la consola.\nEl programa del PC se actualiza solo.</pre><div class="btns"><div class="btn seen">A: Actualizar</div><div class="btn no">Ahora no</div></div></div>` }),
    },
  ];

  const tabs = $('home-tabs'), panel = $('home-panel');
  tabs.innerHTML = CHANNELS.map((c, i) =>
    `<button type="button" role="tab" class="channel" id="ch-${c.id}" aria-selected="false" aria-controls="home-panel" tabindex="-1" data-i="${i}">` +
    `<span class="ch-icon">${c.icon}</span><span class="ch-name">${c.name}</span></button>`).join('');
  const buttons = [...tabs.children];

  function banner(c) {
    const a = c.art();
    let art;
    if (a.bs) art = `<div class="mscr"><div class="bs">${a.bs}</div></div>`;
    else {
      art = `<div class="mscr face-mini${a.tilt ? ' tilt' : ''}">${faceHTML('claude')}${a.waves ? '<span class="waves"><i></i><i></i><i></i></span>' : ''}</div>`;
    }
    const el = document.createElement('div');
    el.className = 'bn';
    el.innerHTML = `<div class="bn-text"><h3>${c.name}</h3><p>${c.phrase}</p><ul class="bn-keys">${c.keys.map(k => `<li>${k}</li>`).join('')}</ul></div>${art}`;
    if (a.face) setFace(el, 'claude', a.face[0], a.face[1], a.face[2]);
    return el;
  }

  let cur = -1;
  function select(i, { focus = false, replay = false } = {}) {
    if (i === cur && !replay) { if (focus) buttons[i].focus(); return; }
    cur = i;
    buttons.forEach((b, j) => { b.setAttribute('aria-selected', String(j === i)); b.tabIndex = j === i ? 0 : -1; });
    panel.setAttribute('aria-labelledby', buttons[i].id);
    panel.replaceChildren(banner(CHANNELS[i]));
    if (focus) buttons[i].focus();
  }

  const cols = () => (getComputedStyle(tabs).gridTemplateColumns.split(' ').length) || 4;
  tabs.addEventListener('keydown', e => {
    const i = cur, n = CHANNELS.length, c = cols();
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % n;
    else if (e.key === 'ArrowLeft') j = (i - 1 + n) % n;
    else if (e.key === 'ArrowDown') j = i + c < n ? i + c : i % c;
    else if (e.key === 'ArrowUp') j = i - c >= 0 ? i - c : Math.min(n - 1, i + c * (Math.ceil(n / c) - 1));
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = n - 1;
    else if (e.key === 'Enter' || e.key === ' ' || e.key.toLowerCase() === 'a') {
      e.preventDefault(); select(i, { replay: true }); return;   // "abrir": el banner vuelve a empezar
    }
    if (j !== null) { e.preventDefault(); select(j, { focus: true }); }
  });
  tabs.addEventListener('click', e => { const b = e.target.closest('.channel'); if (b) select(+b.dataset.i, { replay: e.detail > 0 && +b.dataset.i === cur }); });
  tabs.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse') return;
    const b = e.target.closest('.channel');
    if (b && +b.dataset.i !== cur) select(+b.dataset.i);
  });
  select(0);
})();

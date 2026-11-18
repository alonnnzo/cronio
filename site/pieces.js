// Piezas compartidas de la página: agentes, tarjetas de la pantalla de abajo (mismos textos que la app) y la cara en DOM.
// Es un script clásico: deja todo en window.Cronio para tour.js, home.js y app.js.
(() => {
  'use strict';
  const AGENTS = {
    claude: { name: 'Claude', color: '#ee7446' },
    gemini: { name: 'Gemini', color: '#5b8cff' },
    codex: { name: 'Codex', color: '#2fd08a' },
    cursor: { name: 'Cursor', color: '#c9ced9' },
    hermes: { name: 'Hermes', color: '#f6c544' },
  };
  const C = AGENTS.claude.color;
  const NOTIFY = ['todo', 'lo importante', 'solo al terminar', 'silencio'];
  const $ = id => document.getElementById(id);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  const bar = (title, sub, { color = '', back = false, mode = 'En fila' } = {}) =>
    `<div class="bar">${color ? `<i class="bar-dot" style="background:${color}"></i>` : ''}<b class="bar-title">${title}</b><span class="bar-sub">${sub}</span>` +
    (back ? '<span class="mini" data-key="B">B Volver</span>' : '') + (mode ? `<span class="mini">${mode}</span>` : '') + '</div>';
  const tile = (k, { n = 0, label = 'sin sesiones', cur = false, ask = false } = {}) => {
    const a = AGENTS[k];
    return `<div class="tile${n ? '' : ' off'}${cur ? ' cur' : ''}${ask ? ' ask' : ''}" data-kind="${k}">` +
      (n ? `<div class="badge">${n}</div>` : '') +
      `<i style="background:${a.color}"></i><b>${a.name}</b><span>${label}</span></div>`;
  };
  const permCard = (owner, cmd, { risk = false } = {}) =>
    `<div class="card${risk ? ' risk' : ''}"><div class="card-head"><span>${owner}</span><span class="card-timer">0:12</span></div>` +
    (risk ? '<div class="risk-flag">RIESGO ALTO</div>' : '') +
    `<pre class="card-lines">Bash\n${cmd}</pre>` +
    (risk ? '' : `<div class="btn always" data-key="Y">Y: sí, siempre · Bash(${cmd})</div>`) +
    `<div class="btns"><div class="btn ok${risk ? ' hold' : ''}" data-key="A">${risk ? 'Mantén A' : 'A · Aprobar'}</div><div class="btn no" data-key="B">B · Rechazar</div></div></div>`;
  const noticeCard = (owner, title, text) =>
    `<div class="card notice"><div class="card-head"><b class="notice-label">AVISO</b><span>${owner}</span></div>` +
    `<div class="notice-title">${title}</div><pre class="card-lines">${text}</pre>` +
    `<div class="btns"><div class="btn seen" data-key="A">A: Visto</div><div class="btn no" data-act="read">Leer todo</div></div></div>`;
  const questionCard = (cursor = 0) =>
    `<div class="q-card"><div class="q-head">Despliegue<span>1/1</span></div>` +
    `<p class="q-text">¿A qué entorno publico el sitio?</p>` +
    `<div class="opt${cursor === 0 ? ' cur' : ''}" data-opt="0"><b>Vista previa <span class="star">★</span></b><small>Una URL temporal para revisarlo antes</small></div>` +
    `<div class="opt${cursor === 1 ? ' cur' : ''}" data-opt="1"><b>Producción</b><small>Reemplaza el sitio publicado</small></div>` +
    `<div class="opt-row"><div class="opt${cursor === 2 ? ' cur' : ''}" data-opt="2"><b>Otra…</b></div><div class="opt${cursor === 3 ? ' cur' : ''}" data-opt="3"><b>Responder en el PC</b></div></div></div>`;
  const menuRows = (set, cursor, full) => {
    const row = (i, title, value, on, hint) => `<div class="menu-row${cursor === i ? ' cur' : ''}" data-row="${i}"><div class="menu-line"><b>${title}</b><em${on ? ' class="on"' : ''}>${value}</em></div>${hint ? `<small>${hint}</small>` : ''}</div>`;
    return `<div class="menu">` +
      row(0, 'Avisos por defecto', NOTIFY[set.notify], false, 'Sesiones nuevas · cada sesión cambia el suyo') +
      row(1, 'Pedir "Visto" en los avisos', set.ack ? 'sí' : 'no', set.ack, 'Cada aviso queda en una tarjeta con "Visto"') +
      row(2, 'Sonido', set.sound ? 'sí' : 'no', set.sound) +
      (full ? row(3, 'Agentes', '4 de 5') + row(4, 'Guía de botones', '') + row(5, 'Diagnóstico', '') : '<p class="menu-help">A o ◀ ▶ cambian el valor</p>') +
      `</div>`;
  };
  const instructCard = (cursor = 2) =>
    `<div class="q-card"><div class="q-head">Espera tu instrucción<span>mi-portal</span></div>` +
    `<div class="opt-row"><div class="opt${cursor === 0 ? ' cur' : ''}"><b>Sigue</b></div><div class="opt${cursor === 1 ? ' cur' : ''}"><b>Corre las pruebas</b></div></div>` +
    `<div class="opt${cursor === 2 ? ' cur' : ''}"><b>Escribir</b><small>Teclado: lo que escribas se lo manda a la sesión</small></div>` +
    `<div class="opt${cursor === 3 ? ' cur' : ''}"><b>Seguir en el PC</b><small>Claude termina como siempre; sigues en el PC</small></div></div>`;
  const sessionRows = () => [
    ['mi-portal', 'Opus', 'working', 'trabajando', '2:14', 'Editando hero.astro'],
    ['OTRO-SISTEMA', 'Sonnet', 'ask', 'te espera', '0:40', 'Espera tu respuesta'],
    ['otro-sitio', 'Pro', 'done', 'terminó', '5:02', 'Formulario listo y probado'],
    ['VISKA', 'GPT', 'idle', 'inactivo', '12:31', 'Esperando instrucciones'],
  ].map(([p, m, st, lab, t, act]) =>
    `<div class="sess${st === 'ask' ? ' ask' : ''}"><b>${p}</b><em class="st-${st}">${m} · ${lab} · ${t}</em><span>${act}</span></div>`).join('');

  // La cara en DOM (400x240): fondo, ojos y globo son capas separadas, así el recorrido puede separarlas en Z.
  const faceHTML = (kind = 'claude') =>
    `<div class="face" data-mood="working" style="--fc:${AGENTS[kind].color}">` +
    `<div class="fbg"></div><div class="fglow"><i class="g1"></i><i class="g2"></i></div>` +
    `<div class="feyes"><div class="ey"><b class="eye l"><i></i></b><b class="eye r"><i></i></b></div></div>` +
    `<div class="fbub"><span class="t1"></span><span class="t2"></span></div></div>`;
  function setFace(root, kind, mood, l1, l2) {
    const f = root.querySelector('.face');
    f.dataset.mood = mood;
    f.style.setProperty('--fc', AGENTS[kind].color);
    const bub = f.querySelector('.fbub'), t1 = bub.querySelector('.t1'), t2 = bub.querySelector('.t2');
    if (t1.textContent !== l1 || t2.textContent !== (l2 || '')) {
      t1.textContent = l1; t2.textContent = l2 || '';
      bub.classList.toggle('one', !l2);
      bub.classList.remove('pop'); void bub.offsetWidth; bub.classList.add('pop');
    }
  }

  window.Cronio = { AGENTS, C, NOTIFY, $, reduced, bar, tile, permCard, noticeCard, questionCard, menuRows, instructCard, sessionRows, faceHTML, setFace };
})();

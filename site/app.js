// Página de Cronio (marca en docs/11-marca-cronio.md, rama fase-7).
//  1. Recorrido: la consola se abre con el scroll y muestra las funciones una a una.
//  2. Demo: una segunda consola que responde a botones, teclado y toques.
// Sin compilar. Con prefers-reduced-motion la consola del recorrido queda abierta y todo cambia solo con fundidos.
(() => {
  'use strict';

  // Enlace de descarga: las Releases de GitHub del repositorio público. Es el único lugar de la página con el nombre del repo
  // (el otro es `publish` en packages/installer/package.json). Vacío = el botón queda apagado.
  const RELEASES_URL = 'https://github.com/alonnnzo/cronio/releases/latest';

  const AGENTS = {
    claude: { name: 'Claude', color: '#ee7446' },
    gemini: { name: 'Gemini', color: '#5b8cff' },
    codex: { name: 'Codex', color: '#2fd08a' },
    cursor: { name: 'Cursor', color: '#c9ced9' },
    hermes: { name: 'Hermes', color: '#f6c544' },
  };
  const KINDS = Object.keys(AGENTS);
  const NEUTRAL = '#aab1bc';
  const STATE_LABEL = { idle: 'inactivo', working: 'trabajando', ask: 'te espera', done: 'terminó', error: 'error' };
  const NOTIFY = ['todo', 'lo importante', 'solo al terminar', 'silencio'];
  const $ = id => document.getElementById(id);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const C = AGENTS.claude.color;

  // ---------- piezas de la pantalla inferior (mismos textos que la app) ----------
  const bar = (title, sub, { color = '', back = false, mode = 'En fila' } = {}) =>
    `<div class="bar">${color ? `<i class="bar-dot" style="background:${color}"></i>` : ''}<b class="bar-title">${title}</b><span class="bar-sub">${sub}</span>` +
    (back ? '<span class="mini" data-key="B">B Volver</span>' : '') + (mode ? `<span class="mini">${mode}</span>` : '') + '</div>';
  const tile = (k, { n = 0, label = 'sin sesiones', cur = false, ask = false } = {}) => {
    const a = AGENTS[k];
    return `<div class="tile${n ? '' : ' off'}${cur ? ' cur' : ''}${ask ? ' ask' : ''}" data-kind="${k}">` +
      (n ? `<div class="badge">${n}</div>` : '') +
      `<i style="background:${a.color}"></i><b>${a.name}</b><span>${label}</span></div>`;
  };
  const permCard = (owner, cmd, color) =>
    `<div class="card"><div class="card-head"><span>${owner}</span><span class="card-timer">0:12</span></div>` +
    `<pre class="card-lines">Bash\n${cmd}</pre>` +
    `<div class="btn always" data-key="Y">Y: sí, siempre · Bash(${cmd})</div>` +
    `<div class="btns"><div class="btn ok" data-key="A">A · Aprobar</div><div class="btn no" data-key="B">B · Rechazar</div></div></div>`;
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

  // ---------- pantalla superior: la cara. La pantalla entera toma el color del agente y lleva dos ojos; una por canvas ----------
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const FONT = '"M PLUS Rounded 1c", system-ui, sans-serif';
  const INK = '#12131a';
  function makeFace(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);
    let col = hex(AGENTS.claude.color), cur = { kind: 'claude', mood: 'idle', lines: [''] }, born = 0, key = '';
    const roundRect = (x, y, w, h, r) => {
      ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    };
    return {
      set(b, now) { const k = b.kind + b.mood + b.lines.join('|'); if (k !== key) { key = k; cur = b; born = now; } },
      draw(t, still) {
        const mood = cur.mood, target = hex(cur.kind ? AGENTS[cur.kind].color : NEUTRAL);
        col = still ? target : col.map((v, i) => v + (target[i] - v) * .1);
        // la pantalla entera es la cara: color del agente (apagado si está inactivo) y un brillo suave arriba a la izquierda
        const dim = mood === 'idle' ? .82 : 1;
        ctx.fillStyle = `rgb(${col.map(v => Math.round(v * dim)).join(',')})`;
        ctx.fillRect(0, 0, 400, 240);
        ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.beginPath(); ctx.arc(88, 34, 136, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.arc(88, 34, 72, 0, 7); ctx.fill();

        // ojos: elipses verticales color tinta con un brillo blanco arriba a la izquierda
        const bob = still ? 0 : Math.sin(t / 900) * 3;
        const ey = 84 + bob + (mood === 'ask' && !still ? -Math.abs(Math.sin(t / 260)) * 7 : 0);
        const look = still ? 0 : mood === 'working' ? Math.sin(t / 500) * 9 : mood === 'ask' ? 0 : Math.sin(t / 2300) * 5;
        const blink = !still && (t % 3600) > 3470;
        ctx.strokeStyle = INK; ctx.lineWidth = 9; ctx.lineCap = 'round';
        [-1, 1].forEach(d => {
          const ex = 200 + d * 62 + look;
          ctx.beginPath();
          if (mood === 'done') { ctx.arc(ex, ey + 10, 19, Math.PI, 0); ctx.stroke(); }
          else if (mood === 'idle' || blink) { ctx.moveTo(ex - 17, ey + 4); ctx.lineTo(ex + 17, ey + 4); ctx.stroke(); }
          else {
            const s = mood === 'ask' ? 1.16 : 1;
            ctx.fillStyle = INK; ctx.ellipse(ex, ey, 17 * s, 26 * s, 0, 0, 7); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(ex - 6 * s, ey - 11 * s, 6 * s, 0, 7); ctx.fill();
          }
        });

        // globo de texto
        if (!cur.lines.length || !cur.lines[0]) return;
        const age = still ? 1 : Math.min(1, (t - born) / 180), sc = .92 + .08 * age;
        ctx.save(); ctx.translate(200, 194); ctx.scale(sc, sc); ctx.globalAlpha = age;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.moveTo(-14, -29); ctx.lineTo(0, -42); ctx.lineTo(14, -29); ctx.closePath(); ctx.fill();
        roundRect(-182, -30, 364, 60, 16); ctx.fill();
        ctx.textAlign = 'center'; ctx.fillStyle = '#2f343c';
        if (cur.lines.length === 1) { ctx.font = `800 17px ${FONT}`; ctx.fillText(cur.lines[0], 0, 6); }
        else {
          ctx.font = `800 16px ${FONT}`; ctx.fillText(cur.lines[0], 0, -4);
          ctx.font = `500 13px ${FONT}`; ctx.fillStyle = '#59616c'; ctx.fillText(cur.lines[1], 0, 16);
        }
        ctx.restore();
      },
    };
  }

  // =====================================================================================================
  // 1. Recorrido
  // =====================================================================================================
  const storyGrid = (gemini = 'trabajando') => `<div class="grid">` +
    tile('claude', { n: 2, label: 'trabajando', cur: true }) + tile('gemini', { n: 1, label: gemini }) +
    tile('codex', { n: 1, label: 'inactivo' }) + tile('cursor') + tile('hermes') + `</div>`;
  const STEPS = {
    sessions: {
      face: { kind: 'claude', mood: 'working', lines: ['Claude en mi-portal', 'Editando hero.astro'] }, led: 'working',
      bottom: () => bar('Agentes', '4 sesiones') + storyGrid(),
    },
    permission: {
      face: { kind: 'claude', mood: 'ask', lines: ['Claude necesita permiso', 'npm install sharp · mi-portal'] }, led: 'ask',
      bottom: () => bar('Claude', 'mi-portal', { color: C, back: true }) +
        `<div class="detail"><p><b>Proyecto:</b> mi-portal</p><p><b>Modelo:</b> Opus · te espera</p><p><b>Ahora:</b> Pide permiso</p></div>` +
        permCard('Claude · mi-portal', 'npm install sharp', C),
    },
    waiting: {
      face: { kind: 'claude', mood: 'ask', lines: ['Claude te espera', '¿Publico la rama o la reviso contigo?'] }, led: 'ask',
      bottom: () => bar('Claude', 'OTRO-SISTEMA', { color: C, back: true }) +
        `<div class="detail"><p><b>Proyecto:</b> OTRO-SISTEMA</p><p><b>Modelo:</b> Sonnet · te espera</p>` +
        `<p class="question"><b>Te pregunta:</b>\n¿Publico la rama ahora o prefieres\nrevisarla antes conmigo?</p>` +
        `<p><b>Último mensaje:</b><br>Agregué el módulo de reportes y la suite pasa completa (128 pruebas).</p></div>` +
        `<div class="strips"><span class="read-btn">A: leer todo el mensaje</span><span class="read-btn notify">Y: avisos · todo</span></div>`,
    },
    reader: {
      face: { kind: 'claude', mood: 'ask', lines: ['Claude te espera', '¿Publico la rama o la reviso contigo?'] }, led: 'ask',
      bottom: () => bar('Claude', 'OTRO-SISTEMA · 1-13/38', { color: C, back: true }) +
        `<pre class="reader-lines"><span class="h">Te pregunta:</span>
¿Publico la rama ahora o prefieres
revisarla antes conmigo?

Agregué el módulo de reportes:
- ficha con foto, instrumento y bio
- listado con filtro por cátedra
- exportación para el sitio público

La suite pasa completa (128 pruebas).
Quedan dos cosas por decidir:
1. si la bio admite enlaces
2. el orden por defecto del listado</pre>`,
    },
    menu: {
      face: { kind: 'claude', mood: 'idle', lines: ['Configuración'] }, led: '',
      bottom: () => bar('Configuración', 'SELECT/B: cerrar', { back: true }) + menuRows({ notify: 0, ack: true, sound: true }, 2, true),
    },
    notice: {
      face: { kind: 'gemini', mood: 'done', lines: ['¡Gemini terminó!', 'otro-sitio · Formulario listo y probado.'] }, led: 'done',
      bottom: () => bar('Gemini', 'otro-sitio', { color: AGENTS.gemini.color, back: true }) +
        `<div class="detail"><p><b>Proyecto:</b> otro-sitio</p><p><b>Modelo:</b> Pro · terminó</p></div>` +
        noticeCard('Gemini · otro-sitio', 'Terminó', 'Formulario listo y probado. El envío valida el correo y muestra el error.'),
    },
    question: {
      face: { kind: 'claude', mood: 'ask', lines: ['Claude te hace una pregunta', 'Despliegue · mi-portal'] }, led: 'ask',
      bottom: () => bar('Claude', 'mi-portal', { color: C, back: true }) + questionCard(0),
    },
  };
  STEPS.open = { face: { kind: 'claude', mood: 'working', lines: ['Hola, soy Cronio'] }, led: 'working', bottom: STEPS.sessions.bottom };

  const storyFace = makeFace($('face'));
  const layer = document.createElement('div');
  layer.className = 'bs';
  $('bottom-screen').append(layer);
  let shown = null, swapTimer = 0;
  function showStep(name) {
    if (name === shown) return;
    const first = shown === null;
    shown = name;
    const st = STEPS[name];
    storyFace.set(st.face, performance.now());
    $('led').dataset.led = st.led || '';
    clearTimeout(swapTimer);
    if (first) { layer.innerHTML = st.bottom(); return; }
    layer.classList.add('fade');
    swapTimer = setTimeout(() => { layer.innerHTML = STEPS[shown].bottom(); layer.classList.remove('fade'); }, 160);
  }

  const story = $('story'), device = $('device'), lid = $('lid'), heroCopy = $('hero-copy'), cue = $('scroll-cue');
  const stepEls = [...document.querySelectorAll('.step')];
  const openEl = stepEls[0];
  let W = 0, H = 0, mobile = false, stageVisible = true;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = k => (k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

  function poses() {
    if (mobile) {
      const s = Math.min(.9 * W / 460, .5 * H / 580);
      return { hero: { x: 0, y: H * .07, s: s * .82, tilt: 34 }, open: { x: 0, y: -H * .15, s, tilt: 6 } };
    }
    const sOpen = Math.min(.4 * W / 460, .8 * H / 580);
    const sHero = Math.min(.46 * W / 460, .5 * H / 580);
    return { hero: { x: 0, y: H * .16, s: sHero, tilt: 30 }, open: { x: W * .22, y: 0, s: sOpen, tilt: 6 } };
  }

  function frame() {
    // tamaños leídos en cada cuadro: algunos navegadores cambian el ancho sin avisar con "resize"
    if (innerWidth !== W || innerHeight !== H) { W = innerWidth; H = innerHeight; mobile = W < 900; sizeDemo(); }
    const rect = story.getBoundingClientRect();
    stageVisible = rect.bottom > 0;
    const still = reduced.matches;
    const P = poses();
    const raw = still ? 1 : clamp(-rect.top / (openEl.offsetHeight * .85));   // 0 cerrada, 1 abierta
    const k = ease(raw);
    const x = lerp(P.hero.x, P.open.x, k), y = lerp(P.hero.y, P.open.y, k), s = lerp(P.hero.s, P.open.s, k);
    device.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s}) rotateX(${lerp(P.hero.tilt, P.open.tilt, k)}deg)`;
    lid.style.transform = `rotateX(${-178 * (1 - k)}deg)`;

    if (still) heroCopy.classList.toggle('hidden', -rect.top >= openEl.offsetHeight * .5);
    else {
      heroCopy.style.opacity = String(1 - clamp(raw * 2.4));
      heroCopy.style.transform = `translateY(${-raw * 60}px)`;
      cue.style.opacity = String(1 - clamp(raw * 5));
    }

    // paso activo: el que cruza la mitad de la pantalla
    let active = stepEls[0];
    for (const el of stepEls) { if (el.getBoundingClientRect().top <= H * .5) active = el; }
    const inStory = rect.bottom >= H * .6;
    for (const el of stepEls) el.classList.toggle('active', inStory && el === active && el !== openEl);
    showStep(active.dataset.step);
  }

  // =====================================================================================================
  // 2. Demo interactiva
  // =====================================================================================================
  const demoFace = makeFace($('demo-face'));
  const demoLayer = document.createElement('div');
  demoLayer.className = 'bs';
  $('demo-bottom').append(demoLayer);
  const freshSessions = () => [
    { id: 'c1', kind: 'claude', project: 'mi-portal', model: 'Opus', state: 'working', activity: 'Editando hero.astro', last: 'Ajusté el hero y falta revisar el contraste del botón.' },
    { id: 'c2', kind: 'claude', project: 'OTRO-SISTEMA', model: 'Sonnet', state: 'working', activity: 'Corriendo los tests', last: 'Agregué el módulo de reportes; corro la suite.' },
    { id: 'g1', kind: 'gemini', project: 'otro-sitio', model: 'Pro', state: 'working', activity: 'Revisando el formulario', last: 'El formulario valida bien; reviso el envío.' },
    { id: 'x1', kind: 'codex', project: 'ATLAS', model: 'GPT', state: 'idle', activity: 'Esperando instrucciones', last: 'Listo el refactor del runner.' },
  ];
  const D = {
    sessions: freshSessions(),
    nav: { level: 'agents', cursor: 0, kind: null, sid: null },
    req: null,        // { type: 'perm', sid, cmd } | { type: 'question', sid, cursor }
    notice: null,     // { sid, title, text }
    menu: null,       // { cursor }
    set: { notify: 0, ack: true, sound: true },
    say: null,        // { kind, mood, lines, until }
  };
  const sess = id => D.sessions.find(s => s.id === id);
  const ofKind = k => D.sessions.filter(s => s.kind === k);
  const nameOf = s => AGENTS[s.kind].name;
  const say = (kind, mood, lines, ms = 4000) => { D.say = { kind, mood, lines, until: performance.now() + ms }; };

  // sonido corto de aviso (solo tras un gesto del usuario y con "Sonido: sí")
  let audio = null;
  function chime(notes = [660, 880]) {
    if (!D.set.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      notes.forEach((f, i) => {
        const o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime + i * .13;
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.12, t0 + .02); g.gain.exponentialRampToValueAtTime(.001, t0 + .28);
        o.connect(g).connect(audio.destination); o.start(t0); o.stop(t0 + .3);
      });
    } catch { /* sin audio: la demo sigue igual */ }
  }

  function demoFaceState(now) {
    if (D.say && now < D.say.until && D.say.over) return { ...D.say, led: 'ask' };
    if (D.req) {
      const s = sess(D.req.sid);
      return D.req.type === 'perm'
        ? { kind: s.kind, mood: 'ask', lines: [`${nameOf(s)} necesita permiso`, `${D.req.cmd} · ${s.project}`], led: 'ask' }
        : { kind: s.kind, mood: 'ask', lines: [`${nameOf(s)} te hace una pregunta`, `Despliegue · ${s.project}`], led: 'ask' };
    }
    if (D.say && now < D.say.until) return { ...D.say, led: D.say.mood === 'done' ? 'done' : 'working' };
    if (D.menu) return { kind: 'claude', mood: 'idle', lines: ['Configuración'], led: '' };
    if (D.notice) { const s = sess(D.notice.sid); return { kind: s.kind, mood: 'done', lines: [`¡${nameOf(s)} terminó!`, `${s.project} · ${s.last}`], led: 'done' }; }
    const w = D.sessions.filter(s => s.state === 'working');
    if (!w.length) return { kind: 'claude', mood: 'idle', lines: ['Todo tranquilo'], led: '' };
    const s = w[Math.floor(now / 6000) % w.length];
    return { kind: s.kind, mood: 'working', lines: [`${nameOf(s)} en ${s.project}`, s.activity], led: 'working' };
  }

  function summary(list) {
    if (!list.length) return 'sin sesiones';
    for (const st of ['ask', 'error', 'working', 'done']) if (list.some(s => s.state === st)) return STATE_LABEL[st];
    return 'inactivo';
  }
  function renderDemo() {
    const n = D.nav, back = !(D.req || D.notice);
    let html;
    if (D.menu) {
      html = bar('Configuración', 'SELECT/B: cerrar', { back: true }) + menuRows(D.set, D.menu.cursor, false);
    } else if (D.req && D.req.type === 'question') {
      const s = sess(D.req.sid);
      html = bar(nameOf(s), s.project, { color: AGENTS[s.kind].color, mode: '' }) + questionCard(D.req.cursor);
    } else {
      if (n.level === 'agents') {
        html = bar('Agentes', `${D.sessions.length} sesiones`) + `<div class="grid${D.req || D.notice ? ' compact' : ''}">` +
          KINDS.map((k, i) => { const l = ofKind(k); return tile(k, { n: l.length, label: summary(l), cur: n.cursor === i, ask: l.some(s => s.state === 'ask') }); }).join('') + `</div>`;
      } else if (n.level === 'sessions') {
        const a = AGENTS[n.kind], l = ofKind(n.kind);
        html = bar(a.name, `${l.length} ${l.length === 1 ? 'sesión' : 'sesiones'}`, { color: a.color, back }) + `<div class="list">` +
          l.map((s, i) => `<div class="sess${n.cursor === i ? ' cur' : ''}${s.state === 'ask' ? ' ask' : ''}" data-sess="${s.id}">` +
            `<b>${s.project}</b><em class="st-${s.state}">${s.model} · ${STATE_LABEL[s.state]}</em><span>${s.activity}</span></div>`).join('') + `</div>`;
      } else {
        const s = sess(n.sid), a = AGENTS[s.kind];
        html = bar(a.name, s.project, { color: a.color, back }) +
          `<div class="detail"><p><b>Proyecto:</b> ${s.project}</p><p><b>Modelo:</b> ${s.model} · ${STATE_LABEL[s.state]}</p>` +
          `<p><b>Ahora:</b> ${s.activity}</p><p><b>Último mensaje:</b><br>${s.last}</p></div>`;
      }
      if (D.req) { const s = sess(D.req.sid); html += permCard(`${nameOf(s)} · ${s.project}`, D.req.cmd, AGENTS[s.kind].color); }
      else if (D.notice) { const s = sess(D.notice.sid); html += noticeCard(`${nameOf(s)} · ${s.project}`, D.notice.title, D.notice.text); }
    }
    demoLayer.innerHTML = html;
  }

  // una solicitud nueva reemplaza a la anterior: su sesión vuelve a trabajar (si no, quedaría "te espera" sin tarjeta)
  function release() { if (D.req) { const p = sess(D.req.sid); p.state = 'working'; p.activity = 'Trabajando'; D.req = null; } }
  const EVENTS = {
    perm() {
      release(); D.menu = null; D.say = null;
      sess('c1').state = 'ask'; sess('c1').activity = 'Pide permiso';
      D.req = { type: 'perm', sid: 'c1', cmd: 'npm install sharp' };
      chime([520, 520]);
    },
    done() {
      const s = sess('g1');
      s.state = 'done'; s.activity = 'Terminó su turno'; s.last = 'Formulario listo y probado.';
      if (D.set.notify === 3) return;                       // silencio: ni tarjeta ni sonido
      if (D.set.ack) { D.menu = null; D.notice = { sid: 'g1', title: 'Terminó', text: 'Formulario listo y probado. El envío valida el correo y muestra el error.' }; }
      else say('gemini', 'done', ['¡Gemini terminó!', 'otro-sitio · Formulario listo y probado.']);
      chime([660, 880]);
    },
    question() {
      release(); D.menu = null; D.say = null;
      sess('c2').state = 'ask'; sess('c2').activity = 'Espera tu respuesta';
      D.req = { type: 'question', sid: 'c2', cursor: 0 };
      chime([587, 784]);
    },
    quiet() {
      D.sessions = freshSessions(); D.sessions.forEach(s => { s.state = 'idle'; s.activity = 'Esperando instrucciones'; });
      D.req = D.notice = D.menu = D.say = null; D.nav = { level: 'agents', cursor: 0, kind: null, sid: null };
    },
  };

  function resolve(text1, text2, mood, state, activity) {
    const s = sess(D.req.sid);
    D.req = null; s.state = state; s.activity = activity;
    say(s.kind, mood, [text1, text2.replace('{a}', nameOf(s)).replace('{p}', s.project)], 3500);
  }
  function key(k) {
    const n = D.nav;
    if (D.req && D.req.type === 'perm') {
      if (k === 'A') resolve('Permiso aprobado', '{a} sigue en {p}', 'done', 'working', 'Instalando sharp');
      else if (k === 'Y') resolve('Aprobado, sin volver a preguntar', 'Bash(npm install sharp)', 'done', 'working', 'Instalando sharp');
      else if (k === 'B') resolve('Permiso rechazado', '{a} busca otra forma', 'working', 'working', 'Buscando otra forma');
    } else if (D.req) {
      const q = D.req;
      if (k === 'up') q.cursor = Math.max(0, q.cursor - 1);
      else if (k === 'down') q.cursor = Math.min(3, q.cursor + 1);
      else if (k === 'left' && q.cursor === 3) q.cursor = 2;
      else if (k === 'right' && q.cursor === 2) q.cursor = 3;
      else if (k === 'A') {
        if (q.cursor === 2) { say('claude', 'ask', ['En la consola se abre el teclado', 'Aquí elige una de las opciones'], 3000); D.say.over = true; }
        else if (q.cursor === 3) resolve('Se responde en el PC', '{a} muestra la pregunta allá', 'working', 'ask', 'Espera tu respuesta en el PC');
        else resolve('Respuesta enviada', q.cursor === 0 ? 'Vista previa' : 'Producción', 'done', 'working', q.cursor === 0 ? 'Publicando la vista previa' : 'Publicando en producción');
      }                                                     // B nunca responde ni rechaza una pregunta
    } else if (D.notice) {
      if (k === 'A') { const s = sess(D.notice.sid); D.notice = null; s.state = 'idle'; s.activity = 'Esperando instrucciones'; }
    } else if (D.menu) {
      const m = D.menu;
      if (k === 'up') m.cursor = Math.max(0, m.cursor - 1);
      else if (k === 'down') m.cursor = Math.min(2, m.cursor + 1);
      else if (k === 'B' || k === 'select') D.menu = null;
      else if (k === 'A' || k === 'left' || k === 'right') {
        if (m.cursor === 0) D.set.notify = (D.set.notify + (k === 'left' ? 3 : 1)) % 4;
        else if (m.cursor === 1) D.set.ack = !D.set.ack;
        else { D.set.sound = !D.set.sound; chime([660, 880]); }
      }
    } else if (k === 'select') D.menu = { cursor: 0 };
    else if (n.level === 'agents') {
      const move = { left: -1, right: 1, up: -3, down: 3 }[k];
      if (move) { const c = n.cursor + move; if (c >= 0 && c < KINDS.length) n.cursor = c; }
      else if (k === 'A' && ofKind(KINDS[n.cursor]).length) D.nav = { level: 'sessions', kind: KINDS[n.cursor], cursor: 0, sid: null };
    } else if (n.level === 'sessions') {
      const l = ofKind(n.kind);
      if (k === 'up') n.cursor = Math.max(0, n.cursor - 1);
      else if (k === 'down') n.cursor = Math.min(l.length - 1, n.cursor + 1);
      else if (k === 'A') D.nav = { ...n, level: 'detail', sid: l[n.cursor].id };
      else if (k === 'B') D.nav = { level: 'agents', cursor: KINDS.indexOf(n.kind), kind: null, sid: null };
    } else if (k === 'B') D.nav = { ...n, level: 'sessions', sid: null };
    renderDemo();
  }

  // toques en la pantalla de abajo (el lápiz), botones de la consola y de la página
  $('demo-bottom').addEventListener('click', e => {
    const t = e.target.closest('[data-key],[data-kind],[data-sess],[data-opt],[data-row],[data-act]');
    if (!t) return;
    const d = t.dataset;
    if (d.key) return key(d.key);
    if (d.opt !== undefined && D.req && D.req.type === 'question') { D.req.cursor = +d.opt; return key('A'); }
    if (d.row !== undefined && D.menu) { D.menu.cursor = +d.row; return key('A'); }
    if (d.act === 'read' && D.notice) { const s = sess(D.notice.sid); D.nav = { level: 'detail', kind: s.kind, sid: s.id, cursor: 0 }; D.notice = null; s.state = 'idle'; return renderDemo(); }
    if (D.req || D.notice || D.menu) return;                // con una tarjeta a la vista primero se responde
    if (d.kind && ofKind(d.kind).length) { D.nav = { level: 'sessions', kind: d.kind, cursor: 0, sid: null }; renderDemo(); }
    else if (d.sess) { const s = sess(d.sess); D.nav = { level: 'detail', kind: s.kind, sid: s.id, cursor: ofKind(s.kind).indexOf(s) }; renderDemo(); }
  });
  for (const id of ['demo-device', 'demo-keys']) {
    $(id).addEventListener('click', e => { const b = e.target.closest('button[data-key]'); if (b) key(b.dataset.key); });
  }
  $('demo-events').addEventListener('click', e => { const b = e.target.closest('button[data-ev]'); if (b) { EVENTS[b.dataset.ev](); renderDemo(); } });
  const KEYMAP = { arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', a: 'A', b: 'B', y: 'Y', s: 'select' };
  $('demo-device').addEventListener('keydown', e => {
    const k = KEYMAP[e.key.toLowerCase()];
    if (k && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); key(k); }
  });
  function sizeDemo() { $('demo-device').style.setProperty('--ds', String($('demo-wrap').clientWidth / 460)); }

  // =====================================================================================================
  // Arranque
  // =====================================================================================================
  if (RELEASES_URL) {
    const a = $('releases-link');
    a.href = RELEASES_URL; a.removeAttribute('aria-disabled'); a.textContent = 'Descargar Cronio para Windows';
    $('releases-sub').textContent = 'Desde las Releases de GitHub.';
  }

  let queued = false;
  const request = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; frame(); }); } };
  function resize() {
    W = innerWidth; H = innerHeight; mobile = W < 900;
    document.documentElement.classList.toggle('reduced', reduced.matches);
    sizeDemo();
    frame();
  }
  addEventListener('scroll', request, { passive: true });
  addEventListener('resize', resize);
  reduced.addEventListener('change', () => { heroCopy.removeAttribute('style'); cue.removeAttribute('style'); resize(); });

  // Scroll suave con Lenis (si cargó y no se pidió reducir el movimiento). Mueve la ventana de verdad, así que el
  // manejador de scroll de arriba sigue funcionando igual.
  if (window.Lenis && !reduced.matches) {
    const lenis = new window.Lenis({ lerp: 0.09, smoothWheel: true });
    document.documentElement.classList.add('lenis-on');
    const raf = t => { lenis.raf(t); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href^="#"]');
      const target = a && document.querySelector(a.getAttribute('href'));
      if (target) { e.preventDefault(); lenis.scrollTo(target); history.replaceState(null, '', a.getAttribute('href')); }
    });
  }

  const demoSection = $('demo');
  let lastSaid = '';
  function loop(t) {
    const still = reduced.matches;
    if (innerWidth !== W || innerHeight !== H) frame();
    if (stageVisible) storyFace.draw(t, still);
    const r = demoSection.getBoundingClientRect();
    if (r.bottom > 0 && r.top < H) {
      const st = demoFaceState(t);
      demoFace.set(st, t);
      demoFace.draw(t, still);
      $('demo-led').dataset.led = st.led || '';
      const said = st.lines.join('. ');   // lo que dice la cara
      if (said !== lastSaid) { lastSaid = said; $('demo-live').textContent = said; }
    }
    requestAnimationFrame(loop);
  }

  renderDemo();
  resize();
  requestAnimationFrame(loop);
})();

// Recorrido de producto guiado por el scroll. La consola es HTML y CSS en 3D; una "cámara" (un transform sobre el contenedor)
// pasa por planos distintos según el progreso del scroll. Solo se animan transform y opacity.
// Con prefers-reduced-motion no hay cámara: cada plano es un bloque estático con su encuadre fijo y su texto.
(() => {
  'use strict';
  const { AGENTS, $, reduced, bar, permCard, faceHTML, setFace, sessionRows } = window.Cronio;
  const story = $('story');
  const caps = story ? [...story.querySelectorAll('.cap')] : [];
  const N = caps.length;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = (x, a, b) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };

  // ---------- fotogramas clave: fx, fy = punto de la consola (460 x 608) al que mira la cámara; vis = ancho de consola que cabe en el encuadre ----------
  const KF = [
    { fx: 230, fy: 463, vis: 560, rx: 34, ry: -20, rz: 0, ox: .2, oy: .03, open: 0, sp: 0 },    // 0 cerrada, tres cuartos
    { fx: 385, fy: 345, vis: 380, rx: 12, ry: -56, rz: 0, ox: .26, oy: 0, open: 0, sp: 0 },     // 1 cerrada: canto y bisagra
    { fx: 230, fy: 304, vis: 680, rx: 20, ry: -20, rz: 0, ox: .17, oy: 0, open: 1, sp: 0 },     // 2 se abre
    { fx: 230, fy: 144, vis: 430, rx: 6, ry: 12, rz: 0, ox: .17, oy: 0, open: 1, sp: 0 },       // 3 pantalla de arriba
    { fx: 230, fy: 454, vis: 430, rx: 10, ry: -8, rz: 0, ox: .17, oy: 0, open: 1, sp: 0 },      // 4 pantalla de abajo: permiso
    { fx: 335, fy: 405, vis: 370, rx: 22, ry: -16, rz: 0, ox: -.18, oy: 0, open: 1, sp: 0 },    // 5 botones A y B
    { fx: 230, fy: 150, vis: 520, rx: 5, ry: -62, rz: 0, ox: .17, oy: 0, open: 1, sp: 1 },      // 6 de lado: profundidad
    { fx: 235, fy: 585, vis: 520, rx: 50, ry: -14, rz: 0, ox: -.12, oy: 0, open: 1, sp: 0 },     // 7 luces y ranuras del borde
    { fx: 230, fy: 454, vis: 430, rx: 4, ry: 14, rz: 0, ox: .17, oy: 0, open: 1, sp: 0 },       // 8 sesiones, tema oscuro
    { fx: 230, fy: 304, vis: 760, rx: 0, ry: 0, rz: 0, ox: .17, oy: 0, open: 1, sp: 0 },        // 9 plano general
  ];
  // Encuadres propios para pantallas angostas: la consola va arriba y el texto abajo.
  const MOB = [
    { vis: 700, oy: -.2 }, { vis: 520, oy: -.17 }, { vis: 600, oy: -.17 }, { vis: 450, oy: -.17 }, { vis: 410, oy: -.17 },
    { fx: 375, vis: 330, oy: -.17 }, { vis: 520, oy: -.17 }, { fx: 235, vis: 460, oy: -.17 }, { vis: 410, oy: -.17 }, { vis: 680, oy: -.15 },
  ].map(m => ({ ox: 0, ...m }));
  const keyframe = (i, mobile) => (mobile ? { ...KF[i], ...MOB[i] } : KF[i]);

  // ---------- la consola: sólidos hechos con láminas apiladas (ver styles.css) ----------
  const TB = 44, TL = 26, NB = 26, NL = 19, NLITE = 8;   // NLITE: láminas por mitad en la consola reducida (la de la transición)
  const STOPS = [[0, [241, 244, 248]], [.06, [223, 228, 235]], [.2, [203, 210, 219]], [.7, [174, 182, 195]], [1, [143, 152, 166]]];
  const edgeCol = t => {
    let j = 1; while (j < STOPS.length - 1 && STOPS[j][0] < t) j++;
    const [p0, c0] = STOPS[j - 1], [p1, c1] = STOPS[j], k = clamp((t - p0) / (p1 - p0));
    return `rgb(${c0.map((v, n) => Math.round(lerp(v, c1[n], k))).join(',')})`;
  };
  const EDGE = `linear-gradient(${STOPS.map(([p, c]) => `rgb(${c}) ${p * 100}%`).join(',')})`;
  const slices = (n, T) => Array.from({ length: n }, (_, i) => {
    const z = -(i + 1) * T / (n + 1);
    return `<i class="k-s" style="transform:translateZ(${z.toFixed(2)}px);background-color:${edgeCol(-z / T)}"></i>`;
  }).join('');
  const btn = (cls, txt = '', pos = '') => `<span class="k-btn ${cls}" style="${pos}"><i></i><i></i><i>${txt}</i></span>`;
  const dpad = '<span class="k-dp" style="left:11px;top:131px"><i></i><i></i><i></i></span>';
  const hinge = () => {
    const N = 12, r = 11;
    const faces = Array.from({ length: N }, (_, n) => {
      const th = n * 360 / N, rad = th * Math.PI / 180;
      // luz desde arriba y de frente: normal = (0, -sin, cos); luz = (0, -.5, .85)
      const l = clamp(Math.sin(rad) * .5 + Math.cos(rad) * .85, 0, 1);
      const c = [141, 150, 164].map((v, i) => Math.round(lerp(v, [250, 251, 253][i], Math.pow(l, .8))));
      return `<i class="k-hf" style="transform:rotateX(${th}deg) translateZ(${r}px);background:rgb(${c})"></i>`;
    }).join('');
    const collar = (x, a) => `<i class="k-hc" style="left:${x - 12.5}px;transform:rotateY(${a}deg)"></i>`;
    const caps = collar(-1, -90) + collar(-3, -90) + collar(-5, -90) + collar(381, 90) + collar(383, 90) + collar(385, 90) +
      '<i class="k-hd" style="left:-11px;transform:rotateY(-90deg)"></i><i class="k-hd" style="left:369px;transform:rotateY(90deg)"></i>';
    return `<div class="k-hinge">${faces}${caps}</div>`;
  };
  const trigger = x => {
    const L = Array.from({ length: 5 }, (_, n) => {
      const y = -8 + n * 1.9, c = Math.round(lerp(236, 190, n / 4));
      return `<i style="top:${y.toFixed(1)}px;background:rgb(${c},${c + 3},${c + 9});transform:translateZ(-28px) rotateX(-90deg)"></i>`;
    }).join('');
    return `<div class="k-trig" style="left:${x}px">${L}</div>`;
  };
  const logo = '<span class="logo k-lid-logo" aria-hidden="true"><span>CR<i></i>NI<i></i></span></span>';
  const deviceHTML = (lite = false) => `
    <div class="device kd" style="--edge:${EDGE}">
      <i class="k-sh k-sh-b" style="left:-50px;top:268px;width:560px;height:390px"></i>
      <i class="k-sh k-sh-l" style="left:-50px;top:-50px;width:560px;height:390px"></i>
      <div class="k-lid">
        ${slices(lite ? NLITE : NL, TL)}
        <div class="k-cap k-lfront">
          <div class="k-well" style="left:17px;top:11px;width:426px;height:266px"></div>
          <div class="k-bez" style="left:23px;top:17px;width:414px;height:254px"></div>
          <div class="screen top-screen">${lite ? '' : faceHTML('claude')}</div>
          <i class="k-glass" style="left:30px;top:24px;width:400px;height:240px"></i>
          <i class="k-dots" style="left:3px;top:150px"></i><i class="k-dots" style="left:445px;top:150px"></i>
          <i class="k-cam"></i><i class="k-mic" style="left:213px"></i><i class="k-mic" style="left:244px"></i>
          <i class="k-slot"></i><i class="k-knob"></i>
        </div>
        <div class="k-cap k-lback"><i class="k-panel"></i>${logo}<div class="k-sheen k-sheen-l"><i></i></div></div>
        <i class="k-edge k-lt"><i class="k-notch"></i></i>
      </div>
      ${hinge()}
      <div class="k-base">
        ${slices(lite ? NLITE : NB, TB)}
        <div class="k-cap k-btop">
          <div class="k-well" style="left:57px;top:3px;width:346px;height:266px"></div>
          <div class="k-bez" style="left:63px;top:9px;width:334px;height:254px"></div>
          <div class="screen bottom-screen">${lite ? '' : `
            <div class="bs" data-l="light">${bar('Claude', '4 sesiones', { color: AGENTS.claude.color, mode: '' })}<div class="list">${sessionRows()}</div></div>
            <div class="bs dark" data-l="dark">${bar('Claude', '4 sesiones', { color: AGENTS.claude.color, mode: '' })}<div class="list">${sessionRows()}</div></div>
            <div class="bs" data-l="perm">${bar('Claude', 'mi-portal', { color: AGENTS.claude.color, back: true, mode: '' })}
              <div class="detail"><p><b>Proyecto:</b> mi-portal</p><p><b>Ahora:</b> Pide permiso</p></div>${permCard('Claude · mi-portal', 'npm install sharp')}</div>
            <div class="flash"></div><div class="okmark">✓ Aprobado</div>`}
          </div>
          <i class="k-glass" style="left:70px;top:16px;width:320px;height:240px"></i>
          ${btn('big', '', 'left:13px;top:47px')}${dpad}
          ${btn('bX', 'X', 'left:421.5px;top:52.5px')}${btn('bY', 'Y', 'left:402.5px;top:71.5px')}${btn('bA', 'A', 'left:440.5px;top:71.5px')}${btn('bB', 'B', 'left:421.5px;top:90.5px')}
          ${btn('pill', '', 'left:150px;top:275px')}${btn('sm', '', 'left:223.5px;top:272.5px')}${btn('pill', '', 'left:282px;top:275px')}
          <div class="k-sheen k-sheen-b"><i></i></div>
        </div>
        <div class="k-cap k-bbot"></div>
        <i class="k-edge k-ef"><i class="k-ld pw" style="left:30px;top:18px"></i><i class="k-ld am" style="left:48px;top:18px"></i><i class="k-jack" style="left:330px;top:17px"></i></i>
        <i class="k-edge k-er"><i class="k-card"></i><i class="k-pen"></i></i>
        ${trigger(60)}${trigger(334)}
      </div>
    </div>`;

  // lite: consola reducida para la transición (pocas láminas, pantallas apagadas, sin estados de la historia)
  function makeRig(host, lite = false) {
    host.innerHTML = `<div class="cam">${deviceHTML(lite)}</div>`;
    const q = s => host.querySelector(s);
    const cam = q('.cam'), lid = q('.k-lid'), bA = q('.bA'), flash = q('.flash'), ok = q('.okmark');
    const ledPw = q('.k-ld.pw'), ledAm = q('.k-ld.am');
    const shB = q('.k-sh-b'), shL = q('.k-sh-l'), sheenB = q('.k-sheen-b i'), sheenL = q('.k-sheen-l i');
    const L = Object.fromEntries([...host.querySelectorAll('.bs')].map(e => [e.dataset.l, e]));
    const top = q('.top-screen');
    let faceKey = '';
    const faceFor = idx => {
      if (idx < 2.6) return ['working', 'Claude en mi-portal', 'Editando hero.astro'];
      if (idx < 3.6) return ['ask', 'Claude te espera', '¿Publico la rama o la reviso contigo?'];
      if (idx < 5.12) return ['ask', 'Claude necesita permiso', 'npm install sharp · mi-portal'];
      if (idx < 5.6) return ['done', 'Permiso aprobado', 'Claude sigue en mi-portal'];
      if (idx < 6.6) return ['working', 'Claude en mi-portal', 'Corriendo las pruebas'];
      if (idx < 7.6) return ['done', '¡Claude terminó!', 'mi-portal · 128 pruebas pasan'];
      return ['working', 'Claude en mi-portal', 'Editando hero.astro'];
    };
    return {
      // P: fotograma ya interpolado. vw, vh: tamaño del encuadre; areaW, areaH: espacio donde debe caber la consola.
      apply(P, idx, vw, vh, areaW, areaH) {
        const s = Math.min(areaW / P.vis, areaH / (P.vis * .72));
        cam.style.transform = `translate3d(${vw / 2 + P.ox * vw}px, ${vh / 2 + P.oy * vh}px, 0) scale3d(${s}, ${s}, ${s}) rotateX(${P.rx}deg) rotateY(${P.ry}deg) rotateZ(${P.rz}deg) translate3d(${-P.fx}px, ${-P.fy}px, 0)`;
        lid.style.transform = `rotateX(${-180 * (1 - P.open)}deg)`;
        cam.style.setProperty('--sp', P.sp.toFixed(3));
        // sombra de contacto y brillo especular: cambian con el plano
        shB.style.opacity = (.8 - Math.min(.35, Math.abs(P.ry) / 160)).toFixed(3);
        shL.style.opacity = (P.open * .7).toFixed(3);
        sheenB.style.transform = `translate3d(${(250 + P.ry * 7 - P.rx * 3).toFixed(1)}px, 0, 0) skewX(-20deg)`;
        sheenL.style.transform = `translate3d(${(250 - P.ry * 7 + P.rx * 3).toFixed(1)}px, 0, 0) skewX(-20deg)`;
        ledPw.classList.toggle('on', P.open > .5);
        if (lite) return;
        // estados que dependen del punto del recorrido
        const perm = smooth(idx, 3.5, 3.9) * (1 - smooth(idx, 5.1, 5.18));
        const dark = smooth(idx, 7.45, 7.85) - smooth(idx, 8.55, 8.9);
        L.perm.style.opacity = perm.toFixed(3);
        L.perm.style.visibility = perm > 0.01 ? 'visible' : 'hidden';
        L.dark.style.opacity = clamp(dark).toFixed(3);
        flash.style.opacity = (smooth(idx, 5.1, 5.15) * (1 - smooth(idx, 5.15, 5.45)) * .5).toFixed(3);
        ok.style.opacity = (smooth(idx, 5.12, 5.2) * (1 - smooth(idx, 5.5, 5.75))).toFixed(3);
        bA.classList.toggle('down', smooth(idx, 4.9, 5.0) - smooth(idx, 5.14, 5.24) > .5);
        ledAm.classList.toggle('on', idx > 6.55 && idx < 8.45);
        const f = faceFor(idx), k = f.join('|');
        if (k !== faceKey) { faceKey = k; setFace(top, 'claude', f[0], f[1], f[2]); }
      },
    };
  }

  function atIndex(idx, mobile) {
    const i = clamp(Math.floor(idx), 0, N - 2), f = idx - i;
    const e = smooth(f, .25, .75);
    const a = keyframe(i, mobile), b = keyframe(i + 1, mobile), P = {};
    for (const k in a) P[k] = lerp(a[k], b[k], e);
    return P;
  }

  // La transición de los saltos largos (app.js) arma su propia consola reducida con la misma construcción.
  window.CronioTour = { makeRig };
  if (!story) return;

  // =====================================================================================================
  if (reduced.matches) {
    // Sin cámara: un bloque por plano, con su encuadre fijo y su texto.
    story.classList.add('static');
    const rigs = [];
    caps.forEach((cap, i) => {
      const sec = document.createElement('section');
      sec.className = 'shot-static';
      sec.innerHTML = '<div class="vp" aria-hidden="true"><div class="cam-wrap"></div></div><div class="slot"></div>';
      sec.querySelector('.slot').append(cap);
      story.append(sec);
      rigs.push({ rig: makeRig(sec.querySelector('.cam-wrap')), vp: sec.querySelector('.vp'), i });
    });
    story.querySelector('.stage').remove();
    const draw = () => {
      for (const { rig, vp, i } of rigs) {
        const w = vp.clientWidth, h = vp.clientHeight, mobile = innerWidth < 900;
        const P = { ...keyframe(i, mobile), ox: 0, oy: 0 };
        rig.apply(P, i, w, h, w * .9, h * .9);
      }
    };
    draw();
    addEventListener('resize', draw);
    reduced.addEventListener('change', () => location.reload());
    return;
  }

  // ---------- con movimiento ----------
  // El scroll es el nativo del navegador: nunca se intercepta la rueda ni el tacto (no hay preventDefault). Aquí solo se LEE scrollY,
  // se calcula el progreso OBJETIVO y la cámara lo persigue con un suavizado exponencial independiente de los fps.
  const TAU = 140;          // ms: constante de tiempo de la cámara (la distancia a recorrer cae a 1/e cada TAU)
  const EPS = .0004;        // diferencia de progreso (en planos) por debajo de la cual el bucle se duerme
  const SNAP_PX = 2;        // si ya está a menos de esto de un plano, no se asienta
  const SNAP_QUIET = 140;   // ms sin eventos de scroll para dar el scroll por terminado (cuando no existe scrollend)
  const rig = makeRig($('cam-wrap'));
  const cue = $('scroll-cue');
  let storyTop = 0, total = 1, W = innerWidth, H = innerHeight, current = -1;
  let target = 0, shown = 0, drawn = NaN, lastT = -1, running = false;
  const stage = story.querySelector('.stage');
  const idxAt = y => clamp((y - storyTop) / total) * (N - 1);
  const planeY = i => Math.round(storyTop + (i / (N - 1)) * total + (i === 0 ? 0 : 1));
  const measure = () => {
    W = stage.clientWidth; H = stage.clientHeight;   // el encuadre real (100svh), no innerHeight: en el móvil cambia con la barra del navegador
    storyTop = story.getBoundingClientRect().top + scrollY;
    total = Math.max(1, story.offsetHeight - H);
    target = idxAt(scrollY);
  };
  // puntos laterales: cada uno salta a su plano (scroll nativo; el navegador lo anima)
  const dots = document.createElement('nav');
  dots.className = 'dots';
  dots.setAttribute('aria-label', 'Planos del recorrido');
  dots.innerHTML = caps.map((c, i) => `<button type="button" aria-label="${(c.querySelector('h1,h2').textContent || '').trim()}" title="${(c.querySelector('h1,h2').textContent || '').trim()}"${i === 0 ? ' aria-current="true"' : ''}></button>`).join('');
  stage.append(dots);
  const dotBtns = [...dots.children];
  dots.addEventListener('click', e => {
    const i = dotBtns.indexOf(e.target.closest('button'));
    if (i >= 0) scrollTo({ top: planeY(i), behavior: 'smooth' });
  });

  // Dibuja todo lo que depende del progreso a partir del progreso MOSTRADO (cámara, tapa, textos de cada plano).
  function draw() {
    if (shown === drawn) return;
    drawn = shown;
    const idx = shown, mobile = W < 900;
    const P = atIndex(idx, mobile);
    rig.apply(P, idx, W, H, mobile ? W * .94 : W * .56, mobile ? H * .5 : H * .78);
    caps.forEach((cap, i) => {
      const d = idx - i, o = 1 - clamp((Math.abs(d) - .3) / .2);
      const inner = cap.firstElementChild;
      inner.style.opacity = o.toFixed(3);
      inner.style.transform = `translate3d(0, ${(-d * 70).toFixed(1)}px, 0)`;
      if (cap.classList.contains('has-links')) cap.style.visibility = o > .02 ? 'visible' : 'hidden';
    });
    cue.style.opacity = String(1 - clamp(idx * 4));
    const near = Math.round(target);   // los puntos y el aria-current siguen al objetivo: responden al instante
    if (near !== current) {
      if (current >= 0) dotBtns[current].removeAttribute('aria-current');
      dotBtns[near].setAttribute('aria-current', 'true');
      current = near;
    }
  }
  // Bucle de la cámara: persigue el objetivo y se duerme cuando llega. Solo corre mientras hay algo que mover.
  function loop(now) {
    const dt = lastT < 0 ? 16 : clamp(now - lastT, 0, 64);
    lastT = now;
    const d = target - shown;
    if (Math.abs(d) < EPS) { shown = target; draw(); running = false; lastT = -1; return; }
    shown += d * (1 - Math.exp(-dt / TAU));
    draw();
    requestAnimationFrame(loop);
  }
  const wake = () => { if (!running) { running = true; lastT = -1; requestAnimationFrame(loop); } };
  const snapNow = () => { shown = target; drawn = NaN; draw(); };   // sin persecución: al cargar y al cambiar de tamaño

  // ---------- imán: al dejar de hacer scroll dentro del recorrido, la página se asienta en el plano más cercano ----------
  // Nada de scroll-snap en CSS (un snap en el documento estorbaría fuera del recorrido) ni de interceptar eventos: es un scrollTo suave.
  const hasScrollEnd = 'onscrollend' in window;
  let touching = false, dragging = false, asentando = false, lastScroll = 0, restY = scrollY, timer = 0;
  const cancelar = () => { asentando = false; };   // entrada nueva: el usuario manda (el navegador ya cancela el scroll suave solo)
  const armar = (ms, suave) => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (suave && performance.now() - lastScroll < SNAP_QUIET - 10) return; asentar(); }, ms);
  };
  function asentar() {
    if (asentando) { asentando = false; restY = scrollY; return; }   // fin de nuestro propio asentamiento: no se vuelve a disparar
    if (touching || dragging) return;
    const y = scrollY, from = restY;
    restY = y;
    const first = planeY(0), end = planeY(N - 1);
    if (y < first - SNAP_PX || y > end + SNAP_PX) return;   // fuera del recorrido: se sale libremente por arriba y por abajo
    const step = (end - first) / (N - 1);
    let i = clamp(Math.round((y - first) / step), 0, N - 1);
    if (Math.abs(planeY(i) - y) < SNAP_PX) return;           // ya está en un plano
    // Un empujón corto (un tick de rueda) no debe devolverte al plano de partida: si te alejaste lo suficiente, avanza al siguiente.
    const i0 = clamp(Math.round((from - first) / step), 0, N - 1), moved = y - from;
    if (i === i0 && Math.abs(moved) >= Math.min(step * .08, 70)) i = clamp(i0 + Math.sign(moved), 0, N - 1);
    const ty = planeY(i);
    if (Math.abs(ty - y) < SNAP_PX) return;
    asentando = true;
    scrollTo({ top: ty, behavior: 'smooth' });
    setTimeout(() => { asentando = false; }, 1200);   // por si el navegador no avisa del fin
  }
  addEventListener('wheel', cancelar, { passive: true });
  addEventListener('keydown', cancelar);
  addEventListener('touchstart', () => { touching = true; cancelar(); }, { passive: true });
  const soltar = () => { touching = false; armar(SNAP_QUIET + 20, true); };
  addEventListener('touchend', soltar, { passive: true });
  addEventListener('touchcancel', soltar, { passive: true });
  // barra de scroll arrastrada: el mousedown cae a la derecha del área de contenido
  addEventListener('mousedown', e => { if (e.button === 0 && e.clientX >= document.documentElement.clientWidth) { dragging = true; cancelar(); } });
  const finArrastre = () => { if (dragging) { dragging = false; armar(SNAP_QUIET, false); } };
  addEventListener('mouseup', finArrastre);
  addEventListener('blur', finArrastre);
  if (hasScrollEnd) addEventListener('scrollend', () => armar(0, false));

  addEventListener('scroll', () => {
    lastScroll = performance.now();
    target = idxAt(scrollY);
    wake();
    if (!hasScrollEnd) armar(SNAP_QUIET, false);
  }, { passive: true });
  const remeasure = () => { measure(); snapNow(); };
  addEventListener('resize', remeasure);
  addEventListener('load', remeasure);
  if (window.ResizeObserver) new ResizeObserver(remeasure).observe(stage);
  reduced.addEventListener('change', () => location.reload());
  measure();
  snapNow();
})();

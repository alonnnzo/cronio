// Recorrido de producto guiado por el scroll. La consola es HTML y CSS en 3D; una "cámara" (un transform sobre el contenedor)
// pasa por planos distintos según el progreso del scroll. Solo se animan transform y opacity.
// Con prefers-reduced-motion no hay cámara: cada plano es un bloque estático con su encuadre fijo y su texto.
(() => {
  'use strict';
  const { AGENTS, $, reduced, bar, permCard, faceHTML, setFace, sessionRows } = window.Cronio;
  const story = $('story');
  if (!story) return;
  const caps = [...story.querySelectorAll('.cap')];
  const N = caps.length;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = (x, a, b) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };

  // ---------- fotogramas clave: fx, fy = punto de la consola (460 x 580) al que mira la cámara; vis = ancho de consola que cabe en el encuadre ----------
  const KF = [
    { fx: 230, fy: 435, vis: 600, rx: 34, ry: -20, rz: 0, ox: .2, oy: .03, open: 0, sp: 0 },   // 0 cerrada, tres cuartos
    { fx: 230, fy: 290, vis: 650, rx: 20, ry: -20, rz: 0, ox: .22, oy: 0, open: 1, sp: 0 },     // 1 se abre
    { fx: 230, fy: 145, vis: 430, rx: 6, ry: 12, rz: 0, ox: .22, oy: 0, open: 1, sp: 0 },       // 2 pantalla de arriba
    { fx: 230, fy: 432, vis: 400, rx: 10, ry: -8, rz: 0, ox: .22, oy: 0, open: 1, sp: 0 },      // 3 pantalla de abajo: permiso
    { fx: 285, fy: 443, vis: 330, rx: 20, ry: -16, rz: 0, ox: -.18, oy: 0, open: 1, sp: 0 },     // 4 botones A y B
    { fx: 230, fy: 145, vis: 520, rx: 5, ry: -62, rz: 0, ox: .22, oy: 0, open: 1, sp: 1 },      // 5 de lado: profundidad
    { fx: 385, fy: 330, vis: 270, rx: 30, ry: -22, rz: 0, ox: -.22, oy: 0, open: 1, sp: 0 },     // 6 LED y bisagra
    { fx: 230, fy: 432, vis: 400, rx: 4, ry: 14, rz: 0, ox: .22, oy: 0, open: 1, sp: 0 },       // 7 sesiones, tema oscuro
    { fx: 230, fy: 290, vis: 740, rx: 0, ry: 0, rz: 0, ox: .22, oy: 0, open: 1, sp: 0 },        // 8 plano general
  ];
  // Encuadres propios para pantallas angostas: la consola va arriba y el texto abajo.
  const MOB = [
    { vis: 700, oy: -.2 }, { vis: 580, oy: -.17 }, { vis: 410, oy: -.17 }, { vis: 345, oy: -.17 }, { fx: 300, vis: 350, oy: -.17 },
    { vis: 500, oy: -.17 }, { fx: 360, vis: 260, oy: -.17 }, { vis: 345, oy: -.17 }, { vis: 650, oy: -.15 },
  ].map(m => ({ ox: 0, ...m }));
  const keyframe = (i, mobile) => (mobile ? { ...KF[i], ...MOB[i] } : KF[i]);

  // ---------- la consola ----------
  const logo = '<span class="logo lid-logo" aria-hidden="true"><span>CR<i></i>NI<i></i></span></span>';
  const edges = '<i class="e t"></i><i class="e l"></i><i class="e r"></i><i class="e b"></i>';
  const deviceHTML = () => `
    <div class="device tdev">
      <div class="lid">${edges}
        <div class="lid-front">
          <div class="speaker l"></div>
          <div class="screen top-screen">${faceHTML('claude')}</div>
          <div class="speaker r"></div>
        </div>
        <div class="lid-back">${logo}</div>
      </div>
      <div class="base">${edges}
        <div class="hinge"></div>
        <div class="pad"></div>
        <div class="dpad"><span></span><span></span></div>
        <div class="screen bottom-screen">
          <div class="bs" data-l="light">${bar('Claude', '4 sesiones', { color: AGENTS.claude.color, mode: '' })}<div class="list">${sessionRows()}</div></div>
          <div class="bs dark" data-l="dark">${bar('Claude', '4 sesiones', { color: AGENTS.claude.color, mode: '' })}<div class="list">${sessionRows()}</div></div>
          <div class="bs" data-l="perm">${bar('Claude', 'mi-portal', { color: AGENTS.claude.color, back: true, mode: '' })}
            <div class="detail"><p><b>Proyecto:</b> mi-portal</p><p><b>Ahora:</b> Pide permiso</p></div>${permCard('Claude · mi-portal', 'npm install sharp')}</div>
          <div class="flash"></div><div class="okmark">✓ Aprobado</div>
        </div>
        <div class="face-btns"><span>X</span><span>Y</span><span class="bA">A</span><span class="bB">B</span></div>
        <div class="pills"><span></span><span></span><span></span></div>
        <div class="led"></div>
      </div>
    </div>`;

  function makeRig(host) {
    host.innerHTML = `<div class="cam">${deviceHTML()}</div>`;
    const q = s => host.querySelector(s);
    const cam = q('.cam'), lid = q('.lid'), led = q('.led'), bA = q('.bA'), flash = q('.flash'), ok = q('.okmark');
    const L = Object.fromEntries([...host.querySelectorAll('.bs')].map(e => [e.dataset.l, e]));
    const top = q('.top-screen');
    let faceKey = '';
    const faceFor = idx => {
      if (idx < 1.6) return ['working', 'Claude en mi-portal', 'Editando hero.astro'];
      if (idx < 2.6) return ['ask', 'Claude te espera', '¿Publico la rama o la reviso contigo?'];
      if (idx < 4.12) return ['ask', 'Claude necesita permiso', 'npm install sharp · mi-portal'];
      if (idx < 4.6) return ['done', 'Permiso aprobado', 'Claude sigue en mi-portal'];
      if (idx < 5.6) return ['working', 'Claude en mi-portal', 'Corriendo las pruebas'];
      if (idx < 6.6) return ['done', '¡Claude terminó!', 'mi-portal · 128 pruebas pasan'];
      return ['working', 'Claude en mi-portal', 'Editando hero.astro'];
    };
    return {
      // P: fotograma ya interpolado. vw, vh: tamaño del encuadre; areaW, areaH: espacio donde debe caber la consola.
      apply(P, idx, vw, vh, areaW, areaH) {
        const s = Math.min(areaW / P.vis, areaH / (P.vis * .72));
        cam.style.transform = `translate3d(${vw / 2 + P.ox * vw}px, ${vh / 2 + P.oy * vh}px, 0) scale3d(${s}, ${s}, ${s}) rotateX(${P.rx}deg) rotateY(${P.ry}deg) rotateZ(${P.rz}deg) translate3d(${-P.fx}px, ${-P.fy}px, 0)`;
        lid.style.transform = `rotateX(${-178 * (1 - P.open)}deg)`;
        cam.style.setProperty('--sp', P.sp.toFixed(3));
        // estados que dependen del punto del recorrido
        const perm = smooth(idx, 2.5, 2.9) * (1 - smooth(idx, 4.1, 4.18));
        const dark = smooth(idx, 6.45, 6.85) - smooth(idx, 7.55, 7.9);
        L.perm.style.opacity = perm.toFixed(3);
        L.perm.style.visibility = perm > 0.01 ? 'visible' : 'hidden';
        L.dark.style.opacity = clamp(dark).toFixed(3);
        flash.style.opacity = (smooth(idx, 4.1, 4.15) * (1 - smooth(idx, 4.15, 4.45)) * .5).toFixed(3);
        ok.style.opacity = (smooth(idx, 4.12, 4.2) * (1 - smooth(idx, 4.5, 4.75))).toFixed(3);
        bA.classList.toggle('down', smooth(idx, 3.9, 4.0) - smooth(idx, 4.14, 4.24) > .5);
        led.classList.toggle('on', idx > 5.55 && idx < 7.45);
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
  const rig = makeRig($('cam-wrap'));
  let queued = false;
  function frame() {
    queued = false;
    const W = innerWidth, H = innerHeight, mobile = W < 900;
    const rect = story.getBoundingClientRect();
    const total = story.offsetHeight - H;
    const idx = total > 0 ? clamp(-rect.top / total) * (N - 1) : 0;
    const P = atIndex(idx, mobile);
    rig.apply(P, idx, W, H, mobile ? W * .94 : W * .56, mobile ? H * .5 : H * .78);
    caps.forEach((cap, i) => {
      const d = idx - i, o = 1 - clamp((Math.abs(d) - .3) / .2);
      const inner = cap.firstElementChild;
      inner.style.opacity = o.toFixed(3);
      inner.style.transform = `translate3d(0, ${(-d * 70).toFixed(1)}px, 0)`;
      if (cap.classList.contains('has-links')) cap.style.visibility = o > .02 ? 'visible' : 'hidden';
    });
    $('scroll-cue').style.opacity = String(1 - clamp(idx * 4));
  }
  const request = () => { if (!queued) { queued = true; requestAnimationFrame(frame); } };
  addEventListener('scroll', request, { passive: true });
  addEventListener('resize', request);
  reduced.addEventListener('change', () => location.reload());
  frame();
})();

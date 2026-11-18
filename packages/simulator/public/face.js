// Pantalla superior (400x240): toda la pantalla es la cara del agente. Referencia: art/cara/index.html.
//
// Este módulo es la referencia para portar el dibujo a C en la 3DS: solo usa operaciones simples del
// contexto 2D (fillRect, arc, ellipse, líneas, fillText, save/translate/scale/restore, globalAlpha),
// sin DOM, red ni temporizadores. El tiempo entra como parámetro (timeMs) y el único estado propio
// vive en `localState`.
//
// localState (lo crea createLocalState() y lo actualiza drawFace):
//   {
//     color: [r, g, b] | null,   // color de fondo actual (0..255); null = aún no se dibujó (la primera vez no hay transición)
//     lastMs: number | null,     // timeMs de la llamada anterior (para que la transición dure lo mismo a cualquier fps)
//     bubbleKey: string,         // texto + ánimo del globo que se está mostrando
//     bubbleSince: number,       // timeMs en que apareció ese globo (para la animación de entrada)
//     reducedMotion: boolean,    // true: sin saltos, temblor, parpadeo ni animación de globo; flotar y mirar, mucho menos
//   }
//
// face = { kind: AgentKind | null, mood: 'idle'|'working'|'ask'|'done'|'error', lines: string[1..2] }

export const SCREEN_W = 400;
export const SCREEN_H = 240;

export const AGENT_STYLES = {
  claude: { name: 'Claude', color: '#ee7446' },
  gemini: { name: 'Gemini', color: '#5b8cff' },
  codex: { name: 'Codex', color: '#2fd08a' },
  cursor: { name: 'Cursor', color: '#c9ced9' },
  hermes: { name: 'Hermes', color: '#f6c544' },
};
export const NEUTRAL_COLOR = '#3a3d52';   // sin agente (kind null): gris neutro

// ---------- paleta ----------
const INK = '#12131a';                    // ojos y boca
const EYE_GLINT = 'rgba(255,255,255,.85)';
const BUBBLE_FILL = '#ffffff';
const BUBBLE_BORDER = '#C9CFD8';          // Línea
const BUBBLE_BORDER_W = 2;
const BUBBLE_TITLE = '#2F343C';           // grafito
const BUBBLE_SUB = '#6B737F';             // gris
const FONT = '"M PLUS Rounded 1c",system-ui,sans-serif';   // en la 3DS: la letra del sistema
const TWO_PI = Math.PI * 2;

// ---------- constantes de movimiento (ms, píxeles, radianes) ----------
const FRAME_MS = 1000 / 60;               // el factor de suavizado del color está medido por cuadro a 60 fps
const COLOR_EASE = 0.08;                  // fracción que el color recorre hacia el destino en cada cuadro
const MAX_DT = 250;                       // un salto de tiempo mayor (pestaña dormida) se trata como 250 ms
const DIM = { idle: 0.55, working: 1, ask: 1, done: 1, error: 0.8 };   // brillo del color por ánimo
const SHEEN_X = 110;                      // brillo suave arriba a la izquierda: círculos concéntricos translúcidos
const SHEEN_Y = 50;
const SHEEN_RADII = [30, 70, 115, 165, 225];
const SHEEN_ALPHA = 0.045;                // cada círculo suma esta opacidad blanca (en el centro ~0.22)
const ASK_PULSE_PERIOD = 180;             // pide permiso: la pantalla pulsa, seno de t / 180
const ASK_PULSE_BASE = 0.10;
const ASK_PULSE_AMPLITUDE = 0.10;
const SHAKE_PERIOD = 35;                  // error: temblor horizontal, seno de t / 35
const SHAKE_AMPLITUDE = 3;
const BOB_PERIOD = 900;                   // flotación de la cara, seno de t / 900
const BOB_AMPLITUDE = 3;
const EYE_X = 200;                        // centro entre los ojos
const EYE_Y = 78;
const EYE_SPACING = 62;                   // cada ojo a +-62 px del centro
const EYE_RX = 15;                        // ojo abierto: elipse
const EYE_RY = 22;
const EYE_ASK_SCALE = 1.18;               // ojos más grandes al pedir permiso
const EYE_GLINT_DX = -5;                  // brillo del ojo, respecto al centro
const EYE_GLINT_DY = -8;
const EYE_GLINT_R = 4.5;
const EYE_LINE_WIDTH = 9;
const ASK_JUMP_PERIOD = 260;              // pide permiso: salto |seno(t / 260)|
const ASK_JUMP_HEIGHT = 6;
const LOOK_WORK_PERIOD = 500;             // trabajando: los ojos leen de lado a lado
const LOOK_WORK_AMPLITUDE = 9;
const LOOK_IDLE_PERIOD = 2300;            // resto de ánimos: mirada lenta
const LOOK_IDLE_AMPLITUDE = 5;
const BLINK_PERIOD = 3600;                // parpadeo: ojos cerrados los últimos 130 ms de cada 3600
const BLINK_MS = 130;
const MOUTH_X = 200;
const MOUTH_Y = 120;
const MOUTH_LINE_WIDTH = 5;
const REDUCED_FACTOR = 0.25;              // movimiento reducido: flotar y mirar al 25 %; sin salto, temblor ni parpadeo
const REDUCED_PULSE = 0.15;               // movimiento reducido: la pantalla de "pide permiso" queda fija a esta opacidad

// ---------- globo de texto ----------
const BUBBLE_CX = 200;
const BUBBLE_CY = 196;
const BUBBLE_W = 360;
const BUBBLE_H = 60;
const BUBBLE_R = 14;                      // radio de las esquinas
const BUBBLE_TAIL_W = 16;                 // semiancho de la punta
const BUBBLE_TAIL_H = 15;                 // la punta sobresale por arriba
const BUBBLE_POP_MS = 180;                // entrada: aparece y crece de 90 % a 100 % en 180 ms
const BUBBLE_POP_FROM = 0.9;
const BUBBLE_TALL_BOTTOM = 232;           // con 3 o 4 líneas (la pregunta): el pie queda fijo y el globo crece hacia arriba
const BUBBLE_TALL_BASE_H = 35;
const BUBBLE_TALL_PITCH = 15;             // separación entre las líneas de la pregunta
const BUBBLE_TEXT_W = 340;                // ancho disponible para el texto
const CHAR_W_BOLD = 0.6;                  // ancho medio de un carácter en negrita (x tamaño); sin medir texto, portable
const CHAR_W_REGULAR = 0.55;
const SINGLE_SIZE = 17;                   // una sola línea
const TITLE_SIZE = 16;                    // título de dos líneas
const SUB_SIZE = 13;                      // segunda línea
const MIN_SIZE = 11;
const TEXT_MAX_CHARS = 46;                // defensa: más largo se corta con puntos suspensivos

const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

export function createLocalState() {
  return { color: null, lastMs: null, bubbleKey: '', bubbleSince: 0, reducedMotion: false };
}

function normalizeFace(face) {
  const mood = face && DIM[face.mood] !== undefined ? face.mood : 'idle';
  const kind = face && face.kind && AGENT_STYLES[face.kind] ? face.kind : null;
  const lines = face && Array.isArray(face.lines) && face.lines.length ? face.lines.slice(0, 4).map(String) : [''];
  return { kind, mood, lines };
}

const cut = s => (s.length > TEXT_MAX_CHARS ? s.slice(0, TEXT_MAX_CHARS - 1) + '…' : s);
const fitSize = (text, base, charW) => Math.max(MIN_SIZE, Math.min(base, Math.floor(BUBBLE_TEXT_W / (Math.max(1, text.length) * charW))));

// ---------- cajas (para comprobar que nada se tapa) ----------
// Cajas que ocupa cada parte en el peor caso (con flotación y temblor al máximo).

export function mouthBox() {
  const pad = MOUTH_LINE_WIDTH / 2;
  const x0 = MOUTH_X - 12 - pad - SHAKE_AMPLITUDE, x1 = MOUTH_X + 12 + pad + SHAKE_AMPLITUDE;
  const y0 = MOUTH_Y - BOB_AMPLITUDE - 4 - pad, y1 = MOUTH_Y + BOB_AMPLITUDE + 8 + pad;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function eyesBox() {
  const rx = EYE_SPACING + EYE_RX * EYE_ASK_SCALE + EYE_LINE_WIDTH / 2 + LOOK_WORK_AMPLITUDE + SHAKE_AMPLITUDE;
  const top = EYE_Y - BOB_AMPLITUDE - ASK_JUMP_HEIGHT - EYE_RY * EYE_ASK_SCALE;
  const bottom = EYE_Y + BOB_AMPLITUDE + EYE_RY * EYE_ASK_SCALE;   // lo más bajo es el ojo grande de "pide permiso"
  return { x: EYE_X - rx, y: top, w: rx * 2, h: bottom - top };
}

// Centro vertical y alto del cuerpo del globo según sus líneas: con 1 o 2 es el de siempre; con 3 o 4 crece hacia arriba.
function bubbleGeom(lines) {
  if (lines <= 2) return { cy: BUBBLE_CY, h: BUBBLE_H };
  const h = BUBBLE_TALL_BASE_H + BUBBLE_TALL_PITCH * (lines - 1);
  return { cy: BUBBLE_TALL_BOTTOM - h / 2, h };
}

// Globo con su punta, a tamaño completo. Depende solo del número de líneas (2 por defecto).
export function bubbleBox(lines = 2) {
  const { cy, h } = bubbleGeom(lines);
  return { x: BUBBLE_CX - BUBBLE_W / 2, y: cy - h / 2 - BUBBLE_TAIL_H, w: BUBBLE_W, h: h + BUBBLE_TAIL_H };
}

export const boxesOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ---------- dibujo ----------
function roundedRect(ctx, x, y, w, h, r) {
  // sin arcTo: dos rectángulos y cuatro cuartos de círculo
  ctx.fillRect(x + r, y, w - 2 * r, h);
  ctx.fillRect(x, y + r, w, h - 2 * r);
  for (const [cx, cy, a] of [[x + r, y + r, Math.PI], [x + w - r, y + r, Math.PI * 1.5], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI * 0.5]]) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a, a + Math.PI / 2);
    ctx.closePath();
    ctx.fill();
  }
}

function updateColor(local, targetRgb, timeMs) {
  if (!local.color) {
    local.color = targetRgb.slice();
  } else {
    const dt = local.lastMs === null ? FRAME_MS : Math.min(MAX_DT, Math.max(0, timeMs - local.lastMs));
    const k = 1 - Math.pow(1 - COLOR_EASE, dt / FRAME_MS);
    local.color = local.color.map((v, i) => v + (targetRgb[i] - v) * k);
  }
  local.lastMs = timeMs;
}

export function drawFace(ctx, faceIn, timeMs, local) {
  const face = normalizeFace(faceIn);
  const mood = face.mood;
  const t = timeMs;
  const reduced = !!local.reducedMotion;
  const motion = reduced ? REDUCED_FACTOR : 1;

  // fondo: todo del color del agente, con transición suave
  updateColor(local, hexToRgb(face.kind ? AGENT_STYLES[face.kind].color : NEUTRAL_COLOR), t);
  const dim = DIM[mood];
  ctx.fillStyle = `rgb(${local.color.map(v => Math.round(v * dim)).join(',')})`;
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  ctx.fillStyle = `rgba(255,255,255,${SHEEN_ALPHA})`;
  for (const r of SHEEN_RADII) { ctx.beginPath(); ctx.arc(SHEEN_X, SHEEN_Y, r, 0, TWO_PI); ctx.fill(); }
  if (mood === 'ask') {
    const a = reduced ? REDUCED_PULSE : ASK_PULSE_BASE + ASK_PULSE_AMPLITUDE * Math.sin(t / ASK_PULSE_PERIOD);
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  }

  // movimiento de la cara
  const shake = mood === 'error' && !reduced ? Math.sin(t / SHAKE_PERIOD) * SHAKE_AMPLITUDE : 0;
  const bob = Math.sin(t / BOB_PERIOD) * BOB_AMPLITUDE * motion;
  const jump = mood === 'ask' && !reduced ? -Math.abs(Math.sin(t / ASK_JUMP_PERIOD)) * ASK_JUMP_HEIGHT : 0;
  const ey = EYE_Y + bob + jump;
  const look = (mood === 'working' ? Math.sin(t / LOOK_WORK_PERIOD) * LOOK_WORK_AMPLITUDE
    : mood === 'ask' ? 0 : Math.sin(t / LOOK_IDLE_PERIOD) * LOOK_IDLE_AMPLITUDE) * motion;
  const blink = !reduced && (t % BLINK_PERIOD) > BLINK_PERIOD - BLINK_MS;

  // ojos
  ctx.lineCap = 'round';
  ctx.lineWidth = EYE_LINE_WIDTH;
  for (const d of [-1, 1]) {
    const ex = EYE_X + d * EYE_SPACING + look + shake;
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    if (mood === 'error') {              // cruces
      ctx.moveTo(ex - 15, ey - 15); ctx.lineTo(ex + 15, ey + 15);
      ctx.moveTo(ex + 15, ey - 15); ctx.lineTo(ex - 15, ey + 15);
      ctx.stroke();
    } else if (mood === 'done') {        // ojos sonrientes: arco hacia arriba
      ctx.arc(ex, ey + 10, 18, Math.PI, TWO_PI);
      ctx.stroke();
    } else if (mood === 'idle' || blink) {   // cerrados
      ctx.moveTo(ex - 17, ey + 4); ctx.lineTo(ex + 17, ey + 4);
      ctx.stroke();
    } else {                             // abiertos, con brillo
      const s = mood === 'ask' ? EYE_ASK_SCALE : 1;
      ctx.ellipse(ex, ey, EYE_RX * s, EYE_RY * s, 0, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = EYE_GLINT;
      ctx.beginPath();
      ctx.arc(ex + EYE_GLINT_DX, ey + EYE_GLINT_DY, EYE_GLINT_R, 0, TWO_PI);
      ctx.fill();
    }
  }

  // boca pequeña
  const my = MOUTH_Y + bob, mx = MOUTH_X + shake;
  ctx.strokeStyle = INK;
  ctx.lineWidth = MOUTH_LINE_WIDTH;
  ctx.beginPath();
  if (mood === 'done') ctx.arc(mx, my - 4, 12, 0.15 * Math.PI, 0.85 * Math.PI);          // sonrisa
  else if (mood === 'ask') ctx.ellipse(mx, my + 2, 5, 6, 0, 0, TWO_PI);                   // "o"
  else if (mood === 'error') { ctx.moveTo(mx - 12, my + 4); ctx.quadraticCurveTo(mx, my - 6, mx + 12, my + 4); }   // boca triste
  else { ctx.moveTo(mx - 8, my); ctx.lineTo(mx + 8, my); }                                // línea
  ctx.stroke();

  drawBubble(ctx, face, t, local, reduced);
}

function drawBubble(ctx, face, t, local, reduced) {
  const lines = face.lines.map(cut);
  const key = face.mood + '\n' + lines.join('\n');
  if (key !== local.bubbleKey) { local.bubbleKey = key; local.bubbleSince = t; }
  const age = reduced ? 1 : Math.min(1, Math.max(0, (t - local.bubbleSince) / BUBBLE_POP_MS));
  const scale = BUBBLE_POP_FROM + (1 - BUBBLE_POP_FROM) * age;

  ctx.save();
  const { cy, h: bh } = bubbleGeom(lines.length);
  ctx.translate(BUBBLE_CX, cy);
  ctx.scale(scale, scale);
  ctx.globalAlpha = age;
  // borde Línea: la misma forma un poco más grande, y encima el relleno blanco
  const bw = BUBBLE_BORDER_W;
  for (const [fill, g] of [[BUBBLE_BORDER, bw], [BUBBLE_FILL, 0]]) {
    ctx.fillStyle = fill;
    roundedRect(ctx, -BUBBLE_W / 2 - g, -bh / 2 - g, BUBBLE_W + 2 * g, bh + 2 * g, BUBBLE_R + g);
    ctx.beginPath();
    ctx.moveTo(-BUBBLE_TAIL_W - g, -bh / 2 + 1);
    ctx.lineTo(0, -bh / 2 - BUBBLE_TAIL_H + 1 - g);
    ctx.lineTo(BUBBLE_TAIL_W + g, -bh / 2 + 1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.textAlign = 'center';
  if (lines.length === 1) {
    const size = fitSize(lines[0], SINGLE_SIZE, CHAR_W_BOLD);
    ctx.fillStyle = BUBBLE_TITLE;
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.fillText(lines[0], 0, Math.round(size * 0.35));
  } else if (lines.length > 2) {
    // pregunta en varias líneas: título arriba y cada línea de la pregunta debajo
    const size = fitSize(lines[0], TITLE_SIZE, CHAR_W_BOLD);
    ctx.fillStyle = BUBBLE_TITLE;
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.fillText(lines[0], 0, -bh / 2 + 22);
    for (let i = 1; i < lines.length; i++) {
      const sub = fitSize(lines[i], SUB_SIZE, CHAR_W_REGULAR);
      ctx.fillStyle = BUBBLE_SUB;
      ctx.font = `${sub}px ${FONT}`;
      ctx.fillText(lines[i], 0, -bh / 2 + 22 + 4 + BUBBLE_TALL_PITCH * i);
    }
  } else {
    const size = fitSize(lines[0], TITLE_SIZE, CHAR_W_BOLD);
    ctx.fillStyle = BUBBLE_TITLE;
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.fillText(lines[0], 0, -5);
    const sub = fitSize(lines[1], SUB_SIZE, CHAR_W_REGULAR);
    ctx.fillStyle = BUBBLE_SUB;
    ctx.font = `${sub}px ${FONT}`;
    ctx.fillText(lines[1], 0, 16);
  }
  ctx.restore();
}

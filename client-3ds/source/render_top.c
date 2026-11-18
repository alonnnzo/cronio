#include "render_top.h"

#include <math.h>
#include <string.h>

#include "logic/face_math.h"
#include "logic/palette.h"
#include "logic/stereo.h"
#include "logic/utf8util.h"
#include "ui_draw.h"
#include "ui_text.h"

#define INK 0x12131au
#define BUBBLE_TITLE (pal()->bubble_title)
#define BUBBLE_SUB (pal()->bubble_sub)
#define BUBBLE_LINE (pal()->bubble_line) // borde de 2 px del globo
#define EM 26.0f // píxeles de "font-size" del simulador por escala 1 de la fuente del sistema (celda de 30 px)

static FaceLocal g_local;
static int g_init;

// ex ya lleva el desplazamiento 3D de los ojos; el brillo va un poco más adelante (dxg px más).
static void draw_eye(const FaceFrame *f, float ex, float ey, float dxg) {
  u32 ink = ui_rgb(INK, 1.0f);
  const float w = FACE_EYE_LINE_WIDTH;
  switch (f->mood) {
    case MOOD_ERROR: // cruces
      ui_line_round(ex - 15, ey - 15, ex + 15, ey + 15, w, ink);
      ui_line_round(ex + 15, ey - 15, ex - 15, ey + 15, w, ink);
      return;
    case MOOD_DONE: // ojos sonrientes: arco hacia arriba
      ui_arc(ex, ey + 10, 18, 18, (float)M_PI, (float)(2.0 * M_PI), w, ink);
      return;
    default:
      break;
  }
  if (f->mood == MOOD_IDLE || f->blink) { // cerrados
    ui_line_round(ex - 17, ey + 4, ex + 17, ey + 4, w, ink);
    return;
  }
  float s = f->mood == MOOD_ASK ? FACE_EYE_ASK_SCALE : 1.0f; // abiertos, con brillo
  C2D_DrawEllipseSolid(ex - FACE_EYE_RX * s, ey - FACE_EYE_RY * s, 0.0f, FACE_EYE_RX * 2 * s, FACE_EYE_RY * 2 * s, ink);
  C2D_DrawCircleSolid(ex + dxg + FACE_EYE_GLINT_DX, ey + FACE_EYE_GLINT_DY, 0.0f, FACE_EYE_GLINT_R, ui_rgb(0xffffff, 0.85f));
}

static void draw_mouth(const FaceFrame *f, float mx, float my) {
  u32 ink = ui_rgb(INK, 1.0f);
  const float w = FACE_MOUTH_LINE_WIDTH;
  switch (f->mood) {
    case MOOD_DONE: // sonrisa
      ui_arc(mx, my - 4, 12, 12, (float)(0.15 * M_PI), (float)(0.85 * M_PI), w, ink);
      break;
    case MOOD_ASK: // "o"
      ui_ellipse_outline(mx, my + 2, 5, 6, w, ink);
      break;
    case MOOD_ERROR: { // boca triste: curva cuadrática de (mx-12, my+4) a (mx+12, my+4) con control (mx, my-6)
      float pts[2 * 11];
      for (int i = 0; i <= 10; i++) {
        float t = (float)i / 10.0f, u = 1.0f - t;
        pts[2 * i] = u * u * (mx - 12) + 2 * u * t * mx + t * t * (mx + 12);
        pts[2 * i + 1] = u * u * (my + 4) + 2 * u * t * (my - 6) + t * t * (my + 4);
      }
      ui_polyline(pts, 11, w, ink, 0);
      break;
    }
    default:
      ui_line_round(mx - 8, my, mx + 8, my, w, ink);
      break;
  }
}

// dxb: desplazamiento 3D del globo (borde, punta y texto se mueven juntos).
static void draw_bubble(const FaceView *face, const FaceFrame *f, double t, float dxb) {
  char ln[VIEW_MAX_FACE_LINES][VIEW_TEXT_BYTES + 4];
  char rest[(VIEW_TEXT_BYTES + 4) * (VIEW_MAX_FACE_LINES - 1)] = "";
  int lines = face->line_count < 1 ? 1 : face->line_count > VIEW_MAX_FACE_LINES ? VIEW_MAX_FACE_LINES : face->line_count;
  for (int i = 0; i < lines; i++) {
    utf8_clip(face->line_count >= 1 ? face->lines[i] : "", ln[i], sizeof ln[i], FACE_TEXT_MAX_CHARS);
    if (i >= 1) {
      if (i > 1) strncat(rest, "\n", sizeof rest - strlen(rest) - 1);
      strncat(rest, ln[i], sizeof rest - strlen(rest) - 1);
    }
  }
  BubbleAnim a = face_bubble_anim(&g_local, f->mood, ln[0], lines >= 2 ? rest : NULL, t);
  float bh, cy;
  face_bubble_geom(lines, &cy, &bh);
  float s = a.scale, cx = FACE_BUBBLE_CX + dxb;
  // globo blanco con borde Línea de 2 px: el mismo rectángulo redondeado, 2 px más grande, debajo; la punta igual
  u32 white = ui_rgb(pal()->bubble_fill, a.alpha), line = ui_rgb(BUBBLE_LINE, a.alpha);
  float bx = cx - FACE_BUBBLE_W / 2.0f * s, by = cy - bh / 2.0f * s, bw = FACE_BUBBLE_W * s, bhs = bh * s, bd = 2.0f * s;
  float base = by + 2.0f * s; // la punta empieza dentro del borde, para que lo tape
  C2D_DrawTriangle(cx - (FACE_BUBBLE_TAIL_W + 2.0f) * s, base, line, cx, base - (FACE_BUBBLE_TAIL_H + 3.5f) * s, line,
                   cx + (FACE_BUBBLE_TAIL_W + 2.0f) * s, base, line, 0.0f);
  ui_rrect(bx - bd, by - bd, bw + 2 * bd, bhs + 2 * bd, FACE_BUBBLE_R * s + bd, line);
  ui_rrect(bx, by, bw, bhs, FACE_BUBBLE_R * s, white);
  C2D_DrawTriangle(cx - FACE_BUBBLE_TAIL_W * s, base, white, cx, base - (FACE_BUBBLE_TAIL_H + 1.0f) * s, white,
                   cx + FACE_BUBBLE_TAIL_W * s, base, white, 0.0f);
  float max_w = FACE_BUBBLE_TEXT_W * s;
  if (lines == 1) {
    float size = 17.0f;
    ui_text_draw_baseline(ln[0], cx, cy + roundf(size * 0.35f) * s, size / EM * s, 11.0f / EM * s, max_w, ui_rgb(BUBBLE_TITLE, a.alpha), UI_ALIGN_CENTER);
  } else if (lines == 2) {
    ui_text_draw_baseline(ln[0], cx, cy - 5.0f * s, 16.0f / EM * s, 11.0f / EM * s, max_w, ui_rgb(BUBBLE_TITLE, a.alpha), UI_ALIGN_CENTER);
    ui_text_draw_baseline(ln[1], cx, cy + 16.0f * s, 13.0f / EM * s, 11.0f / EM * s, max_w, ui_rgb(BUBBLE_SUB, a.alpha), UI_ALIGN_CENTER);
  } else {
    // pregunta en varias líneas: título arriba y cada línea de la pregunta debajo, en el color fuerte (hay que leerla)
    float top = cy - bh / 2.0f;
    ui_text_draw_baseline(ln[0], cx, cy + (top + 22.0f - cy) * s, 16.0f / EM * s, 11.0f / EM * s, max_w, ui_rgb(BUBBLE_TITLE, a.alpha), UI_ALIGN_CENTER);
    for (int i = 1; i < lines; i++) {
      float y = top + 22.0f + 4.0f + (float)FACE_BUBBLE_TALL_PITCH * (float)i;
      ui_text_draw_baseline(ln[i], cx, cy + (y - cy) * s, 13.0f / EM * s, 11.0f / EM * s, max_w, ui_rgb(BUBBLE_SUB, a.alpha), UI_ALIGN_CENTER);
    }
  }
}

void render_top_draw(const FaceView *face, double t, StereoEye eye, float slider) {
  if (!g_init) {
    face_local_init(&g_local);
    g_init = 1;
  }
  FaceFrame f;
  face_compute(&f, &g_local, face->kind, face->mood, t);

  // fondo y brillo
  ui_rect(0, 0, FACE_SCREEN_W, FACE_SCREEN_H, ui_rgb_i(f.bg_r, f.bg_g, f.bg_b, 1.0f));
  u32 sheen = ui_rgb(0xffffff, FACE_SHEEN_ALPHA);
  for (int i = 0; i < FACE_SHEEN_RADII_COUNT; i++) C2D_DrawCircleSolid(FACE_SHEEN_X, FACE_SHEEN_Y, 0.0f, FACE_SHEEN_RADII[i], sheen);
  if (f.mood == MOOD_ASK) ui_rect(0, 0, FACE_SCREEN_W, FACE_SCREEN_H, ui_rgb(0xffffff, f.ask_alpha));

  // 3D: el fondo (y su brillo y el velo de "pide permiso") está en el plano de la pantalla; ojos y boca, el brillo y el
  // globo van delante con su propia profundidad (logic/stereo.c). Con el deslizador en 0 todo queda sin desplazar.
  float dx_eyes = stereo_offset(eye, STEREO_DEPTH_EYES, slider);
  float dx_glint = stereo_offset(eye, STEREO_DEPTH_GLINT, slider) - dx_eyes; // respecto a los ojos
  float dx_bubble = stereo_offset(eye, STEREO_DEPTH_BUBBLE, slider);

  // ojos y boca
  for (int d = -1; d <= 1; d += 2) draw_eye(&f, FACE_EYE_X + d * FACE_EYE_SPACING + f.look + f.shake + dx_eyes, f.eye_y, dx_glint);
  draw_mouth(&f, FACE_MOUTH_X + f.shake + dx_eyes, f.mouth_y);

  draw_bubble(face, &f, t, dx_bubble);
}

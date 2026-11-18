#include "intro.h"

#include <math.h>
#include <string.h>

#include "face_math.h"
#include "palette.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define BACK 1.7

#define T_SQ0 120.0
#define T_SQ1 520.0
#define T_LAND0 380.0
#define T_EYE_L 450.0
#define T_EYE_R 520.0
#define T_EYE_DUR 180.0
#define T_BLINK0 800.0
#define T_BLINK1 900.0
#define T_LOOK0 950.0
#define T_JUMP0 1350.0
#define T_JUMP_TOP 1435.0
#define T_JUMP1 1520.0
#define T_SQUASH_END 1620.0
#define T_EXPAND0 1520.0
#define T_EXPAND1 INTRO_DONE_MS

#define SQ_SIZE 96.0
#define SQ_CX 200.0
#define SQ_CY 120.0
#define JUMP_PX 12.0

#define SCREEN_W 400.0
#define SCREEN_H 240.0

static double clamp01(double u) { return u < 0.0 ? 0.0 : u > 1.0 ? 1.0 : u; }
static double seg(double t, double a, double b) { return clamp01((t - a) / (b - a)); } // progreso de t entre a y b
static double lerp(double a, double b, double w) { return a * (1.0 - w) + b * w; }

double intro_ease_out_back(double u, double c1) {
  if (!(u > 0.0)) return 0.0; // extremos exactos (sin ruido de coma flotante)
  if (u >= 1.0) return 1.0;
  double c3 = c1 + 1.0, d = u - 1.0;
  return 1.0 + c3 * d * d * d + c1 * d * d;
}

double intro_ease_out_cubic(double u) {
  double d = 1.0 - clamp01(u);
  return 1.0 - d * d * d;
}

double intro_ease_in_out_cubic(double u) {
  u = clamp01(u);
  if (u < 0.5) return 4.0 * u * u * u;
  double d = -2.0 * u + 2.0;
  return 1.0 - d * d * d / 2.0;
}

IntroTarget intro_target_default(void) {
  IntroTarget g;
  g.eye_lx = (float)(FACE_EYE_X - FACE_EYE_SPACING);
  g.eye_rx_c = (float)(FACE_EYE_X + FACE_EYE_SPACING);
  g.eye_cy = (float)FACE_EYE_Y;
  g.eye_rx = (float)FACE_EYE_RX;
  g.eye_ry = (float)FACE_EYE_RY;
  g.glint_dx = (float)FACE_EYE_GLINT_DX;
  g.glint_dy = (float)FACE_EYE_GLINT_DY;
  g.glint_r = FACE_EYE_GLINT_R;
  return g;
}

// Apertura de un ojo que se abre a partir de t0 (con rebote) por el parpadeo (1 -> 0.1 -> 1 entre 800 y 900).
static double eye_open(double t, double t0) {
  double open = intro_ease_out_back(seg(t, t0, t0 + T_EYE_DUR), BACK);
  double b = seg(t, T_BLINK0, T_BLINK1);
  double blink = b > 0.0 && b < 1.0 ? 1.0 - 0.9 * sin(M_PI * b) : 1.0;
  return open * blink;
}

// Mirada: 0 -> -5 (950-1050), quieta, -> +5 (1150-1250), -> 0 (1250-1350).
static double look_dx(double t) {
  if (t < T_LOOK0) return 0.0;
  if (t < 1050.0) return -5.0 * intro_ease_in_out_cubic(seg(t, T_LOOK0, 1050.0));
  if (t < 1150.0) return -5.0;
  if (t < 1250.0) return lerp(-5.0, 5.0, intro_ease_in_out_cubic(seg(t, 1150.0, 1250.0)));
  return 5.0 * (1.0 - intro_ease_in_out_cubic(seg(t, 1250.0, 1350.0)));
}

void intro_frame(double t, const IntroTarget *target, IntroFrame *o) {
  IntroTarget def = intro_target_default();
  const IntroTarget *fin = target != NULL ? target : &def;
  memset(o, 0, sizeof *o);
  if (!(t > 0.0)) t = 0.0; // también sanea NaN

  // ---------- el cuadrado: escala, aplastamientos y saltito ----------
  double s = t < T_SQ0 ? 0.0 : intro_ease_out_back(seg(t, T_SQ0, T_SQ1), BACK);
  double sx = 1.0, sy = 1.0;
  if (t >= T_LAND0 && t < T_SQ1) { // aterriza: más ancho y más bajo, vuelve a 1
    double k = intro_ease_out_cubic(seg(t, T_LAND0, T_SQ1));
    sx = lerp(1.08, 1.0, k);
    sy = lerp(0.92, 1.0, k);
  }
  double jump = 0.0;
  if (t >= T_JUMP0 && t < T_JUMP1) {
    if (t < T_JUMP_TOP) {
      jump = JUMP_PX * intro_ease_out_cubic(seg(t, T_JUMP0, T_JUMP_TOP)); // sube frenando
    } else {
      double u = seg(t, T_JUMP_TOP, T_JUMP1);
      jump = JUMP_PX * (1.0 - u * u); // cae acelerando
    }
  }
  if (t >= T_JUMP1 && t < T_SQUASH_END) { // toca el suelo: aplastamiento que se recupera en 100 ms
    double k = intro_ease_out_cubic(seg(t, T_JUMP1, T_SQUASH_END));
    sx = lerp(1.06, 1.0, k);
    sy = lerp(0.94, 1.0, k);
  }

  o->square_visible = t >= T_SQ0 ? 1 : 0;
  o->scale = (float)s;
  double w0 = SQ_SIZE * s * sx, h0 = SQ_SIZE * s * sy;
  double bottom = SQ_CY - jump + SQ_SIZE / 2.0 * s; // el aplastamiento se ancla al suelo (borde de abajo)
  double x0 = SQ_CX - w0 / 2.0, y0 = bottom - h0;
  double rad0 = SQ_SIZE * 0.2 * s * (sx + sy) / 2.0;

  // ---------- ojos dentro del cuadrado ----------
  AgentSquare g;
  pal_agent_square((float)SQ_SIZE, &g);
  double kx = w0 / SQ_SIZE, ky = h0 / SQ_SIZE, look = look_dx(t);
  double open[2] = {eye_open(t, T_EYE_L), eye_open(t, T_EYE_R)};
  double ecx[2] = {x0 + g.eye_lx * kx + look, x0 + g.eye_rx_c * kx + look};
  double ecy = y0 + g.eye_cy * ky;
  o->eyes_visible = t >= T_EYE_L ? 1 : 0;

  // ---------- expansión a la cara final (con w = 1 los valores son exactamente los de la cara) ----------
  double w = t >= T_EXPAND0 ? intro_ease_in_out_cubic(seg(t, T_EXPAND0, T_EXPAND1)) : 0.0;
  double fcx[2] = {fin->eye_lx, fin->eye_rx_c};
  o->x = (float)lerp(x0, 0.0, w);
  o->y = (float)lerp(y0, 0.0, w);
  o->w = (float)lerp(w0, SCREEN_W, w);
  o->h = (float)lerp(h0, SCREEN_H, w);
  o->radius = (float)lerp(rad0, 0.0, w);
  for (int i = 0; i < 2; i++) {
    IntroEye *e = &o->eye[i];
    e->dx = (float)(look * (1.0 - w));
    e->cx = (float)lerp(ecx[i], fcx[i], w);
    e->cy = (float)lerp(ecy, fin->eye_cy, w);
    e->rx = (float)lerp(g.eye_rx * kx, fin->eye_rx, w);
    e->ry = (float)lerp(g.eye_ry * ky, fin->eye_ry, w);
    e->scale_y = (float)lerp(open[i], 1.0, w);
    e->glint_dx = (float)lerp(g.glint_dx * kx, fin->glint_dx, w);
    e->glint_dy = (float)lerp(g.glint_dy * ky, fin->glint_dy, w);
    e->glint_r = (float)lerp(g.glint_r * (kx + ky) / 2.0, fin->glint_r, w);
  }
  o->depth_bg = (float)lerp(3.0, 0.0, w);   // cuadrado -> fondo de la cara (plano de la pantalla)
  o->depth_eyes = (float)lerp(6.0, 5.0, w); // ojos de la cara normal: 5
  o->depth_glint = (float)lerp(7.0, 6.0, w);
  o->color_mix = (float)intro_ease_in_out_cubic(seg(t, INTRO_DONE_MS, INTRO_END_MS));

  // ---------- pantalla de abajo ----------
  o->bg_cover = (float)(1.0 - seg(t, 0.0, 300.0));
  o->logo_y = (float)lerp(134.0, 104.0, intro_ease_out_back(seg(t, 600.0, 1000.0), BACK));
  double out = 1.0 - seg(t, 1700.0, INTRO_DONE_MS);
  o->logo_alpha = (float)(seg(t, 600.0, 750.0) * out);
  o->text_alpha = (float)(seg(t, 1000.0, 1200.0) * out);

  o->done = t >= INTRO_DONE_MS;
  o->over = t >= INTRO_END_MS;
}

double intro_skip(double t_ms) { return t_ms < INTRO_DONE_MS ? INTRO_DONE_MS : t_ms; }

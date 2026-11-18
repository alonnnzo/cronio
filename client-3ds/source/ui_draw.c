#include "ui_draw.h"

#include <math.h>

#include "logic/layout.h"
#include "logic/palette.h"
#include "ui_scale.h"
#include "ui_text.h"

#define Z 0.0f
#define MAX_PTS 64

u32 ui_rgb(uint32_t rgb, float alpha) {
  if (alpha < 0.0f) alpha = 0.0f;
  if (alpha > 1.0f) alpha = 1.0f;
  return C2D_Color32((u8)((rgb >> 16) & 255), (u8)((rgb >> 8) & 255), (u8)(rgb & 255), (u8)(alpha * 255.0f + 0.5f));
}

u32 ui_rgb_i(int r, int g, int b, float alpha) {
  if (r < 0) r = 0;
  if (g < 0) g = 0;
  if (b < 0) b = 0;
  if (r > 255) r = 255;
  if (g > 255) g = 255;
  if (b > 255) b = 255;
  if (alpha < 0.0f) alpha = 0.0f;
  if (alpha > 1.0f) alpha = 1.0f;
  return C2D_Color32((u8)r, (u8)g, (u8)b, (u8)(alpha * 255.0f + 0.5f));
}

void ui_rect(float x, float y, float w, float h, u32 clr) {
  if (w <= 0.0f || h <= 0.0f) return;
  C2D_DrawRectSolid(x, y, Z, w, h, clr);
}

void ui_rect_border(float x, float y, float w, float h, float b, u32 clr) {
  ui_rect(x, y, w, b, clr);
  ui_rect(x, y + h - b, w, b, clr);
  ui_rect(x, y + b, b, h - 2 * b, clr);
  ui_rect(x + w - b, y + b, b, h - 2 * b, clr);
}

void ui_line_round(float x0, float y0, float x1, float y1, float width, u32 clr) {
  C2D_DrawLine(x0, y0, clr, x1, y1, clr, width, Z);
  C2D_DrawCircleSolid(x0, y0, Z, width / 2, clr);
  C2D_DrawCircleSolid(x1, y1, Z, width / 2, clr);
}

void ui_polyline(const float *xy, int n, float width, u32 clr, int closed) {
  if (n < 2) return;
  int segs = closed ? n : n - 1;
  for (int i = 0; i < segs; i++) {
    int j = (i + 1) % n;
    C2D_DrawLine(xy[2 * i], xy[2 * i + 1], clr, xy[2 * j], xy[2 * j + 1], clr, width, Z);
  }
  // las figuras circulares van juntas al final: cambiar de modo en la GPU cuesta
  for (int i = 0; i < n; i++) C2D_DrawCircleSolid(xy[2 * i], xy[2 * i + 1], Z, width / 2, clr);
}

void ui_arc(float cx, float cy, float rx, float ry, float a0, float a1, float width, u32 clr) {
  float pts[2 * (MAX_PTS + 1)];
  int steps = (int)ceilf(fabsf(a1 - a0) / (float)(M_PI / 10.0)); // ~18 grados por segmento
  if (steps < 2) steps = 2;
  if (steps > MAX_PTS) steps = MAX_PTS;
  for (int i = 0; i <= steps; i++) {
    float a = a0 + (a1 - a0) * (float)i / (float)steps;
    pts[2 * i] = cx + rx * cosf(a);
    pts[2 * i + 1] = cy + ry * sinf(a);
  }
  ui_polyline(pts, steps + 1, width, clr, 0);
}

void ui_ellipse_outline(float cx, float cy, float rx, float ry, float width, u32 clr) {
  float pts[2 * 20];
  for (int i = 0; i < 20; i++) {
    float a = (float)(2.0 * M_PI) * (float)i / 20.0f;
    pts[2 * i] = cx + rx * cosf(a);
    pts[2 * i + 1] = cy + ry * sinf(a);
  }
  ui_polyline(pts, 20, width, clr, 1);
}

// Cuarto de círculo de radio r con centro (cx, cy) entre los ángulos a0 y a0 + pi/2, como abanico de triángulos.
static void quarter(float cx, float cy, float r, float a0, u32 clr) {
  const int steps = 5;
  for (int i = 0; i < steps; i++) {
    float a = a0 + (float)(M_PI / 2.0) * (float)i / steps;
    float b = a0 + (float)(M_PI / 2.0) * (float)(i + 1) / steps;
    C2D_DrawTriangle(cx, cy, clr, cx + r * cosf(a), cy + r * sinf(a), clr, cx + r * cosf(b), cy + r * sinf(b), clr, Z);
  }
}

void ui_rrect(float x, float y, float w, float h, float r, u32 clr) {
  if (r * 2 > w) r = w / 2;
  if (r * 2 > h) r = h / 2;
  ui_rect(x + r, y, w - 2 * r, h, clr);          // centro, de arriba abajo
  ui_rect(x, y + r, r, h - 2 * r, clr);          // franja izquierda
  ui_rect(x + w - r, y + r, r, h - 2 * r, clr);  // franja derecha
  quarter(x + r, y + r, r, (float)M_PI, clr);
  quarter(x + w - r, y + r, r, (float)(1.5 * M_PI), clr);
  quarter(x + w - r, y + h - r, r, 0.0f, clr);
  quarter(x + r, y + h - r, r, (float)(0.5 * M_PI), clr);
}

// ---------- marca Cronio ----------

void ui_bg_bottom(void) {
  u32 w = ui_rgb(pal()->bg_top, 1.0f), s = ui_rgb(pal()->bg_bot, 1.0f);
  C2D_DrawRectangle(0, 0, Z, LAYOUT_W, LAYOUT_H, w, w, s, s);
  // rayitas (blancas al 55 % en el claro, al 4 % en el oscuro): perpendiculares a la dirección 135 grados, una cada 9 px (12.73 px sobre el eje x), de 2 px
  u32 st = ui_rgb(pal()->stripe, pal()->stripe_alpha);
  for (float c = -(float)LAYOUT_H; c < (float)LAYOUT_W; c += 12.73f) {
    C2D_DrawLine(c, (float)LAYOUT_H, st, c + (float)LAYOUT_H, 0.0f, st, 2.0f, Z);
  }
}

static u32 grad_at(uint32_t top, uint32_t bot, float t) {
  return ui_rgb(pal_lerp(top, bot, (int)(t * 256.0f + 0.5f)), 1.0f);
}

void ui_vgrad(float x, float y, float w, float h, uint32_t top, uint32_t bot) {
  if (w <= 0.0f || h <= 0.0f) return;
  u32 ct = ui_rgb(top, 1.0f), cb = ui_rgb(bot, 1.0f);
  C2D_DrawRectangle(x, y, Z, w, h, ct, ct, cb, cb);
}

void ui_rrect_grad(float x, float y, float w, float h, float r, uint32_t top, uint32_t bot) {
  if (w <= 0.0f || h <= 0.0f) return;
  if (r * 2 > w) r = w / 2;
  if (r * 2 > h) r = h / 2;
  u32 ct = ui_rgb(top, 1.0f), cb = ui_rgb(bot, 1.0f);
  C2D_DrawRectangle(x + r, y, Z, w - 2 * r, h, ct, ct, cb, cb);
  float t0 = r / h, t1 = 1.0f - r / h;
  u32 a = grad_at(top, bot, t0), b = grad_at(top, bot, t1);
  if (h - 2 * r > 0.0f) {
    C2D_DrawRectangle(x, y + r, Z, r, h - 2 * r, a, a, b, b);
    C2D_DrawRectangle(x + w - r, y + r, Z, r, h - 2 * r, a, a, b, b);
  }
  u32 ctop = grad_at(top, bot, t0 / 2.0f), cbot = grad_at(top, bot, 1.0f - t0 / 2.0f);
  quarter(x + r, y + r, r, (float)M_PI, ctop);
  quarter(x + w - r, y + r, r, (float)(1.5 * M_PI), ctop);
  quarter(x + w - r, y + h - r, r, 0.0f, cbot);
  quarter(x + r, y + h - r, r, (float)(0.5 * M_PI), cbot);
}

void ui_panel(float x, float y, float w, float h, float r, uint32_t top, uint32_t bot, uint32_t border, float bw, uint32_t edge) {
  if (edge != 0) ui_rrect(x, y + 2.0f, w, h, r, ui_rgb(edge, 1.0f));
  ui_rrect(x, y, w, h, r, ui_rgb(border, 1.0f));
  float ir = r - bw;
  if (ir < 1.0f) ir = 1.0f;
  ui_rrect_grad(x + bw, y + bw, w - 2 * bw, h - 2 * bw, ir, top, bot);
}

void ui_agent_square(float x, float y, float size, uint32_t rgb, float alpha) {
  AgentSquare g;
  pal_agent_square(size, &g);
  ui_rrect(x, y, size, size, g.radius, ui_rgb(rgb, alpha));
  u32 ink = ui_rgb(PAL_EYE, alpha);
  C2D_DrawEllipseSolid(x + g.eye_lx - g.eye_rx, y + g.eye_cy - g.eye_ry, Z, g.eye_rx * 2, g.eye_ry * 2, ink);
  C2D_DrawEllipseSolid(x + g.eye_rx_c - g.eye_rx, y + g.eye_cy - g.eye_ry, Z, g.eye_rx * 2, g.eye_ry * 2, ink);
  if (g.glint_r > 0.0f) {
    u32 gl = ui_rgb(PAL_WHITE, 0.85f * alpha);
    C2D_DrawCircleSolid(x + g.eye_lx + g.glint_dx, y + g.eye_cy + g.glint_dy, Z, g.glint_r, gl);
    C2D_DrawCircleSolid(x + g.eye_rx_c + g.glint_dx, y + g.eye_cy + g.glint_dy, Z, g.glint_r, gl);
  }
}

void ui_button(float x, float y, float w, float h, UiBtnKind kind, const char *label, float scale, int pressed, float alpha,
               uint32_t border_rgb, uint32_t text_rgb) {
  uint32_t top = pal()->btn_top, bot = pal()->btn_bot, edge = pal()->edge, border = pal()->btn_border, text = pal()->ink;
  switch (kind) {
    case UI_BTN_OK: top = PAL_OK_HI; bot = PAL_OK; edge = PAL_OK_DK; border = PAL_OK_DK; text = PAL_WHITE; break;
    case UI_BTN_BAD: top = PAL_BAD_HI; bot = PAL_BAD; edge = PAL_BAD_DK; border = PAL_BAD_DK; text = PAL_WHITE; break;
    case UI_BTN_PRIMARY: top = PAL_SKY_HI; bot = PAL_SKY_DK; edge = PAL_SKY_EDGE; border = PAL_SKY_DK; text = PAL_WHITE; break;
    default: break;
  }
  if (border_rgb != 0) border = border_rgb;
  if (text_rgb != 0) text = text_rgb;
  float r = h / 2.0f < 12.0f ? h / 2.0f - 1.0f : 12.0f;
  if (r < 3.0f) r = 3.0f;
  float oy = pressed ? 2.0f : 0.0f;
  ui_panel(x, y + oy, w, h, r, top, bot, border, 1.0f, pressed ? 0 : edge);
  float cell = UI_TEXT_CELL_H * scale;
  ui_text_draw(label, x + w / 2.0f, y + oy + (h - cell) / 2.0f - 1.0f, scale, S_MIN, w - 6.0f, ui_rgb(text, alpha), UI_ALIGN_CENTER);
}

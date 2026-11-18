#include "palette.h"

#include <math.h>

uint32_t pal_lerp(uint32_t a, uint32_t b, int t256) {
  if (t256 < 0) t256 = 0;
  if (t256 > 256) t256 = 256;
  uint32_t out = 0;
  for (int sh = 16; sh >= 0; sh -= 8) {
    int ca = (int)((a >> sh) & 255u), cb = (int)((b >> sh) & 255u);
    out |= (uint32_t)(ca + (cb - ca) * t256 / 256) << sh;
  }
  return out;
}

static const Palette LIGHT = {
    .bg_top = PAL_WHITE, .bg_bot = PAL_SILVER, .stripe = PAL_WHITE, .stripe_alpha = 0.55f,
    .bar_top = PAL_WHITE, .bar_bot = PAL_BAR_BOT, .line = PAL_LINE, .edge = PAL_EDGE,
    .row_top = PAL_WHITE, .row_bot = PAL_ROW_BOT, .row_alt = 0xECEFF3u, .pulse = 0xF2F5F8u,
    .btn_top = PAL_WHITE, .btn_bot = PAL_BTN_BOT, .btn_border = PAL_EDGE, .card = PAL_WHITE,
    .ink = PAL_INK, .mute = PAL_MUTE, .cmd_bg = PAL_CMD_BG,
    .sky_text = PAL_SKY_DK, .sky_bg = PAL_SKY_BG, .sky_strip = PAL_SKY_STRIP,
    .ok_text = PAL_OK_DK, .bad_text = PAL_BAD, .bad_bg = PAL_BAD_BG,
    .bubble_fill = PAL_WHITE, .bubble_line = PAL_LINE, .bubble_title = PAL_INK, .bubble_sub = PAL_MUTE,
};

// Tema oscuro (docs/11-marca-cronio.md): grafito frío; el celeste de la selección y los botones de color no cambian.
static const Palette DARK = {
    .bg_top = 0x23272Fu, .bg_bot = 0x1A1D23u, .stripe = PAL_WHITE, .stripe_alpha = 0.04f,
    .bar_top = 0x2C313Au, .bar_bot = 0x262A32u, .line = 0x3A404Au, .edge = 0x14171Cu,
    .row_top = 0x30353Fu, .row_bot = 0x282C34u, .row_alt = 0x2C3039u, .pulse = 0x373D49u,
    .btn_top = 0x30353Fu, .btn_bot = 0x282C34u, .btn_border = 0x3A404Au, .card = 0x30353Fu,
    .ink = 0xE6E9EEu, .mute = 0x9AA3AFu, .cmd_bg = 0x1E2228u,
    .sky_text = 0x5CC4F2u, .sky_bg = 0x16303Du, .sky_strip = 0x173543u,
    .ok_text = 0x6FDC95u, .bad_text = 0xFF7B7Eu, .bad_bg = 0x3A1C1Eu,
    .bubble_fill = 0x23272Fu, .bubble_line = 0x3A404Au, .bubble_title = 0xE6E9EEu, .bubble_sub = 0x9AA3AFu,
};

static const Palette *g_pal = &LIGHT;

const Palette *pal(void) { return g_pal; }
void pal_set_dark(int dark) { g_pal = dark ? &DARK : &LIGHT; }
int pal_is_dark(void) { return g_pal == &DARK; }
const Palette *pal_light(void) { return &LIGHT; }
const Palette *pal_dark(void) { return &DARK; }

static double lin(uint32_t c) {
  double v = (double)c / 255.0;
  return v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4);
}

static double lum(uint32_t rgb) {
  return 0.2126 * lin((rgb >> 16) & 255u) + 0.7152 * lin((rgb >> 8) & 255u) + 0.0722 * lin(rgb & 255u);
}

int pal_contrast_x10(uint32_t fg, uint32_t bg) {
  double a = lum(fg), b = lum(bg);
  if (a < b) { double t = a; a = b; b = t; }
  return (int)(10.0 * (a + 0.05) / (b + 0.05));
}

// Medidas del simulador para un cuadrado de 32 px: radio 6, ojos de 5x8 con el centro a 11.5 y 20.5, y a 16 de alto.
void pal_agent_square(float size, AgentSquare *g) {
  float k = size / 32.0f;
  g->size = size;
  g->radius = size * 0.2f;
  g->eye_rx = 2.5f * k;
  g->eye_ry = 4.0f * k;
  g->eye_lx = 11.5f * k;
  g->eye_rx_c = 20.5f * k;
  g->eye_cy = 16.0f * k;
  g->glint_dx = -0.8f * k;
  g->glint_dy = -2.0f * k;
  g->glint_r = size >= 24.0f ? 1.0f * k : 0.0f;
}

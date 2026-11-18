#include "ui_text.h"

#include <citro2d.h>
#include <string.h>

#include "logic/utf8util.h"

#define DRAW_GLYPHS 4096
#define MEASURE_GLYPHS 512
#define MAX_LINE 256

static C2D_TextBuf g_draw, g_measure;

int ui_text_init(void) {
  g_draw = C2D_TextBufNew(DRAW_GLYPHS);
  g_measure = C2D_TextBufNew(MEASURE_GLYPHS);
  return g_draw != NULL && g_measure != NULL;
}

void ui_text_exit(void) {
  if (g_draw) C2D_TextBufDelete(g_draw);
  if (g_measure) C2D_TextBufDelete(g_measure);
  g_draw = g_measure = NULL;
}

void ui_text_begin_frame(void) {
  if (g_draw) C2D_TextBufClear(g_draw);
}

// Ancho a escala 1 (el ancho de C2D_Text es lineal en la escala).
static float width_at_unit(const char *s) {
  if (!g_measure || s[0] == '\0') return 0.0f;
  C2D_TextBufClear(g_measure);
  C2D_Text t;
  if (C2D_TextParse(&t, g_measure, s) == NULL) return 0.0f;
  float w = 0.0f;
  C2D_TextGetDimensions(&t, 1.0f, 1.0f, &w, NULL);
  return w;
}

float ui_text_width(const char *s, float scale) { return width_at_unit(s) * scale; }

// Recorta line (en el sitio) con "…" hasta que quepa en max_w a esa escala. 0 si ni así cabe nada.
static int shrink_with_ellipsis(char line[MAX_LINE + 4], float scale, float max_w) {
  size_t len = strlen(line);
  while (len > 0) {
    len = utf8_drop_last(line);
    char tmp[MAX_LINE + 4];
    memcpy(tmp, line, len);
    memcpy(tmp + len, "\xE2\x80\xA6", 4); // "…" y el NUL
    if (width_at_unit(tmp) * scale <= max_w) {
      memcpy(line, tmp, len + 4);
      return 1;
    }
  }
  return 0;
}

static float draw_impl(const char *s, float x, float y, float scale, float min_scale, float max_w, u32 color, UiAlign align, int baseline) {
  if (!g_draw || s == NULL || s[0] == '\0') return 0.0f;
  char line[MAX_LINE + 4];
  // una sola línea: el texto del puente nunca lleva saltos, pero se protege el dibujo
  size_t n = 0;
  while (s[n] && s[n] != '\n' && n < MAX_LINE) n++;
  while (n > 0 && s[n] != '\0' && s[n] != '\n' && ((unsigned char)s[n] & 0xC0) == 0x80) n--; // no partir una secuencia
  memcpy(line, s, n);
  line[n] = '\0';

  float unit = width_at_unit(line);
  float w = unit * scale;
  if (max_w > 0.0f && w > max_w) {
    float fit = unit > 0.0f ? max_w / unit : scale;
    float lowered = fit < min_scale ? min_scale : fit;
    if (lowered < scale) scale = lowered; // nunca agranda
    w = unit * scale;
    if (w > max_w) {
      if (!shrink_with_ellipsis(line, scale, max_w)) return 0.0f;
      w = width_at_unit(line) * scale;
    }
  }

  C2D_Text t;
  if (C2D_TextParse(&t, g_draw, line) == NULL) return 0.0f;
  C2D_TextOptimize(&t);
  u32 flags = C2D_WithColor | (baseline ? C2D_AtBaseline : 0);
  if (align == UI_ALIGN_CENTER) flags |= C2D_AlignCenter;
  else if (align == UI_ALIGN_RIGHT) flags |= C2D_AlignRight;
  C2D_DrawText(&t, flags, x, y, 0.0f, scale, scale, color);
  return w;
}

float ui_text_draw(const char *s, float x, float y, float scale, float min_scale, float max_w, u32 color, UiAlign align) {
  return draw_impl(s, x, y, scale, min_scale, max_w, color, align, 0);
}

float ui_text_draw_baseline(const char *s, float x, float baseline, float scale, float min_scale, float max_w, u32 color,
                            UiAlign align) {
  return draw_impl(s, x, baseline, scale, min_scale, max_w, color, align, 1);
}

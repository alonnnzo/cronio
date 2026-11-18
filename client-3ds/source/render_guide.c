#include "render_guide.h"

#include <stdio.h>

#include "logic/layout.h"
#include "logic/palette.h"
#include "ui_draw.h"
#include "ui_scale.h"
#include "ui_text.h"

#define C_INK (pal()->ink)
#define C_MUTE (pal()->mute)
#define C_ASK (pal()->sky_text)   // pide permiso / textos celestes
#define C_OK (pal()->ok_text)     // texto verde
#define C_LINE (pal()->line)

#define LINE_H 17.0f

static void draw_arrow(int x, const char *label, int enabled) {
  float a = enabled ? 1.0f : 0.35f;
  ui_panel((float)x, GUIDE_ARROW_Y, GUIDE_ARROW_W, GUIDE_ARROW_H, 12, pal()->btn_top, pal()->btn_bot, pal()->btn_border, 1.0f, enabled ? pal()->edge : 0);
  ui_text_draw(label, (float)x + GUIDE_ARROW_W / 2.0f, GUIDE_ARROW_Y + 7, S_TITLE, S_MIN, GUIDE_ARROW_W - 6, ui_rgb(C_INK, a), UI_ALIGN_CENTER);
}

void render_guide_draw(const Guide *g) {
  const GuidePage *p = guide_current(g);

  ui_text_draw(p->title, 10, 5, S_TITLE, S_MIN, 190, ui_rgb(C_INK, 1.0f), UI_ALIGN_LEFT);
  ui_text_draw("SELECT o B: cerrar", LAYOUT_W - 8, 10, S_SMALL, S_MIN, 118, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_RIGHT);
  ui_rect(8, 31, LAYOUT_W - 16, 1, ui_rgb(C_LINE, 1.0f));

  float y = 38.0f;
  int n = guide_line_count(p);
  for (int i = 0; i < n; i++) {
    ui_text_draw(p->lines[i], 10, y, S_BODY, S_MIN, 304, ui_rgb(C_INK, 1.0f), UI_ALIGN_LEFT);
    y += LINE_H;
  }

  draw_arrow(GUIDE_ARROW_PREV_X, "<", g->page > 0);
  draw_arrow(GUIDE_ARROW_NEXT_X, ">", g->page < GUIDE_PAGES - 1);
  char pg[24];
  snprintf(pg, sizeof pg, "%d de %d", g->page + 1, GUIDE_PAGES);
  ui_text_draw(pg, LAYOUT_W / 2.0f, 208, S_BODY, S_MIN, 150, ui_rgb(C_INK, 1.0f), UI_ALIGN_CENTER);
  ui_text_draw("cruceta izq. / der.: cambiar de página", LAYOUT_W / 2.0f, 224, S_SMALL, S_MIN, 200, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_CENTER);
}

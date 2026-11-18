#include "render_update.h"

#include <string.h>

#include "logic/palette.h"
#include "ui_draw.h"
#include "ui_scale.h"
#include "ui_text.h"

#define C_INK (pal()->ink)
#define C_MUTE (pal()->mute)
#define C_ASK (pal()->sky_text)
#define C_OK (pal()->ok_text)
#define C_BAD (pal()->bad_text)

static float cell(float scale) { return UI_TEXT_CELL_H * scale; }
static float center_y(float y, float h, float scale) { return y + (h - cell(scale)) / 2.0f - 1.0f; }

// Barra de progreso: pista hundida con borde y, encima, el relleno con degradado (celeste; verde al terminar). Un relleno más angosto que
// su propio redondeo se dibuja como un rectángulo chico para que no se deforme.
static void draw_bar(const UpdateLayout *l, const UpdateScreen *s) {
  const Rect *b = &l->bar;
  ui_panel((float)b->x, (float)b->y, (float)b->w, (float)b->h, 10, pal()->bar_bot, pal()->row_bot, pal()->line, 1.0f, 0);
  float inner_w = (float)b->w - 6.0f;
  float fill = inner_w * (float)s->permille / 1000.0f;
  uint32_t top = s->tone == UPD_TONE_OK ? PAL_OK_HI : PAL_SKY_HI;
  uint32_t bot = s->tone == UPD_TONE_OK ? PAL_OK : PAL_SKY;
  if (fill >= 16.0f) {
    ui_rrect_grad((float)b->x + 3, (float)b->y + 3, fill, (float)b->h - 6, 7, top, bot);
  } else if (fill >= 2.0f) {
    ui_rect((float)b->x + 3, (float)b->y + 5, fill, (float)b->h - 10, ui_rgb(bot, 1.0f));
  }
  ui_text_draw(s->bar_text, (float)b->x + (float)b->w / 2.0f, center_y((float)b->y, (float)b->h, S_BODY), S_BODY, S_MIN, (float)b->w - 12,
               ui_rgb(s->permille >= 520 ? PAL_WHITE : C_INK, 1.0f), UI_ALIGN_CENTER);
}

void render_update_draw(const UpdateScreen *s) {
  UpdateLayout l;
  update_layout(&l);

  ui_text_draw(s->label, (float)l.label.x + 2, center_y((float)l.label.y, (float)l.label.h, S_SMALL), S_SMALL, S_MIN, (float)l.label.w - 4, ui_rgb(C_ASK, 1.0f),
               UI_ALIGN_LEFT);
  uint32_t title_rgb = s->tone == UPD_TONE_OK ? C_OK : s->tone == UPD_TONE_BAD ? C_BAD : C_INK;
  ui_text_draw(s->title, (float)l.title.x + 2, center_y((float)l.title.y, (float)l.title.h, S_HEAD), S_HEAD, S_MIN, (float)l.title.w - 4, ui_rgb(title_rgb, 1.0f),
               UI_ALIGN_LEFT);
  ui_rect((float)l.title.x, (float)(l.title.y + l.title.h + 2), (float)l.title.w, 1, ui_rgb(pal()->line, 1.0f));

  for (int i = 0; i < s->line_count; i++) {
    if (s->lines[i][0] == '\0') continue;
    // con barra (progreso y «Listo») la primera línea es lo que pasa ahora y el resto, ayuda en gris
    int main_line = !s->has_bar || i == 0;
    float scale = main_line ? S_BODY : S_SMALL;
    ui_text_draw(s->lines[i], (float)l.body.x + 2, (float)(l.body.y + i * UPDATE_LINE_PITCH) + (main_line ? 0.0f : 1.0f), scale, S_MIN, (float)l.body.w - 4,
                 ui_rgb(main_line ? C_INK : C_MUTE, 1.0f), UI_ALIGN_LEFT);
  }
  if (s->has_bar) {
    draw_bar(&l, s);
    if (s->kb_text[0] != '\0') {
      ui_text_draw(s->kb_text, (float)l.kb.x + (float)l.kb.w / 2.0f, center_y((float)l.kb.y, (float)l.kb.h, S_SMALL), S_SMALL, S_MIN, (float)l.kb.w,
                   ui_rgb(C_MUTE, 1.0f), UI_ALIGN_CENTER);
    }
  }

  // botones: el velo de la guarda de 500 ms los deja apagados mientras tanto
  float alpha = s->ready ? 1.0f : 0.55f;
  if (s->has_a) {
    ui_button((float)l.btn_a.x, (float)l.btn_a.y, (float)l.btn_a.w, (float)l.btn_a.h, UI_BTN_OK, s->a_label, S_BODY, 0, alpha, 0, 0);
  }
  if (s->has_b) {
    const Rect *r = s->has_a ? &l.btn_b : &l.btn_b_solo;
    ui_button((float)r->x, (float)r->y, (float)r->w, (float)r->h, UI_BTN_NORMAL, s->b_label, S_BODY, 0, alpha, 0, 0);
  }
}

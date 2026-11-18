#include "render_reader.h"

#include <stdio.h>
#include <string.h>

#include "logic/palette.h"
#include "logic/theme.h"
#include "ui_draw.h"
#include "ui_scale.h"
#include "ui_text.h"

// Mismos colores y escalas que render_bottom.c
#define C_INK (pal()->ink)
#define C_MUTE (pal()->mute)
#define C_ASK (pal()->sky_text)   // pide permiso / textos celestes
#define C_OK (pal()->ok_text)     // texto verde
#define C_LINE (pal()->line)
#define C_YELLOW (pal()->sky_text)

static float cell(float scale) { return UI_TEXT_CELL_H * scale; }
static float center_y(float y, float h, float scale) { return y + (h - cell(scale)) / 2.0f - 1.0f; }

static void draw_header(const ReaderModel *m, const ReaderLayout *l) {
  const View *v = m->view;
  const SessionView *s = v != NULL ? view_find_session(v, m->reader->session_id) : NULL;
  const char *name = s != NULL ? theme_agent_name(s->kind) : "Agente";
  ui_vgrad(0, 0, LAYOUT_W, (float)(l->bar.y + l->bar.h), pal()->bar_top, pal()->bar_bot); // barra estilo HOME
  ui_rect(0, (float)(l->bar.y + l->bar.h), LAYOUT_W, 1, ui_rgb(C_LINE, 1.0f));
  float ty = center_y(l->bar.y, l->bar.h, S_TITLE);
  float tw = ui_text_draw(name, 6, ty, S_TITLE, S_MIN, 100, ui_rgb(C_INK, 1.0f), UI_ALIGN_LEFT);
  float sx = 6.0f + tw + 6.0f;
  float sw = (float)l->pos.x - sx - 2.0f - 52.0f; // 52 px para el modo ("Completo" / "Resumen"), a la derecha del proyecto
  if (s != NULL && sw > 20.0f) ui_text_draw(s->project, sx, center_y(l->bar.y, l->bar.h, S_SMALL), S_SMALL, S_MIN, sw, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_LEFT);

  // modo de lo que se ve; cargando todavía no hay nada que rotular
  if (m->reader->state == READER_SHOWING && m->doc != NULL) {
    int summary = reader_shown_mode(m->reader, m->doc) == READ_MODE_SUMMARY;
    ui_text_draw(summary ? "Resumen" : "Completo", (float)l->pos.x - 4.0f, center_y(l->bar.y, l->bar.h, S_SMALL), S_SMALL, S_MIN, 50.0f,
                 ui_rgb(summary ? C_YELLOW : C_MUTE, 1.0f), UI_ALIGN_RIGHT);
  }

  int first, last, total;
  reader_position(m->reader, m->doc, &first, &last, &total);
  if (total > 0) {
    char pos[24];
    if (first == last) snprintf(pos, sizeof pos, "%d/%d", first, total);
    else snprintf(pos, sizeof pos, "%d-%d/%d", first, last, total);
    ui_text_draw(pos, (float)(l->pos.x + l->pos.w), center_y(l->bar.y, l->bar.h, S_SMALL), S_SMALL, S_MIN, (float)l->pos.w, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_RIGHT);
  }
  const Rect *b = &l->back_btn;
  ui_button((float)b->x, (float)b->y, (float)b->w, (float)b->h, UI_BTN_NORMAL, "B Volver", S_SMALL, 0, 1.0f, 0, 0);
}

static void draw_question(const ReadDoc *d, const ReaderLayout *l) {
  if (d == NULL || l->question_lines == 0) return;
  const Rect *q = &l->question;
  ui_panel((float)q->x, (float)q->y, (float)q->w, (float)q->h, 6, pal()->card, pal()->card, PAL_SKY, 1.0f, 0);
  ui_text_draw("Te pregunta:", (float)q->x + 6, (float)q->y + 3, S_SMALL, S_MIN, 296, ui_rgb(C_YELLOW, 1.0f), UI_ALIGN_LEFT);
  for (int i = 0; i < l->question_lines && i < d->question_count; i++) {
    ui_text_draw(d->question[i], (float)q->x + 6, (float)(q->y + READER_QUESTION_HEAD_H + READER_QUESTION_ROW_H * i), S_READER, S_MIN, 302, ui_rgb(C_INK, 1.0f), UI_ALIGN_LEFT);
  }
}

// Pie: el otro modo, que alterna X (o tocar). Si el resumen ya es el mensaje entero lo dice.
static void draw_foot(const ReadDoc *d, const ReaderLayout *l, int mode) {
  char buf[48];
  int whole = d->mode == READ_MODE_SUMMARY && d->whole;
  snprintf(buf, sizeof buf, "%sX: %s", whole ? "Mensaje corto \xC2\xB7 " : "", mode == READ_MODE_SUMMARY ? "completo" : "resumen");
  ui_rect(l->foot.x, l->foot.y, l->foot.w, 1, ui_rgb(C_LINE, 1.0f));
  ui_text_draw(buf, LAYOUT_W / 2.0f, center_y((float)l->foot.y, (float)l->foot.h, S_SMALL), S_SMALL, S_MIN, LAYOUT_W - 16.0f, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_CENTER);
}

void render_reader_draw(const ReaderModel *m) {
  const Reader *r = m->reader;
  const ReadDoc *d = r->state == READER_SHOWING ? m->doc : NULL;
  ReaderLayout l;
  reader_layout(d != NULL ? d->question_count : 0, r->stale, &l);

  draw_header(m, &l);
  if (l.has_stale) {
    ui_rrect((float)l.stale.x, (float)l.stale.y, (float)l.stale.w, (float)l.stale.h, 8, ui_rgb(PAL_SKY, 1.0f));
    ui_rrect((float)l.stale.x + 1, (float)l.stale.y + 1, (float)l.stale.w - 2, (float)l.stale.h - 2, 7, ui_rgb(pal()->sky_strip, 1.0f));
    ui_text_draw("mensaje nuevo \xC2\xB7 A recarga", l.stale.x + l.stale.w / 2.0f, center_y(l.stale.y, l.stale.h, S_SMALL), S_SMALL, S_MIN, l.stale.w - 12, ui_rgb(C_YELLOW, 1.0f), UI_ALIGN_CENTER);
  }

  if (d == NULL) {
    ui_text_draw("Cargando\xE2\x80\xA6", 160, l.body.y + l.body.h / 2.0f - 10, S_TITLE, S_MIN, 300, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_CENTER);
    return;
  }
  draw_question(d, &l);
  draw_foot(d, &l, reader_shown_mode(r, d));

  int total = reading_total_lines(d);
  if (total == 0) {
    ui_text_draw("Sin mensaje todav\xC3\xAD" "a", 160, l.body.y + l.body.h / 2.0f - 10, S_BODY, S_MIN, 300, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_CENTER);
    return;
  }
  for (int i = 0; i < l.rows; i++) {
    int idx = r->top + i;
    if (idx >= total) break;
    float y = (float)(l.body.y + i * READER_ROW_H);
    if (idx < d->line_count) {
      if (d->lines[idx][0] != '\0') ui_text_draw(d->lines[idx], READER_TEXT_X, y, S_READER, S_MIN, READER_TEXT_W, ui_rgb(C_INK, 1.0f), UI_ALIGN_LEFT);
    } else {
      ui_text_draw("\xE2\x80\xA6 sigue en el PC", READER_TEXT_X, y, S_READER, S_MIN, READER_TEXT_W, ui_rgb(C_YELLOW, 1.0f), UI_ALIGN_LEFT);
    }
  }
  if (total > l.rows) { // barra de desplazamiento, como en la lista de sesiones
    float th = (float)l.body.h;
    float len = th * (float)l.rows / (float)total;
    float off = th * (float)r->top / (float)total;
    ui_rect(LAYOUT_W - 4, (float)l.body.y, 2, th, ui_rgb(C_LINE, 1.0f));
    ui_rect(LAYOUT_W - 4, (float)l.body.y + off, 2, len, ui_rgb(C_MUTE, 1.0f));
  }
}

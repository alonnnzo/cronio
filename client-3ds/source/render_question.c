#include "render_question.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

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

static float cell(float scale) { return UI_TEXT_CELL_H * scale; }
static float center_y(float y, float h, float scale) { return y + (h - cell(scale)) / 2.0f - 1.0f; }

// Estrella de cinco puntas (recomendada), centrada en (cx, cy) con radio r.
static void draw_star(float cx, float cy, float r, u32 clr) {
  float pts[20];
  for (int i = 0; i < 10; i++) {
    float a = -1.5707963f + (float)i * 0.6283185f; // desde arriba, cada 36 grados
    float rad = (i % 2 == 0) ? r : r * 0.42f;
    pts[i * 2] = cx + rad * cosf(a);
    pts[i * 2 + 1] = cy + rad * sinf(a);
  }
  ui_polyline(pts, 10, 1.6f, clr, 1);
}

static void draw_checkbox(float x, float y, int on, float a) {
  ui_rect_border(x, y, 11, 11, 1.5f, ui_rgb(on ? PAL_SKY : C_MUTE, a));
  if (on) ui_rect(x + 3, y + 3, 5, 5, ui_rgb(PAL_SKY, a));
}

void render_question_draw(const QuestionModel *m) {
  const RequestView *req = &m->view->request;
  const Question *q = m->q;
  const QuestionView *qv = question_current(q, req);
  if (qv == NULL) return;
  QuestionLayout l;
  question_layout(qv, &l);
  float a = 1.0f;

  // encabezado: "Fondo" a la izquierda; "1/3 · 2 de 3" a la derecha (pregunta de la tarjeta y lugar de la tarjeta en la cola)
  char right[40];
  right[0] = '\0';
  if (req->question_count > 1) snprintf(right, sizeof right, "%d/%d", q->index + 1, req->question_count);
  if (req->total > 1) {
    size_t n = strlen(right);
    snprintf(right + n, sizeof right - n, "%s%u de %u", n > 0 ? " · " : "", (unsigned)req->position, (unsigned)req->total);
  }
  float rw = right[0] != '\0' ? ui_text_width(right, S_SMALL) : 0.0f;
  if (rw > 120.0f) rw = 120.0f;
  ui_text_draw(qv->header[0] != '\0' ? qv->header : req->title, (float)l.header.x + 2, center_y((float)l.header.y, (float)l.header.h, S_BODY), S_BODY, S_MIN,
               (float)l.header.w - rw - 12, ui_rgb(C_ASK, 1.0f), UI_ALIGN_LEFT);
  if (right[0] != '\0') {
    ui_text_draw(right, (float)(l.header.x + l.header.w - 2), center_y((float)l.header.y, (float)l.header.h, S_SMALL), S_SMALL, S_MIN, 120,
                 ui_rgb(C_MUTE, 1.0f), UI_ALIGN_RIGHT);
  }

  // texto de la pregunta
  for (int i = 0; i < qv->text_count; i++) {
    ui_text_draw(qv->text[i], (float)l.text.x + 2, (float)(l.text.y + i * 13), S_BODY, S_MIN, (float)l.text.w - 4, ui_rgb(C_INK, 1.0f), UI_ALIGN_LEFT);
  }

  // filas
  QuestionRow rows[QUESTION_MAX_ROWS];
  int n = question_rows(qv, rows);
  for (int i = 0; i < n; i++) {
    const Rect *r = &l.rows[i];
    int cur = q->cursor == i;
    // opciones: botones normales de la marca (radio 9, relieve de 2 px); la fila marcada lleva el borde celeste de 3 px
    ui_panel((float)r->x, (float)r->y, (float)r->w, (float)r->h, 9, pal()->btn_top, pal()->btn_bot, cur ? PAL_SKY : pal()->btn_border, cur ? 3.0f : 1.0f, pal()->edge);
    float ty = center_y((float)r->y, (float)r->h, S_BODY);
    float x = (float)r->x + 8;
    switch (rows[i].kind) {
      case QROW_OPTION: {
        const OptionView *o = &qv->options[rows[i].option];
        if (qv->multi) {
          draw_checkbox(x, (float)r->y + ((float)r->h - 11.0f) / 2.0f, (q->marks[q->index] >> (unsigned)rows[i].option) & 1u, a);
          x += 18;
        }
        ui_text_draw(o->label, x, ty, S_BODY, S_MIN, (float)(r->x + r->w) - x - (o->recommended ? 24.0f : 8.0f), ui_rgb(C_INK, 1.0f), UI_ALIGN_LEFT);
        if (o->recommended) draw_star((float)(r->x + r->w) - 13, (float)r->y + (float)r->h / 2.0f, 5.5f, ui_rgb(pal()->sky_text, a));
        break;
      }
      case QROW_DONE:
        ui_text_draw("Listo", x, ty, S_BODY, S_MIN, (float)r->w - 16, ui_rgb(q->marks[q->index] != 0 ? C_OK : C_MUTE, 1.0f), UI_ALIGN_LEFT);
        break;
      case QROW_OTHER:
        ui_text_draw("Otra…", x, ty, S_BODY, S_MIN, (float)r->w - 16, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_LEFT);
        break;
      case QROW_PC:
        ui_text_draw("Responder en el PC", x, ty, S_BODY, S_MIN, (float)r->w - 16, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_LEFT);
        break;
    }
  }

  if (!m->ready) { // guarda de 500 ms: las filas se ven apagadas (velo blanco)
    for (int i = 0; i < n; i++) ui_rrect((float)l.rows[i].x, (float)l.rows[i].y, (float)l.rows[i].w, (float)l.rows[i].h, 9, ui_rgb(pal()->bg_bot, 0.55f));
  }

  // descripción de la fila marcada
  if (q->cursor >= 0 && q->cursor < n) {
    const QuestionRow *cr = &rows[q->cursor];
    if (cr->kind == QROW_OPTION) {
      const OptionView *o = &qv->options[cr->option];
      for (int i = 0; i < o->desc_count; i++) {
        ui_text_draw(o->desc[i], (float)l.desc.x + 2, (float)(l.desc.y + i * 13), S_BODY, S_MIN, (float)l.desc.w - 4, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_LEFT);
      }
    } else {
      const char *help = cr->kind == QROW_DONE ? "Enviar lo marcado (al menos una opción)"
                         : cr->kind == QROW_OTHER ? "Escribir tu propia respuesta con el teclado"
                                                  : "Claude Code muestra la pregunta en el PC";
      ui_text_draw(help, (float)l.desc.x + 2, (float)l.desc.y, S_SMALL, S_MIN, (float)l.desc.w - 4, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_LEFT);
    }
  }

  // ayuda del pie
  const char *hint = qv->multi ? (q->index > 0 ? "A: marcar · B: pregunta anterior" : "A: marcar · Listo envía")
                               : (q->index > 0 ? "A: elegir · B: pregunta anterior" : "A: elegir");
  char buf[64];
  snprintf(buf, sizeof buf, "%s%s", hint, m->can_skip ? " · L/R: otra solicitud" : "");
  ui_text_draw(buf, LAYOUT_W / 2.0f, (float)l.hint.y, S_SMALL, S_MIN, (float)l.hint.w, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_CENTER);
}

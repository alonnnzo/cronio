#include "render_instruct.h"

#include <stdio.h>
#include <string.h>

#include "logic/layout.h"
#include "logic/palette.h"
#include "logic/theme.h"
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

void render_instruct_draw(const InstructModel *m) {
  const RequestView *req = &m->view->request;
  const Instruct *s = m->s;
  InstructLayout l;
  instruct_layout_n(&l, s->quick_n);

  // encabezado: título de la tarjeta a la izquierda; "N de M" a la derecha (lugar en la cola de solicitudes)
  const SessionView *owner = view_find_session(m->view, req->session_id);
  char right[24];
  right[0] = '\0';
  if (req->total > 1) snprintf(right, sizeof right, "%u de %u", (unsigned)req->position, (unsigned)req->total);
  float rw = right[0] != '\0' ? ui_text_width(right, S_SMALL) : 0.0f;
  if (rw > 90.0f) rw = 90.0f;
  ui_text_draw(req->title, (float)l.header.x + 2, center_y((float)l.header.y, (float)l.header.h, S_HEAD), S_HEAD, S_MIN, (float)l.header.w - rw - 12,
               ui_rgb(C_INK, 1.0f), UI_ALIGN_LEFT);
  if (right[0] != '\0') {
    ui_text_draw(right, (float)(l.header.x + l.header.w - 2), center_y((float)l.header.y, (float)l.header.h, S_SMALL), S_SMALL, S_MIN, 90, ui_rgb(C_MUTE, 1.0f),
                 UI_ALIGN_RIGHT);
  }

  // de qué sesión es y el comienzo de su último mensaje
  char who[VIEW_TEXT_BYTES + 16];
  snprintf(who, sizeof who, "%s", owner ? (owner->title[0] ? owner->title : owner->project) : "");
  ui_text_draw(who[0] ? who : "\xE2\x80\x94", (float)l.label.x + 2, center_y((float)l.label.y, (float)l.label.h, S_SMALL), S_SMALL, S_MIN, (float)l.label.w - 4,
               ui_rgb(C_ASK, 1.0f), UI_ALIGN_LEFT);
  for (int i = 0; i < req->line_count && i < 3; i++) {
    ui_text_draw(req->lines[i], (float)l.text.x + 2, (float)(l.text.y + i * l.text_pitch), S_SMALL, S_MIN, (float)l.text.w - 4, ui_rgb(C_INK, 1.0f), UI_ALIGN_LEFT);
  }

  // filas: atajos (dos columnas), Escribir y Seguir en el PC
  static const char *const LABEL[INSTRUCT_ROWS] = {"Escribir", "Seguir en el PC"};
  static const char *const HELP[INSTRUCT_ROWS] = {"Teclado: lo que escribas se lo manda a la sesi\xC3\xB3n", "Claude termina como siempre; sigues en el PC"};
  for (int i = 0; i < l.rows_n; i++) {
    const Rect *r = &l.rows[i];
    int cur = s->cursor == i;
    int fixed = i - s->quick_n; // < 0 atajo; 0 Escribir; 1 Seguir
    if (!l.compact) {
      ui_panel((float)r->x, (float)r->y, (float)r->w, (float)r->h, 12, pal()->row_top, pal()->row_bot, cur ? PAL_SKY : C_LINE, cur ? 3.0f : 1.0f, pal()->edge);
      ui_text_draw(LABEL[i], (float)r->x + 10, (float)r->y + 6, S_HEAD, S_MIN, (float)r->w - 20, ui_rgb(i == 0 ? C_OK : C_INK, 1.0f), UI_ALIGN_LEFT);
      ui_text_draw(HELP[i], (float)r->x + 10, (float)r->y + 24, S_SMALL, S_MIN, (float)r->w - 20, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_LEFT);
      continue;
    }
    // compacta: botones normales de la marca, como las opciones de las preguntas; la fila marcada lleva el borde celeste de 3 px
    ui_panel((float)r->x, (float)r->y, (float)r->w, (float)r->h, 9, pal()->btn_top, pal()->btn_bot, cur ? PAL_SKY : pal()->btn_border, cur ? 3.0f : 1.0f, pal()->edge);
    float ty = center_y((float)r->y, (float)r->h, S_BODY);
    if (fixed < 0) {
      ui_text_draw(req->quick[i].label, (float)r->x + 6, ty, S_BODY, S_MIN, (float)r->w - 12, ui_rgb(C_INK, 1.0f), UI_ALIGN_CENTER);
    } else {
      ui_text_draw(LABEL[fixed], (float)r->x + 10, ty, S_BODY, S_MIN, (float)r->w - 20, ui_rgb(fixed == 0 ? C_OK : C_INK, 1.0f), UI_ALIGN_LEFT);
    }
  }
  if (!m->ready) { // guarda de 500 ms: las filas se ven apagadas (velo)
    for (int i = 0; i < l.rows_n; i++) ui_rrect((float)l.rows[i].x, (float)l.rows[i].y, (float)l.rows[i].w, (float)l.rows[i].h, l.compact ? 9 : 12, ui_rgb(pal()->bg_bot, 0.55f));
  }
  // compacta: qué hace la fila marcada (un atajo muestra el texto que va a mandar)
  if (l.compact && s->cursor >= 0 && s->cursor < l.rows_n) {
    int fixed = s->cursor - s->quick_n;
    const char *help = fixed < 0 ? req->quick[s->cursor].text : HELP[fixed];
    ui_text_draw(help, (float)l.help.x + 2, center_y((float)l.help.y, (float)l.help.h, S_SMALL), S_SMALL, S_MIN, (float)l.help.w - 4, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_LEFT);
  }

  // ayuda del pie
  char buf[72];
  snprintf(buf, sizeof buf, "A: elegir \xC2\xB7 B no hace nada%s", m->can_skip ? " \xC2\xB7 L/R: otra solicitud" : "");
  ui_text_draw(buf, LAYOUT_W / 2.0f, (float)l.hint.y, S_SMALL, S_MIN, (float)l.hint.w, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_CENTER);
}

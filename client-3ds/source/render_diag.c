#include "render_diag.h"

#include "logic/palette.h"
#include "ui_draw.h"
#include "ui_scale.h"
#include "ui_text.h"

#define C_INK (pal()->ink)
#define C_YELLOW (pal()->sky_text)
#define LINE_H 17.0f

void render_diag_draw(const char lines[][DIAG_LINE_BYTES], int count) {
  float y = 4.0f;
  ui_text_draw("DIAGNOSTICO   (L+R 1 s: salir)", 6, y, S_BODY, S_MIN, 308, ui_rgb(C_YELLOW, 1.0f), UI_ALIGN_LEFT);
  y += LINE_H + 3.0f;
  for (int i = 0; i < count; i++) {
    ui_text_draw(lines[i], 6, y, S_BODY, S_MIN, 308, ui_rgb(C_INK, 1.0f), UI_ALIGN_LEFT);
    y += LINE_H;
  }
}

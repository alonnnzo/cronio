#include "render_menu.h"

#include <stdio.h>

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

// Fila del menú: relieve de 2 px; la selección es el borde celeste de 3 px. Sin conexión: se ve apagada (texto al 50 %).
static void draw_row_box(const Rect *r, int selected, int enabled) {
  (void)enabled;
  ui_panel((float)r->x, (float)r->y, (float)r->w, (float)r->h, 10, pal()->row_top, pal()->row_bot, selected ? PAL_SKY : C_LINE, selected ? 3.0f : 1.0f, pal()->edge);
}

// Etiqueta a la izquierda y valor a la derecha, centrados en `h` px desde la parte alta de la fila.
static void draw_label_value(const Rect *r, float top, float h, const char *label, const char *value, uint32_t value_rgb, float a) {
  float ty = center_y(top, h, S_BODY);
  float vw = value != NULL ? ui_text_width(value, S_BODY) : 0.0f;
  if (vw > 150.0f) vw = 150.0f;
  ui_text_draw(label, (float)r->x + 8, ty, S_BODY, S_MIN, (float)r->w - 24 - vw, ui_rgb(C_INK, a), UI_ALIGN_LEFT);
  if (value != NULL) ui_text_draw(value, (float)(r->x + r->w - 8), ty, S_BODY, S_MIN, 150, ui_rgb(value_rgb, a), UI_ALIGN_RIGHT);
}

static void draw_back(const MenuLayout *l, const char *label) {
  ui_button((float)l->back.x, (float)l->back.y, (float)l->back.w, (float)l->back.h, UI_BTN_NORMAL, label, S_SMALL, 0, 1.0f, 0, 0);
}

static void draw_root(const Menu *m, const View *v, int diag_on, int sound_ok, const Update *upd) {
  MenuLayout l;
  menu_layout(MENU_ROOT, &l);
  ui_text_draw("Configuración", 10, 5, S_TITLE, S_MIN, 180, ui_rgb(C_INK, 1.0f), UI_ALIGN_LEFT);
  draw_back(&l, "SELECT/B: cerrar");
  ui_rect(8, 31, LAYOUT_W - 16, 1, ui_rgb(C_LINE, 1.0f));

  for (int i = 0; i < MENU_ROOT_ENTRIES; i++) {
    const Rect *r = &l.rows[i];
    MenuEntry e = (MenuEntry)i;
    int enabled = menu_entry_enabled(e, v);
    float a = enabled ? 1.0f : 0.5f;
    draw_row_box(r, m->cursor == i, enabled);
    const char *value = NULL;
    uint32_t vrgb = C_ASK;
    const char *hint = NULL;
    char buf[40];
    switch (e) {
      case MENU_E_NOTIFY:
        value = enabled ? menu_notify_label(v->settings.notify_default) : "sin conexión";
        hint = "Sesiones nuevas · cada sesión cambia el suyo";
        break;
      case MENU_E_ACK:
        value = enabled ? (v->settings.notify_ack ? "sí" : "no") : "sin conexión";
        hint = "Cada aviso queda en una tarjeta con \"Visto\"";
        break;
      case MENU_E_SOUND:
        value = !enabled ? "sin conexión" : !sound_ok ? "sin sonido en esta consola" : v->settings.sound ? "sí" : "no";
        break;
      case MENU_E_QUESTIONS:
        value = !enabled ? "sin conexión" : v->settings.questions ? "sí" : "no";
        break;
      case MENU_E_READER:
        value = !enabled ? "sin conexión" : v->settings.reader_default ? "resumen" : "completo";
        break;
      case MENU_E_INSTRUCT_WAIT:
        if (enabled) {
          snprintf(buf, sizeof buf, "%d min", v->settings.instruct_wait_max);
          value = buf;
        } else {
          value = !menu_agent_enabled(v) ? "sin conexión" : "el puente no lo ofrece";
        }
        break;
      case MENU_E_AGENTS:
        if (enabled) {
          snprintf(buf, sizeof buf, v->settings.hidden_count == 0 ? "todos visibles" : v->settings.hidden_count == 1 ? "1 oculto" : "%d ocultos",
                   v->settings.hidden_count);
          value = buf;
        } else {
          value = "sin conexión";
        }
        break;
      case MENU_E_GUIDE:
        value = ">";
        vrgb = C_MUTE;
        break;
      case MENU_E_DIAG:
        value = diag_on ? "activo" : "apagado";
        vrgb = diag_on ? C_OK : C_MUTE;
        break;
      case MENU_E_THEME:
        value = pal_is_dark() ? "oscuro" : "claro"; // preferencia local: también sin conexión
        break;
      case MENU_E_UPDATE:
        // la versión de esta app, o la nueva si el puente la ofrece (también sin conexión: la versión actual se sabe siempre)
        if (upd != NULL && upd->has_offer) {
          snprintf(buf, sizeof buf, "nueva: %s", upd->offer);
          value = buf;
        } else {
          snprintf(buf, sizeof buf, "%s", upd != NULL && upd->current[0] != '\0' ? upd->current : "?");
          value = buf;
          vrgb = C_MUTE;
        }
        break;
    }
    if (!enabled) vrgb = C_MUTE;
    if (hint != NULL) {
      draw_label_value(r, (float)r->y, 16.0f, menu_entry_title(e), value, vrgb, a);
      ui_text_draw(hint, (float)r->x + 8, (float)r->y + 14, S_SMALL, S_MIN, (float)r->w - 16, ui_rgb(C_MUTE, a), UI_ALIGN_LEFT);
    } else {
      draw_label_value(r, (float)r->y, (float)r->h, menu_entry_title(e), value, vrgb, a);
    }
  }
  ui_text_draw("Arriba/abajo: elegir · A: cambiar · lápiz: tocar", LAYOUT_W / 2.0f, (float)l.hint.y + 1, S_SMALL, S_MIN, 300, ui_rgb(C_MUTE, 1.0f),
               UI_ALIGN_CENTER);
}

static void draw_agents(const Menu *m, const View *v) {
  MenuLayout l;
  menu_layout(MENU_AGENTS, &l);
  int enabled = menu_agent_enabled(v);
  unsigned hidden = menu_hidden_mask(v);
  ui_text_draw("Agentes", 10, 5, S_TITLE, S_MIN, 180, ui_rgb(C_INK, 1.0f), UI_ALIGN_LEFT);
  draw_back(&l, "B: volver");
  ui_rect(8, 31, LAYOUT_W - 16, 1, ui_rgb(C_LINE, 1.0f));
  for (int i = 0; i < AGENT_COUNT; i++) {
    const Rect *r = &l.rows[i];
    int off = (hidden >> (unsigned)i) & 1u;
    draw_row_box(r, m->cursor == i, enabled);
    float a = enabled ? 1.0f : 0.5f;
    // cuadrado del agente (mini cara)
    ui_agent_square((float)r->x + 8, (float)r->y + (float)r->h / 2.0f - 8, 16, theme_agent_ui_rgb((AgentKind)i), off ? 0.35f : a);
    float ty = center_y((float)r->y, (float)r->h, S_BODY);
    ui_text_draw(theme_agent_name((AgentKind)i), (float)r->x + 30, ty, S_BODY, S_MIN, 150, ui_rgb(C_INK, off ? 0.45f : a), UI_ALIGN_LEFT);
    const char *value = !enabled ? "sin conexión" : off ? "oculto" : "visible";
    ui_text_draw(value, (float)(r->x + r->w - 8), ty, S_BODY, S_MIN, 120, ui_rgb(!enabled ? C_MUTE : off ? C_MUTE : C_OK, 1.0f), UI_ALIGN_RIGHT);
  }
  float y = (float)l.hint.y + 2;
  ui_text_draw("Un agente oculto no sale en la lista ni en la cara,", LAYOUT_W / 2.0f, y, S_SMALL, S_MIN, 304, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_CENTER);
  ui_text_draw("pero sus permisos sí llegan y se muestran.", LAYOUT_W / 2.0f, y + 13, S_SMALL, S_MIN, 304, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_CENTER);
}

void render_menu_draw(const Menu *m, const View *v, int diag_on, int sound_ok, const Update *upd) {
  if (m->level == MENU_AGENTS) draw_agents(m, v);
  else draw_root(m, v, diag_on, sound_ok, upd);
}

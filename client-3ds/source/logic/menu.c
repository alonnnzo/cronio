#include "menu.h"

#include <stddef.h>

#include "palette.h"

void menu_init(Menu *m) {
  m->open = 0;
  m->level = MENU_ROOT;
  m->cursor = 0;
  m->root_cursor = 0;
}

void menu_open(Menu *m) {
  m->open = 1;
  m->level = MENU_ROOT;
  m->cursor = 0;
  m->root_cursor = 0;
}

void menu_close(Menu *m) { menu_init(m); }

int menu_agent_enabled(const View *v) { return v != NULL && v->has_settings; }

int menu_entry_enabled(MenuEntry e, const View *v) {
  if (e == MENU_E_GUIDE || e == MENU_E_DIAG || e == MENU_E_THEME || e == MENU_E_UPDATE) return 1;
  if (e == MENU_E_INSTRUCT_WAIT) return menu_agent_enabled(v) && v->settings.has_instruct_wait;
  return menu_agent_enabled(v);
}

unsigned menu_hidden_mask(const View *v) {
  unsigned mask = 0;
  if (v == NULL || !v->has_settings) return 0;
  for (int i = 0; i < v->settings.hidden_count; i++) {
    AgentKind k = v->settings.hidden[i];
    if (k >= 0 && k < AGENT_COUNT) mask |= 1u << (unsigned)k;
  }
  return mask;
}

static int row_count(MenuLevel level) { return level == MENU_AGENTS ? MENU_AGENT_ROWS : MENU_ROOT_ENTRIES; }

void menu_move(Menu *m, int dy) {
  int c = m->cursor + (dy > 0 ? 1 : dy < 0 ? -1 : 0);
  int n = row_count(m->level);
  if (c < 0) c = 0;
  if (c > n - 1) c = n - 1;
  m->cursor = c;
  if (m->level == MENU_ROOT) m->root_cursor = c;
}

MenuOut menu_activate(Menu *m, const View *v, int dir, int cycle_only) {
  MenuOut out = {MENU_OUT_NONE, 0};
  int step = dir < 0 ? -1 : 1;
  if (m->level == MENU_AGENTS) {
    if (!menu_agent_enabled(v) || m->cursor < 0 || m->cursor >= AGENT_COUNT) return out;
    out.kind = MENU_OUT_HIDDEN;
    out.value = (int)(menu_hidden_mask(v) ^ (1u << (unsigned)m->cursor));
    return out;
  }
  MenuEntry e = (MenuEntry)m->cursor;
  if (!menu_entry_enabled(e, v)) return out;
  switch (e) {
    case MENU_E_NOTIFY:
      out.kind = MENU_OUT_NOTIFY;
      out.value = ((int)v->settings.notify_default + step + NOTIFY_COUNT) % NOTIFY_COUNT;
      break;
    case MENU_E_ACK:
      out.kind = MENU_OUT_ACK;
      out.value = !v->settings.notify_ack;
      break;
    case MENU_E_SOUND:
      out.kind = MENU_OUT_SOUND;
      out.value = !v->settings.sound;
      break;
    case MENU_E_QUESTIONS:
      out.kind = MENU_OUT_QUESTIONS;
      out.value = !v->settings.questions;
      break;
    case MENU_E_READER:
      out.kind = MENU_OUT_READER;
      out.value = !v->settings.reader_default;
      break;
    case MENU_E_INSTRUCT_WAIT: {
      // 5 -> 10 -> 30 -> 5 (y al revés con izquierda): un ciclo de tres valores
      static const int WAIT[3] = {5, 10, 30};
      int at = v->settings.instruct_wait_max == 5 ? 0 : v->settings.instruct_wait_max == 30 ? 2 : 1;
      out.kind = MENU_OUT_INSTRUCT_WAIT;
      out.value = WAIT[(at + step + 3) % 3];
      break;
    }
    case MENU_E_AGENTS:
      if (cycle_only) break;
      m->root_cursor = m->cursor;
      m->level = MENU_AGENTS;
      m->cursor = 0;
      break;
    case MENU_E_GUIDE:
      if (!cycle_only) out.kind = MENU_OUT_GUIDE;
      break;
    case MENU_E_DIAG:
      if (!cycle_only) out.kind = MENU_OUT_DIAG;
      break;
    case MENU_E_THEME:
      out.kind = MENU_OUT_THEME;
      out.value = !pal_is_dark(); // A o izquierda/derecha alternan; el valor actual es la paleta en uso
      break;
    case MENU_E_UPDATE:
      if (!cycle_only) out.kind = MENU_OUT_UPDATE;
      break;
  }
  return out;
}

MenuOut menu_back(Menu *m) {
  MenuOut out = {MENU_OUT_NONE, 0};
  if (m->level == MENU_AGENTS) {
    m->level = MENU_ROOT;
    m->cursor = m->root_cursor;
    return out;
  }
  out.kind = MENU_OUT_CLOSE;
  return out;
}

// ---- geometría ----

#define MENU_TOP 34
#define MENU_GAP 2
#define MENU_X 8
#define MENU_W 304

void menu_layout(MenuLevel level, MenuLayout *out) {
  static const int ROOT_H[MENU_ROOT_ENTRIES] = {25, 25, 14, 14, 14, 14, 14, 14, 14, 14, 14};
  int y = MENU_TOP;
  out->count = row_count(level);
  for (int i = 0; i < MENU_ROOT_ENTRIES; i++) out->rows[i].x = out->rows[i].y = out->rows[i].w = out->rows[i].h = 0;
  int gap = level == MENU_AGENTS ? MENU_GAP : 1; // la raíz tiene once filas y deja sitio a la ayuda del pie
  for (int i = 0; i < out->count; i++) {
    int h = level == MENU_AGENTS ? 26 : ROOT_H[i];
    out->rows[i].x = MENU_X;
    out->rows[i].y = y;
    out->rows[i].w = MENU_W;
    out->rows[i].h = h;
    y += h + gap;
  }
  out->back.x = 196;
  out->back.y = 4;
  out->back.w = 120;
  out->back.h = 26;
  out->hint.x = MENU_X;
  out->hint.y = level == MENU_AGENTS ? y + 4 : y; // la raíz, con once filas, deja justo una línea
  out->hint.w = MENU_W;
  out->hint.h = level == MENU_AGENTS ? 240 - (y + 4) - 4 : 240 - y - 3;
}

int menu_hit_row(MenuLevel level, int x, int y) {
  MenuLayout l;
  menu_layout(level, &l);
  for (int i = 0; i < l.count; i++) {
    if (rect_contains(&l.rows[i], x, y)) return i;
  }
  return -1;
}

int menu_hit_back(MenuLevel level, int x, int y) {
  MenuLayout l;
  menu_layout(level, &l);
  return rect_contains(&l.back, x, y);
}

const char *menu_notify_label(NotifyMode m) {
  switch (m) {
    case NOTIFY_ALL: return "todo";
    case NOTIFY_IMPORTANT: return "lo importante";
    case NOTIFY_END: return "solo al terminar";
    case NOTIFY_SILENT: return "silencio";
    default: return "?";
  }
}

const char *menu_entry_title(MenuEntry e) {
  switch (e) {
    case MENU_E_NOTIFY: return "Avisos por defecto";
    case MENU_E_ACK: return "Pedir \"Visto\" en los avisos";
    case MENU_E_SOUND: return "Sonido";
    case MENU_E_QUESTIONS: return "Preguntas en la 3DS";
    case MENU_E_READER: return "Abrir mensajes en";
    case MENU_E_INSTRUCT_WAIT: return "Esperar instrucción hasta";
    case MENU_E_AGENTS: return "Agentes";
    case MENU_E_GUIDE: return "Guía de botones";
    case MENU_E_DIAG: return "Diagnóstico";
    case MENU_E_THEME: return "Tema";
    case MENU_E_UPDATE: return "Actualizar app";
  }
  return "";
}

#include "theme.h"

#include <stdio.h>
#include <string.h>

#include "../core/nav.h"
#include "utf8util.h"

static const char *const NAMES[AGENT_COUNT] = {"Claude", "Gemini", "Codex", "Cursor", "Hermes"};
static const uint32_t COLORS[AGENT_COUNT] = {0xee7446u, 0x5b8cffu, 0x2fd08au, 0xc9ced9u, 0xf6c544u};

static int valid_kind(AgentKind k) { return k >= 0 && k < AGENT_COUNT; }

const char *theme_agent_name(AgentKind kind) { return valid_kind(kind) ? NAMES[kind] : "Agente"; }
uint32_t theme_agent_rgb(AgentKind kind) { return valid_kind(kind) ? COLORS[kind] : THEME_NEUTRAL_RGB; }
uint32_t theme_agent_ui_rgb(AgentKind kind) { return valid_kind(kind) ? COLORS[kind] : 0xece9f5u; }

const char *theme_state_label(AgentState s) {
  switch (s) {
    case STATE_IDLE: return "inactivo";
    case STATE_WORKING: return "trabajando";
    case STATE_ASK: return "te espera";
    case STATE_DONE: return "terminó";
    case STATE_ERROR: return "error";
    default: return "?";
  }
}

const char *theme_mode_label(PermMode m) { return m == MODE_MANUAL ? "Elijo yo" : "En fila"; }

const char *theme_kind_summary(const View *v, AgentKind kind) {
  int any = 0, ask = 0, err = 0, working = 0, done = 0;
  for (int i = 0; i < v->session_count; i++) {
    if (v->sessions[i].kind != kind) continue;
    any = 1;
    switch (v->sessions[i].state) {
      case STATE_ASK: ask = 1; break;
      case STATE_ERROR: err = 1; break;
      case STATE_WORKING: working = 1; break;
      case STATE_DONE: done = 1; break;
      default: break;
    }
  }
  if (!any) return "sin sesiones";
  if (ask) return "te espera";
  if (err) return "error";
  if (working) return "trabajando";
  if (done) return "terminó";
  return "inactivo";
}

void theme_card_owner(const View *v, char *out, size_t cap) {
  if (cap == 0) return;
  out[0] = '\0';
  if (!v->has_request) return;
  const SessionView *s = view_find_session(v, v->request.session_id);
  char tmp[VIEW_TEXT_BYTES * 2 + 16];
  if (s != NULL) snprintf(tmp, sizeof tmp, "%s \xC2\xB7 %s", theme_agent_name(s->kind), s->title);
  else snprintf(tmp, sizeof tmp, "%s", v->request.title);
  // sin recortar caracteres: solo asegura que quepa sin partir una secuencia
  utf8_clip(tmp, out, cap, (size_t)-1 / 2);
}

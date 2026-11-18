#include "nav.h"

#include <string.h>

static int clamp_int(int n, int lo, int hi) { return n < lo ? lo : n > hi ? hi : n; }

static NavOut out_none(void) {
  NavOut o;
  o.kind = NAV_OUT_NONE;
  o.session_id[0] = '\0';
  return o;
}

static NavOut out_unfocus(void) {
  NavOut o = out_none();
  o.kind = NAV_OUT_UNFOCUS;
  return o;
}

static NavOut out_focus(const char *id) {
  NavOut o = out_none();
  o.kind = NAV_OUT_FOCUS;
  size_t n = strlen(id);
  if (n > VIEW_MAX_ID) n = VIEW_MAX_ID;
  memcpy(o.session_id, id, n);
  o.session_id[n] = '\0';
  return o;
}

static void set_id(ViewId dst, const char *src) {
  size_t n = strlen(src);
  if (n > VIEW_MAX_ID) n = VIEW_MAX_ID;
  memcpy(dst, src, n);
  dst[n] = '\0';
}

void nav_init(Nav *n) {
  memset(n, 0, sizeof *n);
  n->level = NAV_AGENTS;
  n->kind = AGENT_NONE;
}

int nav_session_count(const View *v, AgentKind kind) {
  int c = 0;
  for (int i = 0; i < v->session_count; i++) {
    if (v->sessions[i].kind == kind) c++;
  }
  return c;
}

const SessionView *nav_session_at(const View *v, AgentKind kind, int index) {
  if (index < 0) return NULL;
  int c = 0;
  for (int i = 0; i < v->session_count; i++) {
    if (v->sessions[i].kind != kind) continue;
    if (c == index) return &v->sessions[i];
    c++;
  }
  return NULL;
}

// Posición de la sesión id entre las del agente, o -1.
static int index_of(const View *v, AgentKind kind, const char *id) {
  int c = 0;
  for (int i = 0; i < v->session_count; i++) {
    if (v->sessions[i].kind != kind) continue;
    if (strcmp(v->sessions[i].id, id) == 0) return c;
    c++;
  }
  return -1;
}

static int session_exists(const View *v, const char *id) {
  for (int i = 0; i < v->session_count; i++) {
    if (strcmp(v->sessions[i].id, id) == 0) return 1;
  }
  return 0;
}

int nav_agent_count(const View *v) {
  AgentKind list[AGENT_COUNT];
  return view_visible_agents(v, list);
}

AgentKind nav_agent_at(const View *v, int index) {
  AgentKind list[AGENT_COUNT];
  int n = view_visible_agents(v, list);
  return index >= 0 && index < n ? list[index] : AGENT_NONE;
}

// Posición del agente entre los visibles, o 0 si está oculto (el cursor vuelve al inicio).
static int agent_position(const View *v, AgentKind kind) {
  AgentKind list[AGENT_COUNT];
  int n = view_visible_agents(v, list);
  for (int i = 0; i < n; i++) {
    if (list[i] == kind) return i;
  }
  return 0;
}

int nav_item_count(const Nav *n, const View *v) {
  if (n->level == NAV_AGENTS) return nav_agent_count(v);
  if (n->level == NAV_SESSIONS) return nav_session_count(v, n->kind);
  return 0;
}

NavOut nav_move(Nav *n, const View *v, int dx, int dy) {
  int count = nav_item_count(n, v);
  if (count == 0) return out_none();
  int c = n->cursor;
  if (n->level == NAV_AGENTS) {
    if (dx) c = clamp_int(c + dx, 0, count - 1);
    if (dy) {
      int next = c + dy * NAV_GRID_COLS;
      c = (next >= 0 && next < count) ? next : c; // en el borde de la cuadrícula se queda
    }
  } else {
    c = clamp_int(c + dx + dy, 0, count - 1); // en la lista, cualquier flecha recorre
  }
  n->cursor = c;
  return out_none();
}

NavOut nav_enter(Nav *n, const View *v, int index, uint64_t now) {
  int i = index < 0 ? n->cursor : index;
  if (n->level == NAV_AGENTS) {
    AgentKind picked = nav_agent_at(v, i);
    if (picked == AGENT_NONE) return out_none();
    n->level = NAV_SESSIONS;
    n->kind = picked;
    n->session_id[0] = '\0';
    n->cursor = 0;
    return out_none();
  }
  if (n->level == NAV_SESSIONS) {
    const SessionView *s = nav_session_at(v, n->kind, i);
    if (s == NULL) return out_none();
    n->level = NAV_DETAIL;
    set_id(n->session_id, s->id);
    n->cursor = 0;
    n->confirmed = 0;
    n->since = now;
    return out_focus(s->id);
  }
  return out_none();
}

NavOut nav_open_session(Nav *n, const View *v, const char *session_id, uint64_t now) {
  const SessionView *s = view_find_session(v, session_id);
  if (s == NULL || view_agent_hidden(v, s->kind)) return out_none();
  if (n->level == NAV_DETAIL && strcmp(n->session_id, s->id) == 0) return out_none();
  n->level = NAV_DETAIL;
  n->kind = s->kind;
  set_id(n->session_id, s->id);
  n->cursor = 0;
  n->confirmed = 0;
  n->since = now;
  return out_focus(s->id);
}

NavOut nav_back(Nav *n, const View *v) {
  if (n->level == NAV_DETAIL) {
    int i = index_of(v, n->kind, n->session_id);
    n->level = NAV_SESSIONS;
    n->session_id[0] = '\0';
    n->cursor = i > 0 ? i : 0;
    n->confirmed = 0;
    n->since = 0;
    return out_unfocus();
  }
  if (n->level == NAV_SESSIONS) {
    n->cursor = agent_position(v, n->kind);
    n->level = NAV_AGENTS;
    n->kind = AGENT_NONE;
    n->session_id[0] = '\0';
    return out_none();
  }
  return out_none();
}

NavOut nav_sync(Nav *n, const View *v, int64_t now) {
  if (n->level != NAV_AGENTS && view_agent_hidden(v, n->kind)) {
    // el agente de esta pantalla se ocultó en la configuración: de vuelta a la lista de agentes (y se suelta el enfoque)
    int was_detail = n->level == NAV_DETAIL;
    n->level = NAV_AGENTS;
    n->kind = AGENT_NONE;
    n->session_id[0] = '\0';
    n->cursor = 0;
    n->confirmed = 0;
    n->since = 0;
    return was_detail ? out_unfocus() : out_none();
  }
  if (n->level == NAV_DETAIL) {
    if (!session_exists(v, n->session_id)) {
      // la sesión abierta desapareció: un nivel atrás y se avisa al puente
      int count = nav_session_count(v, n->kind);
      n->level = NAV_SESSIONS;
      n->session_id[0] = '\0';
      n->cursor = clamp_int(n->cursor, 0, count > 0 ? count - 1 : 0);
      n->confirmed = 0;
      n->since = 0;
      return out_unfocus();
    }
    if (v->has_detail && strcmp(v->detail.session_id, n->session_id) == 0) {
      n->confirmed = 1;
      return out_none();
    }
    // El puente ya no tiene este enfoque (otro cliente lo quitó o hubo skip): no se envía focus.
    int timed_out = now >= 0 && (now - (int64_t)n->since) >= NAV_DETAIL_CONFIRM_MS;
    if (n->confirmed || timed_out) {
      int i = index_of(v, n->kind, n->session_id);
      n->level = NAV_SESSIONS;
      n->session_id[0] = '\0';
      n->cursor = i > 0 ? i : 0;
      n->confirmed = 0;
      n->since = 0;
    }
    return out_none();
  }
  int count = nav_item_count(n, v);
  n->cursor = clamp_int(n->cursor, 0, count > 0 ? count - 1 : 0);
  return out_none();
}

NavBAction nav_b_action(const View *v) { return v->has_request ? NAV_B_DENY : NAV_B_BACK; }

int nav_skip_wanted(const View *v) { return v->mode == MODE_QUEUE && v->has_request && v->pending_count > 1; }

int nav_mode_target_manual(const View *v) { return v->mode == MODE_MANUAL ? 0 : 1; }

// Mismos escenarios que packages/simulator/test/nav.test.ts.
#include "test.h"

#include "../source/core/nav.h"

static View view1;   // a, b, c de claude y g de gemini
static View scratch; // vistas armadas por cada prueba

static void v_reset(View *v) {
  memset(v, 0, sizeof *v);
  v->mode = MODE_QUEUE;
  v->face.kind = AGENT_NONE;
  v->face.mood = MOOD_IDLE;
  v->face.line_count = 1;
  strcpy(v->face.lines[0], "x");
  v->led = VIEW_LED_OFF;
}

static void v_session(View *v, const char *id, AgentKind kind) {
  SessionView *s = &v->sessions[v->session_count++];
  memset(s, 0, sizeof *s);
  strcpy(s->id, id);
  s->kind = kind;
  strcpy(s->title, id);
  strcpy(s->project, "p");
  strcpy(s->model, "m");
  s->state = STATE_IDLE;
}

static void v_request(View *v, int pending, PermMode mode) {
  v->has_request = 1;
  strcpy(v->request.id, "r1");
  strcpy(v->request.session_id, "a");
  strcpy(v->request.title, "t");
  v->request.line_count = 1;
  strcpy(v->request.lines[0], "ls");
  v->request.expires_in_s = 40;
  v->request.position = 1;
  v->request.total = 1;
  v->pending_count = (uint32_t)pending;
  v->mode = mode;
}

static void v_detail(View *v, const char *id) {
  v->has_detail = 1;
  strcpy(v->detail.session_id, id);
}

static void nav_set(Nav *n, NavLevel level, AgentKind kind, const char *sid, int cursor) {
  memset(n, 0, sizeof *n);
  n->level = level;
  n->kind = kind;
  strcpy(n->session_id, sid);
  n->cursor = cursor;
}

static void check_nav(const Nav *n, NavLevel level, AgentKind kind, const char *sid, int cursor) {
  CHECK_EQ_INT(n->level, level);
  CHECK_EQ_INT(n->kind, kind);
  CHECK_STR(n->session_id, sid);
  CHECK_EQ_INT(n->cursor, cursor);
}

static void check_out(NavOut o, NavOutKind kind, const char *sid) {
  CHECK_EQ_INT(o.kind, kind);
  if (kind == NAV_OUT_FOCUS) CHECK_STR(o.session_id, sid);
}

static int nav_same(const Nav *a, const Nav *b) {
  return a->level == b->level && a->kind == b->kind && strcmp(a->session_id, b->session_id) == 0 &&
         a->cursor == b->cursor && a->confirmed == b->confirmed && a->since == b->since;
}

static void test_enter_and_exit(void) {
  Nav n;
  nav_init(&n);
  check_nav(&n, NAV_AGENTS, AGENT_NONE, "", 0);

  // agentes -> sesiones -> detalle: solo entrar al detalle envía focus
  check_out(nav_enter(&n, &view1, -1, 0), NAV_OUT_NONE, "");
  check_nav(&n, NAV_SESSIONS, AGENT_CLAUDE, "", 0);
  nav_move(&n, &view1, 0, 1);
  check_out(nav_enter(&n, &view1, -1, 0), NAV_OUT_FOCUS, "b");
  check_nav(&n, NAV_DETAIL, AGENT_CLAUDE, "b", 0);
  CHECK_EQ_INT(n.confirmed, 0);
  CHECK_EQ_INT(n.since, 0);

  // salir del detalle envía focus null y deja el cursor en esa sesión
  nav_set(&n, NAV_DETAIL, AGENT_CLAUDE, "c", 0);
  check_out(nav_back(&n, &view1), NAV_OUT_UNFOCUS, "");
  check_nav(&n, NAV_SESSIONS, AGENT_CLAUDE, "", 2);

  // volver de sesiones a agentes no envía nada y deja el cursor en el agente
  nav_set(&n, NAV_SESSIONS, AGENT_GEMINI, "", 0);
  check_out(nav_back(&n, &view1), NAV_OUT_NONE, "");
  check_nav(&n, NAV_AGENTS, AGENT_NONE, "", 1);

  // volver en agentes no hace nada
  nav_init(&n);
  check_out(nav_back(&n, &view1), NAV_OUT_NONE, "");
  check_nav(&n, NAV_AGENTS, AGENT_NONE, "", 0);

  // enter con índice (clic) entra a ese elemento
  nav_init(&n);
  nav_enter(&n, &view1, 1, 0);
  CHECK_EQ_INT(n.kind, AGENT_GEMINI);
  nav_init(&n);
  nav_enter(&n, &view1, 0, 0);
  check_out(nav_enter(&n, &view1, 2, 0), NAV_OUT_FOCUS, "c");
  CHECK_STR(n.session_id, "c");

  // índice fuera de rango o sin sesiones: no cambia nada
  Nav before;
  nav_init(&n);
  nav_enter(&n, &view1, 9, 0);
  nav_init(&before);
  CHECK(nav_same(&n, &before));
  nav_set(&n, NAV_SESSIONS, AGENT_CURSOR, "", 0);
  before = n;
  check_out(nav_enter(&n, &view1, -1, 0), NAV_OUT_NONE, "");
  CHECK(nav_same(&n, &before));
  nav_set(&n, NAV_SESSIONS, AGENT_CLAUDE, "", 0);
  before = n;
  check_out(nav_enter(&n, &view1, 3, 0), NAV_OUT_NONE, "");   // claude tiene 3: el índice 3 no existe
  check_out(nav_enter(&n, &view1, 99, 0), NAV_OUT_NONE, "");
  CHECK(nav_same(&n, &before));

  // enter en el detalle no hace nada
  nav_set(&n, NAV_DETAIL, AGENT_CLAUDE, "a", 0);
  before = n;
  check_out(nav_enter(&n, &view1, -1, 0), NAV_OUT_NONE, "");
  CHECK(nav_same(&n, &before));

  // un agente sin sesiones se puede abrir y muestra la lista vacía
  nav_init(&n);
  nav_move(&n, &view1, 1, 0);
  nav_move(&n, &view1, 1, 0);
  check_out(nav_enter(&n, &view1, -1, 0), NAV_OUT_NONE, "");
  CHECK_EQ_INT(n.level, NAV_SESSIONS);
  CHECK_EQ_INT(n.kind, AGENT_CODEX);
  CHECK_EQ_INT(nav_item_count(&n, &view1), 0);
}

static void test_cursor(void) {
  Nav n;
  nav_init(&n);
  nav_move(&n, &view1, -1, 0);
  CHECK_EQ_INT(n.cursor, 0); // borde izquierdo
  nav_move(&n, &view1, 0, 1);
  CHECK_EQ_INT(n.cursor, 3);
  nav_move(&n, &view1, 1, 0);
  CHECK_EQ_INT(n.cursor, 4);
  nav_move(&n, &view1, 1, 0);
  CHECK_EQ_INT(n.cursor, 4); // último
  nav_move(&n, &view1, 0, 1);
  CHECK_EQ_INT(n.cursor, 4); // no hay fila de abajo
  nav_move(&n, &view1, 0, -1);
  CHECK_EQ_INT(n.cursor, 1);
  nav_move(&n, &view1, 0, -1);
  CHECK_EQ_INT(n.cursor, 1); // no hay fila de arriba

  // lista de sesiones: cualquier flecha recorre y se queda en los bordes
  nav_set(&n, NAV_SESSIONS, AGENT_CLAUDE, "", 0);
  nav_move(&n, &view1, 0, -1);
  CHECK_EQ_INT(n.cursor, 0);
  nav_move(&n, &view1, 0, 1);
  nav_move(&n, &view1, 1, 0);
  nav_move(&n, &view1, 0, 1);
  CHECK_EQ_INT(n.cursor, 2);

  // sin elementos, mover no rompe
  nav_set(&n, NAV_SESSIONS, AGENT_HERMES, "", 0);
  nav_move(&n, &view1, 0, 1);
  check_nav(&n, NAV_SESSIONS, AGENT_HERMES, "", 0);

  // en el detalle no se mueve nada
  nav_set(&n, NAV_DETAIL, AGENT_CLAUDE, "a", 0);
  nav_move(&n, &view1, 1, 1);
  CHECK_EQ_INT(n.cursor, 0);

  // el cursor vuelve a rango cuando la lista se acorta
  nav_set(&n, NAV_SESSIONS, AGENT_CLAUDE, "", 2);
  v_reset(&scratch);
  v_session(&scratch, "a", AGENT_CLAUDE);
  check_out(nav_sync(&n, &scratch, -1), NAV_OUT_NONE, "");
  CHECK_EQ_INT(n.cursor, 0);
  v_reset(&scratch);
  nav_set(&n, NAV_SESSIONS, AGENT_CLAUDE, "", 2);
  nav_sync(&n, &scratch, -1);
  CHECK_EQ_INT(n.cursor, 0);

  // sync no cambia un estado válido
  Nav before;
  nav_set(&n, NAV_SESSIONS, AGENT_CLAUDE, "", 1);
  before = n;
  nav_sync(&n, &view1, -1);
  CHECK(nav_same(&n, &before));
}

static void test_session_disappears(void) {
  Nav n, d;
  nav_set(&d, NAV_DETAIL, AGENT_CLAUDE, "b", 0);

  // vuelve a la lista del agente y avisa con focus null
  v_reset(&scratch);
  v_session(&scratch, "a", AGENT_CLAUDE);
  v_session(&scratch, "c", AGENT_CLAUDE);
  n = d;
  check_out(nav_sync(&n, &scratch, -1), NAV_OUT_UNFOCUS, "");
  check_nav(&n, NAV_SESSIONS, AGENT_CLAUDE, "", 0);

  // si desaparecen todas, la lista queda vacía con el cursor en 0
  v_reset(&scratch);
  v_session(&scratch, "g", AGENT_GEMINI);
  n = d;
  nav_sync(&n, &scratch, -1);
  CHECK_EQ_INT(n.level, NAV_SESSIONS);
  CHECK_EQ_INT(n.kind, AGENT_CLAUDE);
  CHECK_EQ_INT(n.cursor, 0);
  CHECK_EQ_INT(nav_session_count(&scratch, AGENT_CLAUDE), 0);

  // mientras la sesión siga en la vista no se mueve
  n = d;
  check_out(nav_sync(&n, &view1, -1), NAV_OUT_NONE, "");
  // (sin detalle confirmado ni plazo: se queda en el detalle)
  CHECK(nav_same(&n, &d));
}

static void test_b_skip_mode(void) {
  v_reset(&scratch);
  v_request(&scratch, 1, MODE_QUEUE);
  CHECK_EQ_INT(nav_b_action(&scratch), NAV_B_DENY);
  CHECK_EQ_INT(nav_b_action(&view1), NAV_B_BACK);

  v_reset(&scratch);
  v_request(&scratch, 3, MODE_QUEUE);
  CHECK(nav_skip_wanted(&scratch));
  v_reset(&scratch);
  v_request(&scratch, 1, MODE_QUEUE);
  CHECK(!nav_skip_wanted(&scratch));
  v_reset(&scratch);
  scratch.pending_count = 3;
  CHECK(!nav_skip_wanted(&scratch)); // sin tarjeta
  v_reset(&scratch);
  v_request(&scratch, 3, MODE_MANUAL);
  CHECK(!nav_skip_wanted(&scratch));

  v_reset(&scratch);
  CHECK_EQ_INT(nav_mode_target_manual(&scratch), 1); // queue -> manual
  scratch.mode = MODE_MANUAL;
  CHECK_EQ_INT(nav_mode_target_manual(&scratch), 0);

  CHECK_EQ_INT(AGENT_CLAUDE, 0);
  CHECK_EQ_INT(AGENT_GEMINI, 1);
  CHECK_EQ_INT(AGENT_CODEX, 2);
  CHECK_EQ_INT(AGENT_CURSOR, 3);
  CHECK_EQ_INT(AGENT_HERMES, 4);
  CHECK_EQ_INT(AGENT_COUNT, 5);
}

static void open_detail_b(Nav *n) {
  nav_init(n);
  nav_enter(n, &view1, -1, 0);
  nav_move(n, &view1, 1, 0);
  nav_enter(n, &view1, -1, 100);
}

static void test_bridge_removes_focus(void) {
  Nav n, before;
  open_detail_b(&n);
  // (antes del movimiento estaba en agentes: enter -> claude; move dx=1 en la lista -> cursor 1; enter -> detalle de b)
  check_nav(&n, NAV_DETAIL, AGENT_CLAUDE, "b", 0);
  CHECK_EQ_INT(n.confirmed, 0);
  CHECK_EQ_INT(n.since, 100);

  // entrar al detalle no rebota mientras llega la vista que lo confirma
  v_reset(&scratch);
  memcpy(scratch.sessions, view1.sessions, sizeof view1.sessions);
  scratch.session_count = view1.session_count;
  before = n;
  check_out(nav_sync(&n, &scratch, 150), NAV_OUT_NONE, "");
  check_out(nav_sync(&n, &scratch, 1099), NAV_OUT_NONE, "");
  CHECK(nav_same(&n, &before)); // vistas viejas (sin detalle) dentro del plazo: se queda
  // llega la vista con el detalle: queda confirmado
  v_detail(&scratch, "b");
  nav_sync(&n, &scratch, 200);
  CHECK_EQ_INT(n.level, NAV_DETAIL);
  CHECK_EQ_INT(n.confirmed, 1);

  // otro cliente envía focus(null): tras confirmarse, vuelve a sesiones sin enviar focus
  v_reset(&scratch);
  memcpy(scratch.sessions, view1.sessions, sizeof view1.sessions);
  scratch.session_count = view1.session_count;
  check_out(nav_sync(&n, &scratch, 300), NAV_OUT_NONE, "");
  check_nav(&n, NAV_SESSIONS, AGENT_CLAUDE, "", 1);

  // skip: el detalle pasa a otra sesión y el cliente vuelve a sesiones
  open_detail_b(&n);
  v_detail(&scratch, "b");
  nav_sync(&n, &scratch, 200);
  CHECK_EQ_INT(n.confirmed, 1);
  v_reset(&scratch);
  memcpy(scratch.sessions, view1.sessions, sizeof view1.sessions);
  scratch.session_count = view1.session_count;
  v_detail(&scratch, "c");
  check_out(nav_sync(&n, &scratch, 300), NAV_OUT_NONE, "");
  CHECK_EQ_INT(n.level, NAV_SESSIONS);
  CHECK_EQ_INT(n.kind, AGENT_CLAUDE);
  CHECK_STR(n.session_id, "");

  // si el puente nunca confirma, tras 1 s vuelve a sesiones sin enviar focus
  open_detail_b(&n);
  v_reset(&scratch);
  memcpy(scratch.sessions, view1.sessions, sizeof view1.sessions);
  scratch.session_count = view1.session_count;
  check_out(nav_sync(&n, &scratch, 1100), NAV_OUT_NONE, "");
  CHECK_EQ_INT(n.level, NAV_SESSIONS);
  CHECK_STR(n.session_id, "");
  // sin reloj (now < 0) el plazo no vence
  open_detail_b(&n);
  check_out(nav_sync(&n, &scratch, -1), NAV_OUT_NONE, "");
  CHECK_EQ_INT(n.level, NAV_DETAIL);
  // exactamente a 1000 ms de la entrada vence
  open_detail_b(&n);
  nav_sync(&n, &scratch, 100 + NAV_DETAIL_CONFIRM_MS - 1);
  CHECK_EQ_INT(n.level, NAV_DETAIL);
  nav_sync(&n, &scratch, 100 + NAV_DETAIL_CONFIRM_MS);
  CHECK_EQ_INT(n.level, NAV_SESSIONS);
}

static void test_many_sessions(void) {
  // con 12 sesiones de varios agentes las posiciones siguen el orden de la vista
  v_reset(&scratch);
  const char *ids[12] = {"s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11"};
  for (int i = 0; i < 12; i++) v_session(&scratch, ids[i], (AgentKind)(i % 5));
  CHECK_EQ_INT(nav_session_count(&scratch, AGENT_CLAUDE), 3); // s0, s5, s10
  CHECK_STR(nav_session_at(&scratch, AGENT_CLAUDE, 2)->id, "s10");
  CHECK(nav_session_at(&scratch, AGENT_CLAUDE, 3) == NULL);
  CHECK(nav_session_at(&scratch, AGENT_CLAUDE, -1) == NULL);
  Nav n;
  nav_set(&n, NAV_SESSIONS, AGENT_GEMINI, "", 0);
  check_out(nav_enter(&n, &scratch, 1, 7), NAV_OUT_FOCUS, "s6");
  CHECK_EQ_INT(n.since, 7);
  check_out(nav_back(&n, &scratch), NAV_OUT_UNFOCUS, "");
  CHECK_EQ_INT(n.cursor, 1);
}

static void hide(View *v, int count, const AgentKind *kinds) {
  v->has_settings = 1;
  v->settings.notify_default = NOTIFY_IMPORTANT;
  v->settings.notify_ack = 1;
  v->settings.hidden_count = count;
  for (int i = 0; i < count; i++) v->settings.hidden[i] = kinds[i];
}

// Agentes ocultos en la configuración: la lista de agentes cuenta y numera solo los visibles.
static void test_hidden_agents(void) {
  View v = view1;
  const AgentKind two[] = {AGENT_CLAUDE, AGENT_CODEX};
  hide(&v, 2, two);
  CHECK_EQ_INT(nav_agent_count(&v), 3);
  CHECK_EQ_INT(nav_agent_at(&v, 0), AGENT_GEMINI);
  CHECK_EQ_INT(nav_agent_at(&v, 1), AGENT_CURSOR);
  CHECK_EQ_INT(nav_agent_at(&v, 2), AGENT_HERMES);
  CHECK_EQ_INT(nav_agent_at(&v, 3), AGENT_NONE);
  CHECK_EQ_INT(nav_agent_at(&v, -1), AGENT_NONE);
  Nav n;
  nav_init(&n);
  CHECK_EQ_INT(nav_item_count(&n, &v), 3);
  nav_move(&n, &v, 1, 0);
  nav_move(&n, &v, 1, 0);
  nav_move(&n, &v, 1, 0); // tope: 3 agentes
  CHECK_EQ_INT(n.cursor, 2);
  // el índice 0 es Gemini (no Claude)
  nav_enter(&n, &v, 0, 0);
  check_nav(&n, NAV_SESSIONS, AGENT_GEMINI, "", 0);
  CHECK_EQ_INT(nav_item_count(&n, &v), 1);
  nav_back(&n, &v);
  check_nav(&n, NAV_AGENTS, AGENT_NONE, "", 0); // Gemini es el primero visible
  // un índice fuera de lo visible no entra
  check_out(nav_enter(&n, &v, 3, 0), NAV_OUT_NONE, "");
  check_nav(&n, NAV_AGENTS, AGENT_NONE, "", 0);
  // todos ocultos: nada que recorrer ni elegir
  const AgentKind all[] = {AGENT_CLAUDE, AGENT_GEMINI, AGENT_CODEX, AGENT_CURSOR, AGENT_HERMES};
  hide(&v, 5, all);
  CHECK_EQ_INT(nav_agent_count(&v), 0);
  nav_init(&n);
  nav_move(&n, &v, 1, 0);
  check_out(nav_enter(&n, &v, 0, 0), NAV_OUT_NONE, "");
  check_nav(&n, NAV_AGENTS, AGENT_NONE, "", 0);
}

// Si el agente de la pantalla actual se oculta, la navegación vuelve a la lista de agentes (y suelta el enfoque).
static void test_hide_current_agent(void) {
  View v = view1;
  Nav n;
  nav_set(&n, NAV_SESSIONS, AGENT_CLAUDE, "", 1);
  const AgentKind claude[] = {AGENT_CLAUDE};
  hide(&v, 1, claude);
  check_out(nav_sync(&n, &v, 0), NAV_OUT_NONE, "");
  check_nav(&n, NAV_AGENTS, AGENT_NONE, "", 0);
  nav_set(&n, NAV_DETAIL, AGENT_CLAUDE, "a", 0);
  check_out(nav_sync(&n, &v, 0), NAV_OUT_UNFOCUS, "");
  check_nav(&n, NAV_AGENTS, AGENT_NONE, "", 0);
  // otro agente oculto: no molesta
  const AgentKind gemini[] = {AGENT_GEMINI};
  hide(&v, 1, gemini);
  nav_set(&n, NAV_SESSIONS, AGENT_CLAUDE, "", 1);
  check_out(nav_sync(&n, &v, 0), NAV_OUT_NONE, "");
  check_nav(&n, NAV_SESSIONS, AGENT_CLAUDE, "", 1);
}

int main(void) {
  TEST_BEGIN("nav: navegación de la pantalla inferior (mismos escenarios que nav.test.ts)");
  v_reset(&view1);
  v_session(&view1, "a", AGENT_CLAUDE);
  v_session(&view1, "b", AGENT_CLAUDE);
  v_session(&view1, "c", AGENT_CLAUDE);
  v_session(&view1, "g", AGENT_GEMINI);
  RUN(test_enter_and_exit);
  RUN(test_cursor);
  RUN(test_session_disappears);
  RUN(test_b_skip_mode);
  RUN(test_bridge_removes_focus);
  RUN(test_many_sessions);
  RUN(test_hidden_agents);
  RUN(test_hide_current_agent);
  TEST_END();
}

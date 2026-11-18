// Tarjetas de aviso con "Visto" y modo de aviso por sesión (Fase 2b, paso 3a): disposición, el gesto de "Visto" en su propia
// máquina de estados, L/R entre avisos, Y para cambiar el modo, y las reglas de seguridad: un aviso nunca puede aprobar ni
// rechazar un permiso, un permiso que llega le quita la pantalla al aviso, y menú, guía y lector ceden ante un aviso como
// ante un permiso. Sin libctru.
#include "test.h"

#include "../source/core/msg.h"
#include "../source/logic/input_logic.h"
#include "../source/logic/reader.h"

#define CX(r) ((r).x + (r).w / 2)
#define CY(r) ((r).y + (r).h / 2)

// ---- vistas ----

static View V_NOTICE, V_NOTICE2, V_NOTICE_MANY, V_NOTICE_DETAIL, V_NOTICE_DETAIL_SILENT, V_CARD, V_BOTH, V_DETAIL_ONLY, V_NONE_NOTIFY, V_OTHER_SESSION;

static void view_base(View *v) {
  memset(v, 0, sizeof *v);
  v->mode = MODE_QUEUE;
  v->face.kind = AGENT_NONE;
  v->face.mood = MOOD_IDLE;
  v->face.line_count = 1;
  strcpy(v->face.lines[0], "x");
  v->session_count = 2;
  strcpy(v->sessions[0].id, "s1");
  v->sessions[0].kind = AGENT_CLAUDE;
  strcpy(v->sessions[0].title, "Ajustar el hero");
  strcpy(v->sessions[0].project, "mi-portal");
  strcpy(v->sessions[1].id, "s2");
  v->sessions[1].kind = AGENT_CODEX;
  strcpy(v->sessions[1].title, "ATLAS");
  strcpy(v->sessions[1].project, "ATLAS");
}

static void add_notice(View *v, const char *id, const char *session, NoticeKind kind, int lines, int pos, int total) {
  v->has_notice = 1;
  NoticeView *n = &v->notice;
  strcpy(n->id, id);
  strcpy(n->session_id, session);
  n->kind = kind;
  strcpy(n->agent, "Claude");
  strcpy(n->project, "mi-portal");
  strcpy(n->title, "Terminó");
  n->line_count = lines;
  for (int i = 0; i < lines; i++) snprintf(n->lines[i], sizeof n->lines[i], "linea %d del aviso", i + 1);
  n->position = (uint32_t)pos;
  n->total = (uint32_t)total;
}

static void add_detail(View *v, const char *session, int with_notify, NotifyMode mode) {
  v->has_detail = 1;
  strcpy(v->detail.session_id, session);
  v->detail.line_count = 1;
  strcpy(v->detail.last_message[0], "Listo el hero");
  v->detail.has_notify = with_notify;
  v->detail.notify = mode;
}

static void add_request(View *v, const char *id, const char *line) {
  v->has_request = 1;
  strcpy(v->request.id, id);
  strcpy(v->request.session_id, "s2");
  strcpy(v->request.title, "t");
  v->request.line_count = 1;
  strcpy(v->request.lines[0], line);
  v->request.risk = RISK_NORMAL;
  v->request.position = 1;
  v->request.total = 1;
  v->pending_count = 1;
}

static void views_init(void) {
  view_base(&V_NOTICE);
  add_notice(&V_NOTICE, "n1", "s1", NOTICE_DONE, 2, 1, 1);
  view_base(&V_NOTICE2);
  add_notice(&V_NOTICE2, "n2", "s2", NOTICE_ASK, 1, 1, 1);
  view_base(&V_NOTICE_MANY);
  add_notice(&V_NOTICE_MANY, "n1", "s1", NOTICE_DONE, 4, 1, 3);
  view_base(&V_NOTICE_DETAIL);
  add_notice(&V_NOTICE_DETAIL, "n1", "s1", NOTICE_DONE, 2, 1, 1);
  add_detail(&V_NOTICE_DETAIL, "s1", 1, NOTIFY_IMPORTANT);
  view_base(&V_NOTICE_DETAIL_SILENT);
  add_detail(&V_NOTICE_DETAIL_SILENT, "s1", 1, NOTIFY_SILENT);
  view_base(&V_CARD);
  add_request(&V_CARD, "r1", "ls");
  view_base(&V_BOTH); // un puente con errores que mandara las dos: el permiso manda
  add_request(&V_BOTH, "r1", "ls");
  add_notice(&V_BOTH, "n1", "s1", NOTICE_DONE, 2, 1, 1);
  view_base(&V_DETAIL_ONLY);
  add_detail(&V_DETAIL_ONLY, "s1", 1, NOTIFY_IMPORTANT);
  view_base(&V_NONE_NOTIFY); // puente anterior: el detalle no trae el modo
  add_detail(&V_NONE_NOTIFY, "s1", 0, NOTIFY_ALL);
  view_base(&V_OTHER_SESSION);
  add_detail(&V_OTHER_SESSION, "s2", 1, NOTIFY_END);
}

// ---- arnés (lo que hace app.c, con los envíos simulados) ----

typedef struct {
  InputLogic in;
  BottomLayout lay;
  const View *view;
  const ReadDoc *doc;
  uint32_t read_seq;
  int send_fails;
  int acks, skip_notices, notifies, decisions, skips, reads, focus, unfocus, modes;
  char last_ack[VIEW_ID_BYTES], last_notify_id[VIEW_ID_BYTES], last_decision_id[VIEW_ID_BYTES], last_read[VIEW_ID_BYTES], last_focus[VIEW_ID_BYTES];
  int last_notify_mode;
  int last_decision_flag;
} H;

static void relayout(H *h) {
  LayoutInput li;
  memset(&li, 0, sizeof li);
  li.level = h->in.nav.level == NAV_DETAIL ? LAYOUT_DETAIL : h->in.nav.level == NAV_SESSIONS ? LAYOUT_SESSIONS : LAYOUT_AGENTS;
  li.item_count = 5;
  if (h->view != NULL) layout_input_from_view(&li, h->view, h->in.nav.session_id);
  if (h->view != NULL) layout_compute(&li, &h->lay);
  else memset(&h->lay, 0, sizeof h->lay);
}

static void exec(H *h, const InputActions *acts) {
  for (int i = 0; i < acts->n; i++) {
    const InputAction *a = &acts->a[i];
    int rc = h->send_fails ? -1 : 0;
    switch (a->kind) {
      case IN_ACT_ACK: h->acks++; strcpy(h->last_ack, a->id); break;
      case IN_ACT_SKIP_NOTICE: h->skip_notices++; break;
      case IN_ACT_SESSION_NOTIFY: h->notifies++; strcpy(h->last_notify_id, a->id); h->last_notify_mode = a->flag; break;
      case IN_ACT_DECISION: h->decisions++; strcpy(h->last_decision_id, a->id); h->last_decision_flag = a->flag; break;
      case IN_ACT_SKIP: h->skips++; rc = 0; break;
      case IN_ACT_READ: h->reads++; strcpy(h->last_read, a->id); break;
      case IN_ACT_FOCUS: h->focus++; strcpy(h->last_focus, a->id); break;
      case IN_ACT_UNFOCUS: h->unfocus++; rc = 0; break;
      case IN_ACT_MODE: h->modes++; rc = 0; break;
      case IN_ACT_SETTING_NOTIFY:
      case IN_ACT_SETTING_ACK:
      case IN_ACT_SETTING_SOUND:
      case IN_ACT_SETTING_QUESTIONS:
      case IN_ACT_SETTING_READER:
      case IN_ACT_ANSWER:
      case IN_ACT_ANSWER_PC:
      case IN_ACT_QUESTION_OTHER:
      case IN_ACT_SETTING_HIDDEN:
      case IN_ACT_INSTRUCT_WRITE:
      case IN_ACT_INSTRUCT_SEND:
      case IN_ACT_INSTRUCT_CLEAR:
      case IN_ACT_RELEASE:
      case IN_ACT_SESSION_WAIT:
      case IN_ACT_SETTING_INSTRUCT_WAIT:
      case IN_ACT_PAIR_CODE:
      case IN_ACT_THEME:
      case IN_ACT_UPDATE_START:
      case IN_ACT_MANUAL_IP:
      case IN_ACT_RETRY:
      case IN_ACT_QUIT: rc = 0; break;
    }
    input_action_done(&h->in, a, rc);
  }
}

static void h_view(H *h, const View *v, uint64_t now) {
  InputActions acts;
  h->view = v;
  input_view_changed(&h->in, v, "Claude", now, &acts);
  exec(h, &acts);
  relayout(h);
}

static void h_frame(H *h, uint64_t now, uint32_t down, uint32_t up, uint32_t held, int x, int y) {
  InputFrame f;
  InputActions acts;
  memset(&f, 0, sizeof f);
  f.now = now;
  f.down = down;
  f.up = up;
  f.held = held;
  f.rep = down;
  f.touch_x = x;
  f.touch_y = y;
  f.view = h->view;
  f.layout = &h->lay;
  f.doc = h->doc;
  f.read_seq = h->read_seq;
  input_frame(&h->in, &f, &acts);
  exec(h, &acts);
}

static void tap(H *h, uint32_t key, uint64_t at) {
  h_frame(h, at, key, 0, key, 0, 0);
  h_frame(h, at + 30, 0, key, 0, 0, 0);
}

static void touch_down_at(H *h, uint64_t now, const Rect *r) { h_frame(h, now, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, CX(*r), CY(*r)); }
static void touch_up_at(H *h, uint64_t now, int x, int y) { h_frame(h, now, 0, IN_KEY_TOUCH, 0, x, y); }

// Conectado, con la vista v mostrada desde t=0 y la navegación en el nivel de agentes.
static void h_start(H *h, const View *v) {
  memset(h, 0, sizeof *h);
  input_init(&h->in);
  InputActions acts;
  input_session_ready(&h->in, &acts);
  h_view(h, v, 0);
}

// Entra al detalle de s1 (agentes -> sesiones -> detalle) con la cruceta y A, sobre la vista v (sin aviso en pantalla
// al entrar, para que A navegue): se llega con una vista sin aviso y luego se pasa a la que se quiere.
static void h_in_detail(H *h, const View *plain, const View *then) {
  h_start(h, plain);
  tap(h, IN_KEY_A, 100);
  tap(h, IN_KEY_A, 200);
  relayout(h);
  h->focus = h->reads = h->acks = 0;
  if (then != NULL) h_view(h, then, 300);
}

// ---- disposición ----

static void test_layout_notice(void) {
  LayoutInput li;
  BottomLayout l;
  memset(&li, 0, sizeof li);
  li.level = LAYOUT_AGENTS;
  li.item_count = 5;
  li.has_notice = 1;
  li.notice_lines = 2;
  layout_compute(&li, &l);
  CHECK(l.has_notice && !l.has_card);
  CHECK_EQ_INT(l.notice.h, layout_notice_height(2, 0));
  CHECK_EQ_INT(l.notice.y + l.notice.h, LAYOUT_H - 3);
  CHECK(l.btn_ack.x >= l.notice.x && l.btn_ack.x + l.btn_ack.w <= l.notice.x + l.notice.w);
  CHECK(l.btn_notice_read.x >= l.btn_ack.x + l.btn_ack.w); // no se pisan
  CHECK(l.btn_ack.w > l.btn_notice_read.w); // "A: Visto" es el botón grande
  CHECK(l.content.y + l.content.h <= l.notice.y);
  const Zone *z = layout_hit(&l, CX(l.btn_ack), CY(l.btn_ack));
  CHECK(z != NULL && z->kind == ZONE_ACK);
  z = layout_hit(&l, CX(l.btn_notice_read), CY(l.btn_notice_read));
  CHECK(z != NULL && z->kind == ZONE_NOTICE_READ);
  for (int i = 0; i < l.zone_count; i++) {
    CHECK(l.zones[i].kind != ZONE_APPROVE && l.zones[i].kind != ZONE_DENY && l.zones[i].kind != ZONE_ALWAYS); // un aviso no tiene botones de permiso
    CHECK(l.zones[i].kind != ZONE_SKIP_PREV); // sin cola no hay L/R
  }
  // la más alta (4 líneas y cola) cabe y deja contenido
  li.notice_lines = 4;
  li.notice_many = 1;
  layout_compute(&li, &l);
  CHECK(l.has_notice_queue && l.has_notice_skip);
  CHECK_EQ_INT(l.notice.h, layout_notice_height(4, 1));
  CHECK(l.notice.y >= LAYOUT_BAR_Y + LAYOUT_BAR_H);
  CHECK(l.content.h >= LAYOUT_MIN_CONTENT_H);
  CHECK(layout_hit(&l, CX(l.skip_prev), CY(l.skip_prev))->kind == ZONE_SKIP_PREV);
  CHECK(layout_hit(&l, CX(l.skip_next), CY(l.skip_next))->kind == ZONE_SKIP_NEXT);
  // un permiso manda: con las dos pedidas solo hay tarjeta de permiso
  li.has_card = 1;
  li.card_lines = 1;
  layout_compute(&li, &l);
  CHECK(l.has_card && !l.has_notice);
  CHECK(layout_hit(&l, CX(l.btn_approve), CY(l.btn_approve))->kind == ZONE_APPROVE);
  for (int i = 0; i < l.zone_count; i++) CHECK(l.zones[i].kind != ZONE_ACK && l.zones[i].kind != ZONE_NOTICE_READ);
}

static void test_layout_detail_strips(void) {
  LayoutInput li;
  BottomLayout l;
  memset(&li, 0, sizeof li);
  li.level = LAYOUT_DETAIL;
  li.detail_notify = 1;
  layout_compute(&li, &l);
  CHECK(l.has_read && l.has_notify);
  CHECK(l.btn_notify.x >= l.btn_read.x + l.btn_read.w);
  CHECK(l.btn_notify.x + l.btn_notify.w <= LAYOUT_W);
  CHECK(layout_hit(&l, CX(l.btn_notify), CY(l.btn_notify))->kind == ZONE_NOTIFY);
  li.detail_notify = 0; // un puente anterior no manda el modo: sin franja
  layout_compute(&li, &l);
  CHECK(l.has_read && !l.has_notify);
  // con aviso: A marca "Visto", así que no se ofrece leer con A; el modo de aviso sí
  li.detail_notify = 1;
  li.has_notice = 1;
  li.notice_lines = 2;
  layout_compute(&li, &l);
  CHECK(!l.has_read && l.has_notify);
  // con permiso: ninguna de las dos (A aprueba, Y es "siempre")
  li.has_card = 1;
  li.card_lines = 1;
  layout_compute(&li, &l);
  CHECK(!l.has_read && !l.has_notify);
}

static void test_layout_from_view(void) {
  LayoutInput li;
  memset(&li, 0, sizeof li);
  layout_input_from_view(&li, &V_NOTICE_MANY, "");
  CHECK(li.has_notice && li.notice_lines == 4 && li.notice_many && !li.has_card && !li.detail_notify);
  layout_input_from_view(&li, &V_BOTH, "");
  CHECK(li.has_card && !li.has_notice); // el permiso manda aunque lleguen las dos
  layout_input_from_view(&li, &V_DETAIL_ONLY, "s1");
  CHECK(li.detail_notify && !li.has_notice && !li.has_card);
  layout_input_from_view(&li, &V_DETAIL_ONLY, "s2"); // el detalle abierto es de otra sesión
  CHECK(!li.detail_notify);
  layout_input_from_view(&li, &V_NONE_NOTIFY, "s1");
  CHECK(!li.detail_notify);
  CHECK(view_has_notice_card(&V_NOTICE) && !view_has_notice_card(&V_BOTH) && !view_has_notice_card(&V_CARD) && !view_has_notice_card(NULL));
}

// ---- "Visto" ----

static void test_ack_with_a(void) {
  H h;
  h_start(&h, &V_NOTICE);
  tap(&h, IN_KEY_A, 100); // dentro de la guarda de 500 ms: no
  CHECK_EQ_INT(h.acks, 0);
  tap(&h, IN_KEY_A, 600);
  CHECK_EQ_INT(h.acks, 1);
  CHECK_STR(h.last_ack, "n1");
  CHECK_EQ_INT(h.decisions, 0); // un aviso nunca es una decisión
  CHECK_EQ_INT(h.in.nav.level, NAV_AGENTS); // y A tampoco navega
  tap(&h, IN_KEY_A, 900); // ya enviado: no se repite sobre la misma tarjeta
  CHECK_EQ_INT(h.acks, 1);
  CHECK(!approve_ready(&h.in.ack, 1000));
}

static void test_ack_guard_press_before_card(void) {
  H h;
  h_start(&h, &V_NONE_NOTIFY);
  h_frame(&h, 1000, IN_KEY_A, 0, IN_KEY_A, 0, 0); // A pulsada antes de que aparezca el aviso
  h_view(&h, &V_NOTICE, 1100);
  h_frame(&h, 1200, 0, IN_KEY_A, 0, 0, 0); // se suelta con el aviso a la vista: la pulsación empezó antes
  CHECK_EQ_INT(h.acks, 0);
  tap(&h, IN_KEY_A, 1300); // dentro de la guarda desde que apareció (1100 + 500)
  CHECK_EQ_INT(h.acks, 0);
  tap(&h, IN_KEY_A, 1700);
  CHECK_EQ_INT(h.acks, 1);
}

static void test_ack_with_pen(void) {
  H h;
  h_start(&h, &V_NOTICE);
  touch_down_at(&h, 700, &h.lay.btn_ack);
  touch_up_at(&h, 760, CX(h.lay.btn_ack), CY(h.lay.btn_ack));
  CHECK_EQ_INT(h.acks, 1);
  CHECK_STR(h.last_ack, "n1");

  // el lápiz sale del botón antes de soltar: nada
  h_start(&h, &V_NOTICE);
  touch_down_at(&h, 700, &h.lay.btn_ack);
  h_frame(&h, 730, 0, 0, IN_KEY_TOUCH, 5, 5);
  touch_up_at(&h, 760, 5, 5);
  CHECK_EQ_INT(h.acks, 0);

  // dentro de la guarda: nada
  h_start(&h, &V_NOTICE);
  touch_down_at(&h, 200, &h.lay.btn_ack);
  touch_up_at(&h, 260, CX(h.lay.btn_ack), CY(h.lay.btn_ack));
  CHECK_EQ_INT(h.acks, 0);
}

static void test_ack_failed_send_not_locked(void) {
  H h;
  h_start(&h, &V_NOTICE);
  h.send_fails = 1;
  tap(&h, IN_KEY_A, 600);
  CHECK_EQ_INT(h.acks, 1); // el envío falló: la tarjeta sigue pendiente
  CHECK(approve_ready(&h.in.ack, 700));
  h.send_fails = 0;
  tap(&h, IN_KEY_A, 800);
  CHECK_EQ_INT(h.acks, 2);
}

static void test_new_notice_restarts_guard(void) {
  H h;
  h_start(&h, &V_NOTICE);
  h_frame(&h, 800, IN_KEY_A, 0, IN_KEY_A, 0, 0);
  h_view(&h, &V_NOTICE2, 850); // otro aviso (otro id): la pulsación era de la tarjeta anterior
  h_frame(&h, 900, 0, IN_KEY_A, 0, 0, 0);
  CHECK_EQ_INT(h.acks, 0);
  tap(&h, IN_KEY_A, 1000); // guarda desde 850
  CHECK_EQ_INT(h.acks, 0);
  tap(&h, IN_KEY_A, 1400);
  CHECK_EQ_INT(h.acks, 1);
  CHECK_STR(h.last_ack, "n2");
}

static void test_ack_sets_no_decision_and_keeps_permission_guard(void) {
  H h;
  h_start(&h, &V_NOTICE);
  tap(&h, IN_KEY_A, 700);
  CHECK_EQ_INT(h.acks, 1);
  // la tarjeta de aviso se retira (vista sin aviso)
  h_view(&h, &V_NONE_NOTIFY, 800);
  tap(&h, IN_KEY_A, 900); // sin tarjetas: A entra a la lista, no hay nada que enviar
  CHECK_EQ_INT(h.acks, 1);
  CHECK_EQ_INT(h.decisions, 0);
}

// ---- un permiso manda sobre el aviso ----

static void test_permission_takes_over_pressed_ack(void) {
  H h;
  h_start(&h, &V_NOTICE);
  h_frame(&h, 800, IN_KEY_A, 0, IN_KEY_A, 0, 0); // A pulsada sobre el aviso (la guarda ya pasó)
  h_view(&h, &V_CARD, 900);                      // llega un permiso mientras se pulsa
  CHECK(h.lay.has_card && !h.lay.has_notice);
  h_frame(&h, 1000, 0, IN_KEY_A, 0, 0, 0);       // se suelta sobre el permiso
  CHECK_EQ_INT(h.acks, 0);
  CHECK_EQ_INT(h.decisions, 0); // la pulsación empezó sobre el aviso: no aprueba nada
  // y para aprobar hace falta una pulsación nueva, pasada la guarda de la tarjeta de permiso
  tap(&h, IN_KEY_A, 1100);
  CHECK_EQ_INT(h.decisions, 0);
  tap(&h, IN_KEY_A, 1500);
  CHECK_EQ_INT(h.decisions, 1);
  CHECK_STR(h.last_decision_id, "r1");
  CHECK_EQ_INT(h.acks, 0);
}

static void test_permission_takes_over_pressed_pen(void) {
  H h;
  h_start(&h, &V_NOTICE);
  touch_down_at(&h, 800, &h.lay.btn_ack);
  Rect approve_pos = h.lay.btn_ack; // el sitio del botón de "Visto"
  h_view(&h, &V_CARD, 850);
  touch_up_at(&h, 900, CX(approve_pos), CY(approve_pos)); // suelta donde ahora puede haber un botón del permiso
  CHECK_EQ_INT(h.acks, 0);
  CHECK_EQ_INT(h.decisions, 0);
}

static void test_permission_with_notice_in_same_view(void) {
  H h;
  h_start(&h, &V_BOTH);
  CHECK(!view_has_notice_card(&V_BOTH));
  tap(&h, IN_KEY_A, 700);
  CHECK_EQ_INT(h.acks, 0); // un puente con errores no puede hacer que A marque "Visto" un permiso
  CHECK_EQ_INT(h.decisions, 1);
  CHECK_STR(h.last_decision_id, "r1");
  // y B rechaza como siempre (sobre otra vista igual)
  H g;
  h_start(&g, &V_BOTH);
  tap(&g, IN_KEY_B, 100);
  CHECK_EQ_INT(g.decisions, 1);
  CHECK_EQ_INT(g.last_decision_flag, 0);
  CHECK_EQ_INT(g.acks, 0);
}

static void test_ack_never_decides_even_with_pen_on_permission_zone(void) {
  H h;
  h_start(&h, &V_NOTICE);
  // el lápiz empieza en el lugar donde (con permiso) estaría "Aprobar": con aviso es la franja de "Visto" o "Leer todo"
  for (int i = 0; i < h.lay.zone_count; i++) {
    CHECK(h.lay.zones[i].kind != ZONE_APPROVE && h.lay.zones[i].kind != ZONE_DENY);
  }
  tap(&h, IN_KEY_B, 700); // B sin permiso es "volver": nunca rechaza
  CHECK_EQ_INT(h.decisions, 0);
  tap(&h, IN_KEY_Y, 800); // Y sin permiso ni detalle no hace nada con vista
  CHECK_EQ_INT(h.decisions, 0);
  CHECK_EQ_INT(h.notifies, 0);
}

// ---- L/R entre avisos ----

static void test_lr_skips_notices(void) {
  H h;
  h_start(&h, &V_NOTICE_MANY);
  tap(&h, IN_KEY_R, 100);
  CHECK_EQ_INT(h.skip_notices, 1);
  tap(&h, IN_KEY_L, 200);
  CHECK_EQ_INT(h.skip_notices, 2);
  CHECK_EQ_INT(h.skips, 0); // no es el salto de permisos
  // con uno solo no hay a dónde ir
  H g;
  h_start(&g, &V_NOTICE);
  tap(&g, IN_KEY_R, 100);
  CHECK_EQ_INT(g.skip_notices, 0);
  // L y R juntos son el acorde del diagnóstico: no saltan
  H c;
  h_start(&c, &V_NOTICE_MANY);
  h_frame(&c, 100, IN_KEY_L | IN_KEY_R, 0, IN_KEY_L | IN_KEY_R, 0, 0);
  h_frame(&c, 200, 0, IN_KEY_L | IN_KEY_R, 0, 0, 0);
  CHECK_EQ_INT(c.skip_notices, 0);
  // táctil: las flechas de la cola
  H t;
  h_start(&t, &V_NOTICE_MANY);
  touch_down_at(&t, 100, &t.lay.skip_next);
  touch_up_at(&t, 140, CX(t.lay.skip_next), CY(t.lay.skip_next));
  CHECK_EQ_INT(t.skip_notices, 1);
  CHECK_EQ_INT(t.skips, 0);
}

static void test_lr_still_skips_permissions(void) {
  View many;
  view_base(&many);
  add_request(&many, "r1", "ls");
  many.request.total = 2;
  many.pending_count = 2;
  add_notice(&many, "n1", "s1", NOTICE_DONE, 1, 1, 3); // con permiso, el aviso se ignora
  H h;
  h_start(&h, &many);
  tap(&h, IN_KEY_R, 100);
  CHECK_EQ_INT(h.skips, 1);
  CHECK_EQ_INT(h.skip_notices, 0);
}

// ---- modo de aviso por sesión (Y y franja) ----

static void test_y_cycles_session_notify(void) {
  H h;
  h_in_detail(&h, &V_NONE_NOTIFY, &V_DETAIL_ONLY);
  tap(&h, IN_KEY_Y, 400);
  CHECK_EQ_INT(h.notifies, 1);
  CHECK_STR(h.last_notify_id, "s1");
  CHECK_EQ_INT(h.last_notify_mode, NOTIFY_END); // important -> end
  h_view(&h, &V_NOTICE_DETAIL_SILENT, 500);
  tap(&h, IN_KEY_Y, 600);
  CHECK_EQ_INT(h.last_notify_mode, NOTIFY_ALL); // silent -> all: da la vuelta
  CHECK_EQ_INT(h.decisions, 0);
  CHECK_EQ_INT(h.acks, 0);
}

static void test_y_notify_conditions(void) {
  H h;
  // en la lista de agentes no hay sesión abierta
  h_start(&h, &V_DETAIL_ONLY);
  tap(&h, IN_KEY_Y, 100);
  CHECK_EQ_INT(h.notifies, 0);
  // puente anterior: sin modo en el detalle, nada
  h_in_detail(&h, &V_NONE_NOTIFY, NULL);
  tap(&h, IN_KEY_Y, 400);
  CHECK_EQ_INT(h.notifies, 0);
  // el detalle que llegó es de otra sesión
  h_view(&h, &V_OTHER_SESSION, 500);
  tap(&h, IN_KEY_Y, 600);
  CHECK_EQ_INT(h.notifies, 0);
  // con permiso Y es "no volver a preguntar" (si lo ofrece) o nada: nunca cambia el modo
  View card;
  view_base(&card);
  add_request(&card, "r1", "ls");
  add_detail(&card, "s1", 1, NOTIFY_ALL);
  card.request.has_always = 1;
  strcpy(card.request.always, "Bash(ls)");
  h_view(&h, &card, 700);
  tap(&h, IN_KEY_Y, 1300);
  CHECK_EQ_INT(h.notifies, 0);
  CHECK_EQ_INT(h.decisions, 1);
  CHECK_EQ_INT(h.last_decision_flag, 2);
}

static void test_notify_strip_touch(void) {
  H h;
  h_in_detail(&h, &V_NONE_NOTIFY, &V_NOTICE_DETAIL);
  CHECK(h.lay.has_notify);
  touch_down_at(&h, 400, &h.lay.btn_notify);
  touch_up_at(&h, 440, CX(h.lay.btn_notify), CY(h.lay.btn_notify));
  CHECK_EQ_INT(h.notifies, 1);
  CHECK_EQ_INT(h.last_notify_mode, NOTIFY_END);
  CHECK_EQ_INT(h.acks, 0);
}

static void test_a_in_detail_still_reads_without_notice(void) {
  H h;
  h_in_detail(&h, &V_NONE_NOTIFY, &V_DETAIL_ONLY);
  tap(&h, IN_KEY_A, 400);
  CHECK_EQ_INT(h.reads, 1);
  CHECK(reader_active(&h.in.reader) && !h.in.reader.from_notice);
  CHECK_EQ_INT(h.acks, 0);
}

static void test_a_in_detail_with_notice_acks_not_reads(void) {
  H h;
  h_in_detail(&h, &V_NONE_NOTIFY, &V_NOTICE_DETAIL);
  tap(&h, IN_KEY_A, 400); // dentro de la guarda desde 300
  CHECK_EQ_INT(h.reads, 0);
  tap(&h, IN_KEY_A, 900);
  CHECK_EQ_INT(h.acks, 1);
  CHECK_EQ_INT(h.reads, 0);
  CHECK(!reader_active(&h.in.reader));
}

// ---- menú, guía y lector ceden ante un aviso como ante un permiso ----

static void test_select_ignored_with_notice(void) {
  H h;
  h_start(&h, &V_NOTICE);
  tap(&h, IN_KEY_SELECT, 700);
  CHECK(!h.in.menu.open); // primero se marca "Visto" (misma regla que con un permiso)
  h_view(&h, &V_NONE_NOTIFY, 800);
  tap(&h, IN_KEY_SELECT, 900);
  CHECK(h.in.menu.open);
}

static void test_notice_closes_menu_and_guide(void) {
  H h;
  h_start(&h, &V_NONE_NOTIFY);
  tap(&h, IN_KEY_SELECT, 100);
  CHECK(h.in.menu.open);
  guide_open(&h.in.guide); // la guía abierta desde el menú
  h_view(&h, &V_NOTICE, 500);
  CHECK(!h.in.menu.open && !h.in.guide.open);
  // y A ya es "Visto" tras la guarda, no una tecla del menú
  tap(&h, IN_KEY_A, 700);
  CHECK_EQ_INT(h.acks, 0);
  tap(&h, IN_KEY_A, 1100);
  CHECK_EQ_INT(h.acks, 1);
}

static void test_notice_closes_normal_reader(void) {
  H h;
  h_in_detail(&h, &V_NONE_NOTIFY, &V_DETAIL_ONLY);
  tap(&h, IN_KEY_A, 400);
  CHECK(reader_active(&h.in.reader));
  h_view(&h, &V_NOTICE_DETAIL, 800);
  CHECK(!reader_active(&h.in.reader)); // llegó un aviso: se cierra
  // por si acaso también en el cuadro siguiente
  h_frame(&h, 900, 0, 0, 0, 0, 0);
  CHECK(!reader_active(&h.in.reader));
}

static void test_diag_swallows_ack_and_drops_gesture(void) {
  H h;
  h_start(&h, &V_NOTICE);
  h_frame(&h, 700, IN_KEY_A, 0, IN_KEY_A, 0, 0); // A pulsada sobre el aviso
  // L+R 1 s abren el diagnóstico (con A mantenida)
  uint32_t lr = IN_KEY_L | IN_KEY_R | IN_KEY_A;
  h_frame(&h, 710, IN_KEY_L | IN_KEY_R, 0, lr, 0, 0);
  h_frame(&h, 710 + INPUT_DIAG_HOLD_MS + 10, 0, 0, lr, 0, 0);
  CHECK(h.in.diag_on);
  h_frame(&h, 2000, 0, IN_KEY_A | IN_KEY_L | IN_KEY_R, 0, 0, 0);
  CHECK_EQ_INT(h.acks, 0); // el gesto murió con el diagnóstico
  tap(&h, IN_KEY_A, 2100); // con el diagnóstico abierto A se traga
  tap(&h, IN_KEY_A, 2800);
  CHECK_EQ_INT(h.acks, 0);
}

// ---- "Leer todo" ----

static void test_notice_read_strip(void) {
  H h;
  h_start(&h, &V_NOTICE);
  touch_down_at(&h, 700, &h.lay.btn_notice_read);
  touch_up_at(&h, 740, CX(h.lay.btn_notice_read), CY(h.lay.btn_notice_read));
  CHECK_EQ_INT(h.focus, 1); // abre el detalle de la sesión del aviso
  CHECK_STR(h.last_focus, "s1");
  CHECK_EQ_INT(h.reads, 1);
  CHECK_STR(h.last_read, "s1");
  CHECK(reader_active(&h.in.reader) && h.in.reader.from_notice);
  CHECK_EQ_INT(h.in.nav.level, NAV_DETAIL);
  CHECK_STR(h.in.nav.session_id, "s1");
  CHECK_EQ_INT(h.acks, 0);
  // el aviso sigue ahí y no cierra el lector que se abrió con él
  h_view(&h, &V_NOTICE_DETAIL, 800);
  CHECK(reader_active(&h.in.reader));
  // en el lector A no marca "Visto" y B vuelve al detalle, con el aviso aún a la vista
  tap(&h, IN_KEY_A, 1500);
  CHECK_EQ_INT(h.acks, 0);
  tap(&h, IN_KEY_B, 1600);
  CHECK(!reader_active(&h.in.reader));
  CHECK_EQ_INT(h.in.nav.level, NAV_DETAIL);
  CHECK(h.lay.has_notice);
  tap(&h, IN_KEY_A, 2200); // y ahora sí: Visto
  CHECK_EQ_INT(h.acks, 1);
}

static void test_notice_read_lr_pages_not_skips(void) {
  H h;
  h_start(&h, &V_NOTICE_MANY);
  touch_down_at(&h, 700, &h.lay.btn_notice_read);
  touch_up_at(&h, 740, CX(h.lay.btn_notice_read), CY(h.lay.btn_notice_read));
  CHECK(reader_active(&h.in.reader));
  tap(&h, IN_KEY_R, 900);
  tap(&h, IN_KEY_L, 1000);
  CHECK_EQ_INT(h.skip_notices, 0);
  CHECK_EQ_INT(h.skips, 0);
}

static void test_notice_reader_reloads_on_new_message(void) {
  H h;
  h_start(&h, &V_NOTICE_DETAIL);
  touch_down_at(&h, 700, &h.lay.btn_notice_read);
  touch_up_at(&h, 740, CX(h.lay.btn_notice_read), CY(h.lay.btn_notice_read));
  CHECK(reader_active(&h.in.reader) && h.in.reader.from_notice);
  static ReadDoc doc;
  memset(&doc, 0, sizeof doc);
  strcpy(doc.session_id, "s1");
  doc.line_count = 1;
  strcpy(doc.lines[0], "texto");
  h.doc = &doc;
  h.read_seq = 1;
  reader_on_doc(&h.in.reader, &doc, 1);
  CHECK_EQ_INT(h.in.reader.state, READER_SHOWING);
  // llega un mensaje nuevo (cambia el extracto del detalle): el lector avisa y A recarga aunque el aviso siga a la vista
  static View nv;
  nv = V_NOTICE_DETAIL;
  strcpy(nv.detail.last_message[0], "otro mensaje distinto");
  h_view(&h, &nv, 1000);
  CHECK(h.in.reader.stale);
  int reads = h.reads;
  tap(&h, IN_KEY_A, 1100);
  CHECK_EQ_INT(h.reads, reads + 1);
  CHECK(reader_active(&h.in.reader) && h.in.reader.from_notice && !h.in.reader.stale);
  CHECK_EQ_INT(h.acks, 0);
}

static void test_permission_closes_notice_reader(void) {
  H h;
  h_start(&h, &V_NOTICE);
  touch_down_at(&h, 700, &h.lay.btn_notice_read);
  touch_up_at(&h, 740, CX(h.lay.btn_notice_read), CY(h.lay.btn_notice_read));
  CHECK(reader_active(&h.in.reader));
  View card;
  view_base(&card);
  add_request(&card, "r1", "ls");
  add_detail(&card, "s1", 1, NOTIFY_ALL);
  h_view(&h, &card, 900);
  CHECK(!reader_active(&h.in.reader)); // el permiso siempre manda
  tap(&h, IN_KEY_A, 1000); // guarda de 500 ms de la tarjeta
  CHECK_EQ_INT(h.decisions, 0);
  tap(&h, IN_KEY_A, 1500);
  CHECK_EQ_INT(h.decisions, 1);
  CHECK_EQ_INT(h.acks, 0);
}

static void test_notice_read_unknown_session_does_nothing(void) {
  View v;
  view_base(&v);
  add_notice(&v, "n9", "ghost", NOTICE_DONE, 1, 1, 1); // la sesión del aviso ya no está en la lista
  H h;
  h_start(&h, &v);
  touch_down_at(&h, 700, &h.lay.btn_notice_read);
  touch_up_at(&h, 740, CX(h.lay.btn_notice_read), CY(h.lay.btn_notice_read));
  CHECK_EQ_INT(h.reads, 0);
  CHECK(!reader_active(&h.in.reader));
}

static void test_notice_end_of_session_resets(void) {
  H h;
  h_start(&h, &V_NOTICE);
  tap(&h, IN_KEY_A, 700);
  CHECK_EQ_INT(h.acks, 1);
  input_session_end(&h.in);
  InputActions acts;
  input_session_ready(&h.in, &acts);
  h_view(&h, &V_NOTICE, 5000);
  tap(&h, IN_KEY_A, 5100); // conexión nueva: guarda de nuevo y sin lo respondido antes
  CHECK_EQ_INT(h.acks, 1);
  tap(&h, IN_KEY_A, 5600);
  CHECK_EQ_INT(h.acks, 2);
}

// ---- mensajes ----

static void test_messages(void) {
  char out[MSG_MAX_LEN];
  CHECK_STR(msg_ack(out, sizeof out, "n1") > 0 ? out : "", "{\"t\":\"ack\",\"id\":\"n1\"}");
  CHECK_EQ_INT(msg_ack(out, sizeof out, NULL), -1);
  CHECK_EQ_INT(msg_ack(out, sizeof out, ""), -1);
  CHECK_EQ_INT(msg_ack(out, sizeof out, "a b"), -1);
  CHECK_EQ_INT(msg_ack(out, 8, "n1"), -1);
  CHECK_STR(msg_skip_notice(out, sizeof out) > 0 ? out : "", "{\"t\":\"skipNotice\"}");
  CHECK_STR(msg_setting_session_notify(out, sizeof out, "s1", NOTIFY_END) > 0 ? out : "",
            "{\"t\":\"setting\",\"key\":\"sessionNotify\",\"sessionId\":\"s1\",\"value\":\"end\"}");
  CHECK_EQ_INT(msg_setting_session_notify(out, sizeof out, "s1", 4), -1);
  CHECK_EQ_INT(msg_setting_session_notify(out, sizeof out, "s1", -1), -1);
  CHECK_EQ_INT(msg_setting_session_notify(out, sizeof out, NULL, 0), -1);
  CHECK_EQ_INT(msg_setting_session_notify(out, sizeof out, "s 1", 0), -1);
  char id48[49];
  memset(id48, 'a', 48);
  id48[48] = 0;
  CHECK(msg_setting_session_notify(out, sizeof out, id48, NOTIFY_IMPORTANT) > 0);
  CHECK(strlen(out) < MSG_MAX_LEN); // el peor caso cabe
  CHECK(msg_ack(out, sizeof out, id48) > 0);
}

int main(void) {
  TEST_BEGIN("notice: avisos con Visto, modo por sesión y reglas de seguridad");
  views_init();
  RUN(test_layout_notice);
  RUN(test_layout_detail_strips);
  RUN(test_layout_from_view);
  RUN(test_ack_with_a);
  RUN(test_ack_guard_press_before_card);
  RUN(test_ack_with_pen);
  RUN(test_ack_failed_send_not_locked);
  RUN(test_new_notice_restarts_guard);
  RUN(test_ack_sets_no_decision_and_keeps_permission_guard);
  RUN(test_permission_takes_over_pressed_ack);
  RUN(test_permission_takes_over_pressed_pen);
  RUN(test_permission_with_notice_in_same_view);
  RUN(test_ack_never_decides_even_with_pen_on_permission_zone);
  RUN(test_lr_skips_notices);
  RUN(test_lr_still_skips_permissions);
  RUN(test_y_cycles_session_notify);
  RUN(test_y_notify_conditions);
  RUN(test_notify_strip_touch);
  RUN(test_a_in_detail_still_reads_without_notice);
  RUN(test_a_in_detail_with_notice_acks_not_reads);
  RUN(test_select_ignored_with_notice);
  RUN(test_notice_closes_menu_and_guide);
  RUN(test_notice_closes_normal_reader);
  RUN(test_diag_swallows_ack_and_drops_gesture);
  RUN(test_notice_read_strip);
  RUN(test_notice_read_lr_pages_not_skips);
  RUN(test_notice_reader_reloads_on_new_message);
  RUN(test_permission_closes_notice_reader);
  RUN(test_notice_read_unknown_session_does_nothing);
  RUN(test_notice_end_of_session_resets);
  RUN(test_messages);
  TEST_END();
}

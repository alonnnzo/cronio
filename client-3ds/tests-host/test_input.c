// Decisiones de entrada de la app (logic/input_logic.c): aprobar, rechazar, lápiz, L+R y sesión fallida, sin libctru.
#include "test.h"

#include "../source/core/frame.h"
#include "../source/logic/input_logic.h"
#include "../source/logic/palette.h"

// ---- vistas ----

static View VX, VY, VZ, VNONE, VXA, VYA;

static void v_reset(View *v) {
  memset(v, 0, sizeof *v);
  v->mode = MODE_QUEUE;
  v->face.kind = AGENT_NONE;
  v->face.mood = MOOD_IDLE;
  v->face.line_count = 1;
  strcpy(v->face.lines[0], "x");
}

static void v_request(View *v, const char *id, int high, const char *line) {
  v_reset(v);
  v->has_request = 1;
  strcpy(v->request.id, id);
  strcpy(v->request.session_id, "s");
  strcpy(v->request.title, "t");
  v->request.line_count = 1;
  strcpy(v->request.lines[0], line);
  v->request.risk = high ? RISK_HIGH : RISK_NORMAL;
  v->request.expires_in_s = 40;
  v->request.position = 1;
  v->request.total = 1;
  v->pending_count = 1;
}

// ---- arnés: lo que hace app.c, con los envíos simulados ----

typedef struct {
  InputLogic in;
  BottomLayout lay;
  const View *view; // vista viva (NULL: sin sesión lista)
  uint64_t now;
  int send_fails;   // 1: los envíos fallan
  int session_dead;
  struct {
    char id[VIEW_ID_BYTES];
    int allow;
  } dec[8];
  int dec_count;
  int skips, modes, retries, quits, pair, ip, focus, unfocus;
  int set_notify, set_ack, set_hidden, last_notify, last_ack, last_hidden;
  int set_sound, last_sound;
  int set_questions, last_questions;
  int set_reader, last_reader;
  int set_wait, last_wait;
  int set_theme, last_theme;
  int update_starts;
  char last_focus[VIEW_ID_BYTES];
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
  for (int i = 0; i < acts->n && !h->session_dead; i++) {
    const InputAction *a = &acts->a[i];
    int rc = 0;
    switch (a->kind) {
      case IN_ACT_DECISION:
        if (h->dec_count < 8) {
          strcpy(h->dec[h->dec_count].id, a->id);
          h->dec[h->dec_count].allow = a->flag;
        }
        h->dec_count++;
        rc = h->send_fails ? -1 : 0;
        break;
      case IN_ACT_FOCUS: h->focus++; strcpy(h->last_focus, a->id); rc = h->send_fails ? -1 : 0; break;
      case IN_ACT_UNFOCUS: h->unfocus++; rc = h->send_fails ? -1 : 0; break;
      case IN_ACT_SKIP: h->skips++; break;
      case IN_ACT_ACK:
      case IN_ACT_SKIP_NOTICE:
      case IN_ACT_SESSION_NOTIFY: break; // los avisos se prueban en test_notice.c
      case IN_ACT_MODE: h->modes++; break;
      case IN_ACT_RETRY: h->retries++; break;
      case IN_ACT_QUIT: h->quits++; break;
      case IN_ACT_READ: break; // el lector se prueba en test_reader.c
      case IN_ACT_SETTING_NOTIFY: h->set_notify++; h->last_notify = a->flag; break;
      case IN_ACT_SETTING_ACK: h->set_ack++; h->last_ack = a->flag; break;
      case IN_ACT_SETTING_SOUND: h->set_sound++; h->last_sound = a->flag; break;
      case IN_ACT_SETTING_QUESTIONS: h->set_questions++; h->last_questions = a->flag; break;
      case IN_ACT_SETTING_READER: h->set_reader++; h->last_reader = a->flag; break;
      case IN_ACT_ANSWER:
      case IN_ACT_ANSWER_PC:
      case IN_ACT_QUESTION_OTHER: break; // las preguntas se prueban en test_question.c
      case IN_ACT_SETTING_HIDDEN: h->set_hidden++; h->last_hidden = a->flag; break;
      case IN_ACT_INSTRUCT_WRITE:
      case IN_ACT_INSTRUCT_SEND:
      case IN_ACT_INSTRUCT_CLEAR:
      case IN_ACT_RELEASE:
      case IN_ACT_SESSION_WAIT: break; // las instrucciones se prueban en test_instruct.c
      case IN_ACT_SETTING_INSTRUCT_WAIT: h->set_wait++; h->last_wait = a->flag; break;
      case IN_ACT_THEME: h->set_theme++; h->last_theme = a->flag; break;
      case IN_ACT_UPDATE_START: h->update_starts++; break;
      case IN_ACT_PAIR_CODE: h->pair++; break;
      case IN_ACT_MANUAL_IP: h->ip++; break;
    }
    input_action_done(&h->in, a, rc);
    if (rc != 0) { // el envío falló: la sesión queda FAILED y la app la cierra de inmediato
      h->session_dead = 1;
      input_session_end(&h->in);
      h->view = NULL;
    }
  }
}

static void h_init(H *h) {
  memset(h, 0, sizeof *h);
  input_init(&h->in);
}

// Sesión lista y vista nueva (lo que hacen on_ready y on_new_view).
static void h_connect(H *h, const View *v, uint64_t now) {
  InputActions acts;
  h->now = now;
  h->session_dead = 0;
  h->view = v;
  input_session_ready(&h->in, &acts);
  exec(h, &acts);
  input_view_changed(&h->in, v, "Claude", now, &acts);
  exec(h, &acts);
  relayout(h);
}

static void h_view(H *h, const View *v, uint64_t now) {
  InputActions acts;
  h->now = now;
  h->view = v;
  input_view_changed(&h->in, v, "Claude", now, &acts);
  exec(h, &acts);
  relayout(h);
}

static void h_tick(H *h, uint64_t now) {
  InputActions acts;
  h->now = now;
  input_tick(&h->in, h->view, now, &acts);
  exec(h, &acts);
}

static void h_frame(H *h, uint64_t now, uint32_t down, uint32_t up, uint32_t held, int x, int y) {
  InputFrame f;
  InputActions acts;
  memset(&f, 0, sizeof f);
  h->now = now;
  f.now = now;
  f.down = down;
  f.up = up;
  f.held = held;
  f.rep = down;
  f.touch_x = x;
  f.touch_y = y;
  f.view = h->view;
  f.layout = &h->lay;
  f.can_retry = 0;
  input_frame(&h->in, &f, &acts);
  exec(h, &acts);
}

static void tap_key(H *h, uint32_t key, uint64_t down_at, uint64_t up_at) {
  h_frame(h, down_at, key, 0, key, 0, 0);
  h_frame(h, up_at, 0, key, 0, 0, 0);
}

#define CX(r) ((r).x + (r).w / 2)
#define CY(r) ((r).y + (r).h / 2)

static void touch_down_at(H *h, uint64_t now, const Rect *r) { h_frame(h, now, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, CX(*r), CY(*r)); }
static void touch_move_to(H *h, uint64_t now, int x, int y) { h_frame(h, now, 0, 0, IN_KEY_TOUCH, x, y); }
static void touch_up_at(H *h, uint64_t now, int x, int y) { h_frame(h, now, 0, IN_KEY_TOUCH, 0, x, y); }

// ---- 1. una decisión perdida no deja la tarjeta bloqueada ----

static void test_lost_allow_does_not_lock(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VY, 0); // Y: riesgo normal
  h.send_fails = 1;
  tap_key(&h, IN_KEY_A, 600, 700);
  CHECK_EQ_INT(h.dec_count, 1);
  CHECK_EQ_INT(h.dec[0].allow, 1);
  CHECK(h.session_dead); // el envío falló: la app cierra la sesión
  // reconecta y el puente sigue mostrando Y
  h.send_fails = 0;
  h_connect(&h, &VY, 5000);
  tap_key(&h, IN_KEY_A, 5100, 5200);
  CHECK_EQ_INT(h.dec_count, 1); // la guarda de 500 ms cuenta desde que se vuelve a ver la tarjeta
  tap_key(&h, IN_KEY_A, 5500, 5600);
  CHECK_EQ_INT(h.dec_count, 2);
  CHECK_STR(h.dec[1].id, "y");
  CHECK_EQ_INT(h.dec[1].allow, 1);
  // un envío correcto sí bloquea repetir sobre la misma solicitud, con A y con B
  tap_key(&h, IN_KEY_A, 5700, 5800);
  tap_key(&h, IN_KEY_B, 5900, 6000);
  CHECK_EQ_INT(h.dec_count, 2);
  CHECK(!approve_ready(&h.in.approve, 6000));
}

static void test_lost_deny_does_not_lock(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VX, 0);
  h.send_fails = 1;
  tap_key(&h, IN_KEY_B, 100, 150);
  CHECK_EQ_INT(h.dec_count, 1);
  CHECK_EQ_INT(h.dec[0].allow, 0);
  CHECK(h.session_dead);
  h.send_fails = 0;
  h_connect(&h, &VX, 4000);
  tap_key(&h, IN_KEY_B, 4010, 4020); // rechazar no tiene guarda
  CHECK_EQ_INT(h.dec_count, 2);
  CHECK_EQ_INT(h.dec[1].allow, 0);
  CHECK_STR(h.dec[1].id, "x");
  tap_key(&h, IN_KEY_B, 4100, 4120); // enviado bien: no se repite
  tap_key(&h, IN_KEY_A, 5000, 5100);
  CHECK_EQ_INT(h.dec_count, 2);
}

static void test_lost_high_risk_does_not_lock(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VX, 0);
  h.send_fails = 1;
  h_frame(&h, 600, IN_KEY_A, 0, IN_KEY_A, 0, 0);
  h_tick(&h, 600 + APPROVE_HOLD_MS);
  CHECK_EQ_INT(h.dec_count, 1);
  CHECK(h.session_dead);
  h.send_fails = 0;
  h_connect(&h, &VX, 8000);
  h_frame(&h, 8600, IN_KEY_A, 0, IN_KEY_A, 0, 0);
  h_tick(&h, 8600 + APPROVE_HOLD_MS);
  CHECK_EQ_INT(h.dec_count, 2);
  CHECK_EQ_INT(h.dec[1].allow, 1);
  CHECK(approve_is_decided(&h.in.approve, "x"));
}

// ---- 3. rechazar solo si sigue siendo la misma solicitud ----

static void test_touch_deny_other_request(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VY, 0);
  Rect deny = h.lay.btn_deny;
  touch_down_at(&h, 1000, &deny);
  h_view(&h, &VZ, 1200); // Y se resuelve y aparece Z con el botón en el mismo sitio
  CHECK(h.lay.btn_deny.x == deny.x && h.lay.btn_deny.y == deny.y);
  touch_up_at(&h, 1300, CX(deny), CY(deny));
  CHECK_EQ_INT(h.dec_count, 0);
  // control: sobre la misma solicitud sí rechaza, sin esperar la guarda
  touch_down_at(&h, 1310, &deny);
  touch_up_at(&h, 1320, CX(deny), CY(deny));
  CHECK_EQ_INT(h.dec_count, 1);
  CHECK_STR(h.dec[0].id, "z");
  CHECK_EQ_INT(h.dec[0].allow, 0);
}

static void test_touch_deny_changed_text_same_id(void) {
  H h;
  View vx2;
  h_init(&h);
  v_request(&vx2, "x", 1, "rm -rf b"); // mismo id, otra línea: otra solicitud
  h_connect(&h, &VX, 0);
  Rect deny = h.lay.btn_deny;
  touch_down_at(&h, 1000, &deny);
  h_view(&h, &vx2, 1100);
  touch_up_at(&h, 1200, CX(deny), CY(deny));
  CHECK_EQ_INT(h.dec_count, 0);
}

static void test_touch_deny_without_card_at_start(void) {
  H h;
  View none;
  h_init(&h);
  v_reset(&none);
  h_connect(&h, &none, 0);
  // el toque empieza sin tarjeta y aparece una debajo: no hay zona de rechazar al empezar
  h_frame(&h, 100, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, 160, 200);
  h_view(&h, &VX, 200);
  Rect deny = h.lay.btn_deny;
  touch_up_at(&h, 300, CX(deny), CY(deny));
  CHECK_EQ_INT(h.dec_count, 0);
}

static void test_button_deny_on_release_same_request(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VX, 0);
  h_frame(&h, 100, IN_KEY_B, 0, IN_KEY_B, 0, 0);
  CHECK_EQ_INT(h.dec_count, 0); // al pulsar no sale nada
  h_frame(&h, 150, 0, IN_KEY_B, 0, 0, 0);
  CHECK_EQ_INT(h.dec_count, 1);
  CHECK_EQ_INT(h.dec[0].allow, 0);

  // pulsa B sobre X, aparece Y, suelta: no rechaza a Y
  h_init(&h);
  h_connect(&h, &VX, 0);
  h_frame(&h, 100, IN_KEY_B, 0, IN_KEY_B, 0, 0);
  h_view(&h, &VY, 120);
  h_frame(&h, 140, 0, IN_KEY_B, 0, 0, 0);
  CHECK_EQ_INT(h.dec_count, 0);
  // y una pulsación nueva sobre Y sí
  tap_key(&h, IN_KEY_B, 200, 230);
  CHECK_EQ_INT(h.dec_count, 1);
  CHECK_STR(h.dec[0].id, "y");

  // la solicitud desaparece mientras B está pulsado: soltar no rechaza ni navega
  h_init(&h);
  h_connect(&h, &VX, 0);
  h_frame(&h, 100, IN_KEY_B, 0, IN_KEY_B, 0, 0);
  h_view(&h, &VNONE, 120);
  h_frame(&h, 140, 0, IN_KEY_B, 0, 0, 0);
  CHECK_EQ_INT(h.dec_count, 0);

  // sin tarjeta, B vuelve un nivel al pulsar
  h_init(&h);
  h_connect(&h, &VNONE, 0);
  h.in.nav.level = NAV_SESSIONS;
  h.in.nav.kind = AGENT_CLAUDE;
  h_frame(&h, 100, IN_KEY_B, 0, IN_KEY_B, 0, 0);
  CHECK_EQ_INT(h.in.nav.level, NAV_AGENTS);
  h_frame(&h, 150, 0, IN_KEY_B, 0, 0, 0);
  CHECK_EQ_INT(h.dec_count, 0);
}

// ---- 4. un toque no anula la retención del botón A ----

static void test_touch_does_not_cancel_button_gesture(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VY, 0);
  Rect ap = h.lay.btn_approve;
  h_frame(&h, 600, IN_KEY_A, 0, IN_KEY_A, 0, 0); // gesto del botón físico
  touch_down_at(&h, 700, &ap);                   // el lápiz toca el botón: no es dueño del gesto
  touch_move_to(&h, 750, 2, 2);                  // sale del botón
  touch_up_at(&h, 800, 2, 2);                    // y suelta fuera
  h_frame(&h, 900, 0, IN_KEY_A, 0, 0, 0);
  CHECK_EQ_INT(h.dec_count, 1);
  CHECK_EQ_INT(h.dec[0].allow, 1);

  // lo mismo soltando sobre el botón
  h_init(&h);
  h_connect(&h, &VY, 0);
  h_frame(&h, 600, IN_KEY_A, 0, IN_KEY_A, 0, 0);
  touch_down_at(&h, 700, &ap);
  touch_up_at(&h, 800, CX(ap), CY(ap));
  CHECK_EQ_INT(h.dec_count, 0); // el toque no aprueba: el gesto es del botón
  h_frame(&h, 900, 0, IN_KEY_A, 0, 0, 0);
  CHECK_EQ_INT(h.dec_count, 1);
}

static void test_button_does_not_cancel_pen_gesture(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VY, 0);
  Rect ap = h.lay.btn_approve;
  touch_down_at(&h, 600, &ap);
  tap_key(&h, IN_KEY_A, 650, 700); // A ignorado: ya hay un gesto del lápiz
  CHECK_EQ_INT(h.dec_count, 0);
  touch_up_at(&h, 800, CX(ap), CY(ap));
  CHECK_EQ_INT(h.dec_count, 1);

  // el lápiz que sale del botón sí cancela su propio gesto
  h_init(&h);
  h_connect(&h, &VY, 0);
  touch_down_at(&h, 600, &ap);
  touch_move_to(&h, 650, 2, 2);
  touch_up_at(&h, 700, CX(ap), CY(ap));
  CHECK_EQ_INT(h.dec_count, 0);
}

// ---- 5. sesión fallida ----

static int dead_send(void *ctx, const uint8_t *d, size_t n) {
  (void)ctx; (void)d; (void)n;
  return -1;
}
static int ok_send(void *ctx, const uint8_t *d, size_t n) {
  (void)ctx; (void)d; (void)n;
  return 0;
}

static void ready_session(Session *s, int (*send)(void *, const uint8_t *, size_t)) {
  uint8_t key[32], nonce[16];
  memset(key, 7, sizeof key);
  memset(nonce, 9, sizeof nonce);
  session_init(s, "3ds-test", key, nonce);
  Transport t = {send, NULL};
  session_on_connected(s, t);
  s->state = SESSION_READY; // saludo ya hecho
  frame_sealer_init(&s->sealer, key, FRAME_DIR_CONSOLE_TO_BRIDGE);
}

static Session S;

static void test_session_failed_detected(void) {
  ready_session(&S, ok_send);
  CHECK(!input_session_failed(&S));
  CHECK_EQ_INT(session_send_decision(&S, "x", 1), 0);
  CHECK(!input_session_failed(&S));
  CHECK_EQ_INT(session_send_decision(&S, "id con espacios", 1), -1); // argumento inválido: no es un fallo de sesión
  CHECK(!input_session_failed(&S));

  // cualquier envío que falle deja la sesión en FAILED y se detecta de inmediato
  int (*sends[])(Session *) = {session_send_skip, session_send_ping};
  for (int i = 0; i < 2; i++) {
    ready_session(&S, dead_send);
    CHECK_EQ_INT(sends[i](&S), -1);
    CHECK(input_session_failed(&S));
    CHECK_EQ_INT(S.error, SESSION_ERR_SEND);
  }
  ready_session(&S, dead_send);
  CHECK_EQ_INT(session_send_focus(&S, "s1"), -1); // el focus que sale al quedar lista
  CHECK(input_session_failed(&S));
  ready_session(&S, dead_send);
  CHECK_EQ_INT(session_send_mode(&S, 1), -1);
  CHECK(input_session_failed(&S));
  ready_session(&S, dead_send);
  CHECK_EQ_INT(session_send_decision(&S, "x", 0), -1);
  CHECK(input_session_failed(&S));

  // un error de recepción también
  ready_session(&S, ok_send);
  uint8_t junk[FRAME_HEADER_LEN + 3];
  int n = frame_encode(FRAME_JSON, (const uint8_t *)"abc", 3, junk, sizeof junk); // sin etiqueta válida
  CHECK(n > 0);
  CHECK(session_on_data(&S, junk, (size_t)n) < 0);
  CHECK(input_session_failed(&S));
  CHECK_EQ_INT(S.error, SESSION_ERR_TAG);
}

static void test_ready_focus_failure_closes(void) {
  // el focus de on_ready (detalle abierto al reconectar) que falla se trata como cualquier otro envío
  H h;
  h_init(&h);
  h_connect(&h, &VNONE, 0);
  h.in.nav.level = NAV_DETAIL;
  strcpy(h.in.nav.session_id, "s1");
  InputActions acts;
  input_session_ready(&h.in, &acts);
  CHECK_EQ_INT(acts.n, 1);
  CHECK_EQ_INT(acts.a[0].kind, IN_ACT_FOCUS);
  CHECK_STR(acts.a[0].id, "s1");
  h.send_fails = 1;
  exec(&h, &acts);
  CHECK(h.session_dead);
}

// ---- L+R ----

static void test_lr_chord_and_skip(void) {
  H h;
  View two;
  h_init(&h);
  v_request(&two, "q", 0, "ls");
  two.pending_count = 3; // modo en fila con varios pendientes: L/R saltan
  h_connect(&h, &two, 0);
  tap_key(&h, IN_KEY_L, 100, 180);
  CHECK_EQ_INT(h.skips, 1); // al soltar
  tap_key(&h, IN_KEY_R, 300, 380);
  CHECK_EQ_INT(h.skips, 2);
  h_frame(&h, 500, IN_KEY_L, 0, IN_KEY_L, 0, 0);
  CHECK_EQ_INT(h.skips, 2); // al pulsar no salta todavía

  // L+R: antes de 1 s no pasa nada; a 1 s alterna el diagnóstico y no salta nunca
  h_init(&h);
  h_connect(&h, &two, 0);
  h_frame(&h, 1000, IN_KEY_L, 0, IN_KEY_L, 0, 0);
  h_frame(&h, 1020, IN_KEY_R, 0, IN_KEY_L | IN_KEY_R, 0, 0);
  h_frame(&h, 1500, 0, 0, IN_KEY_L | IN_KEY_R, 0, 0);
  CHECK(!h.in.diag_on);
  h_frame(&h, 2019, 0, 0, IN_KEY_L | IN_KEY_R, 0, 0);
  CHECK(!h.in.diag_on);
  h_frame(&h, 2020, 0, 0, IN_KEY_L | IN_KEY_R, 0, 0);
  CHECK(h.in.diag_on);
  h_frame(&h, 3000, 0, 0, IN_KEY_L | IN_KEY_R, 0, 0);
  CHECK(h.in.diag_on); // una vez por pulsación
  h_frame(&h, 3100, 0, IN_KEY_L, IN_KEY_R, 0, 0);
  h_frame(&h, 3150, 0, IN_KEY_R, 0, 0, 0);
  CHECK_EQ_INT(h.skips, 0);
  // otra pulsación larga lo apaga
  h_frame(&h, 4000, IN_KEY_L | IN_KEY_R, 0, IN_KEY_L | IN_KEY_R, 0, 0);
  h_frame(&h, 5000, 0, 0, IN_KEY_L | IN_KEY_R, 0, 0);
  CHECK(!h.in.diag_on);
  h_frame(&h, 5100, 0, IN_KEY_L | IN_KEY_R, 0, 0, 0);
  CHECK_EQ_INT(h.skips, 0);

  // toque corto de los dos a la vez: ni diagnóstico ni salto
  h_init(&h);
  h_connect(&h, &two, 0);
  h_frame(&h, 100, IN_KEY_L | IN_KEY_R, 0, IN_KEY_L | IN_KEY_R, 0, 0);
  h_frame(&h, 300, 0, IN_KEY_L | IN_KEY_R, 0, 0, 0);
  CHECK(!h.in.diag_on);
  CHECK_EQ_INT(h.skips, 0);
  // y después L solo vuelve a saltar
  tap_key(&h, IN_KEY_L, 500, 560);
  CHECK_EQ_INT(h.skips, 1);

  // L primero y R más tarde, soltando en cualquier orden: es un atajo, no salta
  h_init(&h);
  h_connect(&h, &two, 0);
  h_frame(&h, 100, IN_KEY_L, 0, IN_KEY_L, 0, 0);
  h_frame(&h, 400, IN_KEY_R, 0, IN_KEY_L | IN_KEY_R, 0, 0);
  h_frame(&h, 500, 0, IN_KEY_L, IN_KEY_R, 0, 0);
  h_frame(&h, 600, 0, IN_KEY_R, 0, 0, 0);
  CHECK_EQ_INT(h.skips, 0);

  // sin varios pendientes no hay salto
  h_init(&h);
  h_connect(&h, &VX, 0);
  tap_key(&h, IN_KEY_L, 100, 180);
  CHECK_EQ_INT(h.skips, 0);
}

static void test_diag_ignores_touch(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VY, 0);
  Rect ap = h.lay.btn_approve;
  h.in.diag_on = 1; // la pantalla inferior muestra el diagnóstico: los toques no valen
  touch_down_at(&h, 600, &ap);
  touch_up_at(&h, 700, CX(ap), CY(ap));
  CHECK_EQ_INT(h.dec_count, 0);
  // y A tampoco decide mientras está abierto
  tap_key(&h, IN_KEY_A, 800, 900);
  CHECK_EQ_INT(h.dec_count, 0);
}

// Abre el diagnóstico con L+R mantenidos 1 s (suelta al terminar). Devuelve el instante de la última trama.
static uint64_t diag_toggle(H *h, uint64_t at) {
  const uint32_t lr = IN_KEY_L | IN_KEY_R;
  h_frame(h, at, lr, 0, lr, 0, 0);
  h_frame(h, at + INPUT_DIAG_HOLD_MS, 0, 0, lr, 0, 0);
  h_frame(h, at + INPUT_DIAG_HOLD_MS + 50, 0, lr, 0, 0, 0);
  return at + INPUT_DIAG_HOLD_MS + 50;
}

static void test_diag_swallows_a_and_b(void) {
  H h;
  View two;
  v_request(&two, "q", 0, "ls");
  two.pending_count = 3;
  h_init(&h);
  h_connect(&h, &two, 0);
  uint64_t t = diag_toggle(&h, 600);
  CHECK(h.in.diag_on);
  // A y B no deciden, ni X, Y, cruceta, L/R
  tap_key(&h, IN_KEY_A, t + 700, t + 800);
  tap_key(&h, IN_KEY_B, t + 900, t + 950);
  tap_key(&h, IN_KEY_X, t + 1000, t + 1050);
  tap_key(&h, IN_KEY_Y, t + 1100, t + 1150);
  tap_key(&h, IN_KEY_UP, t + 1200, t + 1250);
  tap_key(&h, IN_KEY_L, t + 1300, t + 1350);
  tap_key(&h, IN_KEY_R, t + 1400, t + 1450);
  CHECK_EQ_INT(h.dec_count, 0);
  CHECK_EQ_INT(h.modes, 0);
  CHECK_EQ_INT(h.pair, 0);
  CHECK_EQ_INT(h.skips, 0);
  CHECK(h.in.diag_on);
  // START sigue saliendo
  tap_key(&h, IN_KEY_START, t + 1500, t + 1550);
  CHECK_EQ_INT(h.quits, 1);
  // cerrar con L+R devuelve el control, pasada la guarda
  t = diag_toggle(&h, t + 2000);
  CHECK(!h.in.diag_on);
  tap_key(&h, IN_KEY_A, t + 600, t + 700);
  CHECK_EQ_INT(h.dec_count, 1);
}

static void test_diag_card_arrived_while_open_needs_guard(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VNONE, 0);
  uint64_t t = diag_toggle(&h, 100); // abierto
  CHECK(h.in.diag_on);
  h_view(&h, &VY, t + 500); // llega una tarjeta que nadie ve
  tap_key(&h, IN_KEY_A, t + 1500, t + 1600);
  tap_key(&h, IN_KEY_B, t + 1700, t + 1750);
  CHECK_EQ_INT(h.dec_count, 0);
  uint64_t close_at = diag_toggle(&h, t + 3000); // cerrado: la guarda cuenta desde aquí
  CHECK(!h.in.diag_on);
  tap_key(&h, IN_KEY_A, close_at + 100, close_at + 200);
  CHECK_EQ_INT(h.dec_count, 0);
  tap_key(&h, IN_KEY_A, close_at + 600, close_at + 700);
  CHECK_EQ_INT(h.dec_count, 1);
  CHECK_STR(h.dec[0].id, "y");
}

static void test_diag_open_cancels_held_a(void) {
  H h;
  const uint32_t lr = IN_KEY_L | IN_KEY_R;
  // riesgo alto: A mantenido al abrir el diagnóstico no completa la retención
  h_init(&h);
  h_connect(&h, &VX, 0);
  h_frame(&h, 600, IN_KEY_A, 0, IN_KEY_A, 0, 0);
  h_frame(&h, 700, lr, 0, IN_KEY_A | lr, 0, 0);
  h_frame(&h, 1700, 0, 0, IN_KEY_A | lr, 0, 0); // a 1 s abre el diagnóstico
  CHECK(h.in.diag_on);
  h_tick(&h, 1800);
  h_tick(&h, 2500);
  h_tick(&h, 3500);
  CHECK_EQ_INT(h.dec_count, 0);
  h_frame(&h, 3600, 0, IN_KEY_A | lr, 0, 0, 0);
  CHECK_EQ_INT(h.dec_count, 0);
  // riesgo normal: soltar A después de abrir no aprueba
  h_init(&h);
  h_connect(&h, &VY, 0);
  h_frame(&h, 600, IN_KEY_A, 0, IN_KEY_A, 0, 0);
  h_frame(&h, 700, lr, 0, IN_KEY_A | lr, 0, 0);
  h_frame(&h, 1700, 0, 0, IN_KEY_A | lr, 0, 0);
  CHECK(h.in.diag_on);
  h_frame(&h, 1800, 0, IN_KEY_A | lr, 0, 0, 0);
  CHECK_EQ_INT(h.dec_count, 0);
}

static void test_diag_open_drops_pen_and_b(void) {
  H h;
  const uint32_t lr = IN_KEY_L | IN_KEY_R;
  // B mantenido (rechazo armado) al abrir: soltar con el diagnóstico abierto no rechaza
  h_init(&h);
  h_connect(&h, &VY, 0);
  h_frame(&h, 600, IN_KEY_B, 0, IN_KEY_B, 0, 0);
  h_frame(&h, 700, lr, 0, IN_KEY_B | lr, 0, 0);
  h_frame(&h, 1700, 0, 0, IN_KEY_B | lr, 0, 0);
  CHECK(h.in.diag_on);
  h_frame(&h, 1800, 0, IN_KEY_B | lr, 0, 0, 0);
  CHECK_EQ_INT(h.dec_count, 0);
  // lápiz sobre Aprobar al abrir: soltar no aprueba
  h_init(&h);
  h_connect(&h, &VY, 0);
  Rect ap = h.lay.btn_approve;
  touch_down_at(&h, 600, &ap);
  h_frame(&h, 700, lr, 0, IN_KEY_TOUCH | lr, CX(ap), CY(ap));
  h_frame(&h, 1700, 0, 0, IN_KEY_TOUCH | lr, CX(ap), CY(ap));
  CHECK(h.in.diag_on);
  touch_up_at(&h, 1800, CX(ap), CY(ap));
  CHECK_EQ_INT(h.dec_count, 0);
  CHECK(!h.in.pen_active);
}

// ---- varios ----

static void test_misc_keys(void) {
  H h;
  View none;
  h_init(&h);
  v_reset(&none);
  h_connect(&h, &none, 0);
  tap_key(&h, IN_KEY_Y, 100, 150);
  CHECK_EQ_INT(h.pair, 0); // conectado y sin tarjeta: Y ya no abre el teclado (se abre desde la guía)
  CHECK_EQ_INT(h.ip, 0); // SELECT no escribe la IP: abre el menú (la IP es X en la última página de la guía)
  tap_key(&h, IN_KEY_X, 300, 350);
  CHECK_EQ_INT(h.modes, 1);
  // con tarjeta no se abren los teclados
  h_view(&h, &VX, 400);
  tap_key(&h, IN_KEY_Y, 500, 550);
  CHECK_EQ_INT(h.pair, 0);
  h_frame(&h, 600, IN_KEY_START, 0, IN_KEY_START, 0, 0);
  CHECK_EQ_INT(h.quits, 1);

  // sin vista: A reintenta solo si can_retry
  h_init(&h);
  InputFrame f;
  InputActions acts;
  memset(&f, 0, sizeof f);
  f.down = IN_KEY_A;
  f.held = IN_KEY_A;
  f.layout = &h.lay;
  input_frame(&h.in, &f, &acts);
  CHECK_EQ_INT(acts.n, 0);
  f.can_retry = 1;
  input_frame(&h.in, &f, &acts);
  CHECK_EQ_INT(acts.n, 1);
  CHECK_EQ_INT(acts.a[0].kind, IN_ACT_RETRY);
}

// ---- "sí, no volver a preguntar" (Y y la franja de la tarjeta) ----

static void test_always_key_normal_risk(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VYA, 0);
  tap_key(&h, IN_KEY_Y, 300, 350); // dentro de la guarda de 500 ms
  CHECK_EQ_INT(h.dec_count, 0);
  tap_key(&h, IN_KEY_Y, 600, 700);
  CHECK_EQ_INT(h.dec_count, 1);
  CHECK_STR(h.dec[0].id, "ya");
  CHECK_EQ_INT(h.dec[0].allow, 2);
  CHECK_EQ_INT(h.pair, 0); // con tarjeta Y nunca abre el teclado
  // ya respondida: ni Y ni A repiten
  tap_key(&h, IN_KEY_Y, 800, 900);
  tap_key(&h, IN_KEY_A, 1000, 1100);
  CHECK_EQ_INT(h.dec_count, 1);
  // A normal sobre otra tarjeta con "siempre" sigue mandando 1
  View other = VYA;
  strcpy(other.request.id, "yb");
  h_view(&h, &other, 2000);
  tap_key(&h, IN_KEY_A, 2600, 2700);
  CHECK_EQ_INT(h.dec_count, 2);
  CHECK_EQ_INT(h.dec[1].allow, 1);
}

static void test_always_key_without_offer(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VY, 0); // la tarjeta no ofrece "siempre"
  tap_key(&h, IN_KEY_Y, 600, 700);
  CHECK_EQ_INT(h.dec_count, 0);
  CHECK_EQ_INT(h.pair, 0);
  // y sin tarjeta, con conexión, Y no hace nada
  View none;
  v_reset(&none);
  h_view(&h, &none, 800);
  tap_key(&h, IN_KEY_Y, 900, 950);
  CHECK_EQ_INT(h.pair, 0);
  CHECK_EQ_INT(h.dec_count, 0);
}

// Sin vista (sin conexión o sin emparejar) Y sigue abriendo el código de emparejamiento: no hay otra forma sin la guía.
static void test_y_pairs_only_without_view(void) {
  H h;
  h_init(&h);
  tap_key(&h, IN_KEY_Y, 100, 150);
  CHECK_EQ_INT(h.pair, 1);
  CHECK_EQ_INT(h.ip, 0);
}

static void test_always_key_high_risk_hold(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VXA, 0);
  // soltar antes de 1 s no decide
  h_frame(&h, 600, IN_KEY_Y, 0, IN_KEY_Y, 0, 0);
  h_tick(&h, 1000);
  h_frame(&h, 1200, 0, IN_KEY_Y, 0, 0, 0);
  CHECK_EQ_INT(h.dec_count, 0);
  // mantener 1 s decide una vez, con la bandera, sin esperar a soltar
  h_frame(&h, 2000, IN_KEY_Y, 0, IN_KEY_Y, 0, 0);
  h_tick(&h, 2999);
  CHECK_EQ_INT(h.dec_count, 0);
  h_tick(&h, 3000);
  CHECK_EQ_INT(h.dec_count, 1);
  CHECK_EQ_INT(h.dec[0].allow, 2);
  h_tick(&h, 3100);
  h_frame(&h, 3200, 0, IN_KEY_Y, 0, 0, 0);
  CHECK_EQ_INT(h.dec_count, 1);
}

static void test_always_key_mixed_with_a(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VYA, 0);
  // A abajo, Y abajo y Y arriba: Y no decide ni anula; A al soltar manda 1
  h_frame(&h, 600, IN_KEY_A, 0, IN_KEY_A, 0, 0);
  h_frame(&h, 650, IN_KEY_Y, 0, IN_KEY_A | IN_KEY_Y, 0, 0);
  h_frame(&h, 700, 0, IN_KEY_Y, IN_KEY_A, 0, 0);
  CHECK_EQ_INT(h.dec_count, 0);
  h_frame(&h, 750, 0, IN_KEY_A, 0, 0, 0);
  CHECK_EQ_INT(h.dec_count, 1);
  CHECK_EQ_INT(h.dec[0].allow, 1);
}

static void test_always_changed_card_cancels(void) {
  H h;
  View changed = VYA;
  h_init(&h);
  h_connect(&h, &VYA, 0);
  h_frame(&h, 600, IN_KEY_Y, 0, IN_KEY_Y, 0, 0);
  strcpy(changed.request.always, "Bash(otra cosa)"); // misma solicitud, otra cosa que quedaría permitida
  h_view(&h, &changed, 650);
  h_frame(&h, 700, 0, IN_KEY_Y, 0, 0, 0);
  CHECK_EQ_INT(h.dec_count, 0);
  // la tarjeta deja de ofrecerlo a mitad del gesto
  h_view(&h, &VYA, 1000);
  h_frame(&h, 1600, IN_KEY_Y, 0, IN_KEY_Y, 0, 0);
  h_view(&h, &VY, 1650);
  h_frame(&h, 1700, 0, IN_KEY_Y, 0, 0, 0);
  CHECK_EQ_INT(h.dec_count, 0);
}

static void test_always_touch_zone(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VYA, 0);
  CHECK(h.lay.has_always);
  Rect al = h.lay.btn_always;
  // pasada la guarda: tocar y soltar dentro de la franja decide con la bandera
  touch_down_at(&h, 600, &al);
  touch_up_at(&h, 700, CX(al), CY(al));
  CHECK_EQ_INT(h.dec_count, 1);
  CHECK_EQ_INT(h.dec[0].allow, 2);
  // salir de la franja anula
  View other = VYA;
  strcpy(other.request.id, "yb");
  h_view(&h, &other, 1000);
  touch_down_at(&h, 1600, &al);
  touch_move_to(&h, 1650, h.lay.btn_deny.x + 2, h.lay.btn_deny.y + 2);
  touch_up_at(&h, 1700, CX(al), CY(al));
  CHECK_EQ_INT(h.dec_count, 1);
  // empezar en Aprobar y soltar en la franja tampoco decide
  Rect ap = h.lay.btn_approve;
  touch_down_at(&h, 1800, &ap);
  touch_move_to(&h, 1850, CX(al), CY(al));
  touch_up_at(&h, 1900, CX(al), CY(al));
  CHECK_EQ_INT(h.dec_count, 1);
  // dentro de la guarda no decide
  View third = VYA;
  strcpy(third.request.id, "yc");
  h_view(&h, &third, 3000);
  touch_down_at(&h, 3100, &al);
  touch_up_at(&h, 3200, CX(al), CY(al));
  CHECK_EQ_INT(h.dec_count, 1);
}

static void test_always_blocked_by_guide_and_diag(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VYA, 0);
  // SELECT con la tarjeta a la vista no abre el menú ni anula nada: Y sigue siendo el gesto de "siempre"
  tap_key(&h, IN_KEY_SELECT, 700, 750);
  CHECK(!h.in.menu.open);
  h_frame(&h, 2000, IN_KEY_Y, 0, IN_KEY_Y, 0, 0);
  tap_key(&h, IN_KEY_SELECT, 2100, 2150);
  CHECK(!h.in.menu.open);
  h_frame(&h, 2200, 0, IN_KEY_Y, 0, 0, 0); // se suelta: decide (pasó la guarda y no hay retención)
  CHECK_EQ_INT(h.dec_count, 1);
  CHECK_EQ_INT(h.dec[0].allow, 2);
  // otra tarjeta: lo que sigue prueba el diagnóstico
  h_init(&h);
  h_connect(&h, &VYA, 0);
  // con el diagnóstico abierto Y se traga y la guarda empieza al cerrarlo
  uint64_t t = diag_toggle(&h, 3000);
  CHECK(h.in.diag_on);
  tap_key(&h, IN_KEY_Y, t + 700, t + 800);
  CHECK_EQ_INT(h.dec_count, 0);
  t = diag_toggle(&h, t + 2000);
  tap_key(&h, IN_KEY_Y, t + 100, t + 200);
  CHECK_EQ_INT(h.dec_count, 0);
  tap_key(&h, IN_KEY_Y, t + 700, t + 800);
  CHECK_EQ_INT(h.dec_count, 1);
  CHECK_EQ_INT(h.dec[0].allow, 2);
}

static void test_always_lost_send_does_not_lock(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VYA, 0);
  h.send_fails = 1;
  tap_key(&h, IN_KEY_Y, 600, 700);
  CHECK_EQ_INT(h.dec_count, 1);
  CHECK(h.session_dead);
  h.send_fails = 0;
  h_connect(&h, &VYA, 5000);
  tap_key(&h, IN_KEY_Y, 5100, 5200); // guarda de 500 ms desde que se vuelve a ver
  CHECK_EQ_INT(h.dec_count, 1);
  tap_key(&h, IN_KEY_Y, 5600, 5700);
  CHECK_EQ_INT(h.dec_count, 2);
  CHECK_EQ_INT(h.dec[1].allow, 2);
}

static void test_one_decision_per_batch(void) {
  // A y B soltados en el mismo cuadro sobre la misma solicitud: una sola decisión
  H h;
  h_init(&h);
  h_connect(&h, &VY, 0);
  h_frame(&h, 600, IN_KEY_A | IN_KEY_B, 0, IN_KEY_A | IN_KEY_B, 0, 0);
  h_frame(&h, 700, 0, IN_KEY_A | IN_KEY_B, 0, 0, 0);
  CHECK_EQ_INT(h.dec_count, 1);
}

// ---- menú de configuración (SELECT) y guía de botones (una entrada del menú) ----

// SELECT abre el menú (con una tarjeta de permiso a la vista no abre: ver test_menu_select_ignored_with_card).
static void menu_open_via_select(H *h, uint64_t at) { tap_key(h, IN_KEY_SELECT, at, at + 10); }

// SELECT, abajo hasta "Guía de botones" y A. Sin tarjeta.
static void guide_open_via_select(H *h, uint64_t at) {
  menu_open_via_select(h, at);
  for (int i = 0; i < (int)MENU_E_GUIDE; i++) tap_key(h, IN_KEY_DOWN, at + 20 + (uint64_t)i * 20, at + 30 + (uint64_t)i * 20);
  tap_key(h, IN_KEY_A, at + 90, at + 95);
}

static void test_guide_opens_from_any_state(void) {
  H h;
  View none;
  v_reset(&none);
  // sin vista (buscando el puente / sin emparejar): el menú abre y la guía es su cuarta entrada
  h_init(&h);
  menu_open_via_select(&h, 100);
  CHECK(h.in.menu.open);
  CHECK(!h.in.guide.open);
  tap_key(&h, IN_KEY_SELECT, 200, 250); // SELECT cierra el menú
  CHECK(!h.in.menu.open);
  guide_open_via_select(&h, 300);
  CHECK(h.in.guide.open);
  CHECK(h.in.menu.open); // la guía está encima del menú
  CHECK_EQ_INT(h.in.guide.page, 0);
  CHECK_EQ_INT(h.ip, 0);
  tap_key(&h, IN_KEY_SELECT, 600, 650); // SELECT cierra la guía y se vuelve al menú
  CHECK(!h.in.guide.open);
  CHECK(h.in.menu.open);
  tap_key(&h, IN_KEY_B, 700, 750); // B cierra el menú
  CHECK(!h.in.menu.open);
  // conectada y en agentes
  h_init(&h);
  h_connect(&h, &none, 0);
  guide_open_via_select(&h, 100);
  CHECK(h.in.guide.open);
  tap_key(&h, IN_KEY_B, 400, 450); // B cierra la guía
  CHECK(!h.in.guide.open);
  CHECK(h.in.menu.open);
  // START sigue saliendo con la guía abierta
  guide_open_via_select(&h, 500);
  h_frame(&h, 800, IN_KEY_START, 0, IN_KEY_START, 0, 0);
  CHECK_EQ_INT(h.quits, 1);
  // la guía se abre en la primera página cada vez
  h_init(&h);
  guide_open_via_select(&h, 100);
  tap_key(&h, IN_KEY_RIGHT, 300, 350);
  CHECK_EQ_INT(h.in.guide.page, 1);
  tap_key(&h, IN_KEY_B, 400, 450);
  tap_key(&h, IN_KEY_A, 500, 550); // el cursor sigue en "Guía de botones"
  CHECK(h.in.guide.open);
  CHECK_EQ_INT(h.in.guide.page, 0);
}

// SELECT con una tarjeta de permiso a la vista no abre el menú: primero se responde. No cancela el gesto de aprobar.
static void test_menu_select_ignored_with_card(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VY, 0);
  tap_key(&h, IN_KEY_SELECT, 600, 650);
  CHECK(!h.in.menu.open);
  CHECK(!h.in.guide.open);
  // el gesto de aprobar en curso no se cancela
  h_frame(&h, 1000, IN_KEY_A, 0, IN_KEY_A, 0, 0);
  h_frame(&h, 1100, IN_KEY_SELECT, 0, IN_KEY_A | IN_KEY_SELECT, 0, 0);
  CHECK(!h.in.menu.open);
  h_frame(&h, 1200, 0, IN_KEY_A | IN_KEY_SELECT, 0, 0, 0);
  CHECK_EQ_INT(h.dec_count, 1);
  CHECK_EQ_INT(h.dec[0].allow, 1);
  // y la tarjeta de riesgo alto sigue pidiendo su retención de 1 s
  h_init(&h);
  h_connect(&h, &VX, 0);
  h_frame(&h, 600, IN_KEY_A, 0, IN_KEY_A, 0, 0);
  h_frame(&h, 700, IN_KEY_SELECT, 0, IN_KEY_A | IN_KEY_SELECT, 0, 0);
  h_tick(&h, 1700);
  h_frame(&h, 1750, 0, IN_KEY_A | IN_KEY_SELECT, 0, 0, 0);
  CHECK_EQ_INT(h.dec_count, 1);
}

// Con el menú o la guía abiertos (sin tarjeta) las entradas no llegan a la app de debajo.
static void test_guide_swallows_inputs(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VNONE, 0);
  guide_open_via_select(&h, 600);
  tap_key(&h, IN_KEY_A, 700, 800);          // A no entra a un agente
  tap_key(&h, IN_KEY_X, 900, 950);          // X no cambia el modo (no es la página de la IP)
  tap_key(&h, IN_KEY_L, 1000, 1050);        // L / R no saltan
  tap_key(&h, IN_KEY_R, 1100, 1150);
  tap_key(&h, IN_KEY_Y, 1200, 1250);        // Y no abre el teclado
  tap_key(&h, IN_KEY_UP, 1300, 1350);
  h_frame(&h, 1400, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, 160, 100);
  h_frame(&h, 1450, 0, IN_KEY_TOUCH, 0, 160, 100);
  CHECK_EQ_INT(h.modes, 0);
  CHECK_EQ_INT(h.skips, 0);
  CHECK_EQ_INT(h.pair, 0);
  CHECK_EQ_INT(h.ip, 0);
  CHECK_EQ_INT(h.dec_count, 0);
  CHECK_EQ_INT(h.in.nav.level, NAV_AGENTS);
  CHECK(h.in.guide.open);
  CHECK_EQ_INT(h.in.guide.page, 0);
  // B cierra la guía (no el menú)
  h_frame(&h, 1600, IN_KEY_B, 0, IN_KEY_B, 0, 0);
  h_frame(&h, 1650, 0, IN_KEY_B, 0, 0, 0);
  CHECK(!h.in.guide.open);
  CHECK(h.in.menu.open);
  // con el menú solo, X/Y/L/R tampoco llegan a la app y A no entra a un agente
  tap_key(&h, IN_KEY_X, 1700, 1750);
  tap_key(&h, IN_KEY_Y, 1800, 1850);
  tap_key(&h, IN_KEY_L, 1900, 1950);
  CHECK_EQ_INT(h.modes, 0);
  CHECK_EQ_INT(h.pair, 0);
  CHECK_EQ_INT(h.in.nav.level, NAV_AGENTS);
}

// Una tarjeta que llega con el menú (o la guía encima) abiertos los cierra; la guarda de 500 ms cuenta desde que llega.
static void test_menu_closes_when_card_arrives(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VNONE, 0);
  guide_open_via_select(&h, 100);
  CHECK(h.in.guide.open && h.in.menu.open);
  h_view(&h, &VY, 5000); // llega la tarjeta
  CHECK(!h.in.guide.open);
  CHECK(!h.in.menu.open);
  h_frame(&h, 5100, IN_KEY_A, 0, IN_KEY_A, 0, 0);
  h_frame(&h, 5200, 0, IN_KEY_A, 0, 0, 0);
  CHECK_EQ_INT(h.dec_count, 0); // aún dentro de la guarda de 500 ms
  h_frame(&h, 5600, IN_KEY_A, 0, IN_KEY_A, 0, 0);
  h_frame(&h, 5700, 0, IN_KEY_A, 0, 0, 0);
  CHECK_EQ_INT(h.dec_count, 1);
  CHECK_EQ_INT(h.dec[0].allow, 1);

  // el menú abierto solo (sin guía), y rechazar con B sobre la tarjeta recién llegada: B no es "cerrar el menú"
  h_init(&h);
  h_connect(&h, &VNONE, 0);
  menu_open_via_select(&h, 100);
  CHECK(h.in.menu.open);
  h_view(&h, &VX, 800);
  CHECK(!h.in.menu.open);
  tap_key(&h, IN_KEY_B, 900, 950); // B es "rechazar" y no la guarda de 500 ms (rechazar es seguro)
  CHECK_EQ_INT(h.dec_count, 1);
  CHECK_EQ_INT(h.dec[0].allow, 0);
}

// Misma regla en el cuadro: si la vista con tarjeta ya está y el menú sigue abierto, se cierra antes de atender la pulsación.
static void test_menu_frame_level_close(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VNONE, 0);
  menu_open_via_select(&h, 100);
  h.view = &VY; // la vista cambió sin pasar por input_view_changed
  h_frame(&h, 5000, IN_KEY_B, 0, IN_KEY_B, 0, 0); // B: rechazar (no cerrar el menú)
  h_frame(&h, 5050, 0, IN_KEY_B, 0, 0, 0);
  CHECK(!h.in.menu.open);
}

static void test_guide_pages_and_ip(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VNONE, 0);
  guide_open_via_select(&h, 600);
  tap_key(&h, IN_KEY_LEFT, 700, 750); // ya en la primera: se queda
  CHECK_EQ_INT(h.in.guide.page, 0);
  for (int i = 1; i < GUIDE_PAGES; i++) {
    tap_key(&h, IN_KEY_RIGHT, 800 + (uint64_t)i * 100, 850 + (uint64_t)i * 100);
    CHECK_EQ_INT(h.in.guide.page, i);
  }
  tap_key(&h, IN_KEY_RIGHT, 1500, 1550); // en la última: se queda
  CHECK_EQ_INT(h.in.guide.page, GUIDE_PAGES - 1);
  tap_key(&h, IN_KEY_LEFT, 1600, 1650);
  CHECK_EQ_INT(h.in.guide.page, GUIDE_PAGES - 2);
  // flechas táctiles
  h_frame(&h, 1700, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, GUIDE_ARROW_NEXT_X + 5, GUIDE_ARROW_Y + 5);
  h_frame(&h, 1750, 0, IN_KEY_TOUCH, 0, GUIDE_ARROW_NEXT_X + 5, GUIDE_ARROW_Y + 5);
  CHECK_EQ_INT(h.in.guide.page, GUIDE_PAGES - 1);
  h_frame(&h, 1800, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, GUIDE_ARROW_PREV_X + 5, GUIDE_ARROW_Y + 5);
  h_frame(&h, 1850, 0, IN_KEY_TOUCH, 0, GUIDE_ARROW_PREV_X + 5, GUIDE_ARROW_Y + 5);
  CHECK_EQ_INT(h.in.guide.page, GUIDE_PAGES - 2);
  // fuera de las flechas el toque no hace nada
  h_frame(&h, 1900, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, 160, 100);
  h_frame(&h, 1950, 0, IN_KEY_TOUCH, 0, 160, 100);
  CHECK_EQ_INT(h.in.guide.page, GUIDE_PAGES - 2);
  // X en una página sin la IP no hace nada
  tap_key(&h, IN_KEY_X, 2000, 2050);
  CHECK_EQ_INT(h.ip, 0);
  CHECK_EQ_INT(h.modes, 0);
  CHECK(h.in.guide.open);
  // X en la página de la IP: pide el teclado y cierra la guía y el menú
  tap_key(&h, IN_KEY_RIGHT, 2100, 2150);
  CHECK(guide_ip_here(&h.in.guide));
  h_frame(&h, 2200, IN_KEY_X, 0, IN_KEY_X, 0, 0);
  CHECK_EQ_INT(h.ip, 1);
  CHECK(!h.in.guide.open);
  CHECK(!h.in.menu.open);
  CHECK_EQ_INT(h.modes, 0);
}

// En la última página de la guía Y escribe el código (y cierra la guía y el menú); en otras páginas no hace nada.
static void test_guide_y_pairs_on_last_page(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VNONE, 0);
  guide_open_via_select(&h, 600);
  tap_key(&h, IN_KEY_Y, 800, 850);
  CHECK_EQ_INT(h.pair, 0);
  CHECK(h.in.guide.open);
  for (int i = 1; i < GUIDE_PAGES; i++) tap_key(&h, IN_KEY_RIGHT, 900 + (uint64_t)i * 100, 950 + (uint64_t)i * 100);
  CHECK(guide_ip_here(&h.in.guide));
  h_frame(&h, 1500, IN_KEY_Y, 0, IN_KEY_Y, 0, 0);
  CHECK_EQ_INT(h.pair, 1);
  CHECK_EQ_INT(h.ip, 0);
  CHECK(!h.in.guide.open);
  CHECK(!h.in.menu.open);
}

static void test_guide_and_diag_exclusive(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VNONE, 0);
  h.in.diag_on = 1;
  menu_open_via_select(&h, 600); // con el diagnóstico abierto SELECT no hace nada
  CHECK(!h.in.menu.open);
  CHECK(h.in.diag_on);
  h.in.diag_on = 0;
  guide_open_via_select(&h, 700);
  CHECK(h.in.guide.open);
  // L+R con la guía abierta no abre el diagnóstico
  h_frame(&h, 1000, IN_KEY_L | IN_KEY_R, 0, IN_KEY_L | IN_KEY_R, 0, 0);
  h_frame(&h, 2200, 0, 0, IN_KEY_L | IN_KEY_R, 0, 0);
  CHECK(!h.in.diag_on);
}

static void test_guide_survives_session_events(void) {
  // la conexión sigue viva debajo: una vista nueva sin tarjeta con la guía abierta no la cierra
  H h;
  h_init(&h);
  h_connect(&h, &VNONE, 0);
  guide_open_via_select(&h, 100);
  View other;
  v_reset(&other);
  other.pending_count = 0;
  h_view(&h, &other, 300);
  CHECK(h.in.guide.open);
  input_session_end(&h.in);
  CHECK(h.in.guide.open);
  CHECK(h.in.menu.open);
}

// ---- menú de configuración: acciones hacia el puente ----

static View VS; // sin tarjeta, con ajustes: avisos "lo importante", con "Visto", Claude oculto

static void menu_down(H *h, int n, uint64_t at) {
  for (int i = 0; i < n; i++) tap_key(h, IN_KEY_DOWN, at + (uint64_t)i * 20, at + (uint64_t)i * 20 + 10);
}

static void test_menu_sends_settings(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VS, 0);
  menu_open_via_select(&h, 100);
  CHECK(h.in.menu.open);
  // Avisos por defecto: A pasa de "lo importante" a "solo al terminar"; derecha también cambia; izquierda va atrás
  tap_key(&h, IN_KEY_A, 200, 210);
  CHECK_EQ_INT(h.set_notify, 1);
  CHECK_EQ_INT(h.last_notify, NOTIFY_END);
  tap_key(&h, IN_KEY_RIGHT, 220, 230);
  CHECK_EQ_INT(h.set_notify, 2);
  tap_key(&h, IN_KEY_LEFT, 240, 250);
  CHECK_EQ_INT(h.set_notify, 3);
  CHECK_EQ_INT(h.last_notify, NOTIFY_ALL);
  // Pedir "Visto": alterna (hoy sí -> no)
  menu_down(&h, 1, 300);
  tap_key(&h, IN_KEY_A, 400, 410);
  CHECK_EQ_INT(h.set_ack, 1);
  CHECK_EQ_INT(h.last_ack, 0);
  // Sonido: alterna (hoy sí -> no); izquierda/derecha también
  menu_down(&h, 1, 420);
  tap_key(&h, IN_KEY_A, 440, 450);
  CHECK_EQ_INT(h.set_sound, 1);
  CHECK_EQ_INT(h.last_sound, 0);
  tap_key(&h, IN_KEY_RIGHT, 460, 470);
  CHECK_EQ_INT(h.set_sound, 2);
  // Preguntas en la 3DS: alterna (hoy sí -> no); izquierda/derecha también
  menu_down(&h, 1, 480);
  tap_key(&h, IN_KEY_A, 482, 484);
  CHECK_EQ_INT(h.set_questions, 1);
  CHECK_EQ_INT(h.last_questions, 0);
  tap_key(&h, IN_KEY_LEFT, 486, 488);
  CHECK_EQ_INT(h.set_questions, 2);
  // Abrir mensajes en: alterna completo / resumen; izquierda/derecha también
  menu_down(&h, 1, 490);
  tap_key(&h, IN_KEY_A, 492, 494);
  CHECK_EQ_INT(h.set_reader, 1);
  CHECK_EQ_INT(h.last_reader, READ_MODE_SUMMARY);
  tap_key(&h, IN_KEY_RIGHT, 496, 498);
  CHECK_EQ_INT(h.set_reader, 2);
  // Esperar instrucción hasta (paso 6): de 10 pasa a 30 con A y a 5 con izquierda (el valor sale de la vista, que no cambia)
  menu_down(&h, 1, 499);
  tap_key(&h, IN_KEY_A, 520, 530);
  CHECK_EQ_INT(h.set_wait, 1);
  CHECK_EQ_INT(h.last_wait, 30);
  tap_key(&h, IN_KEY_LEFT, 540, 550);
  CHECK_EQ_INT(h.set_wait, 2);
  CHECK_EQ_INT(h.last_wait, 5);
  // Agentes: A entra; A oculta Claude (ya oculto) -> lo muestra: máscara 0
  menu_down(&h, 1, 560);
  tap_key(&h, IN_KEY_A, 600, 610);
  CHECK_EQ_INT(h.in.menu.level, MENU_AGENTS);
  CHECK_EQ_INT(h.set_hidden, 0);
  tap_key(&h, IN_KEY_A, 700, 710);
  CHECK_EQ_INT(h.set_hidden, 1);
  CHECK_EQ_INT(h.last_hidden, 0);
  menu_down(&h, 2, 800); // Codex
  tap_key(&h, IN_KEY_A, 900, 910);
  CHECK_EQ_INT(h.last_hidden, (1 << AGENT_CLAUDE) | (1 << AGENT_CODEX));
  // B sube un nivel (no cierra); otra B cierra; nada de esto envía decisiones ni cambia el modo
  tap_key(&h, IN_KEY_B, 1000, 1010);
  CHECK(h.in.menu.open);
  CHECK_EQ_INT(h.in.menu.level, MENU_ROOT);
  tap_key(&h, IN_KEY_B, 1100, 1110);
  CHECK(!h.in.menu.open);
  CHECK_EQ_INT(h.dec_count, 0);
  CHECK_EQ_INT(h.modes, 0);
  CHECK_EQ_INT(h.focus + h.unfocus, 0);
  CHECK_EQ_INT(h.set_notify + h.set_ack + h.set_hidden + h.set_sound + h.set_questions + h.set_reader + h.set_wait, 14);
}

// Sin conexión o con un puente que no manda ajustes: las tres primeras entradas no envían nada; la guía y el diagnóstico sirven.
static void test_menu_disabled_without_settings(void) {
  H h;
  View none;
  v_reset(&none);
  for (int k = 0; k < 2; k++) {
    h_init(&h);
    if (k == 1) h_connect(&h, &none, 0); // k == 0: sin vista
    menu_open_via_select(&h, 100);
    for (int row = 0; row < 7; row++) {
      tap_key(&h, IN_KEY_A, 200 + (uint64_t)row * 100, 210 + (uint64_t)row * 100);
      tap_key(&h, IN_KEY_RIGHT, 220 + (uint64_t)row * 100, 230 + (uint64_t)row * 100);
      menu_down(&h, 1, 240 + (uint64_t)row * 100);
    }
    CHECK_EQ_INT(h.set_notify + h.set_ack + h.set_hidden + h.set_sound + h.set_questions + h.set_reader + h.set_wait, 0);
    CHECK_EQ_INT(h.in.menu.level, MENU_ROOT);
    // diagnóstico: A en la quinta entrada alterna la pantalla (lo mismo que L+R 1 s)
    menu_down(&h, 1, 600); // guía -> diagnóstico
    CHECK_EQ_INT(h.in.menu.cursor, MENU_E_DIAG);
    tap_key(&h, IN_KEY_A, 700, 710);
    CHECK(h.in.diag_on);
    CHECK(h.in.menu.open);
    // con el diagnóstico abierto el menú queda debajo: SELECT, A y la cruceta no hacen nada
    tap_key(&h, IN_KEY_SELECT, 800, 810);
    CHECK(h.in.menu.open);
    tap_key(&h, IN_KEY_A, 900, 910);
    CHECK(h.in.diag_on);
    // L+R 1 s lo cierra y se vuelve al menú
    h_frame(&h, 1000, IN_KEY_L | IN_KEY_R, 0, IN_KEY_L | IN_KEY_R, 0, 0);
    h_frame(&h, 2100, 0, 0, IN_KEY_L | IN_KEY_R, 0, 0);
    CHECK(!h.in.diag_on);
    CHECK(h.in.menu.open);
    // y A en la misma entrada lo vuelve a abrir
    h_frame(&h, 2200, 0, IN_KEY_L | IN_KEY_R, 0, 0, 0);
    tap_key(&h, IN_KEY_A, 2300, 2310);
    CHECK(h.in.diag_on);
    tap_key(&h, IN_KEY_A, 2400, 2410); // con el diagnóstico abierto A no lo cierra
    CHECK(h.in.diag_on);
  }
}

// "Tema" es local de la consola: sirve sin conexión y no envía nada al puente; el cambio lo hace la app (set_theme).
static void test_menu_theme_without_connection(void) {
  H h;
  h_init(&h);
  pal_set_dark(0);
  menu_open_via_select(&h, 100);
  menu_down(&h, MENU_E_THEME, 200);
  CHECK_EQ_INT(h.in.menu.cursor, MENU_E_THEME);
  tap_key(&h, IN_KEY_A, 600, 610);
  CHECK_EQ_INT(h.set_theme, 1);
  CHECK_EQ_INT(h.last_theme, 1); // claro -> oscuro
  CHECK(h.in.menu.open);
  pal_set_dark(1); // lo que hace la app al recibir la acción
  tap_key(&h, IN_KEY_LEFT, 700, 710);
  CHECK_EQ_INT(h.set_theme, 2);
  CHECK_EQ_INT(h.last_theme, 0); // oscuro -> claro
  CHECK_EQ_INT(h.set_notify + h.set_ack + h.set_hidden + h.set_sound + h.set_questions + h.set_reader + h.set_wait, 0);
  pal_set_dark(0);
}

static void test_menu_touch(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VS, 0);
  menu_open_via_select(&h, 100);
  MenuLayout l;
  menu_layout(MENU_ROOT, &l);
  // tocar "Avisos por defecto" cambia el valor
  h_frame(&h, 200, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, CX(l.rows[0]), CY(l.rows[0]));
  h_frame(&h, 250, 0, IN_KEY_TOUCH, 0, CX(l.rows[0]), CY(l.rows[0]));
  CHECK_EQ_INT(h.set_notify, 1);
  CHECK_EQ_INT(h.last_notify, NOTIFY_END);
  // tocar "Agentes" entra al submenú; tocar la fila de Gemini lo oculta (Claude ya está oculto)
  h_frame(&h, 300, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, CX(l.rows[MENU_E_AGENTS]), CY(l.rows[MENU_E_AGENTS]));
  h_frame(&h, 350, 0, IN_KEY_TOUCH, 0, CX(l.rows[MENU_E_AGENTS]), CY(l.rows[MENU_E_AGENTS]));
  CHECK_EQ_INT(h.in.menu.level, MENU_AGENTS);
  menu_layout(MENU_AGENTS, &l);
  h_frame(&h, 400, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, CX(l.rows[1]), CY(l.rows[1]));
  h_frame(&h, 450, 0, IN_KEY_TOUCH, 0, CX(l.rows[1]), CY(l.rows[1]));
  CHECK_EQ_INT(h.set_hidden, 1);
  CHECK_EQ_INT(h.last_hidden, (1 << AGENT_CLAUDE) | (1 << AGENT_GEMINI));
  // el botón de arriba hace de B: sube; otra vez, cierra
  h_frame(&h, 500, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, l.back.x + 5, l.back.y + 5);
  CHECK_EQ_INT(h.in.menu.level, MENU_ROOT);
  h_frame(&h, 550, 0, IN_KEY_TOUCH, 0, l.back.x + 5, l.back.y + 5);
  h_frame(&h, 600, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, l.back.x + 5, l.back.y + 5);
  CHECK(!h.in.menu.open);
  // un toque fuera de las filas no hace nada
  menu_open_via_select(&h, 700);
  h_frame(&h, 800, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, 2, 120);
  CHECK(h.in.menu.open);
  CHECK_EQ_INT(h.set_notify + h.set_ack + h.set_hidden, 2);
}

// La tarjeta de permiso que llega con el submenú de agentes abierto lo cierra, aunque lo último sea un gesto en curso;
// aprobar y rechazar funcionan como siempre (guarda de 500 ms desde que llega).
static void test_menu_card_takes_over_submenu(void) {
  H h;
  h_init(&h);
  h_connect(&h, &VS, 0);
  menu_open_via_select(&h, 100);
  menu_down(&h, MENU_E_AGENTS, 200);
  tap_key(&h, IN_KEY_A, 300, 310);
  CHECK_EQ_INT(h.in.menu.level, MENU_AGENTS);
  View card = VY;
  card.has_settings = 1;
  card.settings = VS.settings;
  h_view(&h, &card, 1000);
  CHECK(!h.in.menu.open);
  CHECK_EQ_INT(h.in.menu.level, MENU_ROOT);
  int hidden_before = h.set_hidden;
  tap_key(&h, IN_KEY_A, 1100, 1110); // dentro de la guarda: no aprueba, y tampoco alterna un agente
  CHECK_EQ_INT(h.dec_count, 0);
  CHECK_EQ_INT(h.set_hidden, hidden_before);
  tap_key(&h, IN_KEY_A, 1600, 1610);
  CHECK_EQ_INT(h.dec_count, 1);
  CHECK_EQ_INT(h.dec[0].allow, 1);
  CHECK_EQ_INT(h.set_hidden, hidden_before);
}

int main(void) {
  TEST_BEGIN("input: decisiones de entrada de la app (aprobar, rechazar, lápiz, L+R, sesión fallida)");
  v_request(&VX, "x", 1, "rm -rf a"); // riesgo alto
  v_request(&VY, "y", 0, "ls");       // riesgo normal
  v_request(&VZ, "z", 0, "cat a");    // riesgo normal, mismo tamaño de tarjeta que Y
  v_reset(&VNONE);
  v_reset(&VS); // sin tarjeta, con ajustes del puente: "lo importante", con "Visto", Claude oculto
  VS.has_settings = 1;
  VS.settings.notify_default = NOTIFY_IMPORTANT;
  VS.settings.notify_ack = 1;
  VS.settings.sound = 1;
  VS.settings.questions = 1;
  VS.settings.has_instruct_wait = 1;
  VS.settings.instruct_wait_max = 10;
  VS.settings.hidden_count = 1;
  VS.settings.hidden[0] = AGENT_CLAUDE;
  v_request(&VXA, "xa", 1, "rm -rf a"); // riesgo alto, ofrece "no volver a preguntar"
  VXA.request.has_always = 1;
  strcpy(VXA.request.always, "Bash(rm -rf a)");
  v_request(&VYA, "ya", 0, "ls");       // riesgo normal, ofrece "no volver a preguntar"
  VYA.request.has_always = 1;
  strcpy(VYA.request.always, "Bash(ls)");
  RUN(test_lost_allow_does_not_lock);
  RUN(test_lost_deny_does_not_lock);
  RUN(test_lost_high_risk_does_not_lock);
  RUN(test_touch_deny_other_request);
  RUN(test_touch_deny_changed_text_same_id);
  RUN(test_touch_deny_without_card_at_start);
  RUN(test_button_deny_on_release_same_request);
  RUN(test_touch_does_not_cancel_button_gesture);
  RUN(test_button_does_not_cancel_pen_gesture);
  RUN(test_session_failed_detected);
  RUN(test_ready_focus_failure_closes);
  RUN(test_lr_chord_and_skip);
  RUN(test_diag_ignores_touch);
  RUN(test_diag_swallows_a_and_b);
  RUN(test_diag_card_arrived_while_open_needs_guard);
  RUN(test_diag_open_cancels_held_a);
  RUN(test_diag_open_drops_pen_and_b);
  RUN(test_misc_keys);
  RUN(test_always_key_normal_risk);
  RUN(test_always_key_without_offer);
  RUN(test_y_pairs_only_without_view);
  RUN(test_guide_y_pairs_on_last_page);
  RUN(test_always_key_high_risk_hold);
  RUN(test_always_key_mixed_with_a);
  RUN(test_always_changed_card_cancels);
  RUN(test_always_touch_zone);
  RUN(test_always_blocked_by_guide_and_diag);
  RUN(test_always_lost_send_does_not_lock);
  RUN(test_one_decision_per_batch);
  RUN(test_guide_opens_from_any_state);
  RUN(test_menu_select_ignored_with_card);
  RUN(test_menu_closes_when_card_arrives);
  RUN(test_menu_frame_level_close);
  RUN(test_guide_swallows_inputs);
  RUN(test_guide_pages_and_ip);
  RUN(test_guide_and_diag_exclusive);
  RUN(test_guide_survives_session_events);
  RUN(test_menu_sends_settings);
  RUN(test_menu_disabled_without_settings);
  RUN(test_menu_theme_without_connection);
  RUN(test_menu_touch);
  RUN(test_menu_card_takes_over_submenu);
  TEST_END();
}

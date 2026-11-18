// Preguntas con alternativas (Fase 2b, paso 4): la máquina de estados de logic/question.c, su geometría y su integración con
// logic/input_logic.c. Reglas de seguridad que se comprueban: una pregunta NUNCA se aprueba ni se rechaza (ni A, ni B, ni Y, ni el
// lápiz emiten una decisión), la guarda de 500 ms, B nunca responde, y menú, guía, lector y permisos se comportan igual de bien con
// una pregunta a la vista. Sin libctru.
#include "test.h"

#include "../source/core/msg.h"
#include "../source/logic/input_logic.h"
#include "../source/logic/question.h"
#include "fixtures/views_fixture.h"

#define CX(r) ((r).x + (r).w / 2)
#define CY(r) ((r).y + (r).h / 2)

// ---- vistas ----

static void view_base(View *v) {
  memset(v, 0, sizeof *v);
  v->mode = MODE_QUEUE;
  v->face.kind = AGENT_NONE;
  v->face.mood = MOOD_IDLE;
  v->face.line_count = 1;
  strcpy(v->face.lines[0], "x");
  v->session_count = 1;
  strcpy(v->sessions[0].id, "s1");
  v->sessions[0].kind = AGENT_CLAUDE;
  strcpy(v->sessions[0].title, "Ajustar el hero");
  strcpy(v->sessions[0].project, "mi-portal");
}

static void add_option(QuestionView *q, const char *label, int recommended, const char *d0, const char *d1) {
  OptionView *o = &q->options[q->option_count++];
  memset(o, 0, sizeof *o);
  strcpy(o->label, label);
  o->recommended = recommended;
  if (d0 != NULL) strcpy(o->desc[o->desc_count++], d0);
  if (d1 != NULL) strcpy(o->desc[o->desc_count++], d1);
}

static QuestionView *add_question(View *v, const char *header, const char *text, int multi, int options) {
  RequestView *r = &v->request;
  QuestionView *q = &r->questions[r->question_count++];
  memset(q, 0, sizeof *q);
  strcpy(q->header, header);
  strcpy(q->text[q->text_count++], text);
  q->multi = multi;
  for (int i = 0; i < options; i++) {
    char label[40];
    snprintf(label, sizeof label, "Opción %d", i + 1);
    add_option(q, label, i == 0, "Descripción", i == 1 ? "en dos líneas" : NULL);
  }
  return q;
}

// Una pregunta con `n` preguntas: la 1 es de una sola opción, la 2 multiSelect, las demás de una sola.
static void v_question(View *v, const char *id, int n) {
  view_base(v);
  v->has_request = 1;
  RequestView *r = &v->request;
  memset(r, 0, sizeof *r);
  strcpy(r->id, id);
  strcpy(r->session_id, "s1");
  strcpy(r->title, "Claude te hace una pregunta");
  r->kind = REQ_QUESTION;
  r->line_count = 1;
  strcpy(r->lines[0], "¿Pregunta?");
  r->position = 1;
  r->total = 1;
  v->pending_count = 1;
  for (int i = 0; i < n; i++) add_question(v, i == 0 ? "Fondo" : "Otra", "¿Qué elijo?", i == 1, i == 1 ? 3 : 4);
}

static void v_permission(View *v, const char *id, int high) {
  view_base(v);
  v->has_request = 1;
  RequestView *r = &v->request;
  memset(r, 0, sizeof *r);
  strcpy(r->id, id);
  strcpy(r->session_id, "s1");
  strcpy(r->title, "Claude pide permiso");
  r->line_count = 1;
  strcpy(r->lines[0], "npm test");
  r->risk = high ? RISK_HIGH : RISK_NORMAL;
  r->position = 1;
  r->total = 1;
  v->pending_count = 1;
}

// ---- arnés: lo que hace app.c ----

typedef struct {
  InputLogic in;
  BottomLayout lay;
  const View *view;
  uint64_t now;
  int send_fails;
  int decisions, skips, others, answers, answer_pcs, set_questions, other_actions;
  char last_decision_id[VIEW_ID_BYTES];
  char sent_id[VIEW_ID_BYTES];
  char sent_json[MSG_ANSWER_MAX];
  int pc_sent;
} H;

static void relayout(H *h) {
  LayoutInput li;
  memset(&li, 0, sizeof li);
  li.level = LAYOUT_AGENTS;
  li.item_count = 5;
  if (h->view != NULL) layout_input_from_view(&li, h->view, h->in.nav.session_id);
  if (h->view != NULL) layout_compute(&li, &h->lay);
  else memset(&h->lay, 0, sizeof h->lay);
}

static void exec(H *h, const InputActions *acts);

static void exec(H *h, const InputActions *acts) {
  for (int i = 0; i < acts->n; i++) {
    const InputAction *a = &acts->a[i];
    int rc = h->send_fails ? -1 : 0;
    switch (a->kind) {
      case IN_ACT_DECISION: h->decisions++; strcpy(h->last_decision_id, a->id); break;
      case IN_ACT_SKIP: h->skips++; rc = 0; break;
      case IN_ACT_ANSWER: {
        h->answers++;
        strcpy(h->sent_id, a->id);
        int n = msg_answer(h->sent_json, sizeof h->sent_json, a->id, h->in.question.answers, h->in.question.answer_count);
        CHECK(n > 0);
        break;
      }
      case IN_ACT_ANSWER_PC: h->answer_pcs++; strcpy(h->sent_id, a->id); break;
      case IN_ACT_QUESTION_OTHER: h->other_actions++; rc = 0; break;
      case IN_ACT_SETTING_QUESTIONS: h->set_questions++; rc = 0; break;
      case IN_ACT_SETTING_READER: rc = 0; break;
      case IN_ACT_FOCUS:
      case IN_ACT_UNFOCUS:
      case IN_ACT_READ:
      case IN_ACT_ACK:
      case IN_ACT_SKIP_NOTICE:
      case IN_ACT_SESSION_NOTIFY:
      case IN_ACT_SETTING_NOTIFY:
      case IN_ACT_SETTING_ACK:
      case IN_ACT_SETTING_SOUND:
      case IN_ACT_SETTING_HIDDEN:
      case IN_ACT_MODE:
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

static void h_init(H *h) {
  memset(h, 0, sizeof *h);
  input_init(&h->in);
}

static void h_connect(H *h, const View *v, uint64_t now) {
  InputActions acts;
  h->now = now;
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
  input_frame(&h->in, &f, &acts);
  exec(h, &acts);
}

static void tap_key(H *h, uint32_t key, uint64_t at) {
  h_frame(h, at, key, 0, key, 0, 0);
  h_frame(h, at + 5, 0, key, 0, 0, 0);
}

// lo que hace app.c tras el teclado del sistema
static void h_text(H *h, uint64_t now, const char *text) {
  InputActions acts;
  h->now = now;
  input_question_text(&h->in, h->view, now, text, &acts);
  exec(h, &acts);
}

static int sends(const H *h) { return h->answers + h->answer_pcs; }

// ---------------------------------------------------------------- lógica pura

static void test_rows(void) {
  View v;
  v_question(&v, "q1", 2);
  QuestionRow rows[QUESTION_MAX_ROWS];
  int n = question_rows(&v.request.questions[0], rows);
  CHECK_EQ_INT(n, 4 + 2); // 4 opciones, Otra… y Responder en el PC
  CHECK_EQ_INT(rows[3].kind, QROW_OPTION);
  CHECK_EQ_INT(rows[3].option, 3);
  CHECK_EQ_INT(rows[4].kind, QROW_OTHER);
  CHECK_EQ_INT(rows[5].kind, QROW_PC);
  n = question_rows(&v.request.questions[1], rows); // multiSelect: Listo antes de Otra…
  CHECK_EQ_INT(n, 3 + 3);
  CHECK_EQ_INT(rows[3].kind, QROW_DONE);
  CHECK_EQ_INT(rows[4].kind, QROW_OTHER);
  CHECK_EQ_INT(rows[5].kind, QROW_PC);
  CHECK(QUESTION_MAX_ROWS >= VIEW_MAX_OPTIONS + 3);
}

static void test_guard_and_single(void) {
  View v;
  v_question(&v, "q1", 1);
  Question q;
  question_init(&q);
  question_connection(&q, 1);
  question_view(&q, 1000, &v.request);
  CHECK(!question_ready(&q, 1000 + QUESTION_GUARD_MS - 1));
  CHECK(question_ready(&q, 1000 + QUESTION_GUARD_MS));
  // antes de 500 ms A no hace nada; con repeat tampoco
  QuestionOut o = question_activate(&q, &v.request, 1100, -1, 0);
  CHECK_EQ_INT(o.kind, QOUT_NONE);
  CHECK(!q.sent);
  o = question_activate(&q, &v.request, 1000 + QUESTION_GUARD_MS, -1, 1);
  CHECK_EQ_INT(o.kind, QOUT_NONE);
  // pasada la guarda, elige la fila del cursor
  question_move(&q, &v.request, 1);
  o = question_activate(&q, &v.request, 1000 + QUESTION_GUARD_MS, -1, 0);
  CHECK_EQ_INT(o.kind, QOUT_SEND);
  CHECK(q.sent);
  CHECK_EQ_INT(q.answer_count, 1);
  CHECK_EQ_INT(q.answers[0].is_other, 0);
  CHECK_EQ_INT((int)q.answers[0].mask, 1 << 1);
  // ya enviada: no vuelve a salir
  o = question_activate(&q, &v.request, 5000, 0, 0);
  CHECK_EQ_INT(o.kind, QOUT_NONE);
  // el envío falló: se puede volver a responder
  question_sent(&q, -1);
  CHECK(!q.sent);
  o = question_activate(&q, &v.request, 6000, 2, 0);
  CHECK_EQ_INT(o.kind, QOUT_SEND);
  CHECK_EQ_INT((int)q.answers[0].mask, 1 << 2);
  question_sent(&q, 0);
  CHECK(q.sent);
}

static void test_view_resets(void) {
  View v, w;
  v_question(&v, "q1", 2);
  v_question(&w, "q2", 2);
  Question q;
  question_init(&q);
  question_connection(&q, 1);
  question_view(&q, 1000, &v.request);
  question_activate(&q, &v.request, 2000, 0, 0); // pasa a la pregunta 2
  CHECK_EQ_INT(q.index, 1);
  question_view(&q, 2100, &v.request); // la misma tarjeta repetida no reinicia nada
  CHECK_EQ_INT(q.index, 1);
  CHECK_EQ_INT((int)q.since, 2000);
  question_view(&q, 2200, &w.request); // otra tarjeta: de cero y con guarda nueva
  CHECK_EQ_INT(q.index, 0);
  CHECK_EQ_INT(q.answer_count, 0);
  CHECK(!question_ready(&q, 2200 + QUESTION_GUARD_MS - 1));
  CHECK(question_ready(&q, 2200 + QUESTION_GUARD_MS));
  question_view(&q, 3000, NULL); // sin tarjeta (o con un permiso): todo se olvida, la conexión no
  CHECK(!q.has_id);
  CHECK(q.connected);
  CHECK(!question_ready(&q, 9000));
  // sin conexión no se contesta
  question_connection(&q, 0);
  question_view(&q, 4000, &v.request);
  CHECK(!question_ready(&q, 9000));
  CHECK_EQ_INT(question_activate(&q, &v.request, 9000, 0, 0).kind, QOUT_NONE);
}

static void test_multi_flow(void) {
  View v;
  v_question(&v, "q1", 3);
  Question q;
  question_init(&q);
  question_connection(&q, 1);
  question_view(&q, 0, &v.request);
  uint64_t t = QUESTION_GUARD_MS;
  // 1ª: Opción 1
  CHECK_EQ_INT(question_activate(&q, &v.request, t, 0, 0).kind, QOUT_NONE);
  CHECK_EQ_INT(q.index, 1);
  // al cambiar de pregunta la guarda vuelve a contar: un segundo toque enseguida no elige nada
  CHECK_EQ_INT(question_activate(&q, &v.request, t + 10, 0, 0).kind, QOUT_NONE);
  CHECK_EQ_INT((int)q.marks[1], 0);
  t += QUESTION_GUARD_MS;
  // 2ª (multi): marcar 0 y 2, desmarcar 2, marcar 1; "Listo" (fila 3)
  question_activate(&q, &v.request, t, 0, 0);
  question_activate(&q, &v.request, t, 2, 0);
  question_activate(&q, &v.request, t, 2, 0);
  question_activate(&q, &v.request, t, 1, 0);
  CHECK_EQ_INT((int)q.marks[1], (1 << 0) | (1 << 1));
  CHECK_EQ_INT(question_activate(&q, &v.request, t, 3, 0).kind, QOUT_NONE);
  CHECK_EQ_INT(q.index, 2);
  // B vuelve a la anterior, conserva lo marcado y rehace la respuesta
  question_back(&q);
  CHECK_EQ_INT(q.index, 1);
  CHECK_EQ_INT(q.answer_count, 1);
  CHECK_EQ_INT((int)q.marks[1], (1 << 0) | (1 << 1));
  t += QUESTION_GUARD_MS;
  question_activate(&q, &v.request, t, 0, 0); // desmarca 0
  CHECK_EQ_INT(question_activate(&q, &v.request, t, 3, 0).kind, QOUT_NONE);
  CHECK_EQ_INT(q.index, 2);
  // 3ª: la última manda las tres juntas
  t += QUESTION_GUARD_MS;
  QuestionOut o = question_activate(&q, &v.request, t, 3, 0);
  CHECK_EQ_INT(o.kind, QOUT_SEND);
  CHECK_EQ_INT(q.answer_count, 3);
  CHECK_EQ_INT((int)q.answers[0].mask, 1 << 0);
  CHECK_EQ_INT((int)q.answers[1].mask, 1 << 1);
  CHECK_EQ_INT((int)q.answers[2].mask, 1 << 3);
  // B después de enviar no hace nada
  question_back(&q);
  CHECK_EQ_INT(q.index, 2);
}

static void test_done_needs_a_mark_and_b_on_first(void) {
  View v;
  v_question(&v, "q1", 2);
  Question q;
  question_init(&q);
  question_connection(&q, 1);
  question_view(&q, 0, &v.request);
  question_back(&q); // en la primera B no hace nada
  CHECK_EQ_INT(q.index, 0);
  CHECK(!q.sent);
  question_activate(&q, &v.request, 600, 0, 0);
  CHECK_EQ_INT(q.index, 1);
  CHECK_EQ_INT(question_activate(&q, &v.request, 1200, 3, 0).kind, QOUT_NONE); // Listo sin marcas: no avanza
  CHECK_EQ_INT(q.index, 1);
  CHECK(!q.sent);
}

static void test_other_and_pc(void) {
  View v;
  v_question(&v, "q1", 2);
  Question q;
  question_init(&q);
  question_connection(&q, 1);
  question_view(&q, 0, &v.request);
  // Otra… (fila 4) pide el teclado y no cambia nada
  QuestionOut o = question_activate(&q, &v.request, 600, 4, 0);
  CHECK_EQ_INT(o.kind, QOUT_OTHER);
  CHECK_EQ_INT(q.index, 0);
  // cancelar o vacío: nada
  CHECK_EQ_INT(question_text(&q, &v.request, 700, NULL).kind, QOUT_NONE);
  CHECK_EQ_INT(question_text(&q, &v.request, 700, "").kind, QOUT_NONE);
  CHECK_EQ_INT(question_text(&q, &v.request, 700, " \t\n ").kind, QOUT_NONE);
  CHECK_EQ_INT(q.index, 0);
  // el texto normalizado es la respuesta y avanza (la guarda vuelve a contar)
  CHECK_EQ_INT(question_text(&q, &v.request, 800, "  un   mapa\nanimado\t ").kind, QOUT_NONE);
  CHECK_EQ_INT(q.index, 1);
  CHECK_EQ_INT(q.answers[0].is_other, 1);
  CHECK_STR(q.answers[0].other, "un mapa animado");
  CHECK_EQ_INT((int)q.since, 800);
  // en la última pregunta, el texto envía todo
  o = question_text(&q, &v.request, 900, "ñandú café");
  CHECK_EQ_INT(o.kind, QOUT_SEND);
  CHECK_STR(q.answers[1].other, "ñandú café");
  CHECK_EQ_INT(q.answer_count, 2);

  // Responder en el PC (fila 5 en la pregunta 1)
  question_init(&q);
  question_connection(&q, 1);
  question_view(&q, 0, &v.request);
  o = question_activate(&q, &v.request, 600, 5, 0);
  CHECK_EQ_INT(o.kind, QOUT_SEND_PC);
  CHECK(q.sent && q.send_pc);
  CHECK_EQ_INT(question_activate(&q, &v.request, 700, 0, 0).kind, QOUT_NONE);
}

static void test_text_limits(void) {
  View v;
  v_question(&v, "q1", 1);
  Question q;
  question_init(&q);
  question_connection(&q, 1);
  question_view(&q, 0, &v.request);
  char big[1200];
  memset(big, 'y', 500);
  big[500] = 0;
  CHECK_EQ_INT(question_text(&q, &v.request, 600, big).kind, QOUT_SEND);
  CHECK_EQ_INT((int)strlen(q.answers[0].other), 200); // cortado a 200 caracteres
  // 400 euros (3 bytes cada uno): 200 caracteres = 600 bytes, completos
  question_init(&q);
  question_connection(&q, 1);
  question_view(&q, 0, &v.request);
  for (int i = 0; i < 400; i++) memcpy(big + i * 3, "\xe2\x82\xac", 3);
  big[1200 - 1] = 0;
  CHECK_EQ_INT(question_text(&q, &v.request, 600, big).kind, QOUT_SEND);
  CHECK_EQ_INT((int)strlen(q.answers[0].other), 600);
  // lo que se arma con ese texto lo acepta msg_answer
  static char json[MSG_ANSWER_MAX];
  CHECK(msg_answer(json, sizeof json, "q1", q.answers, q.answer_count) > 0);
}

static void test_layout_fits(void) {
  // la pregunta más alta: texto de 3 líneas, 4 opciones, multiSelect (Listo, Otra…, PC): 7 filas, sin salirse ni solaparse
  QuestionView qv;
  memset(&qv, 0, sizeof qv);
  qv.text_count = 3;
  qv.multi = 1;
  qv.option_count = 4;
  QuestionLayout l;
  question_layout(&qv, &l);
  CHECK_EQ_INT(l.row_count, 7);
  for (int i = 0; i < l.row_count; i++) {
    CHECK(l.rows[i].x >= 0 && l.rows[i].x + l.rows[i].w <= LAYOUT_W);
    CHECK(l.rows[i].y >= l.text.y + l.text.h);
    CHECK(l.rows[i].y + l.rows[i].h <= l.desc.y);
    if (i > 0) CHECK(l.rows[i].y >= l.rows[i - 1].y + l.rows[i - 1].h);
    CHECK_EQ_INT(question_hit_row(&qv, CX(l.rows[i]), CY(l.rows[i])), i);
  }
  CHECK(l.desc.y + l.desc.h <= l.hint.y);
  CHECK(l.hint.y + l.hint.h <= LAYOUT_H);
  CHECK(l.desc.h >= 26); // dos líneas de descripción
  CHECK_EQ_INT(question_hit_row(&qv, 2, 100), -1);
  CHECK_EQ_INT(question_hit_row(&qv, 160, 2), -1);
  // menos líneas y menos opciones también caben
  for (int lines = 1; lines <= 3; lines++) {
    for (int opts = 2; opts <= 4; opts++) {
      qv.text_count = lines;
      qv.option_count = opts;
      qv.multi = opts % 2;
      question_layout(&qv, &l);
      CHECK(l.rows[l.row_count - 1].y + l.rows[l.row_count - 1].h <= l.desc.y);
    }
  }
}

// ---------------------------------------------------------------- integración con input_logic

// LO MÁS IMPORTANTE: una pregunta jamás emite una decisión, con ninguna tecla ni con el lápiz.
static void test_never_a_decision(void) {
  View v;
  v_question(&v, "q1", 2);
  H h;
  h_init(&h);
  h_connect(&h, &v, 0);
  uint32_t keys[] = {IN_KEY_A, IN_KEY_B, IN_KEY_X, IN_KEY_Y, IN_KEY_L, IN_KEY_R, IN_KEY_UP, IN_KEY_DOWN, IN_KEY_LEFT, IN_KEY_RIGHT};
  uint64_t t = 100;
  for (int pass = 0; pass < 3; pass++) { // antes de la guarda, después, y manteniendo
    for (size_t k = 0; k < sizeof keys / sizeof keys[0]; k++) {
      tap_key(&h, keys[k], t);
      t += 10;
    }
    t = 2000 + (uint64_t)pass * 1000;
  }
  // sostener A o Y más de un segundo (el gesto de riesgo alto) tampoco aprueba
  h_frame(&h, 5000, IN_KEY_A, 0, IN_KEY_A, 0, 0);
  h_frame(&h, 6500, 0, 0, IN_KEY_A, 0, 0);
  h_frame(&h, 6600, 0, IN_KEY_A, 0, 0, 0);
  h_frame(&h, 7000, IN_KEY_Y, 0, IN_KEY_Y, 0, 0);
  h_frame(&h, 8500, 0, IN_KEY_Y, 0, 0, 0);
  // y el lápiz sobre cualquier punto de la pantalla
  for (int y = 0; y < LAYOUT_H; y += 8) {
    for (int x = 0; x < LAYOUT_W; x += 16) {
      h_frame(&h, 9000, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, x, y);
      h_frame(&h, 9100, 0, IN_KEY_TOUCH, 0, x, y);
    }
  }
  CHECK_EQ_INT(h.decisions, 0);
  CHECK_EQ_INT(approve_ready(&h.in.approve, 9999), 0); // la máquina de aprobar ni se entera
  CHECK(!h.in.approve.has_shown);
}

static void test_a_after_guard_answers(void) {
  View v;
  v_question(&v, "q1", 1);
  H h;
  h_init(&h);
  h_connect(&h, &v, 1000);
  tap_key(&h, IN_KEY_A, 1100); // dentro de la guarda
  CHECK_EQ_INT(sends(&h), 0);
  tap_key(&h, IN_KEY_DOWN, 1200);
  tap_key(&h, IN_KEY_A, 1000 + QUESTION_GUARD_MS);
  CHECK_EQ_INT(h.answers, 1);
  CHECK_STR(h.sent_id, "q1");
  CHECK_STR(h.sent_json, "{\"t\":\"answer\",\"requestId\":\"q1\",\"answers\":[{\"choose\":[1]}]}");
  CHECK_EQ_INT(h.decisions, 0);
  // ya contestada: otro A no vuelve a enviar
  tap_key(&h, IN_KEY_A, 3000);
  CHECK_EQ_INT(h.answers, 1);
}

static void test_b_goes_back_and_never_denies(void) {
  View v;
  v_question(&v, "q1", 2);
  H h;
  h_init(&h);
  h_connect(&h, &v, 0);
  tap_key(&h, IN_KEY_B, 100);
  tap_key(&h, IN_KEY_B, 200);
  CHECK_EQ_INT(h.decisions, 0);
  CHECK_EQ_INT(sends(&h), 0);
  tap_key(&h, IN_KEY_A, 700); // 1ª pregunta: Opción 1
  CHECK_EQ_INT(h.in.question.index, 1);
  tap_key(&h, IN_KEY_B, 800); // vuelve a la primera
  CHECK_EQ_INT(h.in.question.index, 0);
  CHECK_EQ_INT(h.decisions, 0);
  CHECK_EQ_INT(sends(&h), 0);
}

static void test_two_questions_send_once_at_the_end(void) {
  View v;
  v_question(&v, "q2", 2);
  H h;
  h_init(&h);
  h_connect(&h, &v, 0);
  tap_key(&h, IN_KEY_A, 600); // 1ª: Opción 1
  CHECK_EQ_INT(sends(&h), 0);
  // 2ª (multi, 3 opciones): marcar la 2 y "Listo"
  tap_key(&h, IN_KEY_DOWN, 650);
  tap_key(&h, IN_KEY_A, 1200);
  tap_key(&h, IN_KEY_DOWN, 1210);
  tap_key(&h, IN_KEY_DOWN, 1220);
  tap_key(&h, IN_KEY_A, 1230);
  CHECK_EQ_INT(h.answers, 1);
  CHECK_STR(h.sent_json, "{\"t\":\"answer\",\"requestId\":\"q2\",\"answers\":[{\"choose\":[0]},{\"choose\":[1]}]}");
}

static void test_other_flow(void) {
  View v;
  v_question(&v, "q1", 1);
  H h;
  h_init(&h);
  h_connect(&h, &v, 0);
  for (int i = 0; i < 4; i++) tap_key(&h, IN_KEY_DOWN, 100 + (uint64_t)i * 10); // Otra… es la fila 4
  tap_key(&h, IN_KEY_A, 700);
  CHECK_EQ_INT(h.other_actions, 1);
  CHECK_EQ_INT(sends(&h), 0);
  h_text(&h, 5000, NULL); // canceló el teclado
  CHECK_EQ_INT(sends(&h), 0);
  tap_key(&h, IN_KEY_A, 5500);
  CHECK_EQ_INT(h.other_actions, 2);
  h_text(&h, 9000, "mi respuesta \"con\" comillas");
  CHECK_EQ_INT(h.answers, 1);
  CHECK_STR(h.sent_json, "{\"t\":\"answer\",\"requestId\":\"q1\",\"answers\":[{\"other\":\"mi respuesta \\\"con\\\" comillas\"}]}");
  // el teclado devuelve el texto cuando la tarjeta ya no es una pregunta (se respondió en el PC): nada se envía
  H g;
  h_init(&g);
  h_connect(&g, &v, 0);
  View none;
  view_base(&none);
  h_view(&g, &none, 1000);
  h_text(&g, 2000, "tarde");
  CHECK_EQ_INT(sends(&g), 0);
}

static void test_pc_row(void) {
  View v;
  v_question(&v, "q1", 1);
  H h;
  h_init(&h);
  h_connect(&h, &v, 0);
  for (int i = 0; i < 5; i++) tap_key(&h, IN_KEY_DOWN, 100 + (uint64_t)i * 10); // fila 5: Responder en el PC
  tap_key(&h, IN_KEY_A, 700);
  CHECK_EQ_INT(h.answer_pcs, 1);
  CHECK_EQ_INT(h.answers, 0);
  CHECK_STR(h.sent_id, "q1");
  CHECK_EQ_INT(h.decisions, 0);
}

static void test_send_failure_allows_retry(void) {
  View v;
  v_question(&v, "q1", 1);
  H h;
  h_init(&h);
  h_connect(&h, &v, 0);
  h.send_fails = 1;
  tap_key(&h, IN_KEY_A, 700);
  CHECK_EQ_INT(h.answers, 1);
  CHECK(!h.in.question.sent); // el envío no salió: sigue pendiente
  h.send_fails = 0;
  tap_key(&h, IN_KEY_A, 900);
  CHECK_EQ_INT(h.answers, 2);
  CHECK(h.in.question.sent);
}

static void test_pen(void) {
  View v;
  v_question(&v, "q1", 1);
  H h;
  h_init(&h);
  h_connect(&h, &v, 0);
  QuestionLayout l;
  question_layout(&v.request.questions[0], &l);
  // apoyar marca la fila, pero no elige hasta soltar sobre la misma fila (y pasada la guarda)
  h_frame(&h, 100, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, CX(l.rows[2]), CY(l.rows[2]));
  CHECK_EQ_INT(h.in.question.cursor, 2);
  h_frame(&h, 150, 0, IN_KEY_TOUCH, 0, CX(l.rows[2]), CY(l.rows[2]));
  CHECK_EQ_INT(sends(&h), 0); // dentro de la guarda
  // moverse a otra fila antes de soltar anula el toque
  h_frame(&h, 800, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, CX(l.rows[1]), CY(l.rows[1]));
  h_frame(&h, 810, 0, 0, IN_KEY_TOUCH, CX(l.rows[3]), CY(l.rows[3]));
  h_frame(&h, 820, 0, IN_KEY_TOUCH, 0, CX(l.rows[3]), CY(l.rows[3]));
  CHECK_EQ_INT(sends(&h), 0);
  // soltar fuera de las filas tampoco
  h_frame(&h, 830, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, CX(l.rows[1]), CY(l.rows[1]));
  h_frame(&h, 835, 0, 0, IN_KEY_TOUCH, 2, 2); // el lápiz sale de las filas
  h_frame(&h, 840, 0, IN_KEY_TOUCH, 0, 0, 0); // al soltar el sistema no da la posición
  CHECK_EQ_INT(sends(&h), 0);
  // tocar y soltar sobre la fila 3 elige esa opción
  h_frame(&h, 900, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, CX(l.rows[3]), CY(l.rows[3]));
  h_frame(&h, 950, 0, IN_KEY_TOUCH, 0, CX(l.rows[3]), CY(l.rows[3]));
  CHECK_EQ_INT(h.answers, 1);
  CHECK_STR(h.sent_json, "{\"t\":\"answer\",\"requestId\":\"q1\",\"answers\":[{\"choose\":[3]}]}");
  CHECK_EQ_INT(h.decisions, 0);
}

static void test_skip_between_requests(void) {
  View v;
  v_question(&v, "q1", 1);
  v.pending_count = 2;
  v.request.total = 2;
  H h;
  h_init(&h);
  h_connect(&h, &v, 0);
  h_frame(&h, 50, 0, 0, 0, 0, 0); // un cuadro sin botones: lo que se pulsó antes de la tarjeta ya no cuenta para L/R
  h_frame(&h, 100, IN_KEY_L, 0, IN_KEY_L, 0, 0);
  h_frame(&h, 110, 0, IN_KEY_L, 0, 0, 0);
  CHECK_EQ_INT(h.skips, 1);
  // en modo manual no hay salto
  View m = v;
  m.mode = MODE_MANUAL;
  h_view(&h, &m, 200);
  h_frame(&h, 250, 0, 0, 0, 0, 0);
  h_frame(&h, 300, IN_KEY_R, 0, IN_KEY_R, 0, 0);
  h_frame(&h, 310, 0, IN_KEY_R, 0, 0, 0);
  CHECK_EQ_INT(h.skips, 1);
}

static void test_card_changes_reset_and_permissions_still_work(void) {
  View q1, q2, p;
  v_question(&q1, "q1", 2);
  v_question(&q2, "q2", 1);
  v_permission(&p, "p1", 0);
  H h;
  h_init(&h);
  h_connect(&h, &q1, 0);
  tap_key(&h, IN_KEY_A, 700); // pasa a la 2ª pregunta
  CHECK_EQ_INT(h.in.question.index, 1);
  // otra pregunta: empieza de cero y la guarda cuenta desde que llega
  h_view(&h, &q2, 2000);
  CHECK_EQ_INT(h.in.question.index, 0);
  tap_key(&h, IN_KEY_A, 2100);
  CHECK_EQ_INT(sends(&h), 0);
  // un permiso toma la pantalla: la máquina de la pregunta se olvida y aprobar funciona con su guarda de siempre
  h_view(&h, &p, 3000);
  CHECK(!h.in.question.has_id);
  tap_key(&h, IN_KEY_A, 3100);
  CHECK_EQ_INT(h.decisions, 0); // guarda de 500 ms
  tap_key(&h, IN_KEY_A, 3600);
  CHECK_EQ_INT(h.decisions, 1);
  CHECK_STR(h.last_decision_id, "p1");
  // un permiso con B rechaza como siempre
  H g;
  h_init(&g);
  h_connect(&g, &p, 0);
  tap_key(&g, IN_KEY_B, 100);
  CHECK_EQ_INT(g.decisions, 1);
  // una pregunta que sustituye al permiso a mitad de un gesto de aprobar lo anula
  H k;
  h_init(&k);
  h_connect(&k, &p, 0);
  h_frame(&k, 1000, IN_KEY_A, 0, IN_KEY_A, 0, 0);
  h_view(&k, &q1, 1100);
  h_frame(&k, 1200, 0, IN_KEY_A, 0, 0, 0);
  CHECK_EQ_INT(k.decisions, 0);
  // el permiso que llega mientras se pulsa B sobre la pregunta no recibe un rechazo por accidente
  H j;
  h_init(&j);
  h_connect(&j, &q1, 0);
  h_frame(&j, 1000, IN_KEY_B, 0, IN_KEY_B, 0, 0);
  h_view(&j, &p, 1100);
  h_frame(&j, 1200, 0, IN_KEY_B, 0, 0, 0);
  CHECK_EQ_INT(j.decisions, 0);
}

static void test_menu_guide_reader_yield(void) {
  View q, none;
  v_question(&q, "q1", 1);
  view_base(&none);
  none.has_settings = 1;
  none.settings.questions = 1;
  H h;
  h_init(&h);
  h_connect(&h, &none, 0);
  // con el menú abierto llega una pregunta: el menú se cierra y manda la pregunta
  tap_key(&h, IN_KEY_SELECT, 100);
  CHECK(h.in.menu.open);
  h_view(&h, &q, 500);
  CHECK(!h.in.menu.open);
  // con una pregunta a la vista SELECT no abre el menú
  tap_key(&h, IN_KEY_SELECT, 600);
  CHECK(!h.in.menu.open);
  // y el menú, si se abrió antes, no deja pasar la guía
  H g;
  h_init(&g);
  h_connect(&g, &none, 0);
  tap_key(&g, IN_KEY_SELECT, 100);
  g.in.guide.open = 1;
  h_view(&g, &q, 500);
  tap_key(&g, IN_KEY_A, 600); // no hay menú ni guía: la guarda de la pregunta (500 ms desde 500) aún corre
  CHECK(!g.in.menu.open);
  CHECK_EQ_INT(sends(&g), 0);
  // la entrada Preguntas del menú manda el ajuste (y no estorba a nada de lo anterior)
  H m;
  h_init(&m);
  h_connect(&m, &none, 0);
  tap_key(&m, IN_KEY_SELECT, 100);
  for (int i = 0; i < 3; i++) tap_key(&m, IN_KEY_DOWN, 200 + (uint64_t)i * 10);
  CHECK_EQ_INT(m.in.menu.cursor, MENU_E_QUESTIONS);
  tap_key(&m, IN_KEY_A, 300);
  CHECK_EQ_INT(m.set_questions, 1);
}

static void test_session_end_resets(void) {
  View v;
  v_question(&v, "q1", 2);
  H h;
  h_init(&h);
  h_connect(&h, &v, 0);
  tap_key(&h, IN_KEY_A, 700);
  CHECK_EQ_INT(h.in.question.index, 1);
  input_session_end(&h.in);
  CHECK(!h.in.question.has_id);
  CHECK(!h.in.question.connected);
  // al reconectar con la misma pregunta, empieza de cero con guarda nueva
  h_connect(&h, &v, 5000);
  CHECK_EQ_INT(h.in.question.index, 0);
  tap_key(&h, IN_KEY_A, 5100);
  CHECK_EQ_INT(h.in.question.index, 0);
  tap_key(&h, IN_KEY_A, 5600);
  CHECK_EQ_INT(h.in.question.index, 1);
}

// ---------------------------------------------------------------- con las vistas reales del puente

static const ViewFixture *vf(const char *name) {
  for (int i = 0; i < VIEW_FIXTURE_COUNT; i++) {
    if (strcmp(VIEW_FIXTURES[i].name, name) == 0) return &VIEW_FIXTURES[i];
  }
  return NULL;
}

static View RV;

static void test_real_fixtures(void) {
  const ViewFixture *f = vf("bridge/question-queue");
  CHECK(f != NULL);
  if (f == NULL) return;
  CHECK_EQ_INT(view_parse(f->json, f->json_len, &RV), VIEW_OK);
  CHECK(view_has_question_card(&RV));
  CHECK(!view_has_permission_card(&RV));
  CHECK_EQ_INT(RV.request.question_count, 4);
  CHECK_EQ_INT(RV.request.position, 2); // la pregunta es la segunda de la cola
  CHECK_EQ_INT(RV.request.total, 2);
  CHECK_STR(RV.request.questions[0].options[0].label, "Opción 1"); // "(Recomendado)" ya no está en la etiqueta
  CHECK(RV.request.questions[0].options[0].recommended);
  CHECK(RV.request.questions[1].multi);
  // la disposición de la pantalla de permisos no ve esta tarjeta
  LayoutInput li;
  memset(&li, 0, sizeof li);
  layout_input_from_view(&li, &RV, "");
  CHECK(!li.has_card);
  // y se responde con las respuestas reales
  H h;
  h_init(&h);
  h_connect(&h, &RV, 0);
  uint64_t t = 600;
  for (int q = 0; q < 4; q++) {
    if (RV.request.questions[q].multi) {
      tap_key(&h, IN_KEY_A, t); // marca la 1
      t += 10;
      for (int i = 0; i < RV.request.questions[q].option_count; i++) tap_key(&h, IN_KEY_DOWN, t++);
      tap_key(&h, IN_KEY_A, t); // Listo
      t += QUESTION_GUARD_MS;
    } else {
      tap_key(&h, IN_KEY_DOWN, t++); // la 2
      tap_key(&h, IN_KEY_A, t);
      t += QUESTION_GUARD_MS;
    }
  }
  CHECK_EQ_INT(h.answers, 1);
  CHECK_EQ_INT(h.decisions, 0);
  char want[256];
  snprintf(want, sizeof want, "{\"t\":\"answer\",\"requestId\":\"%s\",\"answers\":[{\"choose\":[1]},{\"choose\":[0]},{\"choose\":[1]},{\"choose\":[0]}]}", RV.request.id);
  CHECK_STR(h.sent_json, want);
}

static void test_max_question_fixtures(void) {
  const char *names[] = {"bridge/max-question-ascii", "bridge/max-question-euro", "bridge/max-question-emoji"};
  for (int i = 0; i < 3; i++) {
    const ViewFixture *f = vf(names[i]);
    CHECK_MSG(f != NULL, "falta %s", names[i]);
    if (f == NULL) continue;
    int r = view_parse(f->json, f->json_len, &RV);
    CHECK_MSG(r == VIEW_OK, "%s dio %d", names[i], r);
    if (r != VIEW_OK) continue;
    CHECK(view_has_question_card(&RV));
    CHECK_EQ_INT(RV.request.question_count, 4);
    for (int q = 0; q < 4; q++) CHECK_EQ_INT(RV.request.questions[q].option_count, 4); // las opciones nunca se pierden
    QuestionLayout l;
    question_layout(&RV.request.questions[1], &l);
    CHECK_EQ_INT(l.row_count, 7);
  }
}

int main(void) {
  TEST_BEGIN("question: preguntas con alternativas (estado, geometría, integración y seguridad)");
  RUN(test_rows);
  RUN(test_guard_and_single);
  RUN(test_view_resets);
  RUN(test_multi_flow);
  RUN(test_done_needs_a_mark_and_b_on_first);
  RUN(test_other_and_pc);
  RUN(test_text_limits);
  RUN(test_layout_fits);
  RUN(test_never_a_decision);
  RUN(test_a_after_guard_answers);
  RUN(test_b_goes_back_and_never_denies);
  RUN(test_two_questions_send_once_at_the_end);
  RUN(test_other_flow);
  RUN(test_pc_row);
  RUN(test_send_failure_allows_retry);
  RUN(test_pen);
  RUN(test_skip_between_requests);
  RUN(test_card_changes_reset_and_permissions_still_work);
  RUN(test_menu_guide_reader_yield);
  RUN(test_session_end_resets);
  RUN(test_real_fixtures);
  RUN(test_max_question_fixtures);
  TEST_END();
}

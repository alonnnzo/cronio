// Instrucciones por texto (Fase 2b, paso 6): la máquina de estados de logic/instruct.c, los mensajes de core/msg.c, la lectura de la vista
// (kind instruction, detail.instructions, waitForMe, settings.instructWaitMax) y su integración con logic/input_logic.c. Reglas de
// seguridad que se comprueban: la tarjeta "Espera tu instrucción" NUNCA se aprueba ni se rechaza (ni A, ni B, ni Y, ni X, ni el lápiz emiten
// una decisión), la guarda de 500 ms, B nunca envía ni libera, y X sigue alternando el modo de permisos fuera del detalle. Sin libctru.
#include "test.h"

#include "../source/core/msg.h"
#include "../source/logic/input_logic.h"
#include "../source/logic/instruct.h"
#include "../source/logic/menu.h"
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
  v->has_settings = 1;
  v->settings.notify_default = NOTIFY_IMPORTANT;
  v->settings.notify_ack = 1;
  v->settings.sound = 1;
  v->settings.questions = 1;
  v->settings.has_instruct_wait = 1;
  v->settings.instruct_wait_max = 10;
}

// El fin de turno retenido de la sesión s1.
static void v_instruction(View *v, const char *id, unsigned total) {
  view_base(v);
  v->has_request = 1;
  RequestView *r = &v->request;
  memset(r, 0, sizeof *r);
  strcpy(r->id, id);
  strcpy(r->session_id, "s1");
  strcpy(r->title, "Claude espera tu instrucción");
  r->kind = REQ_INSTRUCTION;
  r->line_count = 2;
  strcpy(r->lines[0], "Terminé el login.");
  strcpy(r->lines[1], "¿Agrego pruebas?");
  r->position = 1;
  r->total = total;
  v->pending_count = total;
}

static void v_permission(View *v, const char *id) {
  view_base(v);
  v->has_request = 1;
  RequestView *r = &v->request;
  memset(r, 0, sizeof *r);
  strcpy(r->id, id);
  strcpy(r->session_id, "s1");
  strcpy(r->title, "Claude pide permiso");
  r->line_count = 1;
  strcpy(r->lines[0], "npm test");
  r->position = 1;
  r->total = 1;
  v->pending_count = 1;
}

// Detalle de s1 abierto, con o sin cola y con o sin "Esperar".
static void v_detail(View *v, int queued, int wait) {
  view_base(v);
  v->has_detail = 1;
  strcpy(v->detail.session_id, "s1");
  v->detail.line_count = 1;
  strcpy(v->detail.last_message[0], "Listo.");
  v->detail.has_notify = 1;
  v->detail.notify = NOTIFY_IMPORTANT;
  v->detail.instr_count = queued;
  if (queued > 0) strcpy(v->detail.instr_first, "Agrega pruebas");
  v->detail.wait_for_me = wait;
}

// ---- arnés: lo que hace app.c ----

typedef struct {
  InputLogic in;
  BottomLayout lay;
  const View *view;
  uint64_t now;
  int send_fails;
  int decisions, modes, skips, writes, sends, clears, releases, waits, set_wait;
  int last_wait_flag;
  char last_id[VIEW_ID_BYTES];
  char last_text[MSG_INSTRUCT_BYTES];
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
    int rc = 0;
    switch (a->kind) {
      case IN_ACT_DECISION: h->decisions++; break;
      case IN_ACT_MODE: h->modes++; break;
      case IN_ACT_SKIP: h->skips++; break;
      case IN_ACT_INSTRUCT_WRITE: h->writes++; strcpy(h->last_id, a->id); break;
      case IN_ACT_INSTRUCT_SEND:
        h->sends++;
        strcpy(h->last_id, a->id);
        strcpy(h->last_text, h->in.instruct_text);
        rc = h->send_fails ? -1 : 0;
        break;
      case IN_ACT_INSTRUCT_CLEAR: h->clears++; strcpy(h->last_id, a->id); break;
      case IN_ACT_RELEASE:
        h->releases++;
        strcpy(h->last_id, a->id);
        rc = h->send_fails ? -1 : 0;
        break;
      case IN_ACT_SESSION_WAIT: h->waits++; h->last_wait_flag = a->flag; strcpy(h->last_id, a->id); break;
      case IN_ACT_SETTING_INSTRUCT_WAIT: h->set_wait++; h->last_wait_flag = a->flag; break;
      default: break;
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

static void tap_at(H *h, uint64_t at, int x, int y) {
  h_frame(h, at, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, x, y);
  h_frame(h, at + 20, 0, IN_KEY_TOUCH, 0, x, y);
}

// lo que hace app.c tras el teclado del sistema
static void h_text(H *h, const char *session_id, const char *text) {
  InputActions acts;
  input_instruct_text(&h->in, h->view, session_id, text, &acts);
  exec(h, &acts);
}

static void open_detail(H *h) {
  h->in.nav.level = NAV_DETAIL;
  strcpy(h->in.nav.session_id, "s1");
  h->in.nav.confirmed = 1;
}

// ---------------------------------------------------------------- lógica pura

static void test_clean(void) {
  char out[MSG_INSTRUCT_BYTES];
  CHECK_EQ_INT(instruct_clean("  hola  ", out, sizeof out), 4);
  CHECK_STR(out, "hola");
  CHECK_EQ_INT(instruct_clean("a\nb\tc", out, sizeof out), 5);
  CHECK_STR(out, "a b c");
  CHECK_EQ_INT(instruct_clean("\n\n  \t", out, sizeof out), 0);
  CHECK_STR(out, "");
  CHECK_EQ_INT(instruct_clean(NULL, out, sizeof out), 0);
  CHECK_EQ_INT(instruct_clean("camión ñandú €", out, sizeof out), 14);
  CHECK_STR(out, "camión ñandú €");
  // se corta a 400 caracteres sin partir un carácter de varios bytes
  char big[MSG_INSTRUCT_BYTES * 2];
  size_t n = 0;
  for (int i = 0; i < 500; i++) {
    memcpy(big + n, "ñ", 2);
    n += 2;
  }
  big[n] = '\0';
  CHECK_EQ_INT(instruct_clean(big, out, sizeof out), 400);
  CHECK_EQ_INT(strlen(out), 800);
  // el corte que deja un espacio al final lo quita
  for (int i = 0; i < 399; i++) big[i] = 'a';
  big[399] = ' ';
  big[400] = 'b';
  big[401] = '\0';
  CHECK_EQ_INT(instruct_clean(big, out, sizeof out), 399);
  // el búfer chico no se desborda
  char small[8];
  CHECK_EQ_INT(instruct_clean("abcdefghijklmnop", small, sizeof small), 7);
  CHECK_STR(small, "abcdefg");
}

static void test_messages(void) {
  char m[MSG_INSTRUCT_MAX];
  int n = msg_instruct(m, sizeof m, "s1", "Agrega pruebas \"ya\"");
  CHECK(n > 0);
  CHECK_STR(m, "{\"t\":\"instruct\",\"sessionId\":\"s1\",\"text\":\"Agrega pruebas \\\"ya\\\"\"}");
  CHECK_EQ_INT(msg_instruct(m, sizeof m, "s 1", "x"), -1);
  CHECK_EQ_INT(msg_instruct(m, sizeof m, NULL, "x"), -1);
  CHECK_EQ_INT(msg_instruct(m, sizeof m, "s1", NULL), -1);
  CHECK_EQ_INT(msg_instruct(m, sizeof m, "s1", ""), -1);
  CHECK_EQ_INT(msg_instruct(m, sizeof m, "s1", "   "), -1);
  CHECK_EQ_INT(msg_instruct(m, sizeof m, "s1", "a\nb"), -1); // sin saltos ni controles
  CHECK_EQ_INT(msg_instruct(m, sizeof m, "s1", "a\tb"), -1);
  CHECK_EQ_INT(msg_instruct(m, sizeof m, "s1", "\xff\xfe"), -1); // UTF-8 inválido
  char big[MSG_INSTRUCT_BYTES + 8];
  memset(big, 'a', 400);
  big[400] = '\0';
  CHECK(msg_instruct(m, sizeof m, "s1", big) > 0);
  big[400] = 'a';
  big[401] = '\0';
  CHECK_EQ_INT(msg_instruct(m, sizeof m, "s1", big), -1); // 401 caracteres
  size_t k = 0;
  for (int i = 0; i < 400; i++) {
    memcpy(big + k, "\xf0\x9f\x98\x80", 4); // 😀: 4 bytes, 1 carácter
    k += 4;
  }
  big[k] = '\0';
  CHECK(msg_instruct(m, sizeof m, "s1", big) > 0); // el peor caso en bytes cabe
  char tiny[16];
  CHECK_EQ_INT(msg_instruct(tiny, sizeof tiny, "s1", "hola"), -1); // no cabe
  CHECK_STR(tiny, "");

  char s[MSG_MAX_LEN];
  CHECK(msg_instruct_clear(s, sizeof s, "s1") > 0);
  CHECK_STR(s, "{\"t\":\"instructClear\",\"sessionId\":\"s1\"}");
  CHECK_EQ_INT(msg_instruct_clear(s, sizeof s, "a b"), -1);
  CHECK(msg_release(s, sizeof s, "r1") > 0);
  CHECK_STR(s, "{\"t\":\"release\",\"requestId\":\"r1\"}");
  CHECK_EQ_INT(msg_release(s, sizeof s, ""), -1);
  CHECK(msg_setting_session_wait(s, sizeof s, "s1", 1) > 0);
  CHECK_STR(s, "{\"t\":\"setting\",\"key\":\"sessionWait\",\"sessionId\":\"s1\",\"value\":true}");
  CHECK(msg_setting_session_wait(s, sizeof s, "s1", 0) > 0);
  CHECK_STR(s, "{\"t\":\"setting\",\"key\":\"sessionWait\",\"sessionId\":\"s1\",\"value\":false}");
  CHECK_EQ_INT(msg_setting_session_wait(s, sizeof s, "", 1), -1);
  for (int v = 0; v < 61; v++) {
    int ok = v == 5 || v == 10 || v == 30;
    CHECK_EQ_INT(msg_setting_instruct_wait(s, sizeof s, v) > 0, ok);
  }
  CHECK(msg_setting_instruct_wait(s, sizeof s, 30) > 0);
  CHECK_STR(s, "{\"t\":\"setting\",\"key\":\"instructWaitMax\",\"value\":30}");
}

static void test_machine(void) {
  View v;
  v_instruction(&v, "r1", 1);
  Instruct s;
  instruct_init(&s);
  instruct_connection(&s, 1);
  instruct_view(&s, 100, &v.request);
  CHECK(s.has_id);
  CHECK(!instruct_ready(&s, 599));
  CHECK(instruct_ready(&s, 600));
  // dentro de la guarda A no hace nada
  CHECK_EQ_INT(instruct_activate(&s, 599, -1, 0).kind, IOUT_NONE);
  CHECK_EQ_INT(instruct_activate(&s, 600, -1, 1).kind, IOUT_NONE); // repetición
  CHECK_EQ_INT(instruct_activate(&s, 600, -1, 0).kind, IOUT_WRITE);
  CHECK(!s.sent); // el teclado puede cancelarse
  // el cursor se queda en las dos filas
  instruct_move(&s, 5);
  CHECK_EQ_INT(s.cursor, 1);
  instruct_move(&s, -5);
  CHECK_EQ_INT(s.cursor, 0);
  instruct_select(&s, 1);
  CHECK_EQ_INT(s.cursor, 1);
  instruct_select(&s, 2);
  CHECK_EQ_INT(s.cursor, 1);
  CHECK_EQ_INT(instruct_activate(&s, 700, -1, 0).kind, IOUT_RELEASE);
  CHECK(s.sent);
  CHECK_EQ_INT(instruct_activate(&s, 800, -1, 0).kind, IOUT_NONE); // una vez
  instruct_sent(&s, -1); // no salió: se puede volver a elegir
  CHECK(!s.sent);
  CHECK_EQ_INT(instruct_activate(&s, 900, 1, 0).kind, IOUT_RELEASE);
  // la misma tarjeta no reinicia; otra sí; un tipo distinto la borra; sin conexión no hay A
  instruct_view(&s, 5000, &v.request);
  CHECK_EQ_INT(s.since, 100);
  View v2;
  v_instruction(&v2, "r2", 1);
  instruct_view(&s, 5000, &v2.request);
  CHECK(!s.sent);
  CHECK_EQ_INT(s.since, 5000);
  instruct_connection(&s, 0);
  CHECK(!instruct_ready(&s, 9000));
  instruct_connection(&s, 1);
  View p;
  v_permission(&p, "p1");
  instruct_view(&s, 9000, &p.request);
  CHECK(!s.has_id);
  instruct_view(&s, 9000, NULL);
  CHECK(!s.has_id);
}

static void test_layout(void) {
  InstructLayout l;
  instruct_layout(&l);
  for (int i = 0; i < INSTRUCT_ROWS; i++) {
    CHECK(l.rows[i].x >= 0 && l.rows[i].x + l.rows[i].w <= LAYOUT_W);
    CHECK(l.rows[i].y >= 0 && l.rows[i].y + l.rows[i].h <= LAYOUT_H);
    CHECK_EQ_INT(instruct_hit_row(0, CX(l.rows[i]), CY(l.rows[i])), i);
  }
  CHECK(l.rows[1].y >= l.rows[0].y + l.rows[0].h);
  CHECK(l.rows[0].y >= l.text.y + l.text.h);
  CHECK(l.hint.y >= l.rows[1].y + l.rows[1].h && l.hint.y + l.hint.h <= LAYOUT_H);
  CHECK_EQ_INT(instruct_hit_row(0, 2, 2), -1);
  CHECK(!l.compact);
}

// ---------------------------------------------------------------- atajos (Fase 3)

static const char *const QUICK_LABELS[4] = {"Sigue", "Corre las pruebas", "Haz commit", "Resume"};
static const char *const QUICK_TEXTS[4] = {"Sigue con lo que estabas haciendo.", "Corre las pruebas y arregla lo que falle.",
                                           "Haz commit de los cambios con un mensaje claro.", "Resume en pocas líneas qué hiciste y qué falta."};

static void v_quick(View *v, const char *id, int n) {
  v_instruction(v, id, 1);
  v->request.quick_count = n;
  for (int i = 0; i < n; i++) {
    strcpy(v->request.quick[i].label, QUICK_LABELS[i]);
    strcpy(v->request.quick[i].text, QUICK_TEXTS[i]);
  }
}

static void test_quick_cursor(void) {
  View v;
  v_quick(&v, "r1", 4);
  Instruct s;
  instruct_init(&s);
  instruct_connection(&s, 1);
  instruct_view(&s, 0, &v.request);
  CHECK_EQ_INT(instruct_row_count(&s), 6);
  CHECK_EQ_INT(instruct_write_row(&s), 4);
  CHECK_EQ_INT(s.cursor, 4); // empieza en Escribir: un A suelto abre el teclado, no manda una orden
  instruct_move(&s, -1);
  CHECK_EQ_INT(s.cursor, 3); // del último atajo
  instruct_move(&s, -1);
  CHECK_EQ_INT(s.cursor, 1); // sube una fila de la cuadrícula (misma columna)
  instruct_move(&s, -1);
  CHECK_EQ_INT(s.cursor, 1); // sin dar la vuelta
  instruct_move_x(&s, -1);
  CHECK_EQ_INT(s.cursor, 0);
  instruct_move_x(&s, -1);
  CHECK_EQ_INT(s.cursor, 0);
  instruct_move_x(&s, 1);
  CHECK_EQ_INT(s.cursor, 1);
  instruct_move_x(&s, 1);
  CHECK_EQ_INT(s.cursor, 1); // no pasa a la fila de abajo
  instruct_move(&s, 1);
  CHECK_EQ_INT(s.cursor, 3);
  instruct_move(&s, 1);
  CHECK_EQ_INT(s.cursor, 4); // de la última fila de atajos, a Escribir
  instruct_move_x(&s, 1);
  CHECK_EQ_INT(s.cursor, 4); // izquierda/derecha no mueven las filas de abajo
  instruct_move(&s, 1);
  CHECK_EQ_INT(s.cursor, 5);
  instruct_move(&s, 1);
  CHECK_EQ_INT(s.cursor, 5);
  instruct_select(&s, 6);
  CHECK_EQ_INT(s.cursor, 5);
  instruct_select(&s, 2);
  CHECK_EQ_INT(s.cursor, 2);
  // tres atajos: el tercero queda solo en su fila y baja a Escribir
  View v3;
  v_quick(&v3, "r3", 3);
  instruct_view(&s, 10, &v3.request);
  CHECK_EQ_INT(s.cursor, 3);
  instruct_move(&s, -1);
  CHECK_EQ_INT(s.cursor, 2);
  instruct_move_x(&s, 1);
  CHECK_EQ_INT(s.cursor, 2);
  instruct_move(&s, 1);
  CHECK_EQ_INT(s.cursor, 3);
  instruct_select(&s, 1);
  instruct_move(&s, 1);
  CHECK_EQ_INT(s.cursor, 3); // el atajo 1 no tiene otro debajo
  // un solo atajo
  View v1;
  v_quick(&v1, "r4", 1);
  instruct_view(&s, 20, &v1.request);
  CHECK_EQ_INT(instruct_row_count(&s), 3);
  instruct_move(&s, -1);
  CHECK_EQ_INT(s.cursor, 0);
  instruct_move_x(&s, 1);
  CHECK_EQ_INT(s.cursor, 0);
}

static void test_quick_activate(void) {
  View v;
  v_quick(&v, "r1", 4);
  Instruct s;
  instruct_init(&s);
  instruct_connection(&s, 1);
  instruct_view(&s, 100, &v.request);
  InstructOut o = instruct_activate(&s, 599, 2, 0);
  CHECK_EQ_INT(o.kind, IOUT_NONE); // guarda de 500 ms
  CHECK_EQ_INT(instruct_activate(&s, 600, 2, 1).kind, IOUT_NONE);
  o = instruct_activate(&s, 600, 2, 0);
  CHECK_EQ_INT(o.kind, IOUT_QUICK);
  CHECK_EQ_INT(o.index, 2);
  CHECK(s.sent);
  CHECK_EQ_INT(instruct_activate(&s, 700, 1, 0).kind, IOUT_NONE); // una sola vez
  instruct_sent(&s, -1);
  CHECK(!s.sent);
  CHECK_EQ_INT(instruct_activate(&s, 800, 4, 0).kind, IOUT_WRITE); // Escribir sigue donde dice quick_n
  CHECK(!s.sent);
  CHECK_EQ_INT(instruct_activate(&s, 900, 5, 0).kind, IOUT_RELEASE);
  CHECK_EQ_INT(instruct_activate(&s, 1000, 6, 0).kind, IOUT_NONE);
}

static void test_quick_layout(void) {
  for (int n = 1; n <= VIEW_MAX_QUICK; n++) {
    InstructLayout l;
    instruct_layout_n(&l, n);
    CHECK(l.compact);
    CHECK_EQ_INT(l.rows_n, n + INSTRUCT_ROWS);
    for (int i = 0; i < l.rows_n; i++) {
      CHECK_MSG(l.rows[i].x >= 0 && l.rows[i].x + l.rows[i].w <= LAYOUT_W, "n=%d fila %d fuera de ancho", n, i);
      CHECK_MSG(l.rows[i].y >= l.text.y + l.text.h && l.rows[i].y + l.rows[i].h <= l.hint.y, "n=%d fila %d fuera de alto", n, i);
      CHECK_EQ_INT(instruct_hit_row(n, CX(l.rows[i]), CY(l.rows[i])), i);
      for (int j = i + 1; j < l.rows_n; j++) {
        const Rect *a = &l.rows[i], *b = &l.rows[j];
        int apart = a->x + a->w <= b->x || b->x + b->w <= a->x || a->y + a->h <= b->y || b->y + b->h <= a->y;
        CHECK_MSG(apart, "n=%d filas %d y %d se solapan", n, i, j);
      }
    }
    CHECK(l.header.y + l.header.h <= l.label.y && l.label.y + l.label.h <= l.text.y);
    CHECK(l.text.y + (2 * l.text_pitch) + 11 <= l.rows[0].y); // tres líneas del mensaje caben sobre los atajos
    CHECK(l.help.y >= l.rows[l.rows_n - 1].y + l.rows[l.rows_n - 1].h && l.help.y + l.help.h <= l.hint.y);
    CHECK(l.hint.y + l.hint.h <= LAYOUT_H);
    // un toque entre los atajos o fuera de las filas no elige nada
    CHECK_EQ_INT(instruct_hit_row(n, 2, 2), -1);
    CHECK_EQ_INT(instruct_hit_row(n, l.rows[0].x + l.rows[0].w + 1, CY(l.rows[0])), -1);
  }
  // 6 filas: la peor combinación cabe en 320x240
  InstructLayout l;
  instruct_layout_n(&l, 4);
  CHECK(l.hint.y + l.hint.h <= 240);
  CHECK_EQ_INT(l.rows[0].w, 150);
  CHECK(l.rows[1].x == l.rows[0].x + l.rows[0].w + 4);
}

static void test_quick_flow(void) {
  View v;
  v_quick(&v, "r1", 4);
  H h;
  h_init(&h);
  h_connect(&h, &v, 1000);
  tap_key(&h, IN_KEY_A, 1100); // dentro de la guarda: nada
  CHECK_EQ_INT(h.writes + h.sends, 0);
  tap_key(&h, IN_KEY_A, 1600); // la fila marcada al llegar es Escribir
  CHECK_EQ_INT(h.writes, 1);
  CHECK_EQ_INT(h.sends, 0);
  // cruceta: arriba al último atajo, a la izquierda al de al lado y A lo manda
  tap_key(&h, IN_KEY_UP, 1700);
  tap_key(&h, IN_KEY_LEFT, 1710);
  CHECK_EQ_INT(h.in.instruct.cursor, 2);
  tap_key(&h, IN_KEY_A, 1800);
  CHECK_EQ_INT(h.sends, 1);
  CHECK_STR(h.last_id, "s1");
  CHECK_STR(h.last_text, QUICK_TEXTS[2]);
  CHECK(h.in.instruct.sent);
  tap_key(&h, IN_KEY_A, 1900); // una sola vez
  CHECK_EQ_INT(h.sends, 1);
  CHECK_EQ_INT(h.releases, 0);
  CHECK_EQ_INT(h.decisions, 0);
  // si el envío falla, se puede volver a elegir
  View w;
  v_quick(&w, "r2", 4);
  h_init(&h);
  h_connect(&h, &w, 0);
  h.send_fails = 1;
  tap_key(&h, IN_KEY_UP, 600);
  tap_key(&h, IN_KEY_A, 1000);
  CHECK_EQ_INT(h.sends, 1);
  CHECK_STR(h.last_text, QUICK_TEXTS[3]);
  CHECK(!h.in.instruct.sent);
  h.send_fails = 0;
  tap_key(&h, IN_KEY_A, 1100);
  CHECK_EQ_INT(h.sends, 2);
}

static void test_quick_touch(void) {
  View v;
  v_quick(&v, "r1", 4);
  H h;
  h_init(&h);
  h_connect(&h, &v, 0);
  InstructLayout l;
  instruct_layout_n(&l, 4);
  // el lápiz: apoyar marca la fila, soltar sobre la misma la elige
  tap_at(&h, 1000, CX(l.rows[1]), CY(l.rows[1]));
  CHECK_EQ_INT(h.sends, 1);
  CHECK_STR(h.last_text, QUICK_TEXTS[1]);
  // apoyar en un atajo y soltar en otro no elige (y no manda nada más: ya se mandó)
  View w;
  v_quick(&w, "r2", 4);
  h_init(&h);
  h_connect(&h, &w, 0);
  h_frame(&h, 1000, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, CX(l.rows[0]), CY(l.rows[0]));
  h_frame(&h, 1010, 0, 0, IN_KEY_TOUCH, CX(l.rows[2]), CY(l.rows[2]));
  h_frame(&h, 1020, 0, IN_KEY_TOUCH, 0, CX(l.rows[2]), CY(l.rows[2]));
  CHECK_EQ_INT(h.sends, 0);
  // Escribir y Seguir con el lápiz, en su lugar nuevo
  tap_at(&h, 2000, CX(l.rows[4]), CY(l.rows[4]));
  CHECK_EQ_INT(h.writes, 1);
  tap_at(&h, 2100, CX(l.rows[5]), CY(l.rows[5]));
  CHECK_EQ_INT(h.releases, 1);
  CHECK_EQ_INT(h.decisions, 0);
  // nada de lo que se toque o pulse es una decisión
  View p;
  v_quick(&p, "r3", 4);
  h_init(&h);
  h_connect(&h, &p, 0);
  uint32_t keys[] = {IN_KEY_B, IN_KEY_X, IN_KEY_Y, IN_KEY_L, IN_KEY_R, IN_KEY_LEFT, IN_KEY_RIGHT};
  for (unsigned i = 0; i < sizeof keys / sizeof keys[0]; i++) tap_key(&h, keys[i], 1000 + 100 * i);
  CHECK_EQ_INT(h.decisions, 0);
  CHECK_EQ_INT(h.sends + h.releases + h.writes, 0);
}

static void test_quick_parse(void) {
  static const char *const GOOD =
      "{\"t\":\"view\",\"rev\":1,\"view\":{\"sessions\":[],\"request\":{\"id\":\"r1\",\"sessionId\":\"s1\",\"kind\":\"instruction\",\"title\":\"t\","
      "\"lines\":[\"x\"],\"risk\":\"normal\",\"expiresInS\":0,\"position\":1,\"total\":1,"
      "\"quick\":[{\"label\":\"Sigue\",\"text\":\"Sigue con lo que estabas haciendo.\"},{\"label\":\"Resume\",\"text\":\"Resume en pocas l\xC3\xADneas.\"}]},"
      "\"pendingCount\":1,\"mode\":\"queue\",\"face\":{\"kind\":null,\"mood\":\"idle\",\"lines\":[\"x\"]},\"detail\":null,\"led\":\"off\"}}";
  View v;
  CHECK_EQ_INT(view_parse(GOOD, strlen(GOOD), &v), VIEW_OK);
  CHECK_EQ_INT(v.request.quick_count, 2);
  CHECK_STR(v.request.quick[0].label, "Sigue");
  CHECK_STR(v.request.quick[1].text, "Resume en pocas l\xC3\xADneas.");
  // sin el campo: cero atajos (un puente anterior)
  char buf[1200];
  const char *q = strstr(GOOD, ",\"quick\":");
  CHECK(q != NULL);
  size_t head = (size_t)(q - GOOD);
  const char *end = strstr(q, "]},\"pendingCount\"") + 1;
  snprintf(buf, sizeof buf, "%.*s%s", (int)head, GOOD, end);
  CHECK_EQ_INT(view_parse(buf, strlen(buf), &v), VIEW_OK);
  CHECK_EQ_INT(v.request.quick_count, 0);
  // inválidos: con otro tipo de solicitud, etiqueta o texto vacíos o demasiado largos, más de cuatro
  snprintf(buf, sizeof buf, "%s", GOOD);
  char *k = strstr(buf, "\"kind\":\"instruction\"");
  memcpy(k, "\"kind\":\"permission\" ", 20);
  CHECK(view_parse(buf, strlen(buf), &v) < 0);
  static const char *const BAD_LABEL = "\"label\":\"123456789012345678901\"";
  snprintf(buf, sizeof buf, "%s", GOOD);
  char *lab = strstr(buf, "\"label\":\"Sigue\"");
  char tail[600];
  snprintf(tail, sizeof tail, "%s", lab + strlen("\"label\":\"Sigue\""));
  snprintf(lab, sizeof buf - (size_t)(lab - buf), "%s%s", BAD_LABEL, tail);
  CHECK_EQ_INT(view_parse(buf, strlen(buf), &v), VIEW_ERR_LIMIT);
  snprintf(buf, sizeof buf, "%s", GOOD);
  lab = strstr(buf, "\"label\":\"Sigue\"");
  snprintf(tail, sizeof tail, "%s", lab + strlen("\"label\":\"Sigue\""));
  snprintf(lab, sizeof buf - (size_t)(lab - buf), "\"label\":\"\"%s", tail);
  CHECK_EQ_INT(view_parse(buf, strlen(buf), &v), VIEW_ERR_LIMIT);
  // cinco atajos
  char five[1200];
  snprintf(five, sizeof five,
           "{\"t\":\"view\",\"rev\":1,\"view\":{\"sessions\":[],\"request\":{\"id\":\"r1\",\"sessionId\":\"s1\",\"kind\":\"instruction\",\"title\":\"t\","
           "\"lines\":[],\"risk\":\"normal\",\"expiresInS\":0,\"position\":1,\"total\":1,\"quick\":[%s,%s,%s,%s,%s]},"
           "\"pendingCount\":1,\"mode\":\"queue\",\"face\":{\"kind\":null,\"mood\":\"idle\",\"lines\":[\"x\"]},\"detail\":null,\"led\":\"off\"}}",
           "{\"label\":\"a\",\"text\":\"a\"}", "{\"label\":\"b\",\"text\":\"b\"}", "{\"label\":\"c\",\"text\":\"c\"}", "{\"label\":\"d\",\"text\":\"d\"}",
           "{\"label\":\"e\",\"text\":\"e\"}");
  CHECK_EQ_INT(view_parse(five, strlen(five), &v), VIEW_ERR_LIMIT);
}

// ---------------------------------------------------------------- lectura de la vista

static const ViewFixture *vf(const char *name) {
  for (int i = 0; i < VIEW_FIXTURE_COUNT; i++) {
    if (strcmp(VIEW_FIXTURES[i].name, name) == 0) return &VIEW_FIXTURES[i];
  }
  printf("fixture inexistente: %s\n", name);
  exit(2);
}

static View RV;

static void test_real_fixtures(void) {
  const ViewFixture *f = vf("bridge/instruction-card");
  CHECK_EQ_INT(view_parse(f->json, f->json_len, &RV), VIEW_OK);
  CHECK(view_has_instruction_card(&RV));
  CHECK(!view_has_permission_card(&RV));
  CHECK(!view_has_question_card(&RV));
  CHECK_EQ_INT(RV.request.kind, REQ_INSTRUCTION);
  CHECK_STR(view_request_kind_name(RV.request.kind), "instruction");
  CHECK_EQ_INT(RV.request.question_count, 0);
  CHECK_EQ_INT(RV.request.expires_in_s, 0);
  CHECK(RV.request.line_count >= 1 && RV.request.line_count <= 3);
  CHECK_STR(RV.request.title, "Claude espera tu instrucción");
  CHECK_EQ_INT(RV.sessions[0].state, STATE_ASK);
  // la pantalla de permisos no ve esta tarjeta y se responde con las acciones propias
  LayoutInput li;
  memset(&li, 0, sizeof li);
  layout_input_from_view(&li, &RV, "");
  CHECK(!li.has_card);
  H h;
  h_init(&h);
  h_connect(&h, &RV, 0);
  tap_key(&h, IN_KEY_A, 1000);
  CHECK_EQ_INT(h.writes, 1);
  CHECK_STR(h.last_id, "s1");
  h_text(&h, "s1", "Agrega pruebas");
  CHECK_EQ_INT(h.sends, 1);
  CHECK_STR(h.last_text, "Agrega pruebas");
  CHECK_EQ_INT(h.decisions, 0);

  f = vf("bridge/instruction-queue");
  CHECK_EQ_INT(view_parse(f->json, f->json_len, &RV), VIEW_OK);
  CHECK(view_has_instruction_card(&RV)); // el enfoque se movió a la retención
  CHECK_EQ_INT(RV.request.total, 2);
  CHECK_EQ_INT(RV.request.position, 2);

  f = vf("bridge/detail-instructions");
  CHECK_EQ_INT(view_parse(f->json, f->json_len, &RV), VIEW_OK);
  CHECK(RV.has_detail);
  CHECK_EQ_INT(RV.detail.instr_count, 2);
  CHECK(strncmp(RV.detail.instr_first, "Agrega pruebas", 14) == 0);
  CHECK_EQ_INT(RV.detail.wait_for_me, 1);
  CHECK(RV.settings.has_instruct_wait);
  CHECK_EQ_INT(RV.settings.instruct_wait_max, 10);

  f = vf("bridge/settings-instruct-wait");
  CHECK_EQ_INT(view_parse(f->json, f->json_len, &RV), VIEW_OK);
  CHECK_EQ_INT(RV.settings.instruct_wait_max, 30);

  // una vista anterior (sin los campos) sigue valiendo y no ofrece instrucciones
  f = vf("bridge/detail-open");
  CHECK_EQ_INT(view_parse(f->json, f->json_len, &RV), VIEW_OK);
  CHECK_EQ_INT(RV.detail.instr_count, 0);
  CHECK_EQ_INT(RV.detail.wait_for_me, 0);
  CHECK(RV.has_settings);
  CHECK_EQ_INT(RV.settings.has_instruct_wait, 1); // el puente actual siempre lo manda
  f = vf("protocol/bridge-view-settings.valid.json");
  CHECK_EQ_INT(view_parse(f->json, f->json_len, &RV), VIEW_OK);
  CHECK_EQ_INT(RV.settings.has_instruct_wait, 0);
}

// ---------------------------------------------------------------- integración con la entrada

static void test_never_a_decision(void) {
  View v;
  v_instruction(&v, "r1", 1);
  H h;
  h_init(&h);
  h_connect(&h, &v, 0);
  uint32_t keys[] = {IN_KEY_A, IN_KEY_B, IN_KEY_X, IN_KEY_Y, IN_KEY_UP, IN_KEY_DOWN, IN_KEY_LEFT, IN_KEY_RIGHT, IN_KEY_L, IN_KEY_R};
  for (unsigned i = 0; i < sizeof keys / sizeof keys[0]; i++) tap_key(&h, keys[i], 1000 + 100 * i);
  // el lápiz sobre cualquier punto de la pantalla
  for (int y = 0; y < 240; y += 24) {
    for (int x = 0; x < 320; x += 40) tap_at(&h, 5000 + (uint64_t)(y * 8 + x), x, y);
  }
  CHECK_EQ_INT(h.decisions, 0);
  CHECK_EQ_INT(h.modes, 0); // X en la tarjeta no alterna el modo
  CHECK_EQ_INT(h.clears, 0);
  CHECK_EQ_INT(h.waits, 0);
}

static void test_guard_and_rows(void) {
  View v;
  v_instruction(&v, "r1", 1);
  H h;
  h_init(&h);
  h_connect(&h, &v, 1000);
  tap_key(&h, IN_KEY_A, 1100); // dentro de la guarda
  CHECK_EQ_INT(h.writes + h.releases, 0);
  tap_key(&h, IN_KEY_A, 1600); // fila "Escribir"
  CHECK_EQ_INT(h.writes, 1);
  CHECK_STR(h.last_id, "s1");
  tap_key(&h, IN_KEY_B, 1700); // B nunca envía ni libera
  CHECK_EQ_INT(h.releases, 0);
  tap_key(&h, IN_KEY_DOWN, 1800);
  CHECK_EQ_INT(h.in.instruct.cursor, 1);
  tap_key(&h, IN_KEY_A, 1900); // "Seguir en el PC": libera con el id de la solicitud
  CHECK_EQ_INT(h.releases, 1);
  CHECK_STR(h.last_id, "r1");
  tap_key(&h, IN_KEY_A, 2000); // una vez
  CHECK_EQ_INT(h.releases, 1);
  CHECK_EQ_INT(h.decisions, 0);
}

static void test_release_failure_allows_retry(void) {
  View v;
  v_instruction(&v, "r1", 1);
  H h;
  h_init(&h);
  h_connect(&h, &v, 0);
  tap_key(&h, IN_KEY_DOWN, 100);
  h.send_fails = 1;
  tap_key(&h, IN_KEY_A, 1000);
  CHECK_EQ_INT(h.releases, 1);
  CHECK(!h.in.instruct.sent);
  h.send_fails = 0;
  tap_key(&h, IN_KEY_A, 1100);
  CHECK_EQ_INT(h.releases, 2);
}

static void test_text_flow(void) {
  View v;
  v_instruction(&v, "r1", 1);
  H h;
  h_init(&h);
  h_connect(&h, &v, 0);
  // cancelar el teclado (NULL o vacío o solo espacios) no manda nada y la tarjeta sigue usable
  h_text(&h, "s1", NULL);
  h_text(&h, "s1", "");
  h_text(&h, "s1", "  \n ");
  CHECK_EQ_INT(h.sends, 0);
  CHECK(!h.in.instruct.sent);
  // lo escrito se limpia y se manda a la sesión; la tarjeta no se puede volver a usar mientras sale
  h_text(&h, "s1", "  Agrega pruebas\ny documenta  ");
  CHECK_EQ_INT(h.sends, 1);
  CHECK_STR(h.last_text, "Agrega pruebas y documenta");
  CHECK_STR(h.last_id, "s1");
  CHECK(h.in.instruct.sent);
  tap_key(&h, IN_KEY_A, 1000);
  CHECK_EQ_INT(h.writes + h.releases, 0);
  // si el envío falla, vuelve a poder usarse (el arnés cierra la sesión en la app real; aquí solo se comprueba el estado)
  h_init(&h);
  h_connect(&h, &v, 0);
  h.send_fails = 1;
  h_text(&h, "s1", "otra");
  CHECK_EQ_INT(h.sends, 1);
  CHECK(!h.in.instruct.sent);
  // sin vista no hay nada que mandar
  InputActions acts;
  input_instruct_text(&h.in, NULL, "s1", "hola", &acts);
  CHECK_EQ_INT(acts.n, 0);
}

static void test_skip_between_requests(void) {
  View v;
  v_instruction(&v, "r1", 2);
  H h;
  h_init(&h);
  h_connect(&h, &v, 0);
  h_frame(&h, 50, 0, 0, 0, 0, 0); // una pulsación sostenida al llegar la tarjeta no salta (acorde del diagnóstico)
  tap_key(&h, IN_KEY_L, 100);
  tap_key(&h, IN_KEY_R, 200);
  CHECK_EQ_INT(h.skips, 2);
  v.mode = MODE_MANUAL; // en modo "Elijo yo" no se salta
  tap_key(&h, IN_KEY_L, 300);
  CHECK_EQ_INT(h.skips, 2);
}

static void test_permissions_still_work(void) {
  View v, p;
  v_instruction(&v, "r1", 1);
  v_permission(&p, "p1");
  H h;
  h_init(&h);
  h_connect(&h, &v, 0);
  // llega un permiso: la tarjeta de instrucción se va y aprobar funciona como siempre (con su guarda)
  h_view(&h, &p, 1000);
  CHECK(!h.in.instruct.has_id);
  tap_key(&h, IN_KEY_A, 1100);
  CHECK_EQ_INT(h.decisions, 0); // guarda de 500 ms
  tap_key(&h, IN_KEY_A, 1700);
  CHECK_EQ_INT(h.decisions, 1);
  // y al volver la retención empieza de cero
  h_view(&h, &v, 2000);
  CHECK(h.in.instruct.has_id);
  tap_key(&h, IN_KEY_A, 2100);
  CHECK_EQ_INT(h.writes, 0);
}

static void test_menu_guide_reader_yield(void) {
  View v;
  v_instruction(&v, "r1", 1);
  H h;
  h_init(&h);
  h_connect(&h, &v, 0);
  // SELECT no abre el menú con la tarjeta a la vista
  tap_key(&h, IN_KEY_SELECT, 1000);
  CHECK(!h.in.menu.open);
  // un menú abierto se cierra cuando llega la tarjeta
  View none;
  view_base(&none);
  h_view(&h, &none, 2000);
  tap_key(&h, IN_KEY_SELECT, 2100);
  CHECK(h.in.menu.open);
  h_view(&h, &v, 3000);
  h_frame(&h, 3010, 0, 0, 0, 0, 0);
  CHECK(!h.in.menu.open);
  // sesión que termina: todo vuelve a cero
  input_session_end(&h.in);
  CHECK(!h.in.instruct.has_id);
}

// ---- detalle de la sesión

static void test_detail_keys(void) {
  View v;
  v_detail(&v, 0, 0);
  H h;
  h_init(&h);
  h_connect(&h, &v, 0);
  open_detail(&h);
  relayout(&h);
  tap_key(&h, IN_KEY_X, 1000); // X escribe en el detalle; ya no alterna el modo
  CHECK_EQ_INT(h.writes, 1);
  CHECK_STR(h.last_id, "s1");
  CHECK_EQ_INT(h.modes, 0);
  tap_key(&h, IN_KEY_RIGHT, 1100); // Esperar: no -> sí
  CHECK_EQ_INT(h.waits, 1);
  CHECK_EQ_INT(h.last_wait_flag, 1);
  tap_key(&h, IN_KEY_LEFT, 1200);
  CHECK_EQ_INT(h.waits, 2);
  tap_key(&h, IN_KEY_DOWN, 1300); // sin cola, abajo no borra
  CHECK_EQ_INT(h.clears, 0);
  // con "Esperar" encendido la tecla lo apaga
  View w;
  v_detail(&w, 2, 1);
  h_view(&h, &w, 2000);
  tap_key(&h, IN_KEY_LEFT, 2100);
  CHECK_EQ_INT(h.last_wait_flag, 0);
  tap_key(&h, IN_KEY_DOWN, 2200);
  CHECK_EQ_INT(h.clears, 1);
  CHECK_STR(h.last_id, "s1");
  CHECK_EQ_INT(h.decisions, 0);
}

static void test_x_keeps_mode_elsewhere(void) {
  View v;
  v_detail(&v, 0, 0);
  H h;
  h_init(&h);
  h_connect(&h, &v, 0);
  tap_key(&h, IN_KEY_X, 1000); // en la lista de agentes X sigue alternando el modo
  CHECK_EQ_INT(h.modes, 1);
  CHECK_EQ_INT(h.writes, 0);
  // en el detalle de un puente sin instrucciones (sin instructWaitMax) también
  View old;
  v_detail(&old, 0, 0);
  old.settings.has_instruct_wait = 0;
  H g;
  h_init(&g);
  h_connect(&g, &old, 0);
  open_detail(&g);
  tap_key(&g, IN_KEY_X, 1000);
  CHECK_EQ_INT(g.modes, 1);
  CHECK_EQ_INT(g.writes, 0);
  tap_key(&g, IN_KEY_RIGHT, 1100);
  tap_key(&g, IN_KEY_DOWN, 1200);
  CHECK_EQ_INT(g.waits + g.clears, 0);
  // y con una tarjeta de permiso en el detalle, X sigue siendo el modo
  View p;
  v_permission(&p, "p1");
  p.has_detail = 1;
  strcpy(p.detail.session_id, "s1");
  p.settings.has_instruct_wait = 1;
  H k;
  h_init(&k);
  h_connect(&k, &p, 0);
  open_detail(&k);
  tap_key(&k, IN_KEY_X, 1000);
  CHECK_EQ_INT(k.writes, 0);
  CHECK_EQ_INT(k.modes, 1);
}

static void test_detail_layout_and_touch(void) {
  View v;
  v_detail(&v, 2, 0);
  H h;
  h_init(&h);
  h_connect(&h, &v, 0);
  open_detail(&h);
  relayout(&h);
  const BottomLayout *l = &h.lay;
  CHECK(l->has_instruct && l->has_queue_box && l->has_read && l->has_notify);
  // todo dentro de la pantalla y sin solaparse: leer/avisos al pie, instrucción/esperar encima, la cola encima de ellas
  const Rect *rs[] = {&l->btn_read, &l->btn_notify, &l->btn_instruct, &l->btn_wait, &l->queue_box};
  for (int i = 0; i < 5; i++) {
    CHECK(rs[i]->x >= 0 && rs[i]->x + rs[i]->w <= LAYOUT_W);
    CHECK(rs[i]->y >= l->content.y && rs[i]->y + rs[i]->h <= LAYOUT_H);
    for (int j = i + 1; j < 5; j++) {
      int apart = rs[i]->x + rs[i]->w <= rs[j]->x || rs[j]->x + rs[j]->w <= rs[i]->x || rs[i]->y + rs[i]->h <= rs[j]->y || rs[j]->y + rs[j]->h <= rs[i]->y;
      CHECK_MSG(apart, "las franjas %d y %d se solapan", i, j);
    }
  }
  CHECK(l->btn_instruct.y + l->btn_instruct.h <= l->btn_read.y);
  CHECK(l->queue_box.y + l->queue_box.h <= l->btn_instruct.y);
  CHECK_EQ_INT(l->footer_top, l->queue_box.y);
  CHECK(l->btn_clear.x >= l->queue_box.x && l->btn_clear.x + l->btn_clear.w <= l->queue_box.x + l->queue_box.w);
  CHECK(l->footer_top > l->content.y + 60); // queda sitio para lo del detalle
  // los toques
  tap_at(&h, 1000, CX(l->btn_instruct), CY(l->btn_instruct));
  CHECK_EQ_INT(h.writes, 1);
  tap_at(&h, 1100, CX(l->btn_wait), CY(l->btn_wait));
  CHECK_EQ_INT(h.waits, 1);
  CHECK_EQ_INT(h.last_wait_flag, 1);
  tap_at(&h, 1200, CX(l->btn_clear), CY(l->btn_clear));
  CHECK_EQ_INT(h.clears, 1);
  tap_at(&h, 1300, CX(l->btn_read), CY(l->btn_read)); // "A: leer todo" sigue donde estaba
  CHECK_EQ_INT(h.writes, 1);
  // sin cola no hay recuadro ni borrar
  View w;
  v_detail(&w, 0, 1);
  h_view(&h, &w, 2000);
  CHECK(h.lay.has_instruct && !h.lay.has_queue_box);
  CHECK_EQ_INT(h.lay.footer_top, h.lay.btn_instruct.y);
  // un puente sin instrucciones deja el detalle como antes
  View old;
  v_detail(&old, 0, 0);
  old.settings.has_instruct_wait = 0;
  h_view(&h, &old, 3000);
  CHECK(!h.lay.has_instruct && !h.lay.has_queue_box);
  CHECK_EQ_INT(h.lay.footer_top, h.lay.btn_read.y);
}

static void test_menu_entry(void) {
  View v;
  view_base(&v);
  Menu m;
  menu_init(&m);
  menu_open(&m);
  m.cursor = MENU_E_INSTRUCT_WAIT;
  CHECK_EQ_INT(MENU_E_INSTRUCT_WAIT, MENU_E_READER + 1);
  CHECK_STR(menu_entry_title(MENU_E_INSTRUCT_WAIT), "Esperar instrucción hasta");
  CHECK(menu_entry_enabled(MENU_E_INSTRUCT_WAIT, &v));
  CHECK(!menu_entry_enabled(MENU_E_INSTRUCT_WAIT, NULL));
  v.settings.has_instruct_wait = 0; // un puente sin la espera: la entrada sale apagada
  CHECK(!menu_entry_enabled(MENU_E_INSTRUCT_WAIT, &v));
  CHECK_EQ_INT(menu_activate(&m, &v, 1, 0).kind, MENU_OUT_NONE);
  v.settings.has_instruct_wait = 1;
  // 5 -> 10 -> 30 -> 5 con A / derecha, y al revés con izquierda
  static const int ORDER[3] = {5, 10, 30};
  for (int i = 0; i < 3; i++) {
    v.settings.instruct_wait_max = ORDER[i];
    MenuOut o = menu_activate(&m, &v, 1, 0);
    CHECK_EQ_INT(o.kind, MENU_OUT_INSTRUCT_WAIT);
    CHECK_EQ_INT(o.value, ORDER[(i + 1) % 3]);
    o = menu_activate(&m, &v, -1, 1);
    CHECK_EQ_INT(o.value, ORDER[(i + 2) % 3]);
  }
}

int main(void) {
  TEST_BEGIN("instruct: instrucciones por texto (estado, mensajes, vista, entrada y seguridad)");
  RUN(test_clean);
  RUN(test_messages);
  RUN(test_machine);
  RUN(test_layout);
  RUN(test_quick_cursor);
  RUN(test_quick_activate);
  RUN(test_quick_layout);
  RUN(test_quick_flow);
  RUN(test_quick_touch);
  RUN(test_quick_parse);
  RUN(test_real_fixtures);
  RUN(test_never_a_decision);
  RUN(test_guard_and_rows);
  RUN(test_release_failure_allows_retry);
  RUN(test_text_flow);
  RUN(test_skip_between_requests);
  RUN(test_permissions_still_work);
  RUN(test_menu_guide_reader_yield);
  RUN(test_detail_keys);
  RUN(test_x_keeps_mode_elsewhere);
  RUN(test_detail_layout_and_touch);
  RUN(test_menu_entry);
  TEST_END();
}

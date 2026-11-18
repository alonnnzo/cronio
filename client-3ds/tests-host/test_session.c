// La máquina de estados contra un "puente" simulado dentro de la prueba, con los valores de handshake.json.
#include "test.h"

#include "../source/core/handshake.h"
#include "../source/core/session.h"
#include "fixtures/handshake_fixture.h"
#include "fixtures/views_fixture.h"

static Session S;

// ---- transporte simulado ----

typedef struct {
  uint8_t data[8192];
  size_t len;
  int fail;
  int calls;
} Wire;

static int wire_send(void *ctx, const uint8_t *d, size_t n) {
  Wire *w = (Wire *)ctx;
  w->calls++;
  if (w->fail) return -1;
  if (w->len + n > sizeof w->data) return -1;
  memcpy(w->data + w->len, d, n);
  w->len += n;
  return 0;
}

// Saca la siguiente trama de lo enviado. 0 si no hay más.
static int wire_next(const Wire *w, size_t *off, uint8_t *type, const uint8_t **payload, size_t *len) {
  if (*off + FRAME_HEADER_LEN > w->len) return 0;
  size_t l = (size_t)w->data[*off + 1] | ((size_t)w->data[*off + 2] << 8);
  if (*off + FRAME_HEADER_LEN + l > w->len) return 0;
  *type = w->data[*off];
  *payload = w->data + *off + FRAME_HEADER_LEN;
  *len = l;
  *off += FRAME_HEADER_LEN + l;
  return 1;
}

// ---- puente simulado ----

typedef struct {
  uint8_t k[32], nb[16], nc[16], ks[32];
  FrameSealer sealer; // puente -> consola (dir 1)
  FrameOpener opener; // consola -> puente (dir 2)
} Peer;

static void peer_init(Peer *p) {
  t_unhex(HSF_K_HEX, p->k, 32);
  t_unhex(HSF_NONCE_B_HEX, p->nb, 16);
  t_unhex(HSF_NONCE_C_HEX, p->nc, 16);
  t_unhex(HSF_KS_HEX, p->ks, 32);
  frame_sealer_init(&p->sealer, p->ks, FRAME_DIR_BRIDGE_TO_CONSOLE);
  frame_opener_init(&p->opener, p->ks, FRAME_DIR_CONSOLE_TO_BRIDGE);
}

static size_t plain_frame(const char *json, uint8_t *out, size_t cap) {
  int n = frame_encode(FRAME_JSON, (const uint8_t *)json, strlen(json), out, cap);
  return n < 0 ? 0 : (size_t)n;
}

static size_t sealed_frame(Peer *p, uint8_t type, const char *payload, uint8_t *out, size_t cap) {
  int n = frame_seal(&p->sealer, type, (const uint8_t *)payload, strlen(payload), out, cap);
  return n < 0 ? 0 : (size_t)n;
}

static const char CHALLENGE[] = "{\"t\":\"challenge\",\"v\":1,\"nonceB\":\"" HSF_NONCE_B_HEX "\"}";
static const char WELCOME[] = "{\"t\":\"welcome\",\"mac\":\"" HSF_WELCOME_MAC_HEX "\"}";

static void init_session(Session *s, Wire *w, const uint8_t key[32]) {
  uint8_t nc[16];
  t_unhex(HSF_NONCE_C_HEX, nc, 16);
  memset(w, 0, sizeof *w);
  session_init(s, HSF_DEVICE_ID, key, nc);
  Transport t = {wire_send, w};
  session_on_connected(s, t);
}

// Saludo completo con los valores fijos; deja la sesión en READY.
static void handshake(Session *s, Wire *w, Peer *p) {
  uint8_t buf[512];
  peer_init(p);
  init_session(s, w, p->k);
  CHECK_EQ_INT(s->state, SESSION_WAIT_CHALLENGE);
  size_t n = plain_frame(CHALLENGE, buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(s, buf, n), 0);
  CHECK_EQ_INT(s->state, SESSION_WAIT_WELCOME);
  n = plain_frame(WELCOME, buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(s, buf, n), 0);
  CHECK_EQ_INT(s->state, SESSION_READY);
}

static const ViewFixture *vf(const char *name) {
  for (int i = 0; i < VIEW_FIXTURE_COUNT; i++) {
    if (strcmp(VIEW_FIXTURES[i].name, name) == 0) return &VIEW_FIXTURES[i];
  }
  printf("fixture inexistente: %s\n", name);
  exit(2);
}

// Mismo mensaje del puente con otro rev.
static void json_with_rev(const char *json, unsigned long rev, char *out, size_t cap) {
  const char *p = strstr(json, "\"rev\":");
  const char *q = p + 6;
  while (*q >= '0' && *q <= '9') q++;
  snprintf(out, cap, "%.*s\"rev\":%lu%s", (int)(p - json), json, rev, q);
}

static int feed_view(Session *s, Peer *p, const char *json) {
  static uint8_t buf[FRAME_HEADER_LEN + FRAME_MAX_PAYLOAD];
  size_t n = sealed_frame(p, FRAME_JSON, json, buf, sizeof buf);
  CHECK(n > 0);
  return session_on_data(s, buf, n);
}

// ---- pruebas ----

static const ViewFixture *tf(const char *name) {
  for (int i = 0; i < TEXT_FIXTURE_COUNT; i++) {
    if (strcmp(TEXT_FIXTURES[i].name, name) == 0) return &TEXT_FIXTURES[i];
  }
  printf("fixture inexistente: %s\n", name);
  exit(2);
}

// Fase 2b, paso 3: una vista con tarjeta de aviso y sonido se lee; "Visto", pasar de aviso y el modo de sesión salen sellados.
static void test_notice_view_and_messages(void) {
  Wire w;
  Peer p;
  handshake(&S, &w, &p);
  CHECK_EQ_INT(feed_view(&S, &p, vf("bridge/notice-queue")->json), 0);
  const View *v = session_view(&S);
  CHECK(v != NULL && v->has_notice && v->has_chime);
  if (v != NULL && v->has_notice) {
    CHECK_EQ_INT(v->notice.position, 2);
    CHECK_EQ_INT(v->notice.total, 2);
    CHECK_EQ_INT(v->notice.kind, NOTICE_ERROR);
    CHECK_STR(v->notice.title, "Error");
  }
  const char *want[3] = {"{\"t\":\"ack\",\"id\":\"n1\"}", "{\"t\":\"skipNotice\"}",
                         "{\"t\":\"setting\",\"key\":\"sessionNotify\",\"sessionId\":\"s1\",\"value\":\"silent\"}"};
  for (int k = 0; k < 3; k++) {
    size_t before = w.len;
    int rc = k == 0 ? session_send_ack(&S, "n1") : k == 1 ? session_send_skip_notice(&S) : session_send_session_notify(&S, "s1", NOTIFY_SILENT);
    CHECK_EQ_INT(rc, 0);
    size_t off = before, len = 0;
    uint8_t type = 0;
    const uint8_t *pay = NULL;
    CHECK(wire_next(&w, &off, &type, &pay, &len));
    uint8_t body[256];
    memcpy(body, pay, len);
    int n = frame_open(&p.opener, type, body, len);
    CHECK_EQ_INT(n, (int)strlen(want[k]));
    if (n > 0) CHECK(memcmp(body, want[k], (size_t)n) == 0);
  }
  CHECK_EQ_INT(session_send_ack(&S, "id con espacios"), -1);
  CHECK_EQ_INT(session_send_session_notify(&S, "s1", 9), -1);
  CHECK_EQ_INT(S.state, SESSION_READY);
  // una vista con aviso inválido cierra la sesión (como cualquier vista inválida)
  CHECK(feed_view(&S, &p, vf("mut/notice-kind-permission")->json) != 0 || S.state == SESSION_FAILED);
}

// Fase 2b, paso 4: una vista con una pregunta se lee; las respuestas (con texto largo), "Responder en el PC" y el aviso de pausa
// salen sellados con el JSON del protocolo, y una respuesta inválida no sale ni cierra la sesión.
// Instrucciones por texto (paso 6): la vista con el fin de turno retenido y los mensajes sellados que salen hacia el puente.
static void test_instruction_view_and_messages(void) {
  Wire w;
  Peer p;
  handshake(&S, &w, &p);
  CHECK_EQ_INT(feed_view(&S, &p, vf("bridge/instruction-card")->json), 0);
  const View *v = session_view(&S);
  CHECK(v != NULL && view_has_instruction_card(v));
  if (v != NULL && v->has_request) CHECK_EQ_INT(v->request.kind, REQ_INSTRUCTION);
  const char *text = "Agrega pruebas y documenta";
  char want0[256];
  snprintf(want0, sizeof want0, "{\"t\":\"instruct\",\"sessionId\":\"s1\",\"text\":\"%s\"}", text);
  const char *msgs[5] = {want0, "{\"t\":\"instructClear\",\"sessionId\":\"s1\"}", "{\"t\":\"release\",\"requestId\":\"r1\"}",
                         "{\"t\":\"setting\",\"key\":\"sessionWait\",\"sessionId\":\"s1\",\"value\":true}",
                         "{\"t\":\"setting\",\"key\":\"instructWaitMax\",\"value\":30}"};
  for (int k = 0; k < 5; k++) {
    size_t before = w.len;
    int rc = k == 0   ? session_send_instruct(&S, "s1", text)
             : k == 1 ? session_send_instruct_clear(&S, "s1")
             : k == 2 ? session_send_release(&S, "r1")
             : k == 3 ? session_send_setting_session_wait(&S, "s1", 1)
                      : session_send_setting_instruct_wait(&S, 30);
    CHECK_EQ_INT(rc, 0);
    size_t off = before, len = 0;
    uint8_t type = 0;
    const uint8_t *pay = NULL;
    CHECK(wire_next(&w, &off, &type, &pay, &len));
    uint8_t body[512];
    CHECK(len < sizeof body);
    memcpy(body, pay, len);
    int n = frame_open(&p.opener, type, body, len);
    CHECK_EQ_INT(n, (int)strlen(msgs[k]));
    if (n > 0) CHECK(memcmp(body, msgs[k], (size_t)n) == 0);
  }
  // lo inválido no sale y no cierra la sesión
  size_t sent = w.len;
  CHECK_EQ_INT(session_send_instruct(&S, "s1", ""), -1);
  CHECK_EQ_INT(session_send_instruct(&S, "s 1", "x"), -1);
  CHECK_EQ_INT(session_send_instruct_clear(&S, "a b"), -1);
  CHECK_EQ_INT(session_send_release(&S, ""), -1);
  CHECK_EQ_INT(session_send_setting_instruct_wait(&S, 7), -1);
  CHECK_EQ_INT(w.len, sent);
  CHECK_EQ_INT(S.state, SESSION_READY);
  // un tipo de solicitud desconocido cierra la sesión como cualquier vista inválida
  CHECK(feed_view(&S, &p, vf("mut/request-kind-bad")->json) != 0 || S.state == SESSION_FAILED);
}

static void test_question_view_and_messages(void) {
  Wire w;
  Peer p;
  handshake(&S, &w, &p);
  CHECK_EQ_INT(feed_view(&S, &p, vf("bridge/question-single")->json), 0);
  const View *v = session_view(&S);
  CHECK(v != NULL && view_has_question_card(v));
  if (v != NULL && v->has_request) {
    CHECK_EQ_INT(v->request.kind, REQ_QUESTION);
    CHECK_EQ_INT(v->request.question_count, 1);
    CHECK_STR(v->request.questions[0].options[0].label, "Video"); // sin "(Recommended)"
    CHECK(v->request.questions[0].options[0].recommended);
  }
  // varias respuestas y una con texto: el cuerpo sellado es más grande que el de los demás mensajes
  MsgAnswer a[2];
  memset(a, 0, sizeof a);
  a[0].mask = (1u << 0) | (1u << 2);
  a[1].is_other = 1;
  for (int i = 0; i < 200; i++) a[1].other[i] = (char)('a' + i % 26);
  size_t before = w.len;
  CHECK_EQ_INT(session_send_answer(&S, "r1", a, 2), 0);
  size_t off = before, len = 0;
  uint8_t type = 0;
  const uint8_t *pay = NULL;
  CHECK(wire_next(&w, &off, &type, &pay, &len));
  static uint8_t body[1024];
  CHECK(len < sizeof body);
  memcpy(body, pay, len);
  int n = frame_open(&p.opener, type, body, len);
  char want[1024];
  snprintf(want, sizeof want, "{\"t\":\"answer\",\"requestId\":\"r1\",\"answers\":[{\"choose\":[0,2]},{\"other\":\"%s\"}]}", a[1].other);
  CHECK_EQ_INT(n, (int)strlen(want));
  if (n > 0) CHECK(memcmp(body, want, (size_t)n) == 0);

  const char *msgs[3] = {"{\"t\":\"answer\",\"requestId\":\"r1\",\"pc\":true}", "{\"t\":\"hold\",\"seconds\":300}",
                         "{\"t\":\"setting\",\"key\":\"questions\",\"value\":false}"};
  for (int k = 0; k < 3; k++) {
    before = w.len;
    int rc = k == 0 ? session_send_answer_pc(&S, "r1") : k == 1 ? session_send_hold(&S, 300) : session_send_setting_questions(&S, 0);
    CHECK_EQ_INT(rc, 0);
    off = before;
    CHECK(wire_next(&w, &off, &type, &pay, &len));
    uint8_t small[256];
    memcpy(small, pay, len);
    n = frame_open(&p.opener, type, small, len);
    CHECK_EQ_INT(n, (int)strlen(msgs[k]));
    if (n > 0) CHECK(memcmp(small, msgs[k], (size_t)n) == 0);
  }

  // lo inválido no sale y no cierra la sesión
  size_t sent = w.len;
  a[0].mask = 0;
  CHECK_EQ_INT(session_send_answer(&S, "r1", a, 2), -1);
  CHECK_EQ_INT(session_send_answer(&S, "a b", a, 1), -1);
  CHECK_EQ_INT(session_send_answer_pc(&S, "a b"), -1);
  CHECK_EQ_INT(session_send_hold(&S, 0), -1);
  CHECK_EQ_INT(session_send_hold(&S, 301), -1);
  CHECK_EQ_INT(w.len, sent);
  CHECK_EQ_INT(S.state, SESSION_READY);
  // una pregunta mal formada cierra la sesión como cualquier vista inválida
  CHECK(feed_view(&S, &p, vf("mut/question-options-1")->json) != 0 || S.state == SESSION_FAILED);
}

// Fase 2b, paso 1: read -> text. La respuesta va a su propio búfer y no toca la vista ni su contador.
static void test_read_and_text(void) {
  Wire w;
  Peer p;
  handshake(&S, &w, &p);
  CHECK(session_reading(&S) == NULL);
  CHECK_EQ_INT(session_read_seq(&S), 0);
  CHECK_EQ_INT(feed_view(&S, &p, vf("bridge/one-session")->json), 0);
  uint32_t vseq = session_view_seq(&S);

  // pedir: el mensaje sale sellado, con el JSON exacto del protocolo
  size_t before = w.len;
  CHECK_EQ_INT(session_send_read(&S, "s1", READ_MODE_FULL), 0);
  size_t off = before, len = 0;
  uint8_t type = 0;
  const uint8_t *pay = NULL;
  CHECK(wire_next(&w, &off, &type, &pay, &len));
  CHECK_EQ_INT(type, FRAME_JSON);
  uint8_t body[256];
  memcpy(body, pay, len);
  int n = frame_open(&p.opener, type, body, len);
  CHECK_EQ_INT(n, (int)strlen("{\"t\":\"read\",\"sessionId\":\"s1\"}"));
  if (n > 0) CHECK(memcmp(body, "{\"t\":\"read\",\"sessionId\":\"s1\"}", (size_t)n) == 0);
  CHECK_EQ_INT(session_send_read(&S, "id con espacios", READ_MODE_FULL), -1);
  // paso 5: el resumen sale con mode
  before = w.len;
  CHECK_EQ_INT(session_send_read(&S, "s1", READ_MODE_SUMMARY), 0);
  off = before;
  CHECK(wire_next(&w, &off, &type, &pay, &len));
  memcpy(body, pay, len);
  n = frame_open(&p.opener, type, body, len);
  CHECK_EQ_INT(n, (int)strlen("{\"t\":\"read\",\"sessionId\":\"s1\",\"mode\":\"summary\"}"));
  if (n > 0) CHECK(memcmp(body, "{\"t\":\"read\",\"sessionId\":\"s1\",\"mode\":\"summary\"}", (size_t)n) == 0);
  CHECK_EQ_INT(S.state, SESSION_READY); // un argumento inválido no rompe la sesión

  // responder
  const ViewFixture *t = tf("reader/question");
  CHECK_EQ_INT(feed_view(&S, &p, t->json), 0);
  CHECK_EQ_INT(session_read_seq(&S), 1);
  const ReadDoc *d = session_reading(&S);
  CHECK(d != NULL);
  if (d != NULL) {
    CHECK_STR(d->session_id, "s1");
    CHECK(d->line_count > 0 && d->question_count > 0);
  }
  CHECK_EQ_INT(session_view_seq(&S), vseq); // la vista no cambió
  CHECK(session_view(&S) != NULL);

  // el peor caso (cerca de 15 KB) entra entero y se lee
  CHECK_EQ_INT(feed_view(&S, &p, tf("reader/worst-case-accents")->json), 0);
  CHECK_EQ_INT(session_read_seq(&S), 2);
  CHECK(session_reading(&S)->truncated);

  // una vista posterior sigue funcionando
  char json[16384];
  json_with_rev(vf("bridge/one-session")->json, 99, json, sizeof json);
  CHECK_EQ_INT(feed_view(&S, &p, json), 0);
  CHECK(session_view_seq(&S) != vseq);
}

static void test_invalid_text_closes(void) {
  Wire w;
  Peer p;
  handshake(&S, &w, &p);
  CHECK_EQ_INT(feed_view(&S, &p, tf("text-mut/line-49")->json), -1);
  CHECK_EQ_INT(S.state, SESSION_FAILED);
  CHECK_EQ_INT(S.error, SESSION_ERR_VIEW);
  CHECK(session_reading(&S) == NULL);
  handshake(&S, &w, &p);
  CHECK_EQ_INT(feed_view(&S, &p, tf("text-mut/truncated-missing")->json), -1);
  handshake(&S, &w, &p);
  CHECK_EQ_INT(feed_view(&S, &p, tf("text-mut/lines-241")->json), -1);
}

static void test_full_handshake_with_fixtures(void) {
  Wire w;
  Peer p;
  uint8_t buf[512];
  peer_init(&p);
  init_session(&S, &w, p.k);
  CHECK_EQ_INT(S.state, SESSION_WAIT_CHALLENGE);

  size_t n = plain_frame(CHALLENGE, buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), 0);
  CHECK_EQ_INT(S.state, SESSION_WAIT_WELCOME);

  // lo que la consola contestó: un hello con el mac de handshake.json
  size_t off = 0, len = 0;
  uint8_t type = 0;
  const uint8_t *pay = NULL;
  CHECK(wire_next(&w, &off, &type, &pay, &len));
  CHECK_EQ_INT(type, FRAME_JSON);
  char want[400];
  snprintf(want, sizeof want,
           "{\"t\":\"hello\",\"v\":2,\"deviceId\":\"%s\",\"nonceC\":\"%s\",\"mac\":\"%s\"}", HSF_DEVICE_ID,
           HSF_NONCE_C_HEX, HSF_HELLO_MAC_HEX);
  CHECK_EQ_INT(len, strlen(want));
  CHECK(len == strlen(want) && memcmp(pay, want, len) == 0);
  CHECK(!wire_next(&w, &off, &type, &pay, &len)); // y nada más

  n = plain_frame(WELCOME, buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), 0);
  CHECK_EQ_INT(S.state, SESSION_READY);
  CHECK_EQ_INT(S.error, SESSION_ERR_NONE);
  CHECK(session_view(&S) == NULL); // todavía no llegó ninguna vista

  // las dos tramas selladas del puente en handshake.json, byte a byte
  for (int i = 0; i < HSF_BRIDGE_TO_CONSOLE_COUNT; i++) {
    uint8_t frame[256];
    int fl = t_unhex(HSF_BRIDGE_TO_CONSOLE[i].frame_hex, frame, sizeof frame);
    CHECK_EQ_INT(session_on_data(&S, frame, (size_t)fl), 0);
    CHECK_EQ_INT(S.state, SESSION_READY);
  }
  CHECK(strncmp(S.bridge_error, "long-0123456789", 15) == 0); // la tercera trama (varios bloques de ChaCha20), de código largo, se corta al guardarla
  CHECK(session_view(&S) == NULL);

  // consola -> puente: la segunda trama (decision r1 allow, contador 1) coincide con handshake.json
  w.len = 0;
  CHECK_EQ_INT(session_send_focus(&S, "s1"), 0);          // contador 0
  CHECK_EQ_INT(session_send_decision(&S, "r1", 1), 0);    // contador 1
  off = 0;
  CHECK(wire_next(&w, &off, &type, &pay, &len));
  size_t second_start = off;
  CHECK(wire_next(&w, &off, &type, &pay, &len));
  uint8_t frame[256];
  int fl = t_unhex(HSF_CONSOLE_TO_BRIDGE[1].frame_hex, frame, sizeof frame);
  CHECK_EQ_INT(off - second_start, fl);
  CHECK(off - second_start == (size_t)fl && memcmp(w.data + second_start, frame, (size_t)fl) == 0);

  // y el puente las abre con su lado del sello
  off = 0;
  CHECK(wire_next(&w, &off, &type, &pay, &len));
  uint8_t tmp[256];
  memcpy(tmp, pay, len);
  int ol = frame_open(&p.opener, type, tmp, len);
  CHECK(ol > 0);
  CHECK(ol > 0 && memcmp(tmp, "{\"t\":\"focus\",\"sessionId\":\"s1\"}", (size_t)ol) == 0);
}

// El saludo lleva la versión de la app y cómo corre (para que el puente avise de una versión nueva); sin ellos es el de siempre.
static void test_hello_carries_app_info(void) {
  Wire w;
  Peer p;
  uint8_t buf[512];
  peer_init(&p);
  uint8_t nc[16];
  t_unhex(HSF_NONCE_C_HEX, nc, 16);
  memset(&w, 0, sizeof w);
  session_init(&S, HSF_DEVICE_ID, p.k, nc);
  session_set_app(&S, HSF_HELLO_APP_VERSION, 1); // "cia": el mac de handshake.json cubre appVersion e install
  Transport t = {wire_send, &w};
  session_on_connected(&S, t);
  size_t n = plain_frame(CHALLENGE, buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), 0);
  size_t off = 0, len = 0;
  uint8_t type = 0;
  const uint8_t *pay = NULL;
  CHECK(wire_next(&w, &off, &type, &pay, &len));
  char want[400];
  snprintf(want, sizeof want,
           "{\"t\":\"hello\",\"v\":2,\"deviceId\":\"%s\",\"nonceC\":\"%s\",\"mac\":\"%s\",\"appVersion\":\"%s\",\"install\":\"%s\"}",
           HSF_DEVICE_ID, HSF_NONCE_C_HEX, HSF_HELLO_APP_MAC_HEX, HSF_HELLO_APP_VERSION, HSF_HELLO_INSTALL);
  CHECK_EQ_INT(len, strlen(want));
  CHECK(len == strlen(want) && memcmp(pay, want, len) == 0);
  // el saludo con esos campos sigue siendo válido: con el welcome llega a READY
  n = plain_frame(WELCOME, buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), 0);
  CHECK_EQ_INT(S.state, SESSION_READY);
}

static void test_views_and_rev(void) {
  Wire w;
  Peer p;
  handshake(&S, &w, &p);
  const ViewFixture *a = vf("bridge/request-normal"); // rev 3
  CHECK_EQ_INT(feed_view(&S, &p, a->json), 0);
  const View *v = session_view(&S);
  CHECK(v != NULL);
  CHECK_EQ_INT(session_view_seq(&S), 1);
  CHECK_EQ_INT(v->has_request, 1);
  CHECK_EQ_INT(v->request.risk, RISK_NORMAL);
  CHECK_EQ_INT(v->session_count, 1);

  // mismo rev: no se reemplaza
  CHECK_EQ_INT(feed_view(&S, &p, a->json), 0);
  CHECK_EQ_INT(session_view_seq(&S), 1);
  // rev menor con otro contenido: se ignora, sin error
  char buf[FRAME_MAX_PAYLOAD];
  json_with_rev(vf("bridge/empty")->json, 2, buf, sizeof buf);
  CHECK_EQ_INT(feed_view(&S, &p, buf), 0);
  CHECK_EQ_INT(session_view_seq(&S), 1);
  CHECK_EQ_INT(S.state, SESSION_READY);
  CHECK_EQ_INT(session_view(&S)->has_request, 1);
  CHECK_EQ_INT(session_view(&S)->session_count, 1);
  // rev mayor: se reemplaza
  json_with_rev(vf("bridge/empty")->json, 4, buf, sizeof buf);
  CHECK_EQ_INT(feed_view(&S, &p, buf), 0);
  CHECK_EQ_INT(session_view_seq(&S), 2);
  CHECK_EQ_INT(session_view(&S)->has_request, 0);
  CHECK_EQ_INT(session_view(&S)->session_count, 0);
  CHECK(session_view(&S)->rev == 4);

  // la vista más grande (12 sesiones con el texto al máximo) cabe y se lee
  CHECK_EQ_INT(feed_view(&S, &p, vf("bridge/max-text-emoji")->json), 0);
  CHECK_EQ_INT(session_view(&S)->session_count, 12);
  CHECK_EQ_INT(session_view_seq(&S), 3);
}

static void test_first_view_any_rev(void) {
  // la primera vista se acepta aunque su rev sea 0
  Wire w;
  Peer p;
  handshake(&S, &w, &p);
  char buf[FRAME_MAX_PAYLOAD];
  json_with_rev(vf("bridge/empty")->json, 0, buf, sizeof buf);
  CHECK_EQ_INT(feed_view(&S, &p, buf), 0);
  CHECK(session_view(&S) != NULL);
  CHECK_EQ_INT(session_view_seq(&S), 1);
  // y a una reconexión (session_init nuevo) el rev vuelve a empezar
  handshake(&S, &w, &p);
  CHECK(session_view(&S) == NULL);
  CHECK_EQ_INT(session_view_seq(&S), 0);
}

static void test_invalid_view_closes(void) {
  Wire w;
  Peer p;
  handshake(&S, &w, &p);
  CHECK_EQ_INT(feed_view(&S, &p, vf("bridge/one-session")->json), 0);
  CHECK_EQ_INT(session_view(&S)->session_count, 1);
  char good_title[VIEW_TEXT_BYTES];
  strcpy(good_title, session_view(&S)->sessions[0].title);

  // una vista inválida (título de 39) cierra y no pisa la última buena
  const ViewFixture *bad = vf("mut/title-39");
  CHECK_EQ_INT(feed_view(&S, &p, bad->json), -1);
  CHECK_EQ_INT(S.state, SESSION_FAILED);
  CHECK_EQ_INT(S.error, SESSION_ERR_VIEW);
  CHECK_STR(S.view.sessions[0].title, good_title);
  CHECK(session_view(&S) == NULL); // fallida: la app no debe seguir dibujándola
  uint8_t more[4] = {1, 0, 0, 0};
  CHECK_EQ_INT(session_on_data(&S, more, 1), -1);

  // lo mismo con JSON roto y con un mensaje que no es de vista
  const char *junk[] = {"{\"t\":\"view\",\"rev\":9", "[]", "{\"t\":\"select\",\"agentId\":\"s1\"}", "hola", "{\"t\":\"challenge\",\"nonceB\":\"00\"}"};
  for (size_t i = 0; i < sizeof junk / sizeof junk[0]; i++) {
    handshake(&S, &w, &p);
    CHECK_EQ_INT(feed_view(&S, &p, junk[i]), -1);
    CHECK_EQ_INT(S.error, SESSION_ERR_VIEW);
  }
}

static void test_bridge_error_message_after_handshake(void) {
  Wire w;
  Peer p;
  handshake(&S, &w, &p);
  CHECK_EQ_INT(feed_view(&S, &p, "{\"t\":\"error\",\"code\":\"overload\"}"), 0);
  CHECK_EQ_INT(S.state, SESSION_READY);
  CHECK_STR(S.bridge_error, "overload");
}

static void test_wrong_key(void) {
  Wire w;
  Peer p;
  uint8_t buf[512];
  peer_init(&p);
  uint8_t wrong[32];
  memcpy(wrong, p.k, 32);
  wrong[5] ^= 0x40;
  init_session(&S, &w, wrong);
  size_t n = plain_frame(CHALLENGE, buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), 0);
  // el hello sale con un mac distinto del esperado
  size_t off = 0, len = 0;
  uint8_t type;
  const uint8_t *pay;
  CHECK(wire_next(&w, &off, &type, &pay, &len));
  CHECK(len > 0 && memmem(pay, len, HSF_HELLO_MAC_HEX, 64) == NULL);
  // el puente responde error auth y cierra
  n = plain_frame("{\"t\":\"error\",\"code\":\"auth\"}", buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), -1);
  CHECK_EQ_INT(S.state, SESSION_FAILED);
  CHECK_EQ_INT(S.error, SESSION_ERR_AUTH);
  CHECK_STR(session_error_name(S.error), "auth");

  // un puente que no conoce la clave contesta welcome con otro mac: también auth
  init_session(&S, &w, wrong);
  n = plain_frame(CHALLENGE, buf, sizeof buf);
  session_on_data(&S, buf, n);
  n = plain_frame(WELCOME, buf, sizeof buf); // el mac de la clave buena no sirve para la mala
  CHECK_EQ_INT(session_on_data(&S, buf, n), -1);
  CHECK_EQ_INT(S.error, SESSION_ERR_AUTH);

  // un welcome con un solo bit cambiado
  Peer q;
  peer_init(&q);
  init_session(&S, &w, q.k);
  n = plain_frame(CHALLENGE, buf, sizeof buf);
  session_on_data(&S, buf, n);
  char bad[200];
  snprintf(bad, sizeof bad, "{\"t\":\"welcome\",\"mac\":\"%s\"}", HSF_WELCOME_MAC_HEX);
  bad[strlen(bad) - 5] = bad[strlen(bad) - 5] == '0' ? '1' : '0';
  n = plain_frame(bad, buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), -1);
  CHECK_EQ_INT(S.error, SESSION_ERR_AUTH);

  // otro código de error en el saludo no es auth
  init_session(&S, &w, q.k);
  n = plain_frame("{\"t\":\"error\",\"code\":\"busy\"}", buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), -1);
  CHECK_EQ_INT(S.error, SESSION_ERR_PROTOCOL);
}

// Un impostor que contesta {"t":"error","code":"auth"} sin autenticar: en cualquier punto del saludo es
// SESSION_ERR_AUTH (la app lo cuenta por host y no deja de reintentar por eso solo; ver test_netplan.c).
static void test_error_auth_before_and_after_challenge(void) {
  Wire w;
  Peer p;
  uint8_t buf[512];
  peer_init(&p);
  const char *auth = "{\"t\":\"error\",\"code\":\"auth\"}";

  // antes del challenge
  init_session(&S, &w, p.k);
  CHECK_EQ_INT(S.state, SESSION_WAIT_CHALLENGE);
  size_t n = plain_frame(auth, buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), -1);
  CHECK_EQ_INT(S.state, SESSION_FAILED);
  CHECK_EQ_INT(S.error, SESSION_ERR_AUTH);
  CHECK_EQ_INT(w.len, 0); // no llegó a enviar nada

  // después del challenge (el hello ya salió)
  init_session(&S, &w, p.k);
  n = plain_frame(CHALLENGE, buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), 0);
  CHECK_EQ_INT(S.state, SESSION_WAIT_WELCOME);
  CHECK(w.len > 0);
  n = plain_frame(auth, buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), -1);
  CHECK_EQ_INT(S.state, SESSION_FAILED);
  CHECK_EQ_INT(S.error, SESSION_ERR_AUTH);
  CHECK_EQ_INT(session_send_ping(&S), -1); // fallida: ya no envía

  // llega partido en trozos de un byte
  init_session(&S, &w, p.k);
  n = plain_frame(auth, buf, sizeof buf);
  int r = 0;
  for (size_t i = 0; i < n && r == 0; i++) r = session_on_data(&S, buf + i, 1);
  CHECK_EQ_INT(r, -1);
  CHECK_EQ_INT(S.error, SESSION_ERR_AUTH);

  // el estado de la sesión tiene nombre (diagnóstico)
  CHECK_STR(session_state_name(SESSION_IDLE), "IDLE");
  CHECK_STR(session_state_name(SESSION_WAIT_CHALLENGE), "WAIT_CHALLENGE");
  CHECK_STR(session_state_name(SESSION_WAIT_WELCOME), "WAIT_WELCOME");
  CHECK_STR(session_state_name(SESSION_READY), "READY");
  CHECK_STR(session_state_name(SESSION_FAILED), "FAILED");
}

static void test_unexpected_before_handshake(void) {
  Wire w;
  Peer p;
  uint8_t buf[2048];
  peer_init(&p);
  const char *msgs[] = {
      "{\"t\":\"view\",\"rev\":1,\"view\":{}}",
      "{\"t\":\"welcome\",\"mac\":\"" HSF_WELCOME_MAC_HEX "\"}", // welcome antes del challenge
      "{\"t\":\"hello\"}",
      "{\"t\":\"challenge\",\"v\":2,\"nonceB\":\"" HSF_NONCE_B_HEX "\"}",
      "{\"t\":\"challenge\",\"nonceB\":\"00\"}",
      "basura",
      "",
  };
  for (size_t i = 0; i < sizeof msgs / sizeof msgs[0]; i++) {
    init_session(&S, &w, p.k);
    size_t n = plain_frame(msgs[i], buf, sizeof buf);
    CHECK_MSG(session_on_data(&S, buf, n) == -1, "mensaje %zu aceptado antes del saludo", i);
    CHECK_EQ_INT(S.state, SESSION_FAILED);
    CHECK_EQ_INT(S.error, SESSION_ERR_PROTOCOL);
  }
  // un segundo challenge cuando ya se espera el welcome
  init_session(&S, &w, p.k);
  size_t n = plain_frame(CHALLENGE, buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), 0);
  CHECK_EQ_INT(session_on_data(&S, buf, n), -1);
  CHECK_EQ_INT(S.error, SESSION_ERR_PROTOCOL);
  // una trama que no es JSON antes del saludo (PING, PONG, AUDIO, tipo desconocido)
  for (int type = 0; type < 8; type++) {
    if (type == FRAME_JSON) continue;
    init_session(&S, &w, p.k);
    int fl = frame_encode((uint8_t)type, (const uint8_t *)"x", 1, buf, sizeof buf);
    CHECK_EQ_INT(session_on_data(&S, buf, (size_t)fl), -1);
    CHECK_EQ_INT(S.error, SESSION_ERR_PROTOCOL);
  }
  // un mensaje sellado antes del saludo
  init_session(&S, &w, p.k);
  uint8_t frame[256];
  int fl = t_unhex(HSF_BRIDGE_TO_CONSOLE[0].frame_hex, frame, sizeof frame);
  CHECK_EQ_INT(session_on_data(&S, frame, (size_t)fl), -1);
  CHECK_EQ_INT(S.error, SESSION_ERR_PROTOCOL);
}

static void test_sealed_failures(void) {
  Wire w;
  Peer p;
  uint8_t buf[2048], copy[2048];
  const char *view = vf("bridge/one-session")->json;

  // trama repetida
  handshake(&S, &w, &p);
  size_t n = sealed_frame(&p, FRAME_JSON, view, buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), 0);
  CHECK_EQ_INT(session_on_data(&S, buf, n), -1);
  CHECK_EQ_INT(S.error, SESSION_ERR_TAG);

  // un bit alterado en el contenido y en la etiqueta
  for (size_t pos = FRAME_HEADER_LEN; pos < n; pos += 17) {
    handshake(&S, &w, &p);
    n = sealed_frame(&p, FRAME_JSON, view, buf, sizeof buf);
    memcpy(copy, buf, n);
    copy[pos] ^= 0x01;
    CHECK_EQ_INT(session_on_data(&S, copy, n), -1);
    CHECK_EQ_INT(S.error, SESSION_ERR_TAG);
  }
  handshake(&S, &w, &p);
  n = sealed_frame(&p, FRAME_JSON, view, buf, sizeof buf);
  memcpy(copy, buf, n);
  copy[n - 1] ^= 0x80;
  CHECK_EQ_INT(session_on_data(&S, copy, n), -1);
  CHECK_EQ_INT(S.error, SESSION_ERR_TAG);

  // dirección equivocada (sellada como consola -> puente)
  handshake(&S, &w, &p);
  FrameSealer wrong;
  frame_sealer_init(&wrong, p.ks, FRAME_DIR_CONSOLE_TO_BRIDGE);
  int fl = frame_seal(&wrong, FRAME_JSON, (const uint8_t *)view, strlen(view), buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, (size_t)fl), -1);
  CHECK_EQ_INT(S.error, SESSION_ERR_TAG);

  // sin sellar (JSON plano después del saludo)
  handshake(&S, &w, &p);
  n = plain_frame(view, buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), -1);
  CHECK_EQ_INT(S.error, SESSION_ERR_TAG);

  // contador saltado (se perdió una trama)
  handshake(&S, &w, &p);
  p.sealer.counter = 1;
  n = sealed_frame(&p, FRAME_JSON, view, buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), -1);
  CHECK_EQ_INT(S.error, SESSION_ERR_TAG);

  // más corta que la etiqueta
  handshake(&S, &w, &p);
  fl = frame_encode(FRAME_JSON, (const uint8_t *)"0123456789", 10, buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, (size_t)fl), -1);
  CHECK_EQ_INT(S.error, SESSION_ERR_TAG);
}

static void test_frame_types_after_handshake(void) {
  Wire w;
  Peer p;
  uint8_t buf[512];
  handshake(&S, &w, &p);
  // PONG, PING y AUDIO ya autenticados se aceptan y se ignoran
  size_t n = sealed_frame(&p, FRAME_PONG, "", buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), 0);
  n = sealed_frame(&p, FRAME_PONG, "12345678", buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), 0);
  n = sealed_frame(&p, FRAME_AUDIO, "abc", buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), 0);
  n = sealed_frame(&p, FRAME_PING, "", buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), 0);
  CHECK_EQ_INT(S.state, SESSION_READY);
  // tipo desconocido (bien sellado)
  n = sealed_frame(&p, 9, "x", buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), -1);
  CHECK_EQ_INT(S.error, SESSION_ERR_PROTOCOL);
}

static void test_frame_too_long(void) {
  Wire w;
  Peer p;
  handshake(&S, &w, &p);
  uint8_t hdr[3] = {FRAME_JSON, 0x01, 0x40}; // 16385
  CHECK_EQ_INT(session_on_data(&S, hdr, 3), -1);
  CHECK_EQ_INT(S.error, SESSION_ERR_FRAME);
  // también antes del saludo
  peer_init(&p);
  init_session(&S, &w, p.k);
  CHECK_EQ_INT(session_on_data(&S, hdr, 3), -1);
  CHECK_EQ_INT(S.error, SESSION_ERR_FRAME);
  // la cabecera partida en pedazos
  init_session(&S, &w, p.k);
  uint8_t huge[3] = {FRAME_JSON, 0xff, 0xff};
  CHECK_EQ_INT(session_on_data(&S, huge, 1), 0);
  CHECK_EQ_INT(session_on_data(&S, huge + 1, 1), 0);
  CHECK_EQ_INT(session_on_data(&S, huge + 2, 1), -1);
  CHECK_EQ_INT(S.error, SESSION_ERR_FRAME);
}

static void test_fragmentation(void) {
  // el saludo y varias vistas, alimentados con trozos de 1, 2, 5 y 1000 bytes: mismo resultado
  size_t chunks[] = {1, 2, 5, 37, 1000};
  for (size_t c = 0; c < sizeof chunks / sizeof chunks[0]; c++) {
    Wire w;
    Peer p;
    peer_init(&p);
    init_session(&S, &w, p.k);
    static uint8_t stream[FRAME_HEADER_LEN * 8 + 20000];
    size_t n = 0;
    n += plain_frame(CHALLENGE, stream + n, sizeof stream - n);
    n += plain_frame(WELCOME, stream + n, sizeof stream - n);
    // el puente solo manda las vistas tras el saludo, pero llegan juntas en el mismo flujo
    n += sealed_frame(&p, FRAME_JSON, vf("bridge/one-session")->json, stream + n, sizeof stream - n);
    n += sealed_frame(&p, FRAME_PONG, "", stream + n, sizeof stream - n);
    n += sealed_frame(&p, FRAME_JSON, vf("bridge/request-high")->json, stream + n, sizeof stream - n);
    n += sealed_frame(&p, FRAME_JSON, vf("bridge/detail-open")->json, stream + n, sizeof stream - n);
    for (size_t off = 0; off < n; off += chunks[c]) {
      size_t l = n - off < chunks[c] ? n - off : chunks[c];
      CHECK_EQ_INT(session_on_data(&S, stream + off, l), 0);
    }
    CHECK_EQ_INT(S.state, SESSION_READY);
    CHECK_EQ_INT(session_view_seq(&S), 3);
    CHECK_EQ_INT(session_view(&S)->has_detail, 1);
    CHECK_EQ_INT(session_view(&S)->rev, 6);
  }
}

static void test_send_side(void) {
  Wire w;
  Peer p;
  // antes del saludo no se envía nada
  peer_init(&p);
  init_session(&S, &w, p.k);
  w.len = 0;
  CHECK_EQ_INT(session_send_skip(&S), -1);
  CHECK_EQ_INT(session_send_decision(&S, "r1", 1), -1);
  CHECK_EQ_INT(session_send_ping(&S), -1);
  CHECK_EQ_INT(w.len, 0);
  CHECK_EQ_INT(S.state, SESSION_WAIT_CHALLENGE);

  handshake(&S, &w, &p);
  w.len = 0;
  CHECK_EQ_INT(session_send_decision(&S, "r1", 1), 0);
  CHECK_EQ_INT(session_send_decision(&S, "r2", 0), 0);
  CHECK_EQ_INT(session_send_focus(&S, "s2"), 0);
  CHECK_EQ_INT(session_send_focus(&S, NULL), 0);
  CHECK_EQ_INT(session_send_skip(&S), 0);
  CHECK_EQ_INT(session_send_mode(&S, 1), 0);
  CHECK_EQ_INT(session_send_mode(&S, 0), 0);
  CHECK_EQ_INT(session_send_ping(&S), 0);
  const char *want[] = {
      "{\"t\":\"decision\",\"requestId\":\"r1\",\"decision\":\"allow\"}",
      "{\"t\":\"decision\",\"requestId\":\"r2\",\"decision\":\"deny\"}",
      "{\"t\":\"focus\",\"sessionId\":\"s2\"}",
      "{\"t\":\"focus\",\"sessionId\":null}",
      "{\"t\":\"skip\"}",
      "{\"t\":\"mode\",\"mode\":\"manual\"}",
      "{\"t\":\"mode\",\"mode\":\"queue\"}",
      "",
  };
  size_t off = 0, len = 0;
  uint8_t type;
  const uint8_t *pay;
  for (int i = 0; i < 8; i++) {
    CHECK(wire_next(&w, &off, &type, &pay, &len));
    CHECK_EQ_INT(type, i == 7 ? FRAME_PING : FRAME_JSON);
    uint8_t tmp[300];
    memcpy(tmp, pay, len);
    int ol = frame_open(&p.opener, type, tmp, len); // los contadores van 0, 1, 2...
    CHECK_EQ_INT(ol, strlen(want[i]));
    CHECK(ol >= 0 && memcmp(tmp, want[i], (size_t)ol) == 0);
  }
  CHECK(!wire_next(&w, &off, &type, &pay, &len));

  // argumentos inválidos: no se envía nada y la sesión sigue lista
  w.len = 0;
  CHECK_EQ_INT(session_send_decision(&S, "a b", 1), -1);
  CHECK_EQ_INT(session_send_decision(&S, "", 1), -1);
  CHECK_EQ_INT(session_send_decision(&S, NULL, 1), -1);
  CHECK_EQ_INT(session_send_focus(&S, "a\"b"), -1);
  CHECK_EQ_INT(w.len, 0);
  CHECK_EQ_INT(S.state, SESSION_READY);
  CHECK_EQ_INT(session_send_skip(&S), 0); // y el contador no se gastó en vano
  off = 0;
  wire_next(&w, &off, &type, &pay, &len);
  uint8_t tmp[300];
  memcpy(tmp, pay, len);
  CHECK(frame_open(&p.opener, type, tmp, len) > 0);

  // fallo del transporte al enviar: la sesión se cierra
  w.fail = 1;
  CHECK_EQ_INT(session_send_decision(&S, "r9", 1), -1);
  CHECK_EQ_INT(S.state, SESSION_FAILED);
  CHECK_EQ_INT(S.error, SESSION_ERR_SEND);

  // fallo del transporte al enviar el hello
  peer_init(&p);
  init_session(&S, &w, p.k);
  w.fail = 1;
  uint8_t buf[512];
  size_t n = plain_frame(CHALLENGE, buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), -1);
  CHECK_EQ_INT(S.error, SESSION_ERR_SEND);
}

static void test_init_errors(void) {
  Wire w;
  uint8_t key[32] = {0}, nc[16] = {0};
  session_init(&S, "id con espacio", key, nc);
  CHECK_EQ_INT(S.state, SESSION_FAILED);
  CHECK_EQ_INT(S.error, SESSION_ERR_BAD_ARG);
  session_init(&S, "", key, nc);
  CHECK_EQ_INT(S.error, SESSION_ERR_BAD_ARG);
  char id65[66];
  memset(id65, 'a', 65);
  id65[65] = 0;
  session_init(&S, id65, key, nc);
  CHECK_EQ_INT(S.error, SESSION_ERR_BAD_ARG);
  session_init(&S, id65 + 1, key, nc); // 64 caracteres
  CHECK_EQ_INT(S.state, SESSION_IDLE);
  // transporte sin función de envío
  Transport t = {NULL, &w};
  session_on_connected(&S, t);
  CHECK_EQ_INT(S.state, SESSION_FAILED);
  CHECK_EQ_INT(S.error, SESSION_ERR_BAD_ARG);
  // datos sin conexión
  session_init(&S, "dev", key, nc);
  uint8_t x = 1;
  CHECK_EQ_INT(session_on_data(&S, &x, 1), -1);
  CHECK_STR(session_error_name(SESSION_ERR_VIEW), "view");
  CHECK_STR(session_error_name(SESSION_ERR_FRAME), "frame");
}

// Protocolo v2: esta consola nunca baja a la v1. Un welcome calculado a la manera de la v1 (el de una versión forzada) o una trama en
// claro con etiqueta de la v1, aunque sea de un puente que tenga la clave, no se aceptan.
static void test_no_downgrade_to_v1(void) {
  // los valores de la v1 de siempre (K, nonces y ids son los mismos del fixture): welcome v1 y una trama v1 (en claro + etiqueta)
  static const char V1_WELCOME[] =
      "{\"t\":\"welcome\",\"mac\":\"56916d4538a873a1a0c6391fc5a0d8457864af423c20500a4d6da8c040406d3d\"}";
  static const char V1_KS_HEX[] = "79777eef668dce67a9a8c05d049eb00ce86ffb1651bb0dd01283b584326bcec0";
  static const char V1_FRAME_HEX[] =
      "012d007b2274223a226572726f72222c22636f6465223a22746573742d30227dc8b973ff1fa5eb94501e559fb80a83b7";
  Wire w;
  Peer p;
  uint8_t buf[512];
  peer_init(&p);
  init_session(&S, &w, p.k);
  size_t n = plain_frame(CHALLENGE, buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), 0);
  CHECK_EQ_INT(HS_PROTOCOL_VERSION, 2);
  // el hello que sale anuncia v:2 (y su mac es el de la v2, no el de la v1)
  size_t off = 0, len = 0;
  uint8_t type = 0;
  const uint8_t *pay = NULL;
  CHECK(wire_next(&w, &off, &type, &pay, &len));
  CHECK(memmem(pay, len, "\"v\":2", 5) != NULL);
  CHECK(memmem(pay, len, "5219ebb92a9bddb404b1e571baac4f6c2d7657ed39ac475b2bc188445c09b6a9", 64) == NULL); // mac del hello v1
  // un puente que contesta con el welcome de la v1 falla la autenticación
  n = plain_frame(V1_WELCOME, buf, sizeof buf);
  CHECK_EQ_INT(session_on_data(&S, buf, n), -1);
  CHECK_EQ_INT(S.state, SESSION_FAILED);
  CHECK_EQ_INT(S.error, SESSION_ERR_AUTH);

  // con el saludo v2 hecho, una trama de la v1 (contenido en claro) no pasa aunque la etiqueta sea la de la clave de sesión de la v1
  handshake(&S, &w, &p);
  uint8_t frame[128], ks1[32];
  int fl = t_unhex(V1_FRAME_HEX, frame, sizeof frame);
  CHECK(fl > 0);
  CHECK_EQ_INT(t_unhex(V1_KS_HEX, ks1, 32), 32);
  CHECK_EQ_INT(session_on_data(&S, frame, (size_t)fl), -1);
  CHECK_EQ_INT(S.error, SESSION_ERR_TAG);
  // y la clave de sesión de la v2 no es la de la v1
  CHECK(memcmp(p.ks, ks1, 32) != 0);
}

int main(void) {
  TEST_BEGIN("session: saludo, sellado y vistas contra un puente simulado");
  printf("  sizeof(Session) = %zu, sizeof(View) = %zu\n", sizeof(Session), sizeof(View));
  RUN(test_full_handshake_with_fixtures);
  RUN(test_hello_carries_app_info);
  RUN(test_views_and_rev);
  RUN(test_first_view_any_rev);
  RUN(test_invalid_view_closes);
  RUN(test_bridge_error_message_after_handshake);
  RUN(test_wrong_key);
  RUN(test_error_auth_before_and_after_challenge);
  RUN(test_unexpected_before_handshake);
  RUN(test_read_and_text);
  RUN(test_notice_view_and_messages);
  RUN(test_question_view_and_messages);
  RUN(test_instruction_view_and_messages);
  RUN(test_invalid_text_closes);
  RUN(test_sealed_failures);
  RUN(test_frame_types_after_handshake);
  RUN(test_frame_too_long);
  RUN(test_fragmentation);
  RUN(test_send_side);
  RUN(test_init_errors);
  RUN(test_no_downgrade_to_v1);
  TEST_END();
}

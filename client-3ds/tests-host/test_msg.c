#include "test.h"

#include "../source/core/msg.h"
#include "../source/core/view.h"
#include "fixtures/views_fixture.h"

static Guard OUT;

static const char *console_fixture(const char *name) {
  for (int i = 0; i < CONSOLE_FIXTURE_COUNT; i++) {
    if (strcmp(CONSOLE_FIXTURES[i].name, name) == 0) return CONSOLE_FIXTURES[i].json;
  }
  return NULL;
}

static void test_exact_messages(void) {
  char out[MSG_MAX_LEN];
  // byte a byte lo mismo que JSON.stringify de los ejemplos válidos del protocolo
  const char *want = console_fixture("console-decision");
  CHECK(want != NULL);
  int n = msg_decision(out, sizeof out, "r1", 1);
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);

  // "sí, no volver a preguntar": allow == 2
  want = console_fixture("console-decision-always");
  CHECK(want != NULL);
  n = msg_decision(out, sizeof out, "r1", 2);
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);

  want = console_fixture("console-focus");
  n = msg_focus(out, sizeof out, "s2");
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);

  want = console_fixture("console-focus-null");
  n = msg_focus(out, sizeof out, NULL);
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);

  want = console_fixture("console-skip");
  n = msg_skip(out, sizeof out);
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);

  want = console_fixture("console-mode");
  n = msg_mode(out, sizeof out, 1);
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);

  // Fase 2b, paso 1: pedir el mensaje completo de una sesión
  want = console_fixture("console-read");
  CHECK(want != NULL);
  n = msg_read(out, sizeof out, "s2", READ_MODE_FULL);
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);
  CHECK_EQ_INT(msg_read(out, sizeof out, NULL, READ_MODE_FULL), -1);
  CHECK_EQ_INT(msg_read(out, sizeof out, "", READ_MODE_FULL), -1);
  CHECK_EQ_INT(msg_read(out, sizeof out, "a b", READ_MODE_FULL), -1);
  CHECK_EQ_INT(msg_read(out, 10, "s2", READ_MODE_FULL), -1); // no cabe

  // paso 5: el resumen se pide con mode; un modo desconocido no sale
  want = console_fixture("console-read-summary");
  CHECK(want != NULL);
  n = msg_read(out, sizeof out, "s2", READ_MODE_SUMMARY);
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);
  CHECK_EQ_INT(msg_read(out, sizeof out, "s2", 2), -1);
  CHECK_EQ_INT(msg_read(out, sizeof out, "s2", -1), -1);
  CHECK_EQ_INT(msg_read(out, 20, "s2", READ_MODE_SUMMARY), -1); // no cabe
  want = console_fixture("console-setting-reader-default");
  CHECK(want != NULL);
  n = msg_setting_reader_default(out, sizeof out, 1);
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);
  CHECK_EQ_INT(msg_setting_reader_default(out, sizeof out, 0) > 0, 1);
  CHECK_STR(out, "{\"t\":\"setting\",\"key\":\"readerDefault\",\"value\":\"full\"}");
  CHECK_EQ_INT(msg_setting_reader_default(out, sizeof out, 2), -1);
  CHECK_EQ_INT(msg_setting_reader_default(out, 10, 1), -1);
  char rid48[49];
  memset(rid48, 'a', 48);
  rid48[48] = 0;
  CHECK(msg_read(out, sizeof out, rid48, READ_MODE_FULL) > 0);
  CHECK(msg_read(out, sizeof out, rid48, READ_MODE_SUMMARY) > 0);
  CHECK(strlen(out) <= MSG_MAX_LEN - 1);

  // Fase 2b, paso 2: ajustes del puente
  want = console_fixture("console-setting-notify-default");
  CHECK(want != NULL);
  n = msg_setting_notify_default(out, sizeof out, 3);
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);
  CHECK_EQ_INT(msg_setting_notify_default(out, sizeof out, 4), -1);
  CHECK_EQ_INT(msg_setting_notify_default(out, sizeof out, -1), -1);
  CHECK_EQ_INT(msg_setting_notify_default(out, 10, 0), -1); // no cabe
  CHECK_STR(msg_setting_notify_default(out, sizeof out, 1) > 0 ? out : "", "{\"t\":\"setting\",\"key\":\"notifyDefault\",\"value\":\"important\"}");
  want = console_fixture("console-setting-notify-ack");
  CHECK(want != NULL);
  n = msg_setting_notify_ack(out, sizeof out, 0);
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);
  CHECK_STR(msg_setting_notify_ack(out, sizeof out, 1) > 0 ? out : "", "{\"t\":\"setting\",\"key\":\"notifyAck\",\"value\":true}");
  want = console_fixture("console-setting-sound");
  CHECK(want != NULL);
  n = msg_setting_sound(out, sizeof out, 0);
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);
  CHECK_STR(msg_setting_sound(out, sizeof out, 1) > 0 ? out : "", "{\"t\":\"setting\",\"key\":\"sound\",\"value\":true}");
  CHECK_EQ_INT(msg_setting_sound(out, 10, 1), -1);
  want = console_fixture("console-setting-hidden-agents");
  CHECK(want != NULL);
  n = msg_setting_hidden_agents(out, sizeof out, (1u << AGENT_GEMINI) | (1u << AGENT_HERMES)); // se escriben en orden de cuadrícula
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);
  want = console_fixture("console-setting-hidden-agents-empty");
  CHECK(want != NULL);
  n = msg_setting_hidden_agents(out, sizeof out, 0);
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);
  n = msg_setting_hidden_agents(out, sizeof out, 0x1fu);
  CHECK(n > 0 && n < MSG_MAX_LEN);
  CHECK_STR(out, "{\"t\":\"setting\",\"key\":\"hiddenAgents\",\"value\":[\"claude\",\"gemini\",\"codex\",\"cursor\",\"hermes\"]}");

  // Fase 2b, paso 3: "Visto", pasar de aviso y el modo de aviso de una sesión, byte a byte como los ejemplos del protocolo
  want = console_fixture("console-ack");
  CHECK(want != NULL);
  n = msg_ack(out, sizeof out, "n1");
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);
  want = console_fixture("console-skip-notice");
  CHECK(want != NULL);
  n = msg_skip_notice(out, sizeof out);
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);
  want = console_fixture("console-setting-session-notify");
  CHECK(want != NULL);
  n = msg_setting_session_notify(out, sizeof out, "s1", 2);
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);

  // Fase 2b, paso 4: preguntas con alternativas, byte a byte como los ejemplos del protocolo
  want = console_fixture("console-setting-questions");
  CHECK(want != NULL);
  n = msg_setting_questions(out, sizeof out, 0);
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);
  CHECK_STR(msg_setting_questions(out, sizeof out, 1) > 0 ? out : "", "{\"t\":\"setting\",\"key\":\"questions\",\"value\":true}");
  CHECK_EQ_INT(msg_setting_questions(out, 10, 1), -1);
  want = console_fixture("console-answer-pc");
  CHECK(want != NULL);
  n = msg_answer_pc(out, sizeof out, "r1");
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);
  CHECK_EQ_INT(msg_answer_pc(out, sizeof out, NULL), -1);
  CHECK_EQ_INT(msg_answer_pc(out, sizeof out, "a b"), -1);
  want = console_fixture("console-hold");
  CHECK(want != NULL);
  n = msg_hold(out, sizeof out, 300);
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);
  CHECK_STR(msg_hold(out, sizeof out, 7) > 0 ? out : "", "{\"t\":\"hold\",\"seconds\":7}");
  CHECK_EQ_INT(msg_hold(out, sizeof out, 0), -1);
  CHECK_EQ_INT(msg_hold(out, sizeof out, 301), -1);
  CHECK_EQ_INT(msg_hold(out, sizeof out, -5), -1);
  CHECK_EQ_INT(msg_hold(out, 12, 300), -1); // no cabe

  // las variantes que no tienen ejemplo propio
  CHECK_EQ_INT(msg_decision(out, sizeof out, "r1", 0), (int)strlen("{\"t\":\"decision\",\"requestId\":\"r1\",\"decision\":\"deny\"}"));
  CHECK_STR(out, "{\"t\":\"decision\",\"requestId\":\"r1\",\"decision\":\"deny\"}");
  CHECK_EQ_INT(msg_mode(out, sizeof out, 0), (int)strlen("{\"t\":\"mode\",\"mode\":\"queue\"}"));
  CHECK_STR(out, "{\"t\":\"mode\",\"mode\":\"queue\"}");
}

static void set_other(MsgAnswer *a, const char *text) {
  memset(a, 0, sizeof *a);
  a->is_other = 1;
  snprintf(a->other, sizeof a->other, "%s", text);
}

static void set_choose(MsgAnswer *a, unsigned mask) {
  memset(a, 0, sizeof *a);
  a->mask = mask;
}

// msg_answer: índices en orden, "Otra" con los escapes de JSON, y los límites (cantidad, índices, largo, UTF-8, búfer).
static void test_answer(void) {
  static char out[MSG_ANSWER_MAX];
  MsgAnswer a[MSG_MAX_QUESTIONS];
  // el ejemplo del protocolo: una opción, dos opciones y un texto con ñ
  const char *want = console_fixture("console-answer-choose");
  CHECK(want != NULL);
  set_choose(&a[0], 1u << 0);
  set_choose(&a[1], (1u << 0) | (1u << 1));
  set_other(&a[2], "otro fondo con \xc3\xb1");
  int n = msg_answer(out, sizeof out, "r1", a, 3);
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);

  // los índices salen en orden ascendente y sin repetir, sea cual sea el orden en que se marcaron
  set_choose(&a[0], (1u << 3) | (1u << 1));
  CHECK_EQ_INT(msg_answer(out, sizeof out, "r1", a, 1), (int)strlen("{\"t\":\"answer\",\"requestId\":\"r1\",\"answers\":[{\"choose\":[1,3]}]}"));
  CHECK_STR(out, "{\"t\":\"answer\",\"requestId\":\"r1\",\"answers\":[{\"choose\":[1,3]}]}");

  // escapes: comillas, barra invertida, controles; UTF-8 pasa tal cual
  set_other(&a[0], "di \"hola\" a\\b\tc\x01 ñ😀");
  n = msg_answer(out, sizeof out, "r1", a, 1);
  CHECK(n > 0);
  CHECK_STR(out, "{\"t\":\"answer\",\"requestId\":\"r1\",\"answers\":[{\"other\":\"di \\\"hola\\\" a\\\\b\\u0009c\\u0001 ñ😀\"}]}");

  // límites: cantidad de respuestas, mascaras vacías o fuera de rango, texto vacío, ids
  CHECK_EQ_INT(msg_answer(out, sizeof out, "r1", a, 0), -1);
  CHECK_EQ_INT(msg_answer(out, sizeof out, "r1", a, MSG_MAX_QUESTIONS + 1), -1);
  CHECK_EQ_INT(msg_answer(out, sizeof out, "r1", NULL, 1), -1);
  set_choose(&a[0], 0);
  CHECK_EQ_INT(msg_answer(out, sizeof out, "r1", a, 1), -1);
  set_choose(&a[0], 1u << 4);
  CHECK_EQ_INT(msg_answer(out, sizeof out, "r1", a, 1), -1);
  set_choose(&a[0], 1u << 0);
  CHECK_EQ_INT(msg_answer(out, sizeof out, NULL, a, 1), -1);
  CHECK_EQ_INT(msg_answer(out, sizeof out, "a b", a, 1), -1);
  set_other(&a[0], "");
  CHECK_EQ_INT(msg_answer(out, sizeof out, "r1", a, 1), -1);
  CHECK_EQ_INT(out[0], 0);

  // 200 caracteres sí, 201 no (cuenta caracteres, no bytes)
  char text[MSG_OTHER_BYTES];
  memset(text, 'x', 200);
  text[200] = 0;
  set_other(&a[0], text);
  CHECK(msg_answer(out, sizeof out, "r1", a, 1) > 0);
  text[200] = 'x';
  text[201] = 0;
  set_other(&a[0], text);
  CHECK_EQ_INT(msg_answer(out, sizeof out, "r1", a, 1), -1);
  for (int i = 0; i < 200; i++) memcpy(text + i * 3, "\xe2\x82\xac", 3); // 200 euros: 600 bytes
  text[600] = 0;
  set_other(&a[0], text);
  CHECK(msg_answer(out, sizeof out, "r1", a, 1) > 0);
  for (int i = 0; i < 200; i++) memcpy(text + i * 4, "\xf0\x9f\x98\x80", 4); // 200 emoji: 800 bytes
  text[800] = 0;
  set_other(&a[0], text);
  CHECK(msg_answer(out, sizeof out, "r1", a, 1) > 0);

  // UTF-8 inválido: cortado, continuación suelta, sobrelargo, sustituto, más allá de U+10FFFF
  const char *bad[] = {"\xc3", "\x80", "\xc0\x80", "\xed\xa0\x80", "\xf4\x90\x80\x80", "\xe2\x82", "a\xff" "b", "\xf8\x88\x80\x80\x80"};
  for (size_t i = 0; i < sizeof bad / sizeof bad[0]; i++) {
    set_other(&a[0], bad[i]);
    CHECK_MSG(msg_answer(out, sizeof out, "r1", a, 1) == -1, "texto %zu", i);
  }

  // el peor caso (4 textos de 200 caracteres de control, que salen como \u00XX) cabe en MSG_ANSWER_MAX
  char worst[MSG_OTHER_BYTES];
  memset(worst, 0x01, 200);
  worst[200] = 0;
  for (int i = 0; i < MSG_MAX_QUESTIONS; i++) set_other(&a[i], worst);
  char id48[49];
  memset(id48, 'a', 48);
  id48[48] = 0;
  n = msg_answer(out, sizeof out, id48, a, MSG_MAX_QUESTIONS);
  CHECK(n > 0 && n < MSG_ANSWER_MAX);
  // no cabe en un búfer más chico: se rechaza sin escribir fuera
  for (size_t cap = 0; cap < 40; cap++) {
    char *g = (char *)guard_at_end(&OUT, cap);
    CHECK_EQ_INT(msg_answer(g, cap, "r1", a, 1), -1);
    if (cap > 0) CHECK_EQ_INT(g[0], 0);
  }
  char small[100];
  CHECK_EQ_INT(msg_answer(small, sizeof small, "r1", a, 1), -1);
  CHECK_EQ_INT(small[0], 0);
}

static void test_ids_and_caps(void) {
  char out[MSG_MAX_LEN];
  char id48[49], id49[50];
  memset(id48, 'a', 48);
  id48[48] = 0;
  memset(id49, 'a', 49);
  id49[49] = 0;
  CHECK(msg_decision(out, sizeof out, id48, 1) > 0);
  CHECK(strlen(out) <= MSG_MAX_LEN - 1);
  CHECK(msg_focus(out, sizeof out, id48) > 0);
  CHECK_EQ_INT(msg_decision(out, sizeof out, id49, 1), -1);
  CHECK_EQ_INT(msg_focus(out, sizeof out, id49), -1);
  CHECK_EQ_INT(msg_decision(out, sizeof out, "", 1), -1);
  CHECK_EQ_INT(msg_decision(out, sizeof out, NULL, 1), -1);
  CHECK_EQ_INT(msg_decision(out, sizeof out, "a\"b", 1), -1);      // nada que escapar: se rechaza
  CHECK_EQ_INT(msg_decision(out, sizeof out, "a\\b", 1), -1);
  CHECK_EQ_INT(msg_decision(out, sizeof out, "a b", 1), -1);
  CHECK_EQ_INT(msg_decision(out, sizeof out, "a\nb", 1), -1);
  CHECK_EQ_INT(msg_focus(out, sizeof out, "\xc3\xa9"), -1);
  CHECK_EQ_INT(msg_focus(out, sizeof out, ""), -1);
  CHECK_EQ_INT(msg_focus(out, sizeof out, "a:b.c-d_e"), (int)strlen("{\"t\":\"focus\",\"sessionId\":\"a:b.c-d_e\"}"));

  // el búfer: justo, uno menos, cero; sin escribir fuera (el búfer termina en la guarda)
  int len = msg_decision(out, sizeof out, "r1", 1);
  for (size_t cap = 0; cap <= (size_t)len + 2; cap++) {
    char *g = (char *)guard_at_end(&OUT, cap);
    int r = msg_decision(g, cap, "r1", 1);
    if (cap >= (size_t)len + 1) {
      CHECK_EQ_INT(r, len);
      CHECK_STR(g, out);
    } else {
      CHECK_EQ_INT(r, -1);
      if (cap > 0) CHECK_EQ_INT(g[0], 0);
    }
  }
  const char *nulls = "{\"t\":\"focus\",\"sessionId\":null}", *skip = "{\"t\":\"skip\"}", *mode = "{\"t\":\"mode\",\"mode\":\"manual\"}";
  for (size_t cap = 0; cap <= 40; cap++) {
    char *g = (char *)guard_at_end(&OUT, cap);
    int r = msg_focus(g, cap, NULL);
    CHECK((r == (int)strlen(nulls) && cap > strlen(nulls)) || (r == -1 && cap <= strlen(nulls)));
    r = msg_skip(g, cap);
    CHECK((r == (int)strlen(skip) && cap > strlen(skip)) || (r == -1 && cap <= strlen(skip)));
    r = msg_mode(g, cap, 1);
    CHECK((r == (int)strlen(mode) && cap > strlen(mode)) || (r == -1 && cap <= strlen(mode)));
  }
  // MSG_MAX_LEN alcanza para el peor caso
  CHECK(msg_decision(out, sizeof out, id48, 1) < MSG_MAX_LEN);
}

int main(void) {
  TEST_BEGIN("msg: mensajes de la consola, byte a byte como JSON.stringify");
  guard_init(&OUT, 4096);
  RUN(test_exact_messages);
  RUN(test_answer);
  RUN(test_ids_and_caps);
  TEST_END();
}

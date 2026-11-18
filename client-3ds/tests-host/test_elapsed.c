// Tiempo en el estado actual (Fase 3, panel de agentes): logic/elapsed.c y la lectura de `sinceS` de la vista. Sin libctru.
#include "test.h"

#include "../source/core/view.h"
#include "../source/logic/elapsed.h"

static void label_is(uint64_t secs, const char *want) {
  char buf[32];
  elapsed_label(secs, buf, sizeof buf);
  CHECK_MSG(strcmp(buf, want) == 0, "%llu s: se esperaba \"%s\" y salió \"%s\"", (unsigned long long)secs, want, buf);
}

static void test_label(void) {
  label_is(0, "ahora");
  label_is(4, "ahora");
  label_is(5, "hace 5 s");
  label_is(59, "hace 59 s");
  label_is(60, "hace 1 min");
  label_is(179, "hace 2 min");
  label_is(180, "hace 3 min");
  label_is(3599, "hace 59 min");
  label_is(3600, "hace 1 h");
  label_is(7200, "hace 2 h");
  label_is(86399, "hace 23 h");
  label_is(86400, "hace 1 d");
  label_is(3 * 86400 + 5, "hace 3 d");
  label_is(99u * 86400u, "hace 99 d");
  label_is(99u * 86400u + 5u * 86400u, "hace 104 d");
}

static void test_label_buffer(void) {
  char buf[8];
  CHECK_EQ_INT(elapsed_label(7200, buf, sizeof buf), 7);
  CHECK_STR(buf, "hace 2 ");
  char one[1] = {'x'};
  CHECK_EQ_INT(elapsed_label(7200, one, 0), 0);
  CHECK_EQ_INT(one[0], 'x'); // cap 0: no toca nada
  CHECK_EQ_INT(elapsed_label(7200, one, 1), 0);
  CHECK_EQ_INT(one[0], '\0');
  char ok[16];
  CHECK_EQ_INT(elapsed_label(65, ok, sizeof ok), 10);
  CHECK_STR(ok, "hace 1 min");
}

static void test_total(void) {
  CHECK_EQ_INT((int)elapsed_total_s(30, 1000, 1000), 30);
  CHECK_EQ_INT((int)elapsed_total_s(30, 1000, 1999), 30); // menos de un segundo local
  CHECK_EQ_INT((int)elapsed_total_s(30, 1000, 6000), 35);
  CHECK_EQ_INT((int)elapsed_total_s(0, 0, 125000), 125);
  CHECK_EQ_INT((int)elapsed_total_s(30, 5000, 4000), 30); // un reloj que va hacia atrás no resta
  // el reloj del PC no importa: solo cuenta lo que pasó en la consola desde que llegó la vista
  CHECK_EQ_INT((int)elapsed_total_s(VIEW_MAX_SINCE_S, 0, 10000), (int)VIEW_MAX_SINCE_S + 10);
  char buf[32];
  elapsed_label(elapsed_total_s(150, 10000, 70000), buf, sizeof buf); // 150 s + 60 s locales
  CHECK_STR(buf, "hace 3 min");
}

static const char *const VIEW_FMT =
    "{\"t\":\"view\",\"rev\":1,\"view\":{\"sessions\":[{\"id\":\"a\",\"kind\":\"claude\",\"title\":\"t\",\"project\":\"p\",\"model\":\"Opus 5.5\","
    "\"state\":\"working\",\"activity\":\"x\"%s}],\"request\":null,\"pendingCount\":0,\"mode\":\"queue\","
    "\"face\":{\"kind\":null,\"mood\":\"idle\",\"lines\":[\"x\"]},\"detail\":null,\"led\":\"off\"}}";

static int parse_with(const char *since_field, View *v) {
  char buf[800];
  snprintf(buf, sizeof buf, VIEW_FMT, since_field);
  return view_parse(buf, strlen(buf), v);
}

static void test_parse_since(void) {
  View v;
  CHECK_EQ_INT(parse_with(",\"sinceS\":125", &v), VIEW_OK);
  CHECK(v.sessions[0].has_since);
  CHECK_EQ_INT((int)v.sessions[0].since_s, 125);
  CHECK_STR(v.sessions[0].model, "Opus 5.5");
  CHECK_EQ_INT(parse_with(",\"sinceS\":0", &v), VIEW_OK);
  CHECK(v.sessions[0].has_since);
  CHECK_EQ_INT((int)v.sessions[0].since_s, 0);
  CHECK_EQ_INT(parse_with("", &v), VIEW_OK); // un puente anterior
  CHECK(!v.sessions[0].has_since);
  CHECK_EQ_INT(parse_with(",\"sinceS\":8553600", &v), VIEW_OK);
  CHECK_EQ_INT(parse_with(",\"sinceS\":8553601", &v), VIEW_ERR_LIMIT);
  CHECK(parse_with(",\"sinceS\":-1", &v) < 0);
  CHECK(parse_with(",\"sinceS\":1.5", &v) < 0);
  CHECK(parse_with(",\"sinceS\":\"5\"", &v) < 0);
  CHECK(parse_with(",\"sinceS\":null", &v) < 0);
}

int main(void) {
  TEST_BEGIN("elapsed: tiempo en el estado actual y lectura de sinceS");
  RUN(test_label);
  RUN(test_label_buffer);
  RUN(test_total);
  RUN(test_parse_since);
  TEST_END();
}

// Versión de la app y su comparación (logic/version.c). Espejo de packages/protocol/test/version.test.ts.
#include "test.h"

#include "../source/logic/version.h"

static void test_parse_ok(void) {
  AppVersion v;
  CHECK_EQ_INT(version_parse("0.2.0", &v), 0);
  CHECK(v.major == 0 && v.minor == 2 && v.micro == 0);
  CHECK_EQ_INT(version_parse("1.2", &v), 0);
  CHECK(v.major == 1 && v.minor == 2 && v.micro == 0);
  CHECK_EQ_INT(version_parse("3", &v), 0);
  CHECK(v.major == 3 && v.minor == 0 && v.micro == 0);
  CHECK_EQ_INT(version_parse("v1.0.4", &v), 0);
  CHECK(v.major == 1 && v.minor == 0 && v.micro == 4);
  CHECK_EQ_INT(version_parse("65535.65535.9", &v), 0);
  CHECK(v.major == 65535 && v.micro == 9);
}

static void test_parse_rejects(void) {
  static const char *const bad[] = {"",       "a.b.c",   "1.2.3.4", "1..2",         ".1",         "1.",     "-1.0.0",
                                    "1.0.0-b", " 1.0.0", "1.0.0 ",  "99999999.0.0", "70000.0.0",  "v",      "vv1.0.0",
                                    "1.0.0\n", "0x10",   "1,2,3",   "123456.0.0",   "1.2.3.4.5.6", "1.2.3.4.5.6.7.8.9"};
  AppVersion v;
  for (size_t i = 0; i < sizeof bad / sizeof bad[0]; i++) CHECK_MSG(version_parse(bad[i], &v) != 0, "debía rechazar \"%s\"", bad[i]);
  CHECK(version_parse(NULL, &v) != 0);
}

static void test_compare(void) {
  CHECK_EQ_INT(version_compare_str("0.2.0", "0.3.0"), -1);
  CHECK_EQ_INT(version_compare_str("0.3.0", "0.2.0"), 1);
  CHECK_EQ_INT(version_compare_str("0.2.0", "0.2.0"), 0);
  CHECK_EQ_INT(version_compare_str("0.2.1", "0.2.0"), 1);
  CHECK_EQ_INT(version_compare_str("1.0.0", "0.9.9"), 1);
  CHECK_EQ_INT(version_compare_str("0.10.0", "0.9.0"), 1); // numérica, no de texto
  CHECK_EQ_INT(version_compare_str("0.2", "0.2.0"), 0);
  CHECK_EQ_INT(version_compare_str("v0.2.0", "0.2.0"), 0);
}

static void test_unknown(void) {
  CHECK_EQ_INT(version_compare_str("", "0.2.0"), VERSION_UNKNOWN);
  CHECK_EQ_INT(version_compare_str("0.2.0", "basura"), VERSION_UNKNOWN);
  CHECK_EQ_INT(version_compare_str(NULL, "0.2.0"), VERSION_UNKNOWN);
}

int main(void) {
  TEST_BEGIN("version: lectura y comparacion de versiones de la app");
  RUN(test_parse_ok);
  RUN(test_parse_rejects);
  RUN(test_compare);
  RUN(test_unknown);
  TEST_END();
}

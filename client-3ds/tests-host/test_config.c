// config.ini (lectura, escritura, validación de IP y device_id) y el aviso UDP del puente.
#include "test.h"

#include "../source/logic/beacon.h"
#include "../source/logic/config_ini.h"

#define KEY64 "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"

static void test_ip_valid(void) {
  const char *good[] = {"192.168.0.10", "10.0.0.1", "1.2.3.4", "255.255.255.255", "172.16.0.10", "192.168.0.0"};
  for (size_t i = 0; i < sizeof good / sizeof good[0]; i++) CHECK_MSG(config_ip_valid(good[i]), "%s", good[i]);
  const char *bad[] = {"",          "1.2.3",       "1.2.3.4.5",   "256.1.1.1",  "1.2.3.256", "a.b.c.d",   "192.168.01.5",
                       "192.168.0.", ".1.2.3",     "1..2.3",      "0.0.0.0",    "1.2.3.4 ",  " 1.2.3.4",  "1.2.3.-4",
                       "1234.1.1.1", "192.168.0.10:33334", "1.2.3.4\n", "0x7f.0.0.1"};
  for (size_t i = 0; i < sizeof bad / sizeof bad[0]; i++) CHECK_MSG(!config_ip_valid(bad[i]), "[%s]", bad[i]);
}

static void test_ip_normalize(void) {
  char out[CONFIG_HOST_BYTES];
  CHECK_EQ_INT(config_ip_normalize("  192.168.0.10 \r\n", out), 0);
  CHECK_STR(out, "192.168.0.10");
  CHECK_EQ_INT(config_ip_normalize("192.168.0", out), -1);
  CHECK_STR(out, "");
  CHECK_EQ_INT(config_ip_normalize("", out), -1);
  CHECK_EQ_INT(config_ip_normalize("      ", out), -1);
  CHECK_EQ_INT(config_ip_normalize("1111111111111111111", out), -1); // más largo que el destino
}

static void test_device_id(void) {
  uint8_t r[4] = {0x1a, 0x2b, 0x3c, 0x4d};
  char id[13];
  config_make_device_id(r, id);
  CHECK_STR(id, "3ds-1a2b3c4d");
  CHECK(config_device_id_valid(id));
  CHECK(!config_device_id_valid(""));
  CHECK(!config_device_id_valid("tiene espacio"));
  CHECK(!config_device_id_valid("acentó"));
  char longid[80];
  memset(longid, 'a', 64);
  longid[64] = '\0';
  CHECK(config_device_id_valid(longid));
  longid[64] = 'a';
  longid[65] = '\0';
  CHECK(!config_device_id_valid(longid));
}

static void test_parse_ok(void) {
  const char *txt =
      "# comentario\n"
      "device_id=3ds-1a2b3c4d\r\n"
      "key = " KEY64 "\n"
      "[seccion]\n"
      "host=192.168.0.10\n"
      "port=33334\n"
      "desconocida=1\n";
  Config c;
  CHECK_EQ_INT(config_parse(txt, strlen(txt), &c), 0);
  CHECK_STR(c.device_id, "3ds-1a2b3c4d");
  CHECK_STR(c.key_hex, KEY64);
  CHECK_STR(c.host, "192.168.0.10");
  CHECK_EQ_INT(c.port, 33334);
  CHECK(config_has_key(&c));
  CHECK_EQ_INT(config_port_or_default(&c), 33334);
}

static void test_parse_bad_values(void) {
  const char *txt =
      "device_id=con espacios\n"
      "key=abc\n"
      "host=999.1.1.1\n"
      "port=70000\n";
  Config c;
  CHECK_EQ_INT(config_parse(txt, strlen(txt), &c), 4);
  CHECK_STR(c.device_id, "");
  CHECK_STR(c.key_hex, "");
  CHECK_STR(c.host, "");
  CHECK_EQ_INT(c.port, 0);
  CHECK(!config_has_key(&c));
  CHECK_EQ_INT(config_port_or_default(&c), CONFIG_DEFAULT_PORT);

  // key en mayúsculas se normaliza; port con letras se descarta
  const char *t2 = "key=00112233445566778899AABBCCDDEEFF00112233445566778899AABBCCDDEEFF\nport=12ab\n";
  CHECK_EQ_INT(config_parse(t2, strlen(t2), &c), 1);
  CHECK_STR(c.key_hex, KEY64);
  // vacíos válidos
  const char *t3 = "device_id=\nkey=\nhost=\nport=\n";
  CHECK_EQ_INT(config_parse(t3, strlen(t3), &c), 0);
  CHECK(!config_has_key(&c));
}

static void test_parse_hostile(void) {
  Config c;
  CHECK_EQ_INT(config_parse("", 0, &c), 0);
  CHECK_STR(c.device_id, "");
  CHECK_EQ_INT(config_parse("sinigual\n=\n=x\n\n\n", 16, &c), 0);
  // línea enorme sin salto: no desborda
  char big[2000];
  memset(big, 'k', sizeof big);
  memcpy(big, "host=", 5);
  config_parse(big, sizeof big, &c);
  CHECK_STR(c.host, "");
  // sin NUL final, pegado al borde de una página de guarda
  Guard g;
  guard_init(&g, 64);
  const char *t = "port=33334";
  uint8_t *p = guard_copy(&g, t, strlen(t));
  CHECK_EQ_INT(config_parse((const char *)p, strlen(t), &c), 0);
  CHECK_EQ_INT(c.port, 33334);
  // truncado a mitad de una clave
  p = guard_copy(&g, "device_id=3ds-ab", 16);
  config_parse((const char *)p, 16, &c);
  CHECK_STR(c.device_id, "3ds-ab");
  // un archivo más grande que el tope se lee hasta el tope
  static char huge[CONFIG_MAX_FILE * 3];
  memset(huge, '#', sizeof huge);
  huge[CONFIG_MAX_FILE * 2] = '\n';
  memcpy(huge + CONFIG_MAX_FILE + 1, "port=5\n", 7); // pasado el tope: se ignora
  CHECK_EQ_INT(config_parse(huge, sizeof huge, &c), 0);
  CHECK_EQ_INT(c.port, 0);
}

static void test_roundtrip(void) {
  Config a, b;
  config_defaults(&a);
  strcpy(a.device_id, "3ds-00ff00ff");
  strcpy(a.key_hex, KEY64);
  strcpy(a.host, "10.1.2.3");
  a.port = 40000;
  char buf[CONFIG_MAX_FILE];
  int n = config_serialize(&a, buf, sizeof buf);
  CHECK(n > 0);
  CHECK_EQ_INT((int)strlen(buf), n);
  CHECK(n < CONFIG_MAX_FILE);
  CHECK_EQ_INT(config_parse(buf, (size_t)n, &b), 0);
  CHECK_STR(b.device_id, a.device_id);
  CHECK_STR(b.key_hex, a.key_hex);
  CHECK_STR(b.host, a.host);
  CHECK_EQ_INT(b.port, a.port);

  // sin clave ni host
  config_defaults(&a);
  strcpy(a.device_id, "3ds-abcdef01");
  n = config_serialize(&a, buf, sizeof buf);
  CHECK(n > 0);
  CHECK_EQ_INT(config_parse(buf, (size_t)n, &b), 0);
  CHECK(!config_has_key(&b));
  CHECK_STR(b.device_id, "3ds-abcdef01");

  // no cabe: error y búfer terminado
  char tiny[20];
  CHECK_EQ_INT(config_serialize(&a, tiny, sizeof tiny), -1);
  CHECK_EQ_INT(tiny[0], 0);
}

// theme=dark|light: preferencia local de la consola; sin la clave, o con un valor raro, queda el tema claro.
static void test_theme(void) {
  Config c;
  const char *dark = "device_id=3ds-1a2b3c4d\ntheme=dark\n";
  CHECK_EQ_INT(config_parse(dark, strlen(dark), &c), 0);
  CHECK_EQ_INT(c.dark, 1);
  const char *light = "theme = light\r\n";
  CHECK_EQ_INT(config_parse(light, strlen(light), &c), 0);
  CHECK_EQ_INT(c.dark, 0);
  const char *none = "device_id=3ds-1a2b3c4d\n";
  CHECK_EQ_INT(config_parse(none, strlen(none), &c), 0);
  CHECK_EQ_INT(c.dark, 0); // ausente: claro
  const char *weird = "theme=azul\n";
  CHECK_EQ_INT(config_parse(weird, strlen(weird), &c), 1); // se descarta y se cuenta
  CHECK_EQ_INT(c.dark, 0);
  const char *empty = "theme=\n";
  CHECK_EQ_INT(config_parse(empty, strlen(empty), &c), 0);
  CHECK_EQ_INT(c.dark, 0);

  // ida y vuelta
  Config a, b;
  config_defaults(&a);
  strcpy(a.device_id, "3ds-abcdef01");
  char buf[CONFIG_MAX_FILE];
  int n = config_serialize(&a, buf, sizeof buf);
  CHECK(n > 0);
  CHECK(strstr(buf, "theme=light\n") != NULL);
  CHECK_EQ_INT(config_parse(buf, (size_t)n, &b), 0);
  CHECK_EQ_INT(b.dark, 0);
  a.dark = 1;
  n = config_serialize(&a, buf, sizeof buf);
  CHECK(n > 0);
  CHECK(strstr(buf, "theme=dark\n") != NULL);
  CHECK_EQ_INT(config_parse(buf, (size_t)n, &b), 0);
  CHECK_EQ_INT(b.dark, 1);
  CHECK_STR(b.device_id, "3ds-abcdef01");
}

static void test_beacon(void) {
  uint16_t port = 0;
  const char *ok = "{\"service\":\"3ds-agent-companion\",\"v\":1,\"port\":33334,\"name\":\"DESKTOP-ABC\"}";
  CHECK_EQ_INT(beacon_parse(ok, strlen(ok), &port), 0);
  CHECK_EQ_INT(port, 33334);

  const char *no_v = "{\"service\":\"3ds-agent-companion\",\"port\":4000}";
  CHECK_EQ_INT(beacon_parse(no_v, strlen(no_v), &port), 0);
  CHECK_EQ_INT(port, 4000);

  const char *bad[] = {
      "{\"service\":\"otra-cosa\",\"v\":1,\"port\":33334}",
      "{\"v\":1,\"port\":33334}",
      "{\"service\":\"3ds-agent-companion\",\"v\":2,\"port\":33334}",
      "{\"service\":\"3ds-agent-companion\",\"v\":1}",
      "{\"service\":\"3ds-agent-companion\",\"port\":0}",
      "{\"service\":\"3ds-agent-companion\",\"port\":65536}",
      "{\"service\":\"3ds-agent-companion\",\"port\":\"33334\"}",
      "{\"service\":\"3ds-agent-companion\",\"port\":3.5}",
      "{\"service\":\"3ds-agent-companion\",\"port\":-1}",
      "[\"3ds-agent-companion\"]",
      "{\"service\":\"3ds-agent-companion\",\"port\":33334",
      "no es json",
      "",
  };
  for (size_t i = 0; i < sizeof bad / sizeof bad[0]; i++) {
    port = 7;
    CHECK_MSG(beacon_parse(bad[i], strlen(bad[i]), &port) == -1, "%s", bad[i]);
  }
  CHECK_EQ_INT(beacon_parse(NULL, 0, &port), -1);
  // sin NUL final y pegado a la guarda
  Guard g;
  guard_init(&g, 256);
  uint8_t *p = guard_copy(&g, ok, strlen(ok));
  CHECK_EQ_INT(beacon_parse((const char *)p, strlen(ok), &port), 0);
  // todos los prefijos propios: ninguno se cuelga ni lee de más
  for (size_t n = 0; n < strlen(ok); n++) {
    p = guard_copy(&g, ok, n);
    CHECK(beacon_parse((const char *)p, n, &port) == -1);
  }
}

int main(void) {
  TEST_BEGIN("config.ini, IP, device_id y aviso UDP");
  RUN(test_ip_valid);
  RUN(test_ip_normalize);
  RUN(test_device_id);
  RUN(test_parse_ok);
  RUN(test_parse_bad_values);
  RUN(test_parse_hostile);
  RUN(test_roundtrip);
  RUN(test_theme);
  RUN(test_beacon);
  TEST_END();
}

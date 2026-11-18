#include "test.h"

#include "../source/core/handshake.h"
#include "fixtures/handshake_fixture.h"

static void test_code_normalize(void) {
  char out[HS_CODE_LEN + 1];
  CHECK_EQ_INT(pairing_code_normalize("ABCD-EFGH-JKMN-PQRS", out), 0);
  CHECK_STR(out, "ABCDEFGHJKMNPQRS");
  CHECK_EQ_INT(pairing_code_normalize("abcd efgh-jkmn pqrs", out), 0);
  CHECK_STR(out, "ABCDEFGHJKMNPQRS");
  CHECK_EQ_INT(pairing_code_normalize("0123456789ABCDEF", out), 0);
  CHECK_EQ_INT(pairing_code_normalize("GHJKMNPQRSTVWXYZ", out), 0);
  CHECK_EQ_INT(pairing_code_normalize("ABCDEFGHJKMNPQR", out), -1);     // 15
  CHECK_EQ_INT(pairing_code_normalize("ABCDEFGHJKMNPQRST", out), -1);   // 17
  CHECK_EQ_INT(pairing_code_normalize("", out), -1);
  CHECK_EQ_INT(pairing_code_normalize("ABCDEFGHIKMNPQRS", out), -1);    // I no está en el alfabeto
  CHECK_EQ_INT(pairing_code_normalize("ABCDEFGHLKMNPQRS", out), -1);    // L
  CHECK_EQ_INT(pairing_code_normalize("ABCDEFGHOKMNPQRS", out), -1);    // O
  CHECK_EQ_INT(pairing_code_normalize("ABCDEFGHUKMNPQRS", out), -1);    // U
  CHECK_EQ_INT(pairing_code_normalize("ABCDEFGH!KMNPQRS", out), -1);
  CHECK_EQ_INT(pairing_code_normalize("ABCDEFGH\xc3\xa9" "MNPQRS", out), -1);
}

static void test_derivation_and_macs(void) {
  uint8_t k[32], want[32], nb[16], nc[16], mac[32], ks[32];
  CHECK_EQ_INT(t_unhex(HSF_K_HEX, want, 32), 32);
  CHECK_EQ_INT(hs_derive_device_key(HSF_CODE, HSF_DEVICE_ID, k), 0);
  CHECK_MEM(k, want, 32);
  CHECK_EQ_INT(hs_derive_device_key(HSF_NORMALIZED_CODE, HSF_DEVICE_ID, k), 0);
  CHECK_MEM(k, want, 32);
  CHECK_EQ_INT(hs_derive_device_key("abcd-efgh-jkmn-pqrs", HSF_DEVICE_ID, k), 0);
  CHECK_MEM(k, want, 32);

  // otro código u otro id: otra clave; códigos o ids inválidos: error
  uint8_t other[32];
  CHECK_EQ_INT(hs_derive_device_key("ABCD-EFGH-JKMN-PQRT", HSF_DEVICE_ID, other), 0);
  CHECK(memcmp(other, want, 32) != 0);
  CHECK_EQ_INT(hs_derive_device_key(HSF_CODE, "3ds-test-0002", other), 0);
  CHECK(memcmp(other, want, 32) != 0);
  CHECK_EQ_INT(hs_derive_device_key("ABCD-EFGH-JKMN", HSF_DEVICE_ID, other), -1);
  CHECK_EQ_INT(hs_derive_device_key(HSF_CODE, "", other), -1);

  CHECK_EQ_INT(t_unhex(HSF_NONCE_B_HEX, nb, 16), 16);
  CHECK_EQ_INT(t_unhex(HSF_NONCE_C_HEX, nc, 16), 16);
  // hello v2: cubre el id, appVersion e install; sin ellos es el de los fixtures "sin app"
  hs_hello_mac(k, nb, nc, HSF_DEVICE_ID, NULL, -1, mac);
  CHECK_EQ_INT(t_unhex(HSF_HELLO_MAC_HEX, want, 32), 32);
  CHECK_MEM(mac, want, 32);
  hs_hello_mac(k, nb, nc, HSF_DEVICE_ID, HSF_HELLO_APP_VERSION, 1, mac);
  CHECK_EQ_INT(t_unhex(HSF_HELLO_APP_MAC_HEX, want, 32), 32);
  CHECK_MEM(mac, want, 32);
  // cualquier campo cambiado, o quitado, cambia el MAC
  uint8_t other_mac[32];
  hs_hello_mac(k, nb, nc, "3ds-test-0002", HSF_HELLO_APP_VERSION, 1, other_mac);
  CHECK(memcmp(other_mac, want, 32) != 0);
  hs_hello_mac(k, nb, nc, HSF_DEVICE_ID, "0.3.1", 1, other_mac);
  CHECK(memcmp(other_mac, want, 32) != 0);
  hs_hello_mac(k, nb, nc, HSF_DEVICE_ID, NULL, 1, other_mac);
  CHECK(memcmp(other_mac, want, 32) != 0);
  hs_hello_mac(k, nb, nc, HSF_DEVICE_ID, HSF_HELLO_APP_VERSION, 0, other_mac); // 3dsx
  CHECK(memcmp(other_mac, want, 32) != 0);
  hs_hello_mac(k, nb, nc, HSF_DEVICE_ID, HSF_HELLO_APP_VERSION, -1, other_mac);
  CHECK(memcmp(other_mac, want, 32) != 0);
  hs_welcome_mac(k, nb, nc, mac);
  CHECK_EQ_INT(t_unhex(HSF_WELCOME_MAC_HEX, want, 32), 32);
  CHECK_MEM(mac, want, 32);
  hs_session_key(k, nb, nc, ks);
  CHECK_EQ_INT(t_unhex(HSF_KS_HEX, want, 32), 32);
  CHECK_MEM(ks, want, 32);
  // intercambiar los nonces cambia el resultado (el orden importa)
  hs_hello_mac(k, nc, nb, HSF_DEVICE_ID, NULL, -1, mac);
  t_unhex(HSF_HELLO_MAC_HEX, want, 32);
  CHECK(memcmp(mac, want, 32) != 0);
  // el hello no se confunde con el welcome ni con la clave de sesión (etiquetas distintas)
  hs_welcome_mac(k, nb, nc, mac);
  hs_session_key(k, nb, nc, ks);
  CHECK(memcmp(mac, ks, 32) != 0);
}

static void test_hello_build(void) {
  uint8_t nc[16], mac[32];
  t_unhex(HSF_NONCE_C_HEX, nc, 16);
  t_unhex(HSF_HELLO_MAC_HEX, mac, 32);
  char out[512];
  int n = hs_build_hello(out, sizeof out, HSF_DEVICE_ID, nc, mac);
  const char *want = "{\"t\":\"hello\",\"v\":2,\"deviceId\":\"" HSF_DEVICE_ID "\",\"nonceC\":\"" HSF_NONCE_C_HEX
                     "\",\"mac\":\"" HSF_HELLO_MAC_HEX "\"}";
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);

  // límites del id y del búfer
  char id64[65], id65[66];
  memset(id64, 'a', 64);
  id64[64] = '\0';
  memset(id65, 'a', 65);
  id65[65] = '\0';
  CHECK(hs_build_hello(out, sizeof out, id64, nc, mac) > 0);
  CHECK_EQ_INT(hs_build_hello(out, sizeof out, id65, nc, mac), -1);
  CHECK_EQ_INT(hs_build_hello(out, sizeof out, "", nc, mac), -1);
  CHECK_EQ_INT(hs_build_hello(out, sizeof out, "a\"b", nc, mac), -1);
  CHECK_EQ_INT(hs_build_hello(out, sizeof out, "a b", nc, mac), -1);
  CHECK_EQ_INT(hs_build_hello(out, sizeof out, "a\\b", nc, mac), -1);
  CHECK_EQ_INT(hs_build_hello(out, (size_t)n, HSF_DEVICE_ID, nc, mac), -1);     // sin sitio para el NUL
  CHECK_EQ_INT(hs_build_hello(out, (size_t)n + 1, HSF_DEVICE_ID, nc, mac), n);  // justo
  CHECK_EQ_INT(hs_build_hello(out, 0, HSF_DEVICE_ID, nc, mac), -1);
}

static void test_hello_app_fields(void) {
  uint8_t nc[16], mac[32];
  t_unhex(HSF_NONCE_C_HEX, nc, 16);
  t_unhex(HSF_HELLO_MAC_HEX, mac, 32);
  char out[512], base[512];
  int nb = hs_build_hello(base, sizeof base, HSF_DEVICE_ID, nc, mac);
  CHECK(nb > 0);
  // sin versión ni instalación es el saludo de siempre (un puente anterior no nota la diferencia)
  CHECK_EQ_INT(hs_build_hello_app(out, sizeof out, HSF_DEVICE_ID, nc, mac, NULL, -1), nb);
  CHECK_STR(out, base);
  // con versión e instalación: dos campos más al final, antes de la llave de cierre
  int n = hs_build_hello_app(out, sizeof out, HSF_DEVICE_ID, nc, mac, "0.2.0", 1);
  char want[600];
  snprintf(want, sizeof want, "%.*s,\"appVersion\":\"0.2.0\",\"install\":\"cia\"}", nb - 1, base);
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);
  n = hs_build_hello_app(out, sizeof out, HSF_DEVICE_ID, nc, mac, "0.2.0", 0);
  snprintf(want, sizeof want, "%.*s,\"appVersion\":\"0.2.0\",\"install\":\"3dsx\"}", nb - 1, base);
  CHECK_STR(out, want);
  n = hs_build_hello_app(out, sizeof out, HSF_DEVICE_ID, nc, mac, NULL, 1);
  snprintf(want, sizeof want, "%.*s,\"install\":\"cia\"}", nb - 1, base);
  CHECK_STR(out, want);
  // una versión que no sea solo dígitos y puntos (o muy larga) no se manda: no se puede meter JSON en el saludo
  CHECK_EQ_INT(hs_build_hello_app(out, sizeof out, HSF_DEVICE_ID, nc, mac, "0.2.0\",\"x\":\"", 1), -1);
  CHECK_EQ_INT(hs_build_hello_app(out, sizeof out, HSF_DEVICE_ID, nc, mac, "", 1), -1);
  CHECK_EQ_INT(hs_build_hello_app(out, sizeof out, HSF_DEVICE_ID, nc, mac, "1.2.3.4.5.6.7.8.9", 1), -1);
  // el búfer justo y el del peor caso (id de 64 caracteres) caben en los 320 bytes de la sesión
  char id64[65];
  memset(id64, 'a', 64);
  id64[64] = '\0';
  n = hs_build_hello_app(out, sizeof out, id64, nc, mac, "65535.65535.9", 0);
  CHECK(n > 0 && n < 320);
  CHECK_EQ_INT(hs_build_hello_app(out, (size_t)n, id64, nc, mac, "65535.65535.9", 0), -1);
  CHECK_EQ_INT(hs_build_hello_app(out, (size_t)n + 1, id64, nc, mac, "65535.65535.9", 0), n);
}

static int parse(const char *json, HsMsg *m) { return hs_parse(json, strlen(json), m); }

static void test_parse(void) {
  HsMsg m;
  uint8_t want[32];
  CHECK_EQ_INT(parse("{\"t\":\"challenge\",\"v\":1,\"nonceB\":\"" HSF_NONCE_B_HEX "\"}", &m), 0);
  CHECK_EQ_INT(m.kind, HS_MSG_CHALLENGE);
  t_unhex(HSF_NONCE_B_HEX, want, 16);
  CHECK_MEM(m.nonce_b, want, 16);
  // mayúsculas también
  CHECK_EQ_INT(parse("{\"t\":\"challenge\",\"nonceB\":\"000102030405060708090A0B0C0D0E0F\"}", &m), 0);
  CHECK_MEM(m.nonce_b, want, 16);

  CHECK_EQ_INT(parse("{\"t\":\"welcome\",\"mac\":\"" HSF_WELCOME_MAC_HEX "\"}", &m), 0);
  CHECK_EQ_INT(m.kind, HS_MSG_WELCOME);
  t_unhex(HSF_WELCOME_MAC_HEX, want, 32);
  CHECK_MEM(m.mac, want, 32);

  CHECK_EQ_INT(parse("{\"t\":\"error\",\"code\":\"auth\"}", &m), 0);
  CHECK_EQ_INT(m.kind, HS_MSG_ERROR);
  CHECK_STR(m.code, "auth");
  // código muy largo: se corta sin romper nada
  char big[200];
  strcpy(big, "{\"t\":\"error\",\"code\":\"");
  size_t l = strlen(big);
  memset(big + l, 'x', 100);
  strcpy(big + l + 100, "\"}");
  CHECK_EQ_INT(parse(big, &m), 0);
  CHECK_EQ_INT(strlen(m.code), 31);

  // rechazos
  CHECK_EQ_INT(parse("{\"t\":\"challenge\",\"v\":2,\"nonceB\":\"" HSF_NONCE_B_HEX "\"}", &m), -1);
  CHECK_EQ_INT(parse("{\"t\":\"challenge\",\"v\":\"1\",\"nonceB\":\"" HSF_NONCE_B_HEX "\"}", &m), -1);
  CHECK_EQ_INT(parse("{\"t\":\"challenge\",\"v\":1}", &m), -1);
  CHECK_EQ_INT(parse("{\"t\":\"challenge\",\"nonceB\":\"0001\"}", &m), -1);                                   // corto
  CHECK_EQ_INT(parse("{\"t\":\"challenge\",\"nonceB\":\"000102030405060708090a0b0c0d0e0f00\"}", &m), -1);    // largo
  CHECK_EQ_INT(parse("{\"t\":\"challenge\",\"nonceB\":\"000102030405060708090a0b0c0d0e0g\"}", &m), -1);      // no hex
  CHECK_EQ_INT(parse("{\"t\":\"challenge\",\"nonceB\":5}", &m), -1);
  CHECK_EQ_INT(parse("{\"t\":\"welcome\",\"mac\":\"00\"}", &m), -1);
  CHECK_EQ_INT(parse("{\"t\":\"welcome\"}", &m), -1);
  CHECK_EQ_INT(parse("{\"t\":\"error\"}", &m), -1);
  CHECK_EQ_INT(parse("{\"t\":\"error\",\"code\":1}", &m), -1);
  CHECK_EQ_INT(parse("{\"t\":\"view\"}", &m), -1);
  CHECK_EQ_INT(parse("{\"t\":5}", &m), -1);
  CHECK_EQ_INT(parse("{}", &m), -1);
  CHECK_EQ_INT(parse("[]", &m), -1);
  CHECK_EQ_INT(parse("", &m), -1);
  CHECK_EQ_INT(parse("{\"t\":\"challenge\"", &m), -1);
}

static void test_hex(void) {
  uint8_t b[4] = {0x00, 0x0f, 0xa5, 0xff}, out[4];
  char hex[9];
  hex_encode(b, 4, hex);
  CHECK_STR(hex, "000fa5ff");
  CHECK_EQ_INT(hex_decode("000fa5ff", 8, out, 4), 0);
  CHECK_MEM(out, b, 4);
  CHECK_EQ_INT(hex_decode("000FA5FF", 8, out, 4), 0);
  CHECK_MEM(out, b, 4);
  CHECK_EQ_INT(hex_decode("000fa5f", 7, out, 4), -1);
  CHECK_EQ_INT(hex_decode("000fa5ff00", 10, out, 4), -1);
  CHECK_EQ_INT(hex_decode("000fa5fg", 8, out, 4), -1);
  CHECK_EQ_INT(hex_decode("", 0, out, 0), 0);
}

int main(void) {
  TEST_BEGIN("handshake: código, clave del dispositivo, MACs y mensajes");
  RUN(test_code_normalize);
  RUN(test_derivation_and_macs);
  RUN(test_hello_build);
  RUN(test_hello_app_fields);
  RUN(test_parse);
  RUN(test_hex);
  TEST_END();
}

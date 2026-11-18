// ChaCha20 (core/chacha20.c) contra los vectores del RFC 8439 (2.3.2 y 2.4.2) y casos de borde.
#include "test.h"

#include "../source/core/chacha20.h"

static void rfc_key(uint8_t key[32]) {
  for (int i = 0; i < 32; i++) key[i] = (uint8_t)i;
}

// RFC 8439, 2.3.2: el bloque con clave 00..1f, contador 1 y nonce 000000090000004a00000000.
static void test_block_vector(void) {
  uint8_t key[32], nonce[12], out[64], want[64];
  rfc_key(key);
  CHECK_EQ_INT(t_unhex("000000090000004a00000000", nonce, sizeof nonce), 12);
  chacha20_block(key, 1, nonce, out);
  CHECK_EQ_INT(t_unhex("10f1e7e4d13b5915500fdd1fa32071c4c7d1f4c733c068030422aa9ac3d46c4e"
                       "d2826446079faa0914c2d705d98b02a2b5129cd1de164eb9cbd083e8a2503c4e", want, sizeof want), 64);
  CHECK_MEM(out, want, 64);
}

// RFC 8439, 2.4.2: cifrar la frase de "sunscreen" con contador 1 y nonce 000000000000004a00000000 (114 bytes: dos bloques).
static void test_encrypt_vector(void) {
  static const char PLAIN[] =
      "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.";
  uint8_t key[32], nonce[12], want[114], out[114];
  rfc_key(key);
  t_unhex("000000000000004a00000000", nonce, sizeof nonce);
  CHECK_EQ_INT(strlen(PLAIN), 114);
  CHECK_EQ_INT(t_unhex("6e2e359a2568f98041ba0728dd0d6981e97e7aec1d4360c20a27afccfd9fae0b"
                       "f91b65c5524733ab8f593dabcd62b3571639d624e65152ab8f530c359f0861d8"
                       "07ca0dbf500d6a6156a38e088a22b65e52bc514d16ccf806818ce91ab7793736"
                       "5af90bbf74a35be6b40b8eedf2785e42874d", want, sizeof want), 114);
  chacha20_xor(key, 1, nonce, (const uint8_t *)PLAIN, out, 114);
  CHECK_MEM(out, want, 114);
  // descifrar es lo mismo, y en el sitio
  chacha20_xor(key, 1, nonce, out, out, 114);
  CHECK_MEM(out, PLAIN, 114);
}

static void test_edges(void) {
  uint8_t key[32], nonce[12];
  rfc_key(key);
  memset(nonce, 7, sizeof nonce);
  // largo 0: no toca nada ni lee la entrada
  uint8_t o = 0xaa;
  chacha20_xor(key, 0, nonce, NULL, &o, 0);
  CHECK_EQ_INT(o, 0xaa);

  // cada largo de 0 a 200 da lo mismo que el flujo de claves de los bloques consecutivos, byte a byte
  uint8_t ks[256], in[200], out[200];
  for (uint32_t b = 0; b < 4; b++) chacha20_block(key, b, nonce, ks + 64 * b);
  for (size_t i = 0; i < sizeof in; i++) in[i] = (uint8_t)(i * 7 + 3);
  for (size_t len = 0; len <= sizeof in; len++) {
    memset(out, 0, sizeof out);
    chacha20_xor(key, 0, nonce, in, out, len);
    for (size_t i = 0; i < len; i++) {
      if (out[i] != (uint8_t)(in[i] ^ ks[i])) {
        CHECK_MSG(0, "largo %zu, byte %zu", len, i);
        break;
      }
    }
  }
  // el contador de bloque inicial desplaza el flujo
  chacha20_xor(key, 2, nonce, in, out, 64);
  for (int i = 0; i < 64; i++) out[i] ^= in[i];
  CHECK_MEM(out, ks + 128, 64);

  // otra clave, otro nonce, otro contador: flujos distintos
  uint8_t a[64], b[64];
  chacha20_block(key, 0, nonce, a);
  nonce[11] ^= 1;
  chacha20_block(key, 0, nonce, b);
  CHECK(memcmp(a, b, 64) != 0);
  nonce[11] ^= 1;
  key[0] ^= 1;
  chacha20_block(key, 0, nonce, b);
  CHECK(memcmp(a, b, 64) != 0);
}

int main(void) {
  TEST_BEGIN("chacha20: vectores del RFC 8439");
  RUN(test_block_vector);
  RUN(test_encrypt_vector);
  RUN(test_edges);
  TEST_END();
}

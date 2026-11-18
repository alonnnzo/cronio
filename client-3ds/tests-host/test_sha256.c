#include "test.h"

#include "../source/core/sha256.h"

static void check_sha(const char *what, const void *data, size_t len, const char *want_hex) {
  uint8_t out[32], want[32];
  sha256(data, len, out);
  CHECK_EQ_INT(t_unhex(want_hex, want, sizeof want), 32);
  CHECK_MSG(memcmp(out, want, 32) == 0, "SHA-256 de %s", what);
}

static void test_sha256_vectors(void) {
  check_sha("vacío", "", 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  check_sha("abc", "abc", 3, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const char *m448 = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
  check_sha("448 bits", m448, strlen(m448), "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  const char *m896 =
      "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu";
  check_sha("896 bits", m896, strlen(m896), "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1");

  // un millón de 'a', en bloques de 1000 (también prueba las actualizaciones por partes)
  Sha256 c;
  uint8_t blk[1000], out[32], want[32];
  memset(blk, 'a', sizeof blk);
  sha256_init(&c);
  for (int i = 0; i < 1000; i++) sha256_update(&c, blk, sizeof blk);
  sha256_final(&c, out);
  t_unhex("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0", want, 32);
  CHECK_MEM(out, want, 32);
}

static void test_sha256_incremental(void) {
  // para cada largo de 0 a 300: byte a byte, en trozos de 7 y de una vez dan lo mismo
  uint8_t data[300];
  for (size_t i = 0; i < sizeof data; i++) data[i] = (uint8_t)(i * 31 + 7);
  for (size_t len = 0; len <= sizeof data; len++) {
    uint8_t one[32], bytes[32], chunks[32];
    sha256(data, len, one);
    Sha256 c;
    sha256_init(&c);
    for (size_t i = 0; i < len; i++) sha256_update(&c, data + i, 1);
    sha256_final(&c, bytes);
    sha256_init(&c);
    for (size_t i = 0; i < len; i += 7) sha256_update(&c, data + i, len - i < 7 ? len - i : 7);
    sha256_final(&c, chunks);
    CHECK(memcmp(one, bytes, 32) == 0 && memcmp(one, chunks, 32) == 0);
  }
}

static void check_hmac(const char *what, const void *key, size_t klen, const void *data, size_t dlen,
                       const char *want_hex) {
  uint8_t out[32], want[32];
  hmac256(key, klen, data, dlen, out);
  CHECK_EQ_INT(t_unhex(want_hex, want, sizeof want), 32);
  CHECK_MSG(memcmp(out, want, 32) == 0, "HMAC-SHA256 %s", what);
}

static void test_hmac_vectors(void) {
  // RFC 4231
  uint8_t key20[20];
  memset(key20, 0x0b, sizeof key20);
  check_hmac("RFC 4231 caso 1", key20, 20, "Hi There", 8,
             "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
  check_hmac("RFC 4231 caso 2", "Jefe", 4, "what do ya want for nothing?", 28,
             "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  uint8_t key_aa[20], data_dd[50];
  memset(key_aa, 0xaa, sizeof key_aa);
  memset(data_dd, 0xdd, sizeof data_dd);
  check_hmac("RFC 4231 caso 3", key_aa, 20, data_dd, 50,
             "773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe");
  uint8_t key25[25], data_cd[50];
  for (int i = 0; i < 25; i++) key25[i] = (uint8_t)(i + 1);
  memset(data_cd, 0xcd, sizeof data_cd);
  check_hmac("RFC 4231 caso 4", key25, 25, data_cd, 50,
             "82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b");
  uint8_t key131[131];
  memset(key131, 0xaa, sizeof key131);
  const char *d6 = "Test Using Larger Than Block-Size Key - Hash Key First";
  check_hmac("RFC 4231 caso 6 (clave mayor que el bloque)", key131, 131, d6, strlen(d6),
             "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54");
  const char *d7 =
      "This is a test using a larger than block-size key and a larger than block-size data. The key needs to be "
      "hashed before being used by the HMAC algorithm.";
  check_hmac("RFC 4231 caso 7", key131, 131, d7, strlen(d7),
             "9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2");

  // por partes igual que de una vez
  uint8_t a[32], b[32];
  hmac256("Jefe", 4, "what do ya want for nothing?", 28, a);
  Hmac256 h;
  hmac256_init(&h, "Jefe", 4);
  hmac256_update(&h, "what do ya ", 11);
  hmac256_update(&h, "want for nothing?", 17);
  hmac256_final(&h, b);
  CHECK_MEM(a, b, 32);
}

static void test_hkdf_vectors(void) {
  // RFC 5869 caso 1
  uint8_t ikm[22], salt[13], info[10], okm[82], want[82];
  memset(ikm, 0x0b, sizeof ikm);
  for (int i = 0; i < 13; i++) salt[i] = (uint8_t)i;
  for (int i = 0; i < 10; i++) info[i] = (uint8_t)(0xf0 + i);
  CHECK_EQ_INT(hkdf_sha256(salt, 13, ikm, 22, info, 10, okm, 42), 0);
  t_unhex("3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865", want, sizeof want);
  CHECK_MEM(okm, want, 42);

  // caso 2: entradas largas, 82 bytes de salida
  uint8_t ikm2[80], salt2[80], info2[80];
  for (int i = 0; i < 80; i++) {
    ikm2[i] = (uint8_t)i;
    salt2[i] = (uint8_t)(0x60 + i);
    info2[i] = (uint8_t)(0xb0 + i);
  }
  CHECK_EQ_INT(hkdf_sha256(salt2, 80, ikm2, 80, info2, 80, okm, 82), 0);
  t_unhex(
      "b11e398dc80327a1c8e7f78c596a49344f012eda2d4efad8a050cc4c19afa97c59045a99cac7827271cb41c65e590e09da3275600c2f09b8"
      "367793a9aca3db71cc30c58179ec3e87c14c01d5c1f3434f1d87",
      want, sizeof want);
  CHECK_MEM(okm, want, 82);

  // caso 3: sin sal ni info
  CHECK_EQ_INT(hkdf_sha256(NULL, 0, ikm, 22, NULL, 0, okm, 42), 0);
  t_unhex("8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8", want, sizeof want);
  CHECK_MEM(okm, want, 42);

  // límites del largo de salida
  uint8_t big[255 * 32], small[40];
  CHECK_EQ_INT(hkdf_sha256(salt, 13, ikm, 22, info, 10, big, sizeof big), 0);
  CHECK_EQ_INT(hkdf_sha256(salt, 13, ikm, 22, info, 10, big, sizeof big + 1), -1);
  CHECK_EQ_INT(hkdf_sha256(salt, 13, ikm, 22, info, 10, small, 0), 0);
  CHECK_EQ_INT(hkdf_sha256(salt, 13, ikm, 22, info, 10, small, 40), 0);
  CHECK_MEM(small, big, 40); // la salida más corta es prefijo de la más larga
}

static void test_ct_equal(void) {
  uint8_t a[32], b[32];
  memset(a, 0x5a, sizeof a);
  memcpy(b, a, sizeof b);
  CHECK(ct_equal(a, b, 32));
  CHECK(ct_equal(a, b, 0));
  for (size_t i = 0; i < 32; i++) {
    b[i] ^= 1;
    CHECK(!ct_equal(a, b, 32));
    CHECK(ct_equal(a, b, i)); // solo se comparan los primeros i bytes
    b[i] ^= 1;
  }
  b[31] ^= 0x80;
  CHECK(!ct_equal(a, b, 32));
}

int main(void) {
  TEST_BEGIN("sha256: SHA-256, HMAC, HKDF y comparación");
  test_sha256_vectors();
  test_sha256_incremental();
  RUN(test_hmac_vectors);
  RUN(test_hkdf_vectors);
  RUN(test_ct_equal);
  TEST_END();
}

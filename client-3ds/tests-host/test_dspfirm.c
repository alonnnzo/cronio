// Firmware del DSP (Fase 2b, paso 3b), parte pura: descompresión LZSS "hacia atrás" del .code, búsqueda y verificación del
// bloque "DSP1". El compresor de aquí es solo de pruebas (el real es el de Nintendo). Sin libctru.
#include "test.h"

#include "../source/core/sha256.h"
#include "../source/logic/dspfirm.h"

static void wr32(uint8_t *p, uint32_t v) {
  p[0] = (uint8_t)v;
  p[1] = (uint8_t)(v >> 8);
  p[2] = (uint8_t)(v >> 16);
  p[3] = (uint8_t)(v >> 24);
}

// ---- compresor de pruebas (voraz) ----
// Recorre el original de atrás hacia adelante. Devuelve el largo comprimido (con pie) o 0 si no comprime (extra < 0).
static size_t test_compress(const uint8_t *orig, size_t N, uint8_t *comp, size_t cap) {
  static uint8_t R[1 << 16];
  size_t r = 0;
  size_t p = N;
  while (p > 0) {
    size_t control_at = r++;
    uint8_t control = 0;
    for (int i = 0; i < 8 && p > 0; i++) {
      size_t best_len = 0, best_d = 0;
      for (size_t d = 3; d <= 4098; d++) {
        size_t l = 0;
        while (l < 18 && l < p && p - 1 - l + d < N && orig[p - 1 - l] == orig[p - 1 - l + d]) l++;
        if (l > best_len) {
          best_len = l;
          best_d = d;
        }
      }
      if (best_len >= 3) {
        uint32_t seg = (uint32_t)((best_len - 3) << 12) | (uint32_t)(best_d - 3);
        R[r++] = (uint8_t)(seg >> 8); // se lee primero el byte alto
        R[r++] = (uint8_t)seg;
        control |= (uint8_t)(0x80 >> i);
        p -= best_len;
      } else {
        R[r++] = orig[p - 1];
        p--;
      }
    }
    R[control_at] = control;
  }
  size_t n = r + 8;
  if (n > cap || n > N) return 0;
  for (size_t i = 0; i < r; i++) comp[r - 1 - i] = R[i];
  wr32(comp + r, (8u << 24) | (uint32_t)n);
  wr32(comp + r + 4, (uint32_t)(N - n));
  return n;
}

// ---- un .code falso con un bloque DSP1 ----

#define BLOCK 0x600u

static void make_block(uint8_t *b, uint32_t seed) {
  memset(b, 0, BLOCK);
  // firma (0x100 bytes) con algo de contenido
  for (int i = 0; i < 0x100; i++) b[i] = (uint8_t)(seed + (unsigned)i * 7u);
  memcpy(b + 0x100, "DSP1", 4);
  wr32(b + 0x104, BLOCK);
  // dos secciones de 0x100 bytes con contenido repetitivo (comprime bien)
  for (uint32_t i = 0x200; i < BLOCK; i++) b[i] = (uint8_t)((i / 16u) ^ seed);
  uint32_t offs[2] = {0x200, 0x400};
  for (int s = 0; s < 2; s++) {
    uint8_t *h = b + 0x120 + s * 0x30;
    wr32(h, offs[s]);
    wr32(h + 4, 0x1000u * (unsigned)(s + 1));
    wr32(h + 8, 0x100);
    sha256(b + offs[s], 0x100, h + 0x10);
  }
}

#define CODE_LEN 0x3000u

static uint8_t CODE[CODE_LEN];
static uint8_t BLK[BLOCK];
static uint8_t COMP[CODE_LEN];
static uint8_t OUT[CODE_LEN + 64];

// .code: relleno repetitivo, un "DSP1" falso (tamaño absurdo), el bloque verdadero (no al inicio) y más relleno.
static size_t build_code(size_t block_at, int decoy) {
  for (size_t i = 0; i < CODE_LEN; i++) CODE[i] = (uint8_t)(i % 24u);
  if (decoy) {
    memcpy(CODE + 0x180, "DSP1", 4);
    wr32(CODE + 0x184, 0xFFFFFFFFu);
  }
  make_block(BLK, 0x5a);
  memcpy(CODE + block_at, BLK, BLOCK);
  return CODE_LEN;
}

static void test_lzss_roundtrip(void) {
  build_code(0x900, 1);
  size_t n = test_compress(CODE, CODE_LEN, COMP, sizeof COMP);
  CHECK(n > 0 && n < CODE_LEN);
  CHECK_EQ_INT((long long)dspfirm_lzss_size(COMP, n), CODE_LEN);
  memset(OUT, 0xEE, sizeof OUT);
  CHECK_EQ_INT(dspfirm_lzss_decompress(COMP, n, OUT, CODE_LEN), 0);
  CHECK(memcmp(OUT, CODE, CODE_LEN) == 0);
  CHECK_EQ_INT(OUT[CODE_LEN], 0xEE); // no escribe de más
}

static void test_lzss_literals_and_matches(void) {
  // datos con partes sin repetición (literales) y largas repeticiones (coincidencias, incluidas las que se solapan)
  static uint8_t a[2000];
  uint32_t x = 12345;
  for (size_t i = 0; i < sizeof a; i++) {
    x = x * 1103515245u + 12345u;
    a[i] = i < 300 ? (uint8_t)(x >> 16) : (uint8_t)((i / 5) % 3); // al principio ruido, luego muy repetitivo
  }
  size_t n = test_compress(a, sizeof a, COMP, sizeof COMP);
  CHECK(n > 0);
  static uint8_t out[2000];
  CHECK_EQ_INT(dspfirm_lzss_decompress(COMP, n, out, sizeof out), 0);
  CHECK(memcmp(out, a, sizeof a) == 0);
}

static void test_lzss_bad_input(void) {
  build_code(0x900, 0);
  size_t n = test_compress(CODE, CODE_LEN, COMP, sizeof COMP);
  CHECK(n > 0);
  CHECK_EQ_INT((long long)dspfirm_lzss_size(NULL, 0), 0);
  CHECK_EQ_INT((long long)dspfirm_lzss_size(COMP, 7), 0);
  CHECK_EQ_INT(dspfirm_lzss_decompress(COMP, n, OUT, CODE_LEN - 1), -1);  // tamaño de salida equivocado
  CHECK_EQ_INT(dspfirm_lzss_decompress(COMP, n, OUT, CODE_LEN + 1), -1);
  CHECK_EQ_INT(dspfirm_lzss_decompress(COMP, 5, OUT, CODE_LEN), -1);
  // pie con largo de cabecera inválido
  static uint8_t bad[CODE_LEN];
  memcpy(bad, COMP, n);
  wr32(bad + n - 8, (3u << 24) | (uint32_t)n);
  CHECK_EQ_INT((long long)dspfirm_lzss_size(bad, n), 0);
  // "extra" gigantesco: pasa el tope
  memcpy(bad, COMP, n);
  wr32(bad + n - 4, 0xF0000000u);
  CHECK_EQ_INT((long long)dspfirm_lzss_size(bad, n), 0);
  // datos del medio rotos: nunca escribe fuera ni se cuelga (con UBSan en modo trap, un acceso malo cae); devuelve 0 o -1
  uint32_t x = 99;
  for (int it = 0; it < 3000; it++) {
    memcpy(bad, COMP, n);
    for (int k = 0; k < 4; k++) {
      x = x * 1103515245u + 12345u;
      size_t at = (x >> 8) % (n - 8);
      x = x * 1103515245u + 12345u;
      bad[at] = (uint8_t)(x >> 16);
    }
    int rc = dspfirm_lzss_decompress(bad, n, OUT, CODE_LEN);
    CHECK(rc == 0 || rc == -1);
    CHECK_EQ_INT(OUT[CODE_LEN], OUT[CODE_LEN]);
  }
}

static void test_find_ok(void) {
  size_t cl = build_code(0x900, 1); // el falso "DSP1" va antes: debe saltarlo
  size_t off = 0, size = 0;
  CHECK_EQ_INT(dspfirm_find(CODE, cl, &off, &size), DSPFIRM_OK);
  CHECK_EQ_INT((long long)off, 0x900);
  CHECK_EQ_INT((long long)size, BLOCK);
  CHECK(memcmp(CODE + off, BLK, size) == 0);
  CHECK(dspfirm_block_valid(CODE + off, size));
  // el bloque al inicio exacto del .code
  build_code(0, 0);
  CHECK_EQ_INT(dspfirm_find(CODE, CODE_LEN, &off, &size), DSPFIRM_OK);
  CHECK_EQ_INT((long long)off, 0);
}

static void test_find_through_compression(void) {
  build_code(0x1234, 1);
  size_t n = test_compress(CODE, CODE_LEN, COMP, sizeof COMP);
  CHECK(n > 0);
  CHECK_EQ_INT(dspfirm_lzss_decompress(COMP, n, OUT, CODE_LEN), 0);
  size_t off = 0, size = 0;
  CHECK_EQ_INT(dspfirm_find(OUT, CODE_LEN, &off, &size), DSPFIRM_OK);
  CHECK_EQ_INT((long long)off, 0x1234);
  CHECK(memcmp(OUT + off, BLK, size) == 0);
}

static void test_find_rejects(void) {
  size_t off = 0, size = 0;
  // sin el texto
  for (size_t i = 0; i < CODE_LEN; i++) CODE[i] = (uint8_t)(i % 24u);
  CHECK_EQ_INT(dspfirm_find(CODE, CODE_LEN, &off, &size), DSPFIRM_ERR_NOMAGIC);
  CHECK_EQ_INT(dspfirm_find(NULL, 0, &off, &size), DSPFIRM_ERR_NOMAGIC);
  CHECK_EQ_INT(dspfirm_find(CODE, 0x50, &off, &size), DSPFIRM_ERR_NOMAGIC);
  // una sección alterada: hay bloque, pero no coincide su SHA-256
  size_t cl = build_code(0x900, 0);
  CODE[0x900 + 0x250] ^= 0x01;
  CHECK_EQ_INT(dspfirm_find(CODE, cl, &off, &size), DSPFIRM_ERR_HASH);
  CHECK(!dspfirm_block_valid(CODE + 0x900, BLOCK));
  // el hash alterado
  build_code(0x900, 0);
  CODE[0x900 + 0x120 + 0x10] ^= 0x80;
  CHECK_EQ_INT(dspfirm_find(CODE, cl, &off, &size), DSPFIRM_ERR_HASH);
  // tamaño del bloque fuera de rango o más grande que lo que queda del .code
  build_code(0x900, 0);
  wr32(CODE + 0x900 + 0x104, 0x40);
  CHECK_EQ_INT(dspfirm_find(CODE, cl, &off, &size), DSPFIRM_ERR_NOMAGIC);
  build_code(CODE_LEN - BLOCK, 0); // declara más bytes de los que quedan en el .code
  wr32(CODE + CODE_LEN - BLOCK + 0x104, BLOCK + 0x100);
  CHECK(dspfirm_find(CODE, CODE_LEN, &off, &size) != DSPFIRM_OK);
  // una sección con desplazamiento fuera del bloque
  build_code(0x900, 0);
  wr32(CODE + 0x900 + 0x120, BLOCK - 0x10);
  CHECK_EQ_INT(dspfirm_find(CODE, cl, &off, &size), DSPFIRM_ERR_HASH);
  // sin ninguna sección (tabla vacía): no vale
  build_code(0x900, 0);
  wr32(CODE + 0x900 + 0x120 + 8, 0);
  CHECK_EQ_INT(dspfirm_find(CODE, cl, &off, &size), DSPFIRM_ERR_HASH);
}

static void test_block_valid_edges(void) {
  make_block(BLK, 1);
  CHECK(dspfirm_block_valid(BLK, BLOCK));
  CHECK(!dspfirm_block_valid(BLK, BLOCK - 1)); // el tamaño declarado no cabe
  CHECK(!dspfirm_block_valid(NULL, 0));
  CHECK(!dspfirm_block_valid(BLK, 0x100));
  BLK[0x100] = 'X';
  CHECK(!dspfirm_block_valid(BLK, BLOCK));
}

int main(void) {
  TEST_BEGIN("dspfirm: descompresión del .code y verificación del bloque DSP1");
  RUN(test_lzss_roundtrip);
  RUN(test_lzss_literals_and_matches);
  RUN(test_lzss_bad_input);
  RUN(test_find_ok);
  RUN(test_find_through_compression);
  RUN(test_find_rejects);
  RUN(test_block_valid_edges);
  TEST_END();
}

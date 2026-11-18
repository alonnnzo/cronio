#include "chacha20.h"

#include <string.h>

static uint32_t rotl32(uint32_t x, int n) { return (x << n) | (x >> (32 - n)); }

static uint32_t load32_le(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static void store32_le(uint8_t *p, uint32_t v) {
  p[0] = (uint8_t)(v & 0xff);
  p[1] = (uint8_t)((v >> 8) & 0xff);
  p[2] = (uint8_t)((v >> 16) & 0xff);
  p[3] = (uint8_t)((v >> 24) & 0xff);
}

#define QR(a, b, c, d)                   \
  do {                                   \
    a += b; d ^= a; d = rotl32(d, 16);   \
    c += d; b ^= c; b = rotl32(b, 12);   \
    a += b; d ^= a; d = rotl32(d, 8);    \
    c += d; b ^= c; b = rotl32(b, 7);    \
  } while (0)

void chacha20_block(const uint8_t key[CHACHA20_KEY_LEN], uint32_t counter, const uint8_t nonce[CHACHA20_NONCE_LEN],
                    uint8_t out[CHACHA20_BLOCK_LEN]) {
  uint32_t s[16], x[16];
  s[0] = 0x61707865u; // "expand 32-byte k"
  s[1] = 0x3320646eu;
  s[2] = 0x79622d32u;
  s[3] = 0x6b206574u;
  for (int i = 0; i < 8; i++) s[4 + i] = load32_le(key + 4 * i);
  s[12] = counter;
  for (int i = 0; i < 3; i++) s[13 + i] = load32_le(nonce + 4 * i);
  memcpy(x, s, sizeof x);
  for (int round = 0; round < 10; round++) { // 20 rondas = 10 dobles
    QR(x[0], x[4], x[8], x[12]);
    QR(x[1], x[5], x[9], x[13]);
    QR(x[2], x[6], x[10], x[14]);
    QR(x[3], x[7], x[11], x[15]);
    QR(x[0], x[5], x[10], x[15]);
    QR(x[1], x[6], x[11], x[12]);
    QR(x[2], x[7], x[8], x[13]);
    QR(x[3], x[4], x[9], x[14]);
  }
  for (int i = 0; i < 16; i++) store32_le(out + 4 * i, x[i] + s[i]);
  memset(x, 0, sizeof x);
  memset(s, 0, sizeof s);
}

void chacha20_xor(const uint8_t key[CHACHA20_KEY_LEN], uint32_t counter, const uint8_t nonce[CHACHA20_NONCE_LEN],
                  const uint8_t *in, uint8_t *out, size_t len) {
  uint8_t block[CHACHA20_BLOCK_LEN];
  size_t off = 0;
  while (off < len) {
    chacha20_block(key, counter++, nonce, block);
    size_t n = len - off < CHACHA20_BLOCK_LEN ? len - off : CHACHA20_BLOCK_LEN;
    for (size_t i = 0; i < n; i++) out[off + i] = (uint8_t)(in[off + i] ^ block[i]);
    off += n;
  }
  memset(block, 0, sizeof block);
}

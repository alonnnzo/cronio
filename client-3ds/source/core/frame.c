#include "frame.h"

#include <string.h>

int frame_encode(uint8_t type, const uint8_t *payload, size_t len, uint8_t *out, size_t cap) {
  if (len > FRAME_MAX_PAYLOAD || cap < FRAME_HEADER_LEN + len) return -1;
  out[0] = type;
  out[1] = (uint8_t)(len & 0xff);
  out[2] = (uint8_t)((len >> 8) & 0xff);
  if (len > 0) memmove(out + FRAME_HEADER_LEN, payload, len);
  return (int)(FRAME_HEADER_LEN + len);
}

void frame_decoder_init(FrameDecoder *d) {
  d->len = 0;
  d->done = 0;
  d->type = 0;
  d->payload_len = 0;
  d->failed = 0;
}

int frame_decoder_feed(FrameDecoder *d, const uint8_t *data, size_t len, size_t *used) {
  size_t consumed = 0;
  if (d->failed) {
    *used = 0;
    return FRAME_ERR_TOO_LONG;
  }
  if (d->done) { // la trama anterior ya se entregó
    d->len = 0;
    d->done = 0;
  }
  // cabecera
  while (d->len < FRAME_HEADER_LEN && consumed < len) d->buf[d->len++] = data[consumed++];
  if (d->len < FRAME_HEADER_LEN) {
    *used = consumed;
    return FRAME_NEED_MORE;
  }
  size_t plen = (size_t)d->buf[1] | ((size_t)d->buf[2] << 8);
  if (plen > FRAME_MAX_PAYLOAD) {
    d->failed = 1;
    *used = consumed;
    return FRAME_ERR_TOO_LONG;
  }
  size_t need = FRAME_HEADER_LEN + plen - d->len;
  size_t avail = len - consumed;
  size_t n = need < avail ? need : avail;
  if (n > 0) memcpy(d->buf + d->len, data + consumed, n);
  d->len += n;
  consumed += n;
  *used = consumed;
  if (d->len < FRAME_HEADER_LEN + plen) return FRAME_NEED_MORE;
  d->type = d->buf[0];
  d->payload_len = plen;
  d->done = 1;
  return FRAME_COMPLETE;
}

static void derive_key(const uint8_t ks[SHA256_DIGEST_LEN], const char *label, uint8_t out[SHA256_DIGEST_LEN]) {
  // HKDF-Expand con un solo bloque: T(1) = HMAC(ks, info | 0x01)
  uint8_t info[32];
  size_t n = strlen(label);
  memcpy(info, label, n);
  info[n] = 0x01;
  hmac256(ks, SHA256_DIGEST_LEN, info, n + 1, out);
}

void frame_sealer_init(FrameSealer *s, const uint8_t ks[SHA256_DIGEST_LEN], uint8_t dir) {
  int b2c = dir == FRAME_DIR_BRIDGE_TO_CONSOLE;
  derive_key(ks, b2c ? "3dsac-v2 enc-b2c" : "3dsac-v2 enc-c2b", s->enc);
  derive_key(ks, b2c ? "3dsac-v2 mac-b2c" : "3dsac-v2 mac-c2b", s->mac);
  s->dir = dir;
  s->counter = 0;
}

void frame_opener_init(FrameOpener *o, const uint8_t ks[SHA256_DIGEST_LEN], uint8_t dir) {
  frame_sealer_init(o, ks, dir);
}

// Nonce de 12 bytes: contador u32 little endian y 8 ceros.
static void make_nonce(uint32_t counter, uint8_t nonce[CHACHA20_NONCE_LEN]) {
  memset(nonce, 0, CHACHA20_NONCE_LEN);
  nonce[0] = (uint8_t)(counter & 0xff);
  nonce[1] = (uint8_t)((counter >> 8) & 0xff);
  nonce[2] = (uint8_t)((counter >> 16) & 0xff);
  nonce[3] = (uint8_t)((counter >> 24) & 0xff);
}

// Etiqueta sobre el TEXTO CIFRADO.
static void compute_tag(const FrameSealer *s, uint8_t type, const uint8_t *cipher, size_t len,
                        uint8_t tag[FRAME_TAG_LEN]) {
  uint8_t head[6];
  head[0] = s->dir;
  head[1] = (uint8_t)(s->counter & 0xff);
  head[2] = (uint8_t)((s->counter >> 8) & 0xff);
  head[3] = (uint8_t)((s->counter >> 16) & 0xff);
  head[4] = (uint8_t)((s->counter >> 24) & 0xff);
  head[5] = type;
  Hmac256 h;
  hmac256_init(&h, s->mac, SHA256_DIGEST_LEN);
  hmac256_update(&h, head, sizeof head);
  if (len > 0) hmac256_update(&h, cipher, len);
  uint8_t full[SHA256_DIGEST_LEN];
  hmac256_final(&h, full);
  memcpy(tag, full, FRAME_TAG_LEN);
  memset(full, 0, sizeof full);
}

int frame_seal(FrameSealer *s, uint8_t type, const uint8_t *payload, size_t len, uint8_t *out, size_t cap) {
  size_t body = len + FRAME_TAG_LEN;
  if (body > FRAME_MAX_PAYLOAD || cap < FRAME_HEADER_LEN + body || s->counter >= FRAME_COUNTER_MAX) return -1;
  out[0] = type;
  out[1] = (uint8_t)(body & 0xff);
  out[2] = (uint8_t)((body >> 8) & 0xff);
  if (len > 0) {
    memmove(out + FRAME_HEADER_LEN, payload, len);
    uint8_t nonce[CHACHA20_NONCE_LEN];
    make_nonce(s->counter, nonce);
    chacha20_xor(s->enc, 0, nonce, out + FRAME_HEADER_LEN, out + FRAME_HEADER_LEN, len);
  }
  compute_tag(s, type, out + FRAME_HEADER_LEN, len, out + FRAME_HEADER_LEN + len);
  s->counter++;
  return (int)(FRAME_HEADER_LEN + body);
}

int frame_open(FrameOpener *o, uint8_t type, uint8_t *sealed, size_t sealed_len) {
  if (sealed_len < FRAME_TAG_LEN || sealed_len > FRAME_MAX_PAYLOAD || o->counter >= FRAME_COUNTER_MAX) return -1;
  size_t len = sealed_len - FRAME_TAG_LEN;
  uint8_t want[FRAME_TAG_LEN];
  compute_tag(o, type, sealed, len, want);
  if (!ct_equal(want, sealed + len, FRAME_TAG_LEN)) return -1;
  if (len > 0) {
    uint8_t nonce[CHACHA20_NONCE_LEN];
    make_nonce(o->counter, nonce);
    chacha20_xor(o->enc, 0, nonce, sealed, sealed, len);
  }
  o->counter++;
  return (int)len;
}

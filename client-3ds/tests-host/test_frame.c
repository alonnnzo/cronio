#include "test.h"

#include "../source/core/frame.h"
#include "fixtures/handshake_fixture.h"

static Guard G;

static void test_encode(void) {
  uint8_t out[16];
  const uint8_t p[] = {1, 2, 3};
  CHECK_EQ_INT(frame_encode(FRAME_JSON, p, 3, out, sizeof out), 6);
  const uint8_t want[] = {1, 3, 0, 1, 2, 3};
  CHECK_MEM(out, want, 6);
  CHECK_EQ_INT(frame_encode(FRAME_PING, NULL, 0, out, sizeof out), 3);
  CHECK_EQ_INT(out[0], FRAME_PING);
  CHECK_EQ_INT(out[1], 0);
  CHECK_EQ_INT(frame_encode(FRAME_JSON, p, 3, out, 5), -1); // no cabe
  CHECK_EQ_INT(frame_encode(FRAME_JSON, p, 3, out, 6), 6);

  // largo en little endian y límite
  static uint8_t big[FRAME_HEADER_LEN + FRAME_MAX_PAYLOAD + 1];
  static uint8_t pay[FRAME_MAX_PAYLOAD + 1];
  memset(pay, 0x41, sizeof pay);
  CHECK_EQ_INT(frame_encode(FRAME_JSON, pay, FRAME_MAX_PAYLOAD, big, sizeof big), FRAME_HEADER_LEN + FRAME_MAX_PAYLOAD);
  CHECK_EQ_INT(big[1], 0x00);
  CHECK_EQ_INT(big[2], 0x40); // 16384 = 0x4000
  CHECK_EQ_INT(frame_encode(FRAME_JSON, pay, FRAME_MAX_PAYLOAD + 1, big, sizeof big), -1);
}

typedef struct {
  int count;
  uint8_t types[32];
  size_t lens[32];
  uint8_t first_byte[32];
} Frames;

// Alimenta `data` al decodificador en trozos de `chunk` bytes y anota las tramas completas.
static int feed(FrameDecoder *d, const uint8_t *data, size_t len, size_t chunk, Frames *f) {
  size_t off = 0;
  while (off < len) {
    size_t n = len - off < chunk ? len - off : chunk;
    uint8_t *g = guard_copy(&G, data + off, n); // la lectura no puede pasarse del trozo
    size_t pos = 0;
    while (pos < n) {
      size_t used = 0;
      int r = frame_decoder_feed(d, g + pos, n - pos, &used);
      pos += used;
      if (r == FRAME_ERR_TOO_LONG) return -1;
      if (r == FRAME_COMPLETE) {
        if (f->count < 32) {
          f->types[f->count] = d->type;
          f->lens[f->count] = d->payload_len;
          f->first_byte[f->count] = d->payload_len > 0 ? frame_decoder_payload(d)[0] : 0;
        }
        f->count++;
      }
    }
    off += n;
  }
  return 0;
}

static void test_decoder(void) {
  FrameDecoder *d = (FrameDecoder *)malloc(sizeof *d);
  uint8_t stream[64];
  size_t n = 0;
  uint8_t a[] = {10, 11, 12, 13, 14}, b[] = {20};
  n += (size_t)frame_encode(FRAME_JSON, a, sizeof a, stream + n, sizeof stream - n);
  n += (size_t)frame_encode(FRAME_PING, NULL, 0, stream + n, sizeof stream - n);
  n += (size_t)frame_encode(FRAME_PONG, b, sizeof b, stream + n, sizeof stream - n);

  // todo de una vez, y con trozos de 1, 2, 3, 5, 7 bytes
  size_t chunks[] = {1000, 1, 2, 3, 5, 7};
  for (size_t c = 0; c < sizeof chunks / sizeof chunks[0]; c++) {
    Frames f;
    memset(&f, 0, sizeof f);
    frame_decoder_init(d);
    CHECK_EQ_INT(feed(d, stream, n, chunks[c], &f), 0);
    CHECK_EQ_INT(f.count, 3);
    CHECK_EQ_INT(f.types[0], FRAME_JSON);
    CHECK_EQ_INT(f.lens[0], 5);
    CHECK_EQ_INT(f.first_byte[0], 10);
    CHECK_EQ_INT(f.types[1], FRAME_PING);
    CHECK_EQ_INT(f.lens[1], 0);
    CHECK_EQ_INT(f.types[2], FRAME_PONG);
    CHECK_EQ_INT(f.lens[2], 1);
    CHECK_EQ_INT(f.first_byte[2], 20);
  }

  // incompleta: no entrega nada; al llegar el resto, sí
  Frames f;
  memset(&f, 0, sizeof f);
  frame_decoder_init(d);
  feed(d, stream, 4, 4, &f);
  CHECK_EQ_INT(f.count, 0);
  feed(d, stream + 4, 4, 4, &f);
  CHECK_EQ_INT(f.count, 1);

  // el contenido es el correcto byte a byte
  frame_decoder_init(d);
  size_t used = 0;
  CHECK_EQ_INT(frame_decoder_feed(d, stream, n, &used), FRAME_COMPLETE);
  CHECK_EQ_INT(used, 8);
  CHECK_MEM(frame_decoder_payload(d), a, 5);

  // largo en el límite (16384) pasa; 16385 falla apenas llega la cabecera y deja el decodificador inservible
  static uint8_t hdr[3 + FRAME_MAX_PAYLOAD];
  memset(hdr, 0x55, sizeof hdr);
  hdr[0] = FRAME_JSON;
  hdr[1] = 0x00;
  hdr[2] = 0x40;
  memset(&f, 0, sizeof f);
  frame_decoder_init(d);
  CHECK_EQ_INT(feed(d, hdr, sizeof hdr, 1000, &f), 0);
  CHECK_EQ_INT(f.count, 1);
  CHECK_EQ_INT(f.lens[0], FRAME_MAX_PAYLOAD);
  uint8_t over[3] = {FRAME_JSON, 0x01, 0x40}; // 16385
  frame_decoder_init(d);
  CHECK_EQ_INT(frame_decoder_feed(d, over, 3, &used), FRAME_ERR_TOO_LONG);
  CHECK_EQ_INT(frame_decoder_feed(d, hdr, 10, &used), FRAME_ERR_TOO_LONG); // sigue fallando
  CHECK_EQ_INT(used, 0);
  uint8_t huge[3] = {FRAME_JSON, 0xff, 0xff};
  frame_decoder_init(d);
  CHECK_EQ_INT(frame_decoder_feed(d, huge, 3, &used), FRAME_ERR_TOO_LONG);
  // el error se detecta con la cabecera partida en bytes sueltos
  frame_decoder_init(d);
  CHECK_EQ_INT(frame_decoder_feed(d, huge, 1, &used), FRAME_NEED_MORE);
  CHECK_EQ_INT(frame_decoder_feed(d, huge + 1, 1, &used), FRAME_NEED_MORE);
  CHECK_EQ_INT(frame_decoder_feed(d, huge + 2, 1, &used), FRAME_ERR_TOO_LONG);

  // trama de largo 0 completa con solo la cabecera
  uint8_t zero[3] = {FRAME_PING, 0, 0};
  frame_decoder_init(d);
  CHECK_EQ_INT(frame_decoder_feed(d, zero, 3, &used), FRAME_COMPLETE);
  CHECK_EQ_INT(d->payload_len, 0);
  free(d);
}

static void test_seal_fixtures(void) {
  uint8_t ks[32];
  CHECK_EQ_INT(t_unhex(HSF_KS_HEX, ks, 32), 32);
  static uint8_t pay[600], sealed[600], frame[600], got[600];

  // puente -> consola (dir 1): la trama selladora reproduce byte a byte lo del puente, y abrirla devuelve el contenido
  FrameSealer sealer;
  FrameOpener opener;
  frame_sealer_init(&sealer, ks, FRAME_DIR_BRIDGE_TO_CONSOLE);
  frame_opener_init(&opener, ks, FRAME_DIR_BRIDGE_TO_CONSOLE);
  for (int i = 0; i < HSF_BRIDGE_TO_CONSOLE_COUNT; i++) {
    const HsFrameFixture *fx = &HSF_BRIDGE_TO_CONSOLE[i];
    int plen = t_unhex(fx->payload_hex, pay, sizeof pay);
    int slen = t_unhex(fx->sealed_hex, sealed, sizeof sealed);
    int flen = t_unhex(fx->frame_hex, frame, sizeof frame);
    CHECK_EQ_INT(slen, plen + FRAME_TAG_LEN);
    CHECK_EQ_INT(flen, FRAME_HEADER_LEN + slen);
    CHECK_EQ_INT(sealer.counter, fx->counter);
    int n = frame_seal(&sealer, (uint8_t)fx->type, pay, (size_t)plen, got, sizeof got);
    CHECK_EQ_INT(n, flen);
    CHECK_MEM(got, frame, (size_t)flen);

    // abrir la trama del cable: se decodifica y se abre en el sitio
    FrameDecoder *d = (FrameDecoder *)malloc(sizeof *d);
    frame_decoder_init(d);
    size_t used = 0;
    CHECK_EQ_INT(frame_decoder_feed(d, frame, (size_t)flen, &used), FRAME_COMPLETE);
    CHECK_EQ_INT(d->payload_len, slen);
    int olen = frame_open(&opener, d->type, frame_decoder_payload(d), d->payload_len);
    CHECK_EQ_INT(olen, plen);
    CHECK_MEM(frame_decoder_payload(d), pay, (size_t)plen);
    free(d);
  }

  // consola -> puente (dir 2)
  frame_sealer_init(&sealer, ks, FRAME_DIR_CONSOLE_TO_BRIDGE);
  for (int i = 0; i < HSF_CONSOLE_TO_BRIDGE_COUNT; i++) {
    const HsFrameFixture *fx = &HSF_CONSOLE_TO_BRIDGE[i];
    int plen = t_unhex(fx->payload_hex, pay, sizeof pay);
    int flen = t_unhex(fx->frame_hex, frame, sizeof frame);
    int n = frame_seal(&sealer, (uint8_t)fx->type, pay, (size_t)plen, got, sizeof got);
    CHECK_EQ_INT(n, flen);
    CHECK_MEM(got, frame, (size_t)flen);
  }
}

static void test_open_failures(void) {
  uint8_t ks[32];
  t_unhex(HSF_KS_HEX, ks, 32);
  uint8_t frame[600];
  int flen = t_unhex(HSF_BRIDGE_TO_CONSOLE[0].frame_hex, frame, sizeof frame);
  uint8_t *sealed = frame + FRAME_HEADER_LEN;
  size_t slen = (size_t)flen - FRAME_HEADER_LEN;
  uint8_t work[600];
  FrameOpener o;

  // intacta: abre; el contador avanza solo si abre
  frame_opener_init(&o, ks, FRAME_DIR_BRIDGE_TO_CONSOLE);
  memcpy(work, sealed, slen);
  CHECK(frame_open(&o, FRAME_JSON, work, slen) > 0);
  CHECK_EQ_INT(o.counter, 1);

  // repetida: el mismo bytes otra vez ya no sirve (contador 1)
  memcpy(work, sealed, slen);
  CHECK_EQ_INT(frame_open(&o, FRAME_JSON, work, slen), -1);
  CHECK_EQ_INT(o.counter, 1);
  // y la siguiente de verdad (contador 1) sí abre aunque antes hubo un intento fallido
  uint8_t second[600];
  int s2 = t_unhex(HSF_BRIDGE_TO_CONSOLE[1].sealed_hex, second, sizeof second);
  CHECK(frame_open(&o, FRAME_JSON, second, (size_t)s2) > 0);
  CHECK_EQ_INT(o.counter, 2);

  // un bit alterado en cada posición (contenido y etiqueta)
  for (size_t i = 0; i < slen; i++) {
    frame_opener_init(&o, ks, FRAME_DIR_BRIDGE_TO_CONSOLE);
    memcpy(work, sealed, slen);
    work[i] ^= 0x01;
    CHECK(frame_open(&o, FRAME_JSON, work, slen) < 0);
    CHECK_EQ_INT(o.counter, 0);
  }

  // tipo distinto, dirección equivocada, clave distinta, contador adelantado
  frame_opener_init(&o, ks, FRAME_DIR_BRIDGE_TO_CONSOLE);
  memcpy(work, sealed, slen);
  CHECK_EQ_INT(frame_open(&o, FRAME_PONG, work, slen), -1);
  frame_opener_init(&o, ks, FRAME_DIR_CONSOLE_TO_BRIDGE);
  CHECK_EQ_INT(frame_open(&o, FRAME_JSON, work, slen), -1);
  uint8_t other[32];
  memcpy(other, ks, 32);
  other[0] ^= 1;
  frame_opener_init(&o, other, FRAME_DIR_BRIDGE_TO_CONSOLE);
  CHECK_EQ_INT(frame_open(&o, FRAME_JSON, work, slen), -1);
  frame_opener_init(&o, ks, FRAME_DIR_BRIDGE_TO_CONSOLE);
  o.counter = 1;
  CHECK_EQ_INT(frame_open(&o, FRAME_JSON, work, slen), -1);

  // más corta que la etiqueta, justo la etiqueta (contenido vacío) y demasiado larga
  frame_opener_init(&o, ks, FRAME_DIR_BRIDGE_TO_CONSOLE);
  CHECK_EQ_INT(frame_open(&o, FRAME_JSON, work, 0), -1);
  CHECK_EQ_INT(frame_open(&o, FRAME_JSON, work, FRAME_TAG_LEN - 1), -1);
  CHECK_EQ_INT(frame_open(&o, FRAME_JSON, work, FRAME_MAX_PAYLOAD + 1), -1);
}

static void test_seal_edges(void) {
  uint8_t ks[32];
  t_unhex(HSF_KS_HEX, ks, 32);
  FrameSealer s;
  FrameOpener o;
  static uint8_t out[FRAME_HEADER_LEN + FRAME_MAX_PAYLOAD + 64];
  static uint8_t pay[FRAME_MAX_PAYLOAD];
  memset(pay, 'z', sizeof pay);

  // vacío: solo la etiqueta; abre y devuelve 0
  frame_sealer_init(&s, ks, FRAME_DIR_CONSOLE_TO_BRIDGE);
  frame_opener_init(&o, ks, FRAME_DIR_CONSOLE_TO_BRIDGE);
  int n = frame_seal(&s, FRAME_PING, NULL, 0, out, sizeof out);
  CHECK_EQ_INT(n, FRAME_HEADER_LEN + FRAME_TAG_LEN);
  CHECK_EQ_INT(out[1], FRAME_TAG_LEN);
  CHECK_EQ_INT(frame_open(&o, FRAME_PING, out + FRAME_HEADER_LEN, FRAME_TAG_LEN), 0);

  // el máximo que cabe con etiqueta
  n = frame_seal(&s, FRAME_JSON, pay, FRAME_MAX_PAYLOAD - FRAME_TAG_LEN, out, sizeof out);
  CHECK_EQ_INT(n, FRAME_HEADER_LEN + FRAME_MAX_PAYLOAD);
  CHECK_EQ_INT(frame_open(&o, FRAME_JSON, out + FRAME_HEADER_LEN, FRAME_MAX_PAYLOAD), FRAME_MAX_PAYLOAD - FRAME_TAG_LEN);
  // uno más no cabe, y no consume contador
  uint32_t before = s.counter;
  CHECK_EQ_INT(frame_seal(&s, FRAME_JSON, pay, FRAME_MAX_PAYLOAD - FRAME_TAG_LEN + 1, out, sizeof out), -1);
  CHECK_EQ_INT(s.counter, before);
  // búfer de salida corto
  CHECK_EQ_INT(frame_seal(&s, FRAME_JSON, pay, 10, out, 10 + FRAME_TAG_LEN + FRAME_HEADER_LEN - 1), -1);
  CHECK_EQ_INT(s.counter, before);
  CHECK_EQ_INT(frame_seal(&s, FRAME_JSON, pay, 10, out, 10 + FRAME_TAG_LEN + FRAME_HEADER_LEN), 29);

  // el contador es parte del nonce: la trama con el contador 2^32-1 no se usa (no envuelve), ni al sellar ni al abrir
  frame_sealer_init(&s, ks, FRAME_DIR_BRIDGE_TO_CONSOLE);
  frame_opener_init(&o, ks, FRAME_DIR_BRIDGE_TO_CONSOLE);
  s.counter = 0xfffffffdu;
  o.counter = 0xfffffffdu;
  for (int i = 0; i < 2; i++) { // contadores 0xfffffffd y 0xfffffffe
    n = frame_seal(&s, FRAME_JSON, (const uint8_t *)"abc", 3, out, sizeof out);
    CHECK(n > 0);
    CHECK_EQ_INT(frame_open(&o, FRAME_JSON, out + FRAME_HEADER_LEN, (size_t)n - FRAME_HEADER_LEN), 3);
  }
  CHECK_EQ_INT(s.counter, 0xffffffffu);
  CHECK_EQ_INT(frame_seal(&s, FRAME_JSON, (const uint8_t *)"abc", 3, out, sizeof out), -1);
  CHECK_EQ_INT(s.counter, 0xffffffffu);
  uint8_t junk[3 + FRAME_TAG_LEN];
  memset(junk, 1, sizeof junk);
  CHECK_EQ_INT(frame_open(&o, FRAME_JSON, junk, sizeof junk), -1);
  CHECK_EQ_INT(o.counter, 0xffffffffu);

  // sellar en el sitio: payload ya dentro de out
  frame_sealer_init(&s, ks, FRAME_DIR_CONSOLE_TO_BRIDGE);
  uint8_t a[64], b[64];
  memcpy(a + FRAME_HEADER_LEN, "hola", 4);
  CHECK_EQ_INT(frame_seal(&s, FRAME_JSON, a + FRAME_HEADER_LEN, 4, a, sizeof a), 23);
  frame_sealer_init(&s, ks, FRAME_DIR_CONSOLE_TO_BRIDGE);
  CHECK_EQ_INT(frame_seal(&s, FRAME_JSON, (const uint8_t *)"hola", 4, b, sizeof b), 23);
  CHECK_MEM(a, b, 23);
}

// Claves de la v2: las cuatro subclaves salen de ks con la etiqueta de cada uso y dirección (lo mismo que subKeyV2 del puente).
static void test_v2_keys(void) {
  uint8_t ks[32], want[32];
  t_unhex(HSF_KS_HEX, ks, 32);
  FrameSealer b2c, c2b;
  frame_sealer_init(&b2c, ks, FRAME_DIR_BRIDGE_TO_CONSOLE);
  frame_sealer_init(&c2b, ks, FRAME_DIR_CONSOLE_TO_BRIDGE);
  CHECK_EQ_INT(t_unhex(HSF_ENC_B2C_HEX, want, 32), 32);
  CHECK_MEM(b2c.enc, want, 32);
  CHECK_EQ_INT(t_unhex(HSF_MAC_B2C_HEX, want, 32), 32);
  CHECK_MEM(b2c.mac, want, 32);
  CHECK_EQ_INT(t_unhex(HSF_ENC_C2B_HEX, want, 32), 32);
  CHECK_MEM(c2b.enc, want, 32);
  CHECK_EQ_INT(t_unhex(HSF_MAC_C2B_HEX, want, 32), 32);
  CHECK_MEM(c2b.mac, want, 32);
  // las cuatro son distintas entre sí y de ks
  const uint8_t *all[5] = {b2c.enc, b2c.mac, c2b.enc, c2b.mac, ks};
  for (int i = 0; i < 5; i++) {
    for (int j = i + 1; j < 5; j++) CHECK(memcmp(all[i], all[j], 32) != 0);
  }
}

// El contenido va cifrado: ni el texto en claro aparece en el cable, y la misma carga cifra distinto con cada contador.
static void test_ciphertext(void) {
  uint8_t ks[32];
  t_unhex(HSF_KS_HEX, ks, 32);
  FrameSealer s;
  FrameOpener o;
  frame_sealer_init(&s, ks, FRAME_DIR_BRIDGE_TO_CONSOLE);
  frame_opener_init(&o, ks, FRAME_DIR_BRIDGE_TO_CONSOLE);
  static const char TEXT[] = "{\"t\":\"view\",\"secreto\":\"rm -rf /home/usuario\"}";
  const size_t len = sizeof TEXT - 1;
  uint8_t a[128], b[128];
  int na = frame_seal(&s, FRAME_JSON, (const uint8_t *)TEXT, len, a, sizeof a);
  int nb = frame_seal(&s, FRAME_JSON, (const uint8_t *)TEXT, len, b, sizeof b);
  CHECK_EQ_INT(na, FRAME_HEADER_LEN + (int)len + FRAME_TAG_LEN);
  CHECK(memmem(a, (size_t)na, "secreto", 7) == NULL);
  CHECK(memmem(a, (size_t)na, "rm -rf", 6) == NULL);
  CHECK(memcmp(a + FRAME_HEADER_LEN, TEXT, len) != 0);
  CHECK(memcmp(a + FRAME_HEADER_LEN, b + FRAME_HEADER_LEN, len) != 0); // otro contador, otro nonce
  // abrir devuelve el texto en el sitio; la segunda trama solo abre con el contador 1
  CHECK_EQ_INT(frame_open(&o, FRAME_JSON, a + FRAME_HEADER_LEN, (size_t)na - FRAME_HEADER_LEN), (int)len);
  CHECK_MEM(a + FRAME_HEADER_LEN, TEXT, len);
  CHECK_EQ_INT(frame_open(&o, FRAME_JSON, b + FRAME_HEADER_LEN, (size_t)nb - FRAME_HEADER_LEN), (int)len);
  CHECK_MEM(b + FRAME_HEADER_LEN, TEXT, len);

  // la etiqueta cubre el texto cifrado: una trama alterada no se descifra (el búfer queda como llegó) y no avanza el contador
  frame_sealer_init(&s, ks, FRAME_DIR_BRIDGE_TO_CONSOLE);
  frame_opener_init(&o, ks, FRAME_DIR_BRIDGE_TO_CONSOLE);
  na = frame_seal(&s, FRAME_JSON, (const uint8_t *)TEXT, len, a, sizeof a);
  memcpy(b, a, (size_t)na);
  b[FRAME_HEADER_LEN + 2] ^= 0x40;
  uint8_t before[128];
  memcpy(before, b, (size_t)na);
  CHECK_EQ_INT(frame_open(&o, FRAME_JSON, b + FRAME_HEADER_LEN, (size_t)na - FRAME_HEADER_LEN), -1);
  CHECK_MEM(b, before, (size_t)na);
  CHECK_EQ_INT(o.counter, 0);

  // las dos direcciones tienen claves distintas: la trama de una no abre en la otra
  FrameOpener other;
  frame_opener_init(&other, ks, FRAME_DIR_CONSOLE_TO_BRIDGE);
  CHECK_EQ_INT(frame_open(&other, FRAME_JSON, a + FRAME_HEADER_LEN, (size_t)na - FRAME_HEADER_LEN), -1);
  FrameSealer back;
  frame_sealer_init(&back, ks, FRAME_DIR_CONSOLE_TO_BRIDGE);
  frame_seal(&back, FRAME_JSON, (const uint8_t *)TEXT, len, b, sizeof b);
  CHECK(memcmp(a + FRAME_HEADER_LEN, b + FRAME_HEADER_LEN, len) != 0); // mismo texto y contador, otra clave
}

int main(void) {
  TEST_BEGIN("frame: tramas, lectura en flujo y sellado");
  guard_init(&G, 32768);
  RUN(test_encode);
  RUN(test_decoder);
  RUN(test_seal_fixtures);
  RUN(test_open_failures);
  RUN(test_seal_edges);
  RUN(test_v2_keys);
  RUN(test_ciphertext);
  TEST_END();
}

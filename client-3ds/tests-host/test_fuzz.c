// Mini-fuzz determinista (semilla fija): muta bytes de vistas y de tramas válidas decenas de miles de veces y comprueba
// que nada se cuelga, se cae ni lee/escribe fuera de los búferes (la entrada va pegada a una página de guarda), y que
// lo que se acepta cumple los invariantes (cadenas con NUL, UTF-8 válido, enumeraciones y cantidades en rango).
#include "test.h"

#include "../source/core/handshake.h"
#include "../source/core/json.h"
#include "../source/core/session.h"
#include "fixtures/handshake_fixture.h"
#include "fixtures/views_fixture.h"

#define VIEW_ITERATIONS 40000
#define SESSION_ITERATIONS 15000
#define STREAM_ITERATIONS 20000
#define HANDSHAKE_ITERATIONS 10000

static Guard IN, VG, FR;

static int fuzz_sink(void *ctx, const uint8_t *d, size_t n) {
  (void)ctx;
  (void)d;
  (void)n;
  return 0;
}
static Session S;

// ---- generador pseudoaleatorio (xorshift32) ----

static uint32_t rng_state = 0x2545f491u;
static uint32_t rnd(void) {
  uint32_t x = rng_state;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  rng_state = x;
  return x;
}
static uint32_t rnd_below(uint32_t n) { return n == 0 ? 0 : rnd() % n; }

static const uint8_t SPECIAL[] = {'"', '\\', '{', '}', '[', ']', ',', ':', 0x00, 0xff, 0x80, 0xc0, 0xe2, 0xf0, 'u', '-', '0', '9', 'e', '.'};

// Aplica entre 1 y 4 mutaciones a una copia de src en dst; devuelve el largo nuevo.
static size_t mutate(uint8_t *dst, size_t cap, const uint8_t *src, size_t len) {
  if (len > cap) len = cap;
  memcpy(dst, src, len);
  int ops = 1 + (int)rnd_below(4);
  for (int i = 0; i < ops; i++) {
    switch (rnd_below(9)) {
      case 0: // cambiar un bit
        if (len) dst[rnd_below((uint32_t)len)] ^= (uint8_t)(1u << rnd_below(8));
        break;
      case 1: // byte al azar
        if (len) dst[rnd_below((uint32_t)len)] = (uint8_t)rnd();
        break;
      case 2: // byte estructural
        if (len) dst[rnd_below((uint32_t)len)] = SPECIAL[rnd_below(sizeof SPECIAL)];
        break;
      case 3: // truncar
        if (len) len = rnd_below((uint32_t)len);
        break;
      case 4: { // borrar un trozo
        if (len < 2) break;
        size_t at = rnd_below((uint32_t)len), n = 1 + rnd_below(16);
        if (at + n > len) n = len - at;
        memmove(dst + at, dst + at + n, len - at - n);
        len -= n;
        break;
      }
      case 5: { // insertar bytes
        size_t at = rnd_below((uint32_t)len + 1), n = 1 + rnd_below(8);
        if (len + n > cap) break;
        memmove(dst + at + n, dst + at, len - at);
        for (size_t k = 0; k < n; k++) dst[at + k] = rnd_below(2) ? SPECIAL[rnd_below(sizeof SPECIAL)] : (uint8_t)rnd();
        len += n;
        break;
      }
      case 6: { // duplicar un trozo
        if (len < 2) break;
        size_t at = rnd_below((uint32_t)len), n = 1 + rnd_below(32);
        if (at + n > len) n = len - at;
        if (len + n > cap) break;
        memmove(dst + at + n, dst + at, len - at);
        len += n;
        break;
      }
      case 7: // intercambiar dos bytes
        if (len >= 2) {
          uint32_t a = rnd_below((uint32_t)len), b = rnd_below((uint32_t)len);
          uint8_t t = dst[a];
          dst[a] = dst[b];
          dst[b] = t;
        }
        break;
      default: // pegar el principio otra vez al final (anidamiento y repetición)
        if (len >= 8 && len * 2 <= cap) {
          size_t n = 1 + rnd_below((uint32_t)len > 64 ? 64 : (uint32_t)len);
          memcpy(dst + len, dst, n);
          len += n;
        }
        break;
    }
  }
  return len;
}

// ---- invariantes de lo aceptado ----

static int utf8_ok(const char *s) {
  const unsigned char *p = (const unsigned char *)s;
  while (*p) {
    size_t l;
    if (*p < 0x80) l = 1;
    else if (*p >= 0xc2 && *p <= 0xdf) l = 2;
    else if (*p >= 0xe0 && *p <= 0xef) l = 3;
    else if (*p >= 0xf0 && *p <= 0xf4) l = 4;
    else return 0;
    for (size_t i = 1; i < l; i++) {
      if ((p[i] & 0xc0) != 0x80) return 0;
    }
    if (l == 3 && p[0] == 0xe0 && p[1] < 0xa0) return 0;
    if (l == 3 && p[0] == 0xed && p[1] > 0x9f) return 0;
    if (l == 4 && p[0] == 0xf0 && p[1] < 0x90) return 0;
    if (l == 4 && p[0] == 0xf4 && p[1] > 0x8f) return 0;
    p += l;
  }
  return 1;
}

static size_t codepoints(const char *s) {
  size_t n = 0;
  for (; *s; s++) {
    if (((unsigned char)*s & 0xc0) != 0x80) n++;
  }
  return n;
}

static int text_ok(const char *s, size_t bytes_cap) {
  size_t l = strnlen(s, bytes_cap);
  return l < bytes_cap && utf8_ok(s) && codepoints(s) <= VIEW_MAX_TEXT;
}

static int id_ok(const char *s) { return strnlen(s, VIEW_ID_BYTES) < VIEW_ID_BYTES && view_id_valid(s); }

static int view_invariants(const View *v) {
  if (v->session_count < 0 || v->session_count > VIEW_MAX_SESSIONS) return 0;
  for (int i = 0; i < v->session_count; i++) {
    const SessionView *s = &v->sessions[i];
    if (!id_ok(s->id) || s->kind < 0 || s->kind >= AGENT_COUNT || s->state < 0 || s->state >= STATE_COUNT) return 0;
    if (!text_ok(s->title, VIEW_TEXT_BYTES) || !text_ok(s->project, VIEW_TEXT_BYTES) ||
        !text_ok(s->model, VIEW_TEXT_BYTES) || !text_ok(s->activity, VIEW_TEXT_BYTES))
      return 0;
  }
  if (v->has_request != 0 && v->has_request != 1) return 0;
  if (v->has_request) {
    const RequestView *r = &v->request;
    if (!id_ok(r->id) || !id_ok(r->session_id) || !text_ok(r->title, VIEW_TEXT_BYTES)) return 0;
    if (r->line_count < 0 || r->line_count > VIEW_MAX_LINES) return 0;
    for (int i = 0; i < r->line_count; i++) {
      if (!text_ok(r->lines[i], VIEW_TEXT_BYTES)) return 0;
    }
    if (r->risk != RISK_NORMAL && r->risk != RISK_HIGH) return 0;
    if (r->position < 1 || r->total < 1) return 0;
  }
  if (v->mode != MODE_QUEUE && v->mode != MODE_MANUAL) return 0;
  if (v->face.kind < AGENT_NONE || v->face.kind >= AGENT_COUNT || v->face.mood < 0 || v->face.mood >= MOOD_COUNT) return 0;
  if (v->face.line_count < 1 || v->face.line_count > VIEW_MAX_FACE_LINES) return 0;
  for (int i = 0; i < v->face.line_count; i++) {
    if (!text_ok(v->face.lines[i], VIEW_TEXT_BYTES)) return 0;
  }
  if (v->has_detail != 0 && v->has_detail != 1) return 0;
  if (v->has_detail) {
    if (!id_ok(v->detail.session_id) || v->detail.line_count < 0 || v->detail.line_count > VIEW_MAX_DETAIL_LINES) return 0;
    for (int i = 0; i < v->detail.line_count; i++) {
      if (!text_ok(v->detail.last_message[i], VIEW_TEXT_BYTES)) return 0;
    }
    if (v->detail.question_count < 0 || v->detail.question_count > VIEW_MAX_QUESTION_LINES) return 0;
    for (int i = 0; i < v->detail.question_count; i++) {
      if (!text_ok(v->detail.question[i], VIEW_TEXT_BYTES)) return 0;
    }
  }
  if (v->led < 0 || v->led >= VIEW_LED_COUNT) return 0;
  return 1;
}

// ---- pruebas ----

static void test_view_parse_fuzz(void) {
  static uint8_t work[FRAME_MAX_PAYLOAD * 2];
  View *v = (View *)guard_at_end(&VG, sizeof(View));
  int corpus[VIEW_FIXTURE_COUNT], nc = 0;
  for (int i = 0; i < VIEW_FIXTURE_COUNT; i++) {
    if (VIEW_FIXTURES[i].c_valid) corpus[nc++] = i;
  }
  CHECK(nc > 40);
  long accepted = 0, rejected = 0, errors = 0;
  for (int it = 0; it < VIEW_ITERATIONS; it++) {
    const ViewFixture *f = &VIEW_FIXTURES[corpus[rnd_below((uint32_t)nc)]];
    size_t len = mutate(work, sizeof work, (const uint8_t *)f->json, f->json_len);
    const char *p = (const char *)guard_copy(&IN, work, len);
    memset(v, rnd() & 0xff, sizeof *v);
    int r = view_parse(p, len, v);
    if (r == VIEW_OK) {
      accepted++;
      if (!view_invariants(v)) {
        CHECK_MSG(0, "invariantes rotos en la iteración %d (%s)", it, f->name);
        return;
      }
    } else if (r == VIEW_BRIDGE_ERROR) {
      errors++;
      if (strnlen(v->error_code, VIEW_ERROR_CODE_BYTES) >= VIEW_ERROR_CODE_BYTES || !utf8_ok(v->error_code)) {
        CHECK_MSG(0, "código de error mal terminado (iteración %d)", it);
        return;
      }
    } else {
      rejected++;
      if (r > 0 || r < VIEW_ERR_LIMIT) {
        CHECK_MSG(0, "código de retorno fuera de rango: %d", r);
        return;
      }
    }
  }
  printf("  view_parse: %ld aceptadas, %ld errores del puente, %ld rechazadas de %d mutaciones\n", accepted, errors,
         rejected, VIEW_ITERATIONS);
  CHECK(accepted > 1000 && rejected > 1000); // el fuzz de verdad explora las dos ramas
}

static void test_json_fuzz(void) {
  static uint8_t work[FRAME_MAX_PAYLOAD * 2];
  static JsonDoc doc;
  char out[16];
  long ok = 0;
  for (int it = 0; it < VIEW_ITERATIONS / 2; it++) {
    const ViewFixture *f = &VIEW_FIXTURES[rnd_below(VIEW_FIXTURE_COUNT)];
    size_t len = mutate(work, sizeof work, (const uint8_t *)f->json, f->json_len);
    const char *p = (const char *)guard_copy(&IN, work, len);
    int r = json_parse(&doc, p, len);
    if (r != JSON_OK) {
      CHECK(r < 0);
      continue;
    }
    ok++;
    // recorrer todo con las funciones públicas
    for (int t = 0; t < doc.count; t++) {
      const JsonTok *tk = &doc.toks[t];
      if (tk->end > len || tk->start > tk->end || tk->next > doc.count || tk->next <= t) {
        CHECK_MSG(0, "token inconsistente en la iteración %d", it);
        return;
      }
      size_t chars;
      int cut;
      json_string(&doc, tk, out, sizeof out, &chars, &cut);
      json_str_eq(&doc, tk, "view");
      uint64_t u;
      json_uint(&doc, tk, &u);
      json_get(&doc, tk, "view");
      json_at(&doc, tk, 1);
    }
  }
  printf("  json_parse: %ld de %d mutaciones siguen siendo JSON válido\n", ok, VIEW_ITERATIONS / 2);
}

// Alimenta a la sesión con una vista mutada, sellada correctamente por el puente simulado: llega al parser de vistas.
static void test_session_fuzz(void) {
  static uint8_t work[FRAME_MAX_PAYLOAD], frame[FRAME_HEADER_LEN + FRAME_MAX_PAYLOAD];
  uint8_t k[32], nb[16], nc16[16], ks[32];
  t_unhex(HSF_K_HEX, k, 32);
  t_unhex(HSF_NONCE_B_HEX, nb, 16);
  t_unhex(HSF_NONCE_C_HEX, nc16, 16);
  t_unhex(HSF_KS_HEX, ks, 32);
  static const char challenge[] = "{\"t\":\"challenge\",\"v\":1,\"nonceB\":\"" HSF_NONCE_B_HEX "\"}";
  static const char welcome[] = "{\"t\":\"welcome\",\"mac\":\"" HSF_WELCOME_MAC_HEX "\"}";
  long ready = 0, failed = 0;
  int corpus[VIEW_FIXTURE_COUNT], nc = 0;
  for (int i = 0; i < VIEW_FIXTURE_COUNT; i++) {
    if (VIEW_FIXTURES[i].c_valid && VIEW_FIXTURES[i].json_len < FRAME_MAX_PAYLOAD - 200) corpus[nc++] = i;
  }
  for (int it = 0; it < SESSION_ITERATIONS; it++) {
    uint8_t buf[600];
    session_init(&S, HSF_DEVICE_ID, k, nc16);
    Transport t = {fuzz_sink, NULL}; // descarta lo que la consola envía
    session_on_connected(&S, t);
    int n = frame_encode(FRAME_JSON, (const uint8_t *)challenge, strlen(challenge), buf, sizeof buf);
    CHECK_EQ_INT(session_on_data(&S, buf, (size_t)n), 0);
    n = frame_encode(FRAME_JSON, (const uint8_t *)welcome, strlen(welcome), buf, sizeof buf);
    CHECK_EQ_INT(session_on_data(&S, buf, (size_t)n), 0);
    FrameSealer peer;
    frame_sealer_init(&peer, ks, FRAME_DIR_BRIDGE_TO_CONSOLE);
    // varias vistas seguidas, algunas mutadas
    for (int k2 = 0; k2 < 3 && S.state == SESSION_READY; k2++) {
      const ViewFixture *f = &VIEW_FIXTURES[corpus[rnd_below((uint32_t)nc)]];
      size_t len;
      if (rnd_below(2) == 0) {
        len = f->json_len;
        memcpy(work, f->json, len);
      } else {
        len = mutate(work, sizeof work, (const uint8_t *)f->json, f->json_len);
      }
      int fl = frame_seal(&peer, FRAME_JSON, work, len, frame, sizeof frame);
      if (fl < 0) break;
      // en trozos al azar, contra la guarda
      size_t off = 0;
      while (off < (size_t)fl && S.state != SESSION_FAILED) {
        size_t chunk = 1 + rnd_below(3000);
        if (chunk > (size_t)fl - off) chunk = (size_t)fl - off;
        uint8_t *g = guard_copy(&FR, frame + off, chunk);
        session_on_data(&S, g, chunk);
        off += chunk;
      }
    }
    if (S.state == SESSION_READY) {
      ready++;
      const View *v = session_view(&S);
      if (v != NULL && !view_invariants(v)) {
        CHECK_MSG(0, "la sesión guardó una vista que rompe los invariantes (iteración %d)", it);
        return;
      }
    } else {
      failed++;
      CHECK_EQ_INT(S.state, SESSION_FAILED);
      CHECK(S.error != SESSION_ERR_NONE);
    }
  }
  printf("  session: %ld sesiones siguen listas, %ld cerradas por vista inválida\n", ready, failed);
  CHECK(ready > 300 && failed > 500);
}

// Flujos de bytes mutados (cabeceras, largos, saludo, tramas selladas) alimentados al decodificador y a la sesión.
static void test_stream_fuzz(void) {
  uint8_t k[32], nc16[16], ks[32];
  t_unhex(HSF_K_HEX, k, 32);
  t_unhex(HSF_NONCE_C_HEX, nc16, 16);
  t_unhex(HSF_KS_HEX, ks, 32);
  static uint8_t clean[4096], work[8192];
  size_t clen = 0;
  static const char challenge[] = "{\"t\":\"challenge\",\"v\":1,\"nonceB\":\"" HSF_NONCE_B_HEX "\"}";
  static const char welcome[] = "{\"t\":\"welcome\",\"mac\":\"" HSF_WELCOME_MAC_HEX "\"}";
  clen += (size_t)frame_encode(FRAME_JSON, (const uint8_t *)challenge, strlen(challenge), clean + clen, sizeof clean - clen);
  clen += (size_t)frame_encode(FRAME_JSON, (const uint8_t *)welcome, strlen(welcome), clean + clen, sizeof clean - clen);
  for (int i = 0; i < HSF_BRIDGE_TO_CONSOLE_COUNT; i++) {
    uint8_t f[256];
    int fl = t_unhex(HSF_BRIDGE_TO_CONSOLE[i].frame_hex, f, sizeof f);
    memcpy(clean + clen, f, (size_t)fl);
    clen += (size_t)fl;
  }
  long ready = 0, failed = 0, idle = 0;
  for (int it = 0; it < STREAM_ITERATIONS; it++) {
    size_t len;
    if (rnd_below(5) == 0) {
      len = clen;
      memcpy(work, clean, clen);
    } else {
      len = mutate(work, sizeof work, clean, clen);
    }
    session_init(&S, HSF_DEVICE_ID, k, nc16);
    Transport t = {fuzz_sink, NULL};
    session_on_connected(&S, t);
    size_t off = 0;
    while (off < len) {
      size_t chunk = 1 + rnd_below(70);
      if (chunk > len - off) chunk = len - off;
      uint8_t *g = guard_copy(&FR, work + off, chunk);
      if (session_on_data(&S, g, chunk) < 0) break;
      off += chunk;
    }
    if (S.state == SESSION_READY) ready++;
    else if (S.state == SESSION_FAILED) failed++;
    else idle++;
    if (S.state == SESSION_FAILED && S.error == SESSION_ERR_NONE) {
      CHECK_MSG(0, "FAILED sin motivo (iteración %d)", it);
      return;
    }
  }
  printf("  flujos: %ld listos, %ld cerrados, %ld a medias\n", ready, failed, idle);
  CHECK(ready > 100 && failed > 1000);
}

// El decodificador de tramas con bytes totalmente al azar y fragmentación al azar: nunca se pasa del búfer.
static void test_frame_decoder_fuzz(void) {
  static FrameDecoder d;
  static uint8_t data[2000];
  long complete = 0, too_long = 0;
  for (int it = 0; it < STREAM_ITERATIONS; it++) {
    size_t len = rnd_below(sizeof data);
    for (size_t i = 0; i < len; i++) data[i] = (uint8_t)(rnd_below(3) == 0 ? rnd() : (i % 7 == 1 ? rnd_below(8) : rnd() & 0x0f));
    frame_decoder_init(&d);
    size_t off = 0;
    int dead = 0;
    while (off < len && !dead) {
      size_t chunk = 1 + rnd_below(100);
      if (chunk > len - off) chunk = len - off;
      uint8_t *g = guard_copy(&FR, data + off, chunk);
      size_t pos = 0;
      while (pos < chunk) {
        size_t used = 0;
        int r = frame_decoder_feed(&d, g + pos, chunk - pos, &used);
        if (used > chunk - pos) {
          CHECK_MSG(0, "consumió más de lo dado");
          return;
        }
        pos += used;
        if (r == FRAME_COMPLETE) {
          complete++;
          if (d.payload_len > FRAME_MAX_PAYLOAD) {
            CHECK_MSG(0, "trama completa con largo excesivo");
            return;
          }
        } else if (r == FRAME_ERR_TOO_LONG) {
          too_long++;
          dead = 1;
          break;
        } else if (used == 0) {
          CHECK_MSG(0, "no avanza");
          return;
        }
      }
      off += chunk;
    }
  }
  printf("  decodificador: %ld tramas completas, %ld flujos con largo excesivo\n", complete, too_long);
  CHECK(complete > 1000 && too_long > 100);
}

// Mensajes del saludo mutados.
static void test_handshake_fuzz(void) {
  static const char *seeds[] = {
      "{\"t\":\"challenge\",\"v\":1,\"nonceB\":\"" HSF_NONCE_B_HEX "\"}",
      "{\"t\":\"welcome\",\"mac\":\"" HSF_WELCOME_MAC_HEX "\"}",
      "{\"t\":\"error\",\"code\":\"auth\"}",
  };
  static uint8_t work[512];
  long ok = 0;
  for (int it = 0; it < HANDSHAKE_ITERATIONS; it++) {
    const char *s = seeds[rnd_below(3)];
    size_t len = mutate(work, sizeof work, (const uint8_t *)s, strlen(s));
    const char *p = (const char *)guard_copy(&IN, work, len);
    HsMsg m;
    if (hs_parse(p, len, &m) == 0) {
      ok++;
      CHECK(m.kind == HS_MSG_CHALLENGE || m.kind == HS_MSG_WELCOME || m.kind == HS_MSG_ERROR);
      CHECK(strnlen(m.code, sizeof m.code) < sizeof m.code);
    }
  }
  printf("  hs_parse: %ld de %d mutaciones siguen siendo mensajes válidos\n", ok, HANDSHAKE_ITERATIONS);
  CHECK(ok > 100);
}

int main(void) {
  TEST_BEGIN("fuzz: mutaciones deterministas de vistas y tramas (semilla fija)");
  guard_init(&IN, 70000);
  guard_init(&VG, sizeof(View));
  guard_init(&FR, FRAME_MAX_PAYLOAD + 64);
  RUN(test_view_parse_fuzz);
  RUN(test_json_fuzz);
  RUN(test_session_fuzz);
  RUN(test_stream_fuzz);
  RUN(test_frame_decoder_fuzz);
  RUN(test_handshake_fuzz);
  TEST_END();
}

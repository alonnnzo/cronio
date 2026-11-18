// Sonido de los avisos (Fase 2b, paso 3b), parte pura: compuerta de `chime.seq` (punto de partida, reinicio del puente,
// límite de frecuencia, ajuste apagado) y síntesis de los cuatro sonidos. Sin libctru.
#include "test.h"

#include "../source/logic/chime.h"

static ChimeGate G;

static int step(int has, ChimeKind k, uint32_t seq, int enabled, uint64_t now) { return chime_gate_step(&G, has, k, seq, enabled, now); }

static void test_first_seq_is_baseline(void) {
  chime_gate_init(&G);
  CHECK_EQ_INT(step(1, CHIME_DONE, 7, 1, 1000), -1);     // el primero visto: punto de partida, no suena
  CHECK_EQ_INT(step(1, CHIME_DONE, 7, 1, 1016), -1);     // la misma vista otra vez: nada
  CHECK_EQ_INT(step(1, CHIME_ASK, 8, 1, 5000), CHIME_ASK);
  CHECK_EQ_INT(step(1, CHIME_ASK, 8, 1, 5016), -1);      // una sola vez por seq
  CHECK_EQ_INT(step(1, CHIME_ERROR, 9, 1, 9000), CHIME_ERROR);
}

static void test_each_kind_maps(void) {
  chime_gate_init(&G);
  step(1, CHIME_DONE, 1, 1, 0);
  uint64_t t = 10000;
  for (int k = 0; k < CHIME_COUNT; k++, t += 5000) CHECK_EQ_INT(step(1, (ChimeKind)k, (uint32_t)(2 + k), 1, t), k);
}

static void test_no_chime_in_first_view_then_seq1_sounds(void) {
  chime_gate_init(&G);
  CHECK_EQ_INT(step(0, CHIME_DONE, 0, 1, 100), -1); // puente nuevo sin avisos
  CHECK_EQ_INT(step(1, CHIME_DONE, 1, 1, 3000), CHIME_DONE);
}

static void test_reconnect_resets_baseline(void) {
  chime_gate_init(&G);
  step(1, CHIME_DONE, 3, 1, 0);
  CHECK_EQ_INT(step(1, CHIME_DONE, 4, 1, 5000), CHIME_DONE);
  chime_gate_reset(&G); // se cayó la conexión
  CHECK_EQ_INT(step(1, CHIME_DONE, 9, 1, 20000), -1); // el 9 es el nuevo punto de partida (llegó mientras no estábamos)
  CHECK_EQ_INT(step(1, CHIME_DONE, 10, 1, 30000), CHIME_DONE);
  chime_gate_reset(&G);
  CHECK_EQ_INT(step(1, CHIME_DONE, 10, 1, 40000), -1); // mismo seq tras reconectar: tampoco suena
}

static void test_seq_backwards_resets_without_sound(void) {
  chime_gate_init(&G);
  step(1, CHIME_DONE, 50, 1, 0);
  CHECK_EQ_INT(step(1, CHIME_DONE, 2, 1, 5000), -1);   // el puente se reinició
  CHECK_EQ_INT(step(1, CHIME_DONE, 3, 1, 9000), CHIME_DONE); // y de ahí en adelante suena
  // el puente se reinicia y su primera vista ya no trae chime: el siguiente (1) suena
  step(0, CHIME_DONE, 0, 1, 12000);
  CHECK_EQ_INT(step(1, CHIME_ERROR, 1, 1, 15000), CHIME_ERROR);
}

static void test_rate_limit(void) {
  chime_gate_init(&G);
  step(1, CHIME_DONE, 1, 1, 0);
  CHECK_EQ_INT(step(1, CHIME_DONE, 2, 1, 10000), CHIME_DONE);
  CHECK_EQ_INT(step(1, CHIME_ASK, 3, 1, 10500), -1);   // dentro de 1,5 s: se descarta
  CHECK_EQ_INT(step(1, CHIME_ASK, 3, 1, 12000), -1);   // y no queda en cola: ese seq ya se atendió
  CHECK_EQ_INT(step(1, CHIME_ERROR, 4, 1, 11499), -1); // 1499 ms después del último que sonó
  CHECK_EQ_INT(step(1, CHIME_ERROR, 5, 1, 11500), CHIME_ERROR); // justo 1500 ms
  CHECK_EQ_INT((int)CHIME_MIN_GAP_MS, 1500);
}

static void test_disabled_advances_baseline(void) {
  chime_gate_init(&G);
  step(1, CHIME_DONE, 1, 1, 0);
  CHECK_EQ_INT(step(1, CHIME_DONE, 2, 0, 5000), -1);   // ajuste apagado o sin ndsp
  CHECK_EQ_INT(step(1, CHIME_DONE, 3, 0, 9000), -1);
  CHECK_EQ_INT(step(1, CHIME_DONE, 3, 1, 12000), -1);  // al encender no se suelta el viejo
  CHECK_EQ_INT(step(1, CHIME_DONE, 4, 1, 15000), CHIME_DONE);
  // un aviso que no sonó por estar apagado tampoco consume el límite de frecuencia
  chime_gate_init(&G);
  step(1, CHIME_DONE, 1, 1, 0);
  step(1, CHIME_DONE, 2, 0, 5000);
  CHECK_EQ_INT(step(1, CHIME_DONE, 3, 1, 5100), CHIME_DONE);
}

static void test_clock_going_back_does_not_block(void) {
  chime_gate_init(&G);
  step(1, CHIME_DONE, 1, 1, 100000);
  CHECK_EQ_INT(step(1, CHIME_DONE, 2, 1, 200000), CHIME_DONE);
  CHECK_EQ_INT(step(1, CHIME_DONE, 3, 1, 1000), CHIME_DONE); // reloj raro: no se queda mudo
}

static void test_invalid_kind(void) {
  chime_gate_init(&G);
  step(1, CHIME_DONE, 1, 1, 0);
  CHECK_EQ_INT(step(1, (ChimeKind)9, 2, 1, 5000), -1);
}

// ---- síntesis ----

static int16_t BUF[CHIME_MAX_SAMPLES + 8];
static int16_t REF[CHIME_COUNT][CHIME_MAX_SAMPLES];

static void test_synth_shape(void) {
  size_t lens[CHIME_COUNT];
  for (int k = 0; k < CHIME_COUNT; k++) {
    for (size_t i = 0; i < CHIME_MAX_SAMPLES + 8; i++) BUF[i] = 0x5555;
    size_t n = chime_synth((ChimeKind)k, BUF, CHIME_MAX_SAMPLES);
    lens[k] = n;
    CHECK(n > (size_t)(CHIME_RATE / 10));                 // más de 100 ms
    CHECK(n <= (size_t)CHIME_MAX_SAMPLES);                 // y no más de 400 ms
    CHECK(n * 1000u / CHIME_RATE <= CHIME_MAX_MS);
    CHECK_EQ_INT(BUF[0], 0);                               // empieza en silencio
    CHECK(BUF[n - 1] >= -1 && BUF[n - 1] <= 1);            // y termina en silencio
    if (n < CHIME_MAX_SAMPLES + 8) CHECK_EQ_INT(BUF[n], 0x5555); // sin escribir de más
    int peak = 0, maxstep = 0;
    for (size_t i = 0; i < n; i++) {
      int a = BUF[i] < 0 ? -BUF[i] : BUF[i];
      if (a > peak) peak = a;
      if (i > 0) {
        int d = BUF[i] - BUF[i - 1];
        if (d < 0) d = -d;
        if (d > maxstep) maxstep = d;
      }
    }
    CHECK(peak <= CHIME_PEAK);
    CHECK(peak >= CHIME_PEAK / 2);                         // se oye
    CHECK(maxstep < 4200);                                 // sin saltos bruscos (clics)
    memcpy(REF[k], BUF, n * sizeof(int16_t));
  }
  // los cuatro son distintos entre sí
  for (int a = 0; a < CHIME_COUNT; a++) {
    for (int b = a + 1; b < CHIME_COUNT; b++) {
      size_t m = lens[a] < lens[b] ? lens[a] : lens[b];
      int diff = 0;
      for (size_t i = 0; i < m; i++) diff += REF[a][i] != REF[b][i];
      CHECK(diff > (int)(m / 2));
    }
  }
}

static void test_synth_deterministic_and_limits(void) {
  static int16_t a[CHIME_MAX_SAMPLES], b[CHIME_MAX_SAMPLES];
  for (int k = 0; k < CHIME_COUNT; k++) {
    size_t n1 = chime_synth((ChimeKind)k, a, CHIME_MAX_SAMPLES);
    size_t n2 = chime_synth((ChimeKind)k, b, CHIME_MAX_SAMPLES);
    CHECK_EQ_INT((long long)n1, (long long)n2);
    CHECK(memcmp(a, b, n1 * sizeof(int16_t)) == 0);
    CHECK_EQ_INT((long long)chime_synth((ChimeKind)k, a, n1 - 1), 0); // no cabe: no escribe nada
  }
  CHECK_EQ_INT((long long)chime_synth((ChimeKind)CHIME_COUNT, a, CHIME_MAX_SAMPLES), 0);
  CHECK_EQ_INT((long long)chime_synth((ChimeKind)-1, a, CHIME_MAX_SAMPLES), 0);
}

// Cruces por cero: más densos = más agudo.
static int zero_crossings(const int16_t *s, size_t from, size_t to) {
  int c = 0;
  for (size_t i = from + 1; i < to; i++) c += (s[i - 1] < 0) != (s[i] < 0);
  return c;
}

static void test_done_rises(void) {
  size_t n = chime_synth(CHIME_DONE, BUF, CHIME_MAX_SAMPLES);
  size_t a_len = (size_t)130 * CHIME_RATE / 1000, b_from = (size_t)150 * CHIME_RATE / 1000;
  double ra = (double)zero_crossings(BUF, 0, a_len) / (double)a_len;
  double rb = (double)zero_crossings(BUF, b_from, n) / (double)(n - b_from);
  CHECK(rb > ra * 1.3); // la segunda nota es más aguda que la primera
}

int main(void) {
  TEST_BEGIN("chime: compuerta de seq y síntesis de los sonidos");
  RUN(test_first_seq_is_baseline);
  RUN(test_each_kind_maps);
  RUN(test_no_chime_in_first_view_then_seq1_sounds);
  RUN(test_reconnect_resets_baseline);
  RUN(test_seq_backwards_resets_without_sound);
  RUN(test_rate_limit);
  RUN(test_disabled_advances_baseline);
  RUN(test_clock_going_back_does_not_block);
  RUN(test_invalid_kind);
  RUN(test_synth_shape);
  RUN(test_synth_deterministic_and_limits);
  RUN(test_done_rises);
  TEST_END();
}

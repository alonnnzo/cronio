// Reloj virtual sin pausas (logic/pause.c) y su efecto sobre los temporizadores de netplan.
#include "test.h"

#include "../source/logic/netplan.h"
#include "../source/logic/pause.h"

#define CHECK_EQ_U64(a, b) CHECK((uint64_t)(a) == (uint64_t)(b))

static void test_normal_frames(void) {
  PauseClock c;
  pause_init(&c);
  CHECK_EQ_U64(pause_step(&c, 100000), 100000);
  CHECK_EQ_U64(pause_step(&c, 100016), 100016);
  CHECK_EQ_U64(pause_step(&c, 100050), 100050);
  CHECK_EQ_U64(pause_step(&c, 100050), 100050); // dos lecturas en el mismo instante
  CHECK_EQ_U64(pause_step(&c, 100800 - 1), 100799 - 0); // 749 ms: aún no es pausa (un envío puede tardar 500 ms)
  CHECK_EQ_INT((int)c.pauses, 0);
  CHECK_EQ_U64(c.paused_ms, 0);
}

static void test_swkbd_pause_is_one_frame(void) {
  PauseClock c;
  pause_init(&c);
  uint64_t t = pause_step(&c, 50000);
  // el teclado del sistema bloquea el bucle 8 s
  uint64_t after = pause_step(&c, 58000);
  CHECK_EQ_U64(after, t + PAUSE_FRAME_MS);
  CHECK_EQ_INT((int)c.pauses, 1);
  CHECK_EQ_U64(c.paused_ms, 8000 - PAUSE_FRAME_MS);
  // y a partir de ahí el tiempo vuelve a correr normal
  CHECK_EQ_U64(pause_step(&c, 58016), after + 16);
}

static void test_timers_do_not_see_the_pause(void) {
  PauseClock c;
  pause_init(&c);
  uint64_t t0 = pause_step(&c, 10000);
  uint64_t last_ping = t0, last_rx = t0, conn_since = t0;
  // pausa de 20 s (swkbd, reposo o menú HOME)
  uint64_t t1 = pause_step(&c, 30000);
  CHECK(!netplan_ping_due(last_ping, t1));
  CHECK(!netplan_rx_timed_out(last_rx, t1));
  CHECK(!netplan_connect_expired(conn_since, t1));
  CHECK(!netplan_search_expired(conn_since, t1));
  // sin el reloj virtual, todos habrían vencido
  CHECK(netplan_ping_due(last_ping, 30000));
  CHECK(netplan_rx_timed_out(last_rx, 30000));
  CHECK(netplan_connect_expired(conn_since, 30000));
  // el silencio real sigue contando después de la pausa
  uint64_t t = t1;
  for (int i = 0; i < 1000; i++) t = pause_step(&c, 30000 + 16 * (uint64_t)(i + 1));
  CHECK(netplan_rx_timed_out(last_rx, t)); // 16 s de cuadros normales
}

static void test_many_pauses_and_clock_back(void) {
  PauseClock c;
  pause_init(&c);
  uint64_t v = pause_step(&c, 1000);
  v = pause_step(&c, 6000);
  v = pause_step(&c, 12000);
  CHECK_EQ_INT((int)c.pauses, 2);
  CHECK_EQ_U64(v, 1000 + 2 * PAUSE_FRAME_MS);
  uint64_t back = pause_step(&c, 11000); // el reloj retrocede: no resta ni salta
  CHECK_EQ_U64(back, v);
  CHECK_EQ_U64(pause_step(&c, 12016), v + 16);
}

int main(void) {
  TEST_BEGIN("pause: reloj virtual que no ve las pausas del bucle");
  RUN(test_normal_frames);
  RUN(test_swkbd_pause_is_one_frame);
  RUN(test_timers_do_not_see_the_pause);
  RUN(test_many_pauses_and_clock_back);
  TEST_END();
}

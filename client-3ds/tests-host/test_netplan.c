// Política de red (logic/netplan.c): a qué IP conectar, qué hacer tras un fallo de autenticación y cuándo un recv
// significa "aún no conectado". Escenarios con impostores en la red.
#include <errno.h>
#include <limits.h>

#include "test.h"

#include "../source/logic/netplan.h"

// ---- recv tras connect() ----

static void test_recv_verdict(void) {
  // sin bytes recibidos: 0, EAGAIN, EWOULDBLOCK, ENOTCONN, EINPROGRESS son "pendiente"
  CHECK_EQ_INT(netplan_recv_verdict(0, 0, 0), NP_RECV_PENDING);
  CHECK_EQ_INT(netplan_recv_verdict(-1, EAGAIN, 0), NP_RECV_PENDING);
  CHECK_EQ_INT(netplan_recv_verdict(-1, EWOULDBLOCK, 0), NP_RECV_PENDING);
  CHECK_EQ_INT(netplan_recv_verdict(-1, ENOTCONN, 0), NP_RECV_PENDING);
  CHECK_EQ_INT(netplan_recv_verdict(-1, EINPROGRESS, 0), NP_RECV_PENDING);
  CHECK_EQ_INT(netplan_recv_verdict(-1, EALREADY, 0), NP_RECV_PENDING);
  CHECK_EQ_INT(netplan_recv_verdict(-1, EINTR, 0), NP_RECV_PENDING);
  // con datos
  CHECK_EQ_INT(netplan_recv_verdict(1, 0, 0), NP_RECV_DATA);
  CHECK_EQ_INT(netplan_recv_verdict(512, 0, 0), NP_RECV_DATA);
  CHECK_EQ_INT(netplan_recv_verdict(7, 0, 1), NP_RECV_DATA);
  // errores reales
  CHECK_EQ_INT(netplan_recv_verdict(-1, ECONNREFUSED, 0), NP_RECV_ERROR);
  CHECK_EQ_INT(netplan_recv_verdict(-1, ECONNRESET, 0), NP_RECV_ERROR);
  CHECK_EQ_INT(netplan_recv_verdict(-1, ETIMEDOUT, 0), NP_RECV_ERROR);
  CHECK_EQ_INT(netplan_recv_verdict(-1, EHOSTUNREACH, 0), NP_RECV_ERROR);
  // tras el primer byte, 0 es un cierre y ENOTCONN / EINPROGRESS ya no son "aún no"
  CHECK_EQ_INT(netplan_recv_verdict(0, 0, 1), NP_RECV_CLOSED);
  CHECK_EQ_INT(netplan_recv_verdict(-1, EAGAIN, 1), NP_RECV_PENDING);
  CHECK_EQ_INT(netplan_recv_verdict(-1, EWOULDBLOCK, 1), NP_RECV_PENDING);
  CHECK_EQ_INT(netplan_recv_verdict(-1, EINTR, 1), NP_RECV_PENDING);
  CHECK_EQ_INT(netplan_recv_verdict(-1, ENOTCONN, 1), NP_RECV_ERROR);
  CHECK_EQ_INT(netplan_recv_verdict(-1, EINPROGRESS, 1), NP_RECV_ERROR);
  CHECK_EQ_INT(netplan_recv_verdict(-1, ECONNRESET, 1), NP_RECV_ERROR);
}

// ---- arnés: lo que hacen net.c y app.c con la política ----

#define BRIDGE "192.168.0.10"
#define FAKE "192.168.0.40"
#define FAKE2 "192.168.0.50"

typedef enum { OUT_READY, OUT_AUTH, OUT_SILENT, OUT_REFUSED } Outcome;

typedef struct {
  NetPlan p;
  uint64_t now;
  uint64_t search_since;
  int pending_pair;
  int stopped;      // se mostró "error de autenticación" y se dejó de reintentar
  int discarded;    // se descartó el código tecleado
  int attempts;
  int ready;
  char tried[32][NP_HOST_BYTES];
  char loop[3][NP_HOST_BYTES]; // remitentes que avisan sin parar
  int loop_count;
} Sim;

static void sim_init(Sim *s) {
  memset(s, 0, sizeof *s);
  netplan_init(&s->p);
  s->now = 1000;
  s->search_since = 1000;
}

static void sim_beacon(Sim *s, const char *host) { netplan_beacon_seen(&s->p, host, 33334, s->now); }
static void sim_beacon_loop(Sim *s, const char *host) {
  strcpy(s->loop[s->loop_count++], host);
  sim_beacon(s, host);
}

// Un intento con el destino elegido; fn decide cómo responde ese host.
typedef Outcome (*Responder)(const char *host);

static int sim_attempt(Sim *s, Responder fn) {
  NpTarget t;
  if (!netplan_pick(&s->p, s->now, s->search_since, &t)) return 0;
  if (s->attempts < 32) strcpy(s->tried[s->attempts], t.host);
  s->attempts++;
  Outcome o = fn(t.host);
  if (o == OUT_READY) {
    netplan_on_ready(&s->p, t.host);
    netplan_confirm_saved(&s->p, t.host, t.port);
    s->ready = 1;
    s->pending_pair = 0;
    return 1;
  }
  NpFailVerdict v = netplan_on_failure(&s->p, t.host, o == OUT_AUTH, s->pending_pair);
  if (v.action == NP_FAIL_AUTH_STOP) {
    s->stopped = 1;
    if (v.discard_pairing) {
      s->discarded = 1;
      s->pending_pair = 0;
    }
  }
  s->now += netplan_backoff_ms(s->attempts);
  s->search_since = s->now;
  return 1;
}

// hasta READY, parada o n intentos
static void sim_run(Sim *s, Responder fn, int max_attempts) {
  for (int i = 0; i < max_attempts && !s->ready && !s->stopped; i++) {
    for (int k = 0; k < s->loop_count; k++) sim_beacon(s, s->loop[k]);
    if (!sim_attempt(s, fn)) s->now += 500;
  }
}

static Outcome only_fake_auth(const char *h) { return strcmp(h, FAKE) == 0 ? OUT_AUTH : OUT_READY; }
static Outcome everyone_auth(const char *h) { (void)h; return OUT_AUTH; }
static Outcome fake_auth_bridge_ready(const char *h) { return strcmp(h, BRIDGE) == 0 ? OUT_READY : OUT_AUTH; }
static Outcome fake_auth_bridge_down(const char *h) { return strcmp(h, BRIDGE) == 0 ? OUT_REFUSED : OUT_AUTH; }
static Outcome fake_silent_bridge_ready(const char *h) { return strcmp(h, BRIDGE) == 0 ? OUT_READY : OUT_SILENT; }
static Outcome fake_silent_bridge_down(const char *h) { return strcmp(h, BRIDGE) == 0 ? OUT_REFUSED : OUT_SILENT; }
static Outcome bridge_real_wrong_key(const char *h) { return strcmp(h, BRIDGE) == 0 ? OUT_AUTH : OUT_SILENT; }

// ---- impostor que responde "auth" ----

static void test_impostor_auth_no_saved_ip(void) {
  // sin IP guardada y solo el impostor: reintenta y recién a la tercera muestra el error
  Sim s;
  sim_init(&s);
  sim_beacon(&s, FAKE);
  s.pending_pair = 1;
  sim_attempt(&s, everyone_auth);
  CHECK(!s.stopped && !s.discarded);
  CHECK_EQ_INT(netplan_auth_fails(&s.p, FAKE), 1);
  sim_attempt(&s, everyone_auth);
  CHECK(!s.stopped && !s.discarded);
  CHECK(s.pending_pair); // el código tecleado sigue vivo
  sim_attempt(&s, everyone_auth);
  CHECK(s.stopped && s.discarded); // agotados los reintentos: se descarta
  CHECK_EQ_INT(s.attempts, 3);

  // con el puente real también presente, tras el primer fallo del impostor se prueba al otro y empareja
  sim_init(&s);
  sim_beacon(&s, FAKE); // el impostor llegó primero
  s.now += 50;
  sim_beacon(&s, BRIDGE);
  s.pending_pair = 1;
  sim_run(&s, fake_auth_bridge_ready, 10);
  CHECK(s.ready && !s.stopped && !s.discarded);
  CHECK_EQ_INT(s.attempts, 2);
  CHECK_STR(s.tried[0], FAKE);
  CHECK_STR(s.tried[1], BRIDGE);
  CHECK_STR(s.p.saved_host, BRIDGE);
}

static void test_impostor_auth_with_saved_ip(void) {
  // IP guardada verificada, el puente apagado y un impostor que avisa y responde auth: nunca se muestra el error
  Sim s;
  sim_init(&s);
  netplan_set_saved(&s.p, BRIDGE, 33334);
  sim_beacon_loop(&s, FAKE);
  sim_run(&s, fake_auth_bridge_down, 30);
  CHECK(!s.stopped && !s.ready);
  CHECK(s.attempts == 30);
  // se alternó entre el impostor y la IP guardada
  CHECK_STR(s.tried[0], FAKE);
  CHECK_STR(s.tried[1], BRIDGE);
  CHECK_STR(s.tried[2], FAKE);
  CHECK(netplan_auth_fails(&s.p, FAKE) >= 1);
  // vuelve el puente: la siguiente vez que toca la IP guardada, conecta
  s.now += 100;
  netplan_beacon_seen(&s.p, BRIDGE, 33334, s.now);
  sim_run(&s, fake_auth_bridge_ready, 5);
  CHECK(s.ready && !s.stopped);
}

static void test_legit_invalid_key_shows_error_after_first_failure(void) {
  // el puente real, en la IP guardada, responde auth: clave realmente inválida
  Sim s;
  sim_init(&s);
  netplan_set_saved(&s.p, BRIDGE, 33334);
  sim_beacon(&s, BRIDGE);
  sim_attempt(&s, everyone_auth);
  CHECK(s.stopped);
  CHECK_EQ_INT(s.attempts, 1);
  CHECK_STR(s.tried[0], BRIDGE);
  // y sin aviso (conecta a la guardada tras la ventana): igual
  sim_init(&s);
  netplan_set_saved(&s.p, BRIDGE, 33334);
  sim_run(&s, everyone_auth, 10);
  CHECK(s.stopped && s.attempts == 1);
  // el usuario fuerza el reintento: se borran las rachas y vuelve a probar
  netplan_on_user_retry(&s.p);
  CHECK_EQ_INT(netplan_auth_fails(&s.p, BRIDGE), 0);
  s.stopped = 0;
  sim_run(&s, everyone_auth, 10);
  CHECK(s.stopped && s.attempts == 2);

  // un impostor con el puente real ausente no gana el error mientras haya IP guardada
  sim_init(&s);
  netplan_set_saved(&s.p, BRIDGE, 33334);
  sim_beacon(&s, FAKE);
  sim_attempt(&s, fake_auth_bridge_down);
  sim_attempt(&s, fake_auth_bridge_down);
  sim_attempt(&s, fake_auth_bridge_down);
  sim_attempt(&s, fake_auth_bridge_down);
  CHECK(!s.stopped);
}

// ---- impostor que acepta y calla ----

static void test_impostor_silent(void) {
  Sim s;
  sim_init(&s);
  netplan_set_saved(&s.p, BRIDGE, 33334);
  sim_beacon_loop(&s, FAKE);
  sim_run(&s, fake_silent_bridge_down, 12);
  CHECK(!s.stopped);
  CHECK_EQ_INT(netplan_auth_fails(&s.p, FAKE), 0); // callar no es fallo de autenticación
  CHECK_STR(s.tried[0], FAKE);
  CHECK_STR(s.tried[1], BRIDGE); // el siguiente intento va a la IP guardada
  CHECK_STR(s.tried[2], FAKE);   // y se alterna
  // vuelve el puente: llega por su aviso o por la IP guardada
  netplan_beacon_seen(&s.p, BRIDGE, 33334, s.now);
  sim_run(&s, fake_silent_bridge_ready, 5);
  CHECK(s.ready);

  // sin IP guardada: impostor callado primero, puente después, empareja en el segundo intento
  sim_init(&s);
  sim_beacon(&s, FAKE);
  sim_beacon(&s, BRIDGE);
  sim_run(&s, fake_silent_bridge_ready, 5);
  CHECK(s.ready && s.attempts == 2);
  CHECK_STR(s.tried[0], FAKE);
  CHECK_STR(s.tried[1], BRIDGE);
}

// ---- avisos: preferencia y orden ----

static void test_beacon_preference(void) {
  NetPlan p;
  NpTarget t;
  netplan_init(&p);
  // sin IP guardada: el primero recibido, aunque el otro avise más seguido
  netplan_beacon_seen(&p, FAKE, 33334, 1000);
  netplan_beacon_seen(&p, BRIDGE, 33334, 1100);
  for (uint64_t at = 1200; at < 3000; at += 100) netplan_beacon_seen(&p, BRIDGE, 33334, at);
  netplan_beacon_seen(&p, FAKE, 33334, 3000);
  CHECK(netplan_pick(&p, 3050, 1000, &t));
  CHECK_STR(t.host, FAKE);
  CHECK_EQ_INT(t.origin, NP_ORIGIN_BEACON);
  CHECK_EQ_INT(p.beacon_count, 2);
  // con IP guardada: el que coincide, llegara cuando llegara y aunque el impostor avise más
  netplan_set_saved(&p, BRIDGE, 33334);
  CHECK(netplan_pick(&p, 3050, 1000, &t));
  CHECK_STR(t.host, BRIDGE);
  for (uint64_t at = 3100; at < 3900; at += 100) netplan_beacon_seen(&p, FAKE, 33334, at);
  CHECK(netplan_pick(&p, 3950, 1000, &t));
  CHECK_STR(t.host, BRIDGE);
  NpBeacon b;
  CHECK(netplan_best_beacon(&p, 3950, &b));
  CHECK_STR(b.host, BRIDGE);

  // el aviso del puente (último a los 2900) caduca a los 6 s; el del impostor (3800) aún vale
  CHECK(netplan_pick(&p, 9500, 1000, &t));
  CHECK_STR(t.host, FAKE);
}

static void test_beacon_expiry_and_flood(void) {
  NetPlan p;
  NpTarget t;
  netplan_init(&p);
  netplan_beacon_seen(&p, FAKE, 33334, 1000);
  CHECK(!netplan_pick(&p, 7000, 7000, &t)); // vencido: sin IP guardada no hay a dónde ir
  // más remitentes que el tope: los de más no entran, el de la IP guardada sí
  netplan_init(&p);
  const char *hosts[] = {"10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5"};
  for (int i = 0; i < 5; i++) netplan_beacon_seen(&p, hosts[i], 33334, 1000 + (uint64_t)i);
  CHECK_EQ_INT(p.beacon_count, NP_MAX_BEACONS);
  CHECK(netplan_pick(&p, 1100, 1000, &t));
  CHECK_STR(t.host, "10.0.0.1");
  netplan_set_saved(&p, BRIDGE, 33334);
  netplan_beacon_seen(&p, BRIDGE, 33334, 1200);
  CHECK(netplan_pick(&p, 1300, 1000, &t));
  CHECK_STR(t.host, BRIDGE);
  CHECK_EQ_INT(p.beacon_count, NP_MAX_BEACONS);
  // los vencidos se sueltan y hacen sitio
  netplan_init(&p);
  for (int i = 0; i < 4; i++) netplan_beacon_seen(&p, hosts[i], 33334, 1000);
  netplan_beacon_seen(&p, hosts[4], 33334, 8000);
  CHECK_EQ_INT(p.beacon_count, 1);
  CHECK(netplan_pick(&p, 8100, 8000, &t));
  CHECK_STR(t.host, "10.0.0.5");
}

static void test_saved_ip_window_and_origins(void) {
  NetPlan p;
  NpTarget t;
  netplan_init(&p);
  netplan_set_saved(&p, BRIDGE, 40000);
  CHECK(!netplan_pick(&p, 2000, 1000, &t)); // ventana de 3 s sin aviso
  CHECK(!netplan_pick(&p, 3999, 1000, &t));
  CHECK(netplan_pick(&p, 4000, 1000, &t));
  CHECK_STR(t.host, BRIDGE);
  CHECK_EQ_INT(t.port, 40000);
  CHECK_EQ_INT(t.origin, NP_ORIGIN_SAVED);
  CHECK_STR(netplan_origin_name(t.origin), "guardada");
  CHECK_STR(netplan_origin_name(NP_ORIGIN_BEACON), "aviso");
  CHECK_STR(netplan_origin_name(NP_ORIGIN_MANUAL), "manual");
  // un aviso fresco no espera la ventana
  netplan_beacon_seen(&p, FAKE, 33334, 1100);
  CHECK(netplan_pick(&p, 1200, 1000, &t));
  CHECK_STR(t.host, FAKE);
  CHECK_EQ_INT(t.origin, NP_ORIGIN_BEACON);
  // sin nada guardado ni avisos: nada
  netplan_init(&p);
  CHECK(!netplan_pick(&p, 99999, 0, &t));
}

static void test_manual_ip(void) {
  Sim s;
  NpTarget t;
  sim_init(&s);
  netplan_set_saved(&s.p, BRIDGE, 33334);
  sim_beacon(&s, FAKE);
  netplan_set_manual(&s.p, FAKE2, 33334); // escrita a mano: manda sobre los avisos y descarta los vistos
  CHECK_EQ_INT(s.p.beacon_count, 0);
  CHECK(netplan_pick(&s.p, s.now, s.search_since, &t));
  CHECK_STR(t.host, FAKE2);
  CHECK_EQ_INT(t.origin, NP_ORIGIN_MANUAL);
  // si falla, se alterna con los avisos
  netplan_on_failure(&s.p, FAKE2, 0, 0);
  sim_beacon(&s, BRIDGE);
  CHECK(netplan_pick(&s.p, s.now, s.search_since, &t));
  CHECK_STR(t.host, BRIDGE);
  // sin verificar: no hay IP guardada que valga, un mismo host que falla 3 veces seguidas muestra el error
  netplan_init(&s.p);
  netplan_set_manual(&s.p, FAKE2, 33334);
  CHECK_EQ_INT(netplan_on_failure(&s.p, FAKE2, 1, 0).action, NP_FAIL_RETRY);
  CHECK_EQ_INT(netplan_on_failure(&s.p, FAKE2, 1, 0).action, NP_FAIL_RETRY);
  CHECK_EQ_INT(netplan_on_failure(&s.p, FAKE2, 1, 0).action, NP_FAIL_AUTH_STOP);
  // al llegar a READY con una vista válida pasa a ser la guardada
  netplan_confirm_saved(&s.p, FAKE2, 33334);
  CHECK(s.p.saved_verified && !s.p.manual);
}

// ---- veredictos ----

static void test_verdicts(void) {
  NetPlan p;
  netplan_init(&p);
  // sin IP guardada: tres fallos seguidos del mismo host; otro tipo de fallo corta la racha
  CHECK_EQ_INT(netplan_on_failure(&p, FAKE, 1, 0).action, NP_FAIL_RETRY);
  CHECK_EQ_INT(netplan_on_failure(&p, FAKE, 1, 0).action, NP_FAIL_RETRY);
  netplan_on_failure(&p, FAKE, 0, 0); // por ejemplo, no respondió
  CHECK_EQ_INT(netplan_auth_fails(&p, FAKE), 0);
  CHECK_EQ_INT(netplan_on_failure(&p, FAKE, 1, 0).action, NP_FAIL_RETRY);
  CHECK_EQ_INT(netplan_on_failure(&p, FAKE, 1, 0).action, NP_FAIL_RETRY);
  NpFailVerdict v = netplan_on_failure(&p, FAKE, 1, 1);
  CHECK_EQ_INT(v.action, NP_FAIL_AUTH_STOP);
  CHECK_EQ_INT(v.discard_pairing, 1);

  // por host: dos impostores que fallan alternados no suman entre sí
  netplan_init(&p);
  for (int i = 0; i < 2; i++) {
    CHECK_EQ_INT(netplan_on_failure(&p, FAKE, 1, 0).action, NP_FAIL_RETRY);
    CHECK_EQ_INT(netplan_on_failure(&p, FAKE2, 1, 0).action, NP_FAIL_RETRY);
  }
  CHECK_EQ_INT(netplan_on_failure(&p, FAKE, 1, 0).action, NP_FAIL_AUTH_STOP);
  // READY borra las rachas
  netplan_init(&p);
  netplan_on_failure(&p, FAKE, 1, 0);
  netplan_on_failure(&p, FAKE, 1, 0);
  netplan_on_ready(&p, BRIDGE);
  CHECK_EQ_INT(netplan_auth_fails(&p, FAKE), 0);
  CHECK(p.last_failed[0] == '\0');

  // con IP guardada, solo ella detiene; sin descartar el código cuando no había emparejamiento
  netplan_init(&p);
  netplan_set_saved(&p, BRIDGE, 33334);
  for (int i = 0; i < 10; i++) CHECK_EQ_INT(netplan_on_failure(&p, FAKE, 1, 1).action, NP_FAIL_RETRY);
  v = netplan_on_failure(&p, BRIDGE, 1, 0);
  CHECK_EQ_INT(v.action, NP_FAIL_AUTH_STOP);
  CHECK_EQ_INT(v.discard_pairing, 0);
  // la IP guardada sigue intacta tras el error
  CHECK_STR(p.saved_host, BRIDGE);
  CHECK(p.saved_verified);

  // tabla de hosts llena: el más antiguo se suelta y no rompe nada
  netplan_init(&p);
  const char *hosts[] = {"10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4", "10.0.0.5", "10.0.0.6"};
  for (int i = 0; i < 6; i++) netplan_on_failure(&p, hosts[i], 1, 0);
  CHECK_EQ_INT(p.auth_count, NP_MAX_AUTH_HOSTS);
  CHECK_EQ_INT(netplan_auth_fails(&p, "10.0.0.1"), 0);
  CHECK_EQ_INT(netplan_auth_fails(&p, "10.0.0.6"), 1);
}

// ---- emparejamiento con impostor activo ----

static void test_pairing_with_active_impostor(void) {
  // había una clave guardada para el puente de siempre (.84); se teclea un código nuevo y un impostor está activo
  Sim s;
  sim_init(&s);
  netplan_set_saved(&s.p, BRIDGE, 33334);
  sim_beacon(&s, FAKE);
  s.pending_pair = 1;
  sim_attempt(&s, bridge_real_wrong_key); // el impostor calla (aviso primero)
  CHECK(!s.stopped && !s.discarded && s.pending_pair);
  CHECK_STR(s.tried[0], FAKE);
  sim_attempt(&s, bridge_real_wrong_key); // la IP guardada responde auth: el código no es el del puente de siempre
  CHECK_STR(s.tried[1], BRIDGE);
  CHECK(s.stopped && s.discarded);
  CHECK(!s.pending_pair);
  CHECK_STR(s.p.saved_host, BRIDGE); // lo guardado sigue
  CHECK(s.p.saved_verified);

  // primer emparejamiento (sin IP guardada) con impostor que responde auth y el puente real que sí acepta
  sim_init(&s);
  sim_beacon(&s, FAKE);
  s.now += 10;
  sim_beacon(&s, BRIDGE);
  s.pending_pair = 1;
  sim_run(&s, fake_auth_bridge_ready, 10);
  CHECK(s.ready && !s.discarded);
  CHECK_STR(s.p.saved_host, BRIDGE);

  // primer emparejamiento solo con el impostor: el código se descarta cuando se agotan los reintentos
  sim_init(&s);
  sim_beacon(&s, FAKE);
  s.pending_pair = 1;
  sim_run(&s, everyone_auth, 10);
  CHECK(s.stopped && s.discarded);
  CHECK_EQ_INT(s.attempts, NP_AUTH_MAX_FAILS);
  // y no hay IP guardada ni verificada
  CHECK(s.p.saved_host[0] == '\0');
}

static void test_flooding_impostor_does_not_block_real(void) {
  // el impostor avisa 10 veces más seguido; con IP guardada el puente real gana siempre que avise
  Sim s;
  sim_init(&s);
  netplan_set_saved(&s.p, BRIDGE, 33334);
  sim_beacon(&s, FAKE);
  for (int i = 0; i < 50; i++) {
    s.now += 100;
    sim_beacon(&s, FAKE);
    if (i % 30 == 0) sim_beacon(&s, BRIDGE);
  }
  sim_run(&s, only_fake_auth, 3);
  CHECK(s.ready);
  CHECK_STR(s.tried[0], BRIDGE);
}

// libctru deja errno negativo tras un socket() fallido (-115 = -ENETDOWN en la New 3DS XL): se clasifica por valor absoluto.
static void test_negative_errno(void) {
  CHECK_EQ_INT(netplan_errno_abs(-115), 115);
  CHECK_EQ_INT(netplan_errno_abs(115), 115);
  CHECK_EQ_INT(netplan_errno_abs(0), 0);
  CHECK(netplan_errno_abs(INT_MIN) > 0);
  CHECK_EQ_INT(ENETDOWN, 115); // el valor que se vio en la consola

  CHECK_EQ_INT(netplan_errno_kind(-115), NP_ERR_NETDOWN);
  CHECK_EQ_INT(netplan_errno_kind(ENETDOWN), NP_ERR_NETDOWN);
  CHECK_EQ_INT(netplan_errno_kind(-EAGAIN), NP_ERR_PENDING);
  CHECK_EQ_INT(netplan_errno_kind(-EINPROGRESS), NP_ERR_PENDING);
  CHECK_EQ_INT(netplan_errno_kind(EALREADY), NP_ERR_PENDING);
  CHECK_EQ_INT(netplan_errno_kind(-EINTR), NP_ERR_PENDING);
  CHECK_EQ_INT(netplan_errno_kind(-ECONNRESET), NP_ERR_CLOSED);
  CHECK_EQ_INT(netplan_errno_kind(-EPIPE), NP_ERR_CLOSED);
  CHECK_EQ_INT(netplan_errno_kind(-ECONNREFUSED), NP_ERR_REFUSED);
  CHECK_EQ_INT(netplan_errno_kind(-ETIMEDOUT), NP_ERR_UNREACHABLE);
  CHECK_EQ_INT(netplan_errno_kind(-EHOSTUNREACH), NP_ERR_UNREACHABLE);
  CHECK_EQ_INT(netplan_errno_kind(-ENETUNREACH), NP_ERR_UNREACHABLE);
  CHECK_EQ_INT(netplan_errno_kind(-10040), NP_ERR_OTHER); // código sin traducir de libctru
  CHECK_EQ_INT(netplan_errno_kind(0), NP_ERR_OTHER);

  // recv con errno negativo: igual que con el positivo
  CHECK_EQ_INT(netplan_recv_verdict(-1, -EAGAIN, 0), NP_RECV_PENDING);
  CHECK_EQ_INT(netplan_recv_verdict(-1, -EWOULDBLOCK, 1), NP_RECV_PENDING);
  CHECK_EQ_INT(netplan_recv_verdict(-1, -ENOTCONN, 0), NP_RECV_PENDING);
  CHECK_EQ_INT(netplan_recv_verdict(-1, -EINPROGRESS, 0), NP_RECV_PENDING);
  CHECK_EQ_INT(netplan_recv_verdict(-1, -ENOTCONN, 1), NP_RECV_ERROR);
  CHECK_EQ_INT(netplan_recv_verdict(-1, -ECONNRESET, 1), NP_RECV_ERROR);

  // los textos para el usuario no llevan el número crudo
  for (int k = NP_ERR_PENDING; k <= NP_ERR_OTHER; k++) {
    const char *t = netplan_errno_reason((NpErrKind)k);
    CHECK(t != NULL && t[0] != '\0');
    int digits = 0;
    for (const char *c = t; *c; c++) digits += (*c >= '0' && *c <= '9');
    CHECK_EQ_INT(digits, 0);
    CHECK(strstr(t, "error") == NULL);
  }
  CHECK_STR(netplan_errno_reason(NP_ERR_NETDOWN), "La red no está lista");
}

int main(void) {
  TEST_BEGIN("netplan: destino, fallos de autenticación con impostores y recv tras connect");
  RUN(test_recv_verdict);
  RUN(test_negative_errno);
  RUN(test_impostor_auth_no_saved_ip);
  RUN(test_impostor_auth_with_saved_ip);
  RUN(test_legit_invalid_key_shows_error_after_first_failure);
  RUN(test_impostor_silent);
  RUN(test_beacon_preference);
  RUN(test_beacon_expiry_and_flood);
  RUN(test_saved_ip_window_and_origins);
  RUN(test_manual_ip);
  RUN(test_verdicts);
  RUN(test_pairing_with_active_impostor);
  RUN(test_flooding_impostor_does_not_block_real);
  TEST_END();
}

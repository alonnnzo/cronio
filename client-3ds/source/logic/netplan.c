#include "netplan.h"

#include <errno.h>
#include <limits.h>
#include <string.h>

static int64_t elapsed(uint64_t since, uint64_t now) { return (int64_t)now - (int64_t)since; }

uint32_t netplan_backoff_ms(int failures) {
  if (failures < 1) failures = 1;
  if (failures > 3) return NETPLAN_BACKOFF_CAP_MS;
  return 1000u << (failures - 1);
}

int netplan_search_expired(uint64_t since, uint64_t now) { return elapsed(since, now) >= NETPLAN_SEARCH_WINDOW_MS; }
int netplan_connect_expired(uint64_t since, uint64_t now) { return elapsed(since, now) >= NETPLAN_CONNECT_TIMEOUT_MS; }
int netplan_beacon_fresh(uint64_t at, uint64_t now) {
  int64_t e = elapsed(at, now);
  return e >= 0 && e < NETPLAN_BEACON_FRESH_MS;
}
int netplan_ping_due(uint64_t last_ping, uint64_t now) { return elapsed(last_ping, now) >= NETPLAN_PING_INTERVAL_MS; }
int netplan_rx_timed_out(uint64_t last_rx, uint64_t now) { return elapsed(last_rx, now) >= NETPLAN_RX_TIMEOUT_MS; }
int netplan_udp_stale(uint64_t quiet_since, uint64_t now) { return elapsed(quiet_since, now) >= NETPLAN_UDP_STALE_MS; }
int netplan_sock_restart_due(int consecutive) { return consecutive >= NETPLAN_SOCK_FAILS_MAX; }

// ---------- errno ----------

int netplan_errno_abs(int err) { return err == INT_MIN ? INT_MAX : (err < 0 ? -err : err); }

NpErrKind netplan_errno_kind(int err) {
  int e = netplan_errno_abs(err);
  if (e == EAGAIN || e == EWOULDBLOCK || e == EINPROGRESS || e == EALREADY || e == EINTR) return NP_ERR_PENDING;
  if (e == ECONNRESET || e == ECONNABORTED || e == EPIPE || e == ENOTCONN) return NP_ERR_CLOSED;
  if (e == ECONNREFUSED) return NP_ERR_REFUSED;
  if (e == ETIMEDOUT || e == EHOSTUNREACH || e == ENETUNREACH) return NP_ERR_UNREACHABLE;
  if (e == ENETDOWN || e == ENETRESET) return NP_ERR_NETDOWN;
  return NP_ERR_OTHER;
}

const char *netplan_errno_reason(NpErrKind k) {
  switch (k) {
    case NP_ERR_PENDING: return "Conectando con el puente";
    case NP_ERR_CLOSED: return "El puente cortó la conexión";
    case NP_ERR_REFUSED: return "El puente rechazó la conexión";
    case NP_ERR_UNREACHABLE: return "No se encontró el PC en la red";
    case NP_ERR_NETDOWN: return "La red no está lista";
    case NP_ERR_OTHER: break;
  }
  return "No se pudo conectar con el puente";
}

// ---------- recv tras connect() ----------

NpRecvVerdict netplan_recv_verdict(int r, int err, int bytes_seen) {
  if (r > 0) return NP_RECV_DATA;
  if (r == 0) return bytes_seen ? NP_RECV_CLOSED : NP_RECV_PENDING;
  int e = netplan_errno_abs(err); // por valor absoluto: libctru puede dejar errno negativo
  if (e == EAGAIN || e == EWOULDBLOCK || e == EINTR) return NP_RECV_PENDING;
  if (!bytes_seen && (e == ENOTCONN || e == EINPROGRESS || e == EALREADY)) return NP_RECV_PENDING;
  return NP_RECV_ERROR;
}

// ---------- destino y fallos ----------

static void copy_host(char dst[NP_HOST_BYTES], const char *src) {
  size_t n = src != NULL ? strlen(src) : 0;
  if (n >= NP_HOST_BYTES) n = NP_HOST_BYTES - 1;
  if (n > 0) memcpy(dst, src, n);
  dst[n] = '\0';
}

void netplan_init(NetPlan *p) { memset(p, 0, sizeof *p); }

void netplan_clear_beacons(NetPlan *p) { p->beacon_count = 0; }

static void clear_failures(NetPlan *p) {
  p->last_failed[0] = '\0';
  p->auth_count = 0;
}

void netplan_set_saved(NetPlan *p, const char *host, uint16_t port) {
  copy_host(p->saved_host, host);
  p->saved_port = port;
  p->saved_verified = p->saved_host[0] != '\0';
  p->manual = 0;
}

void netplan_set_manual(NetPlan *p, const char *host, uint16_t port) {
  copy_host(p->saved_host, host);
  p->saved_port = port;
  p->saved_verified = 0;
  p->manual = p->saved_host[0] != '\0';
  netplan_clear_beacons(p);
  clear_failures(p);
}

void netplan_confirm_saved(NetPlan *p, const char *host, uint16_t port) {
  netplan_set_saved(p, host, port);
}

void netplan_beacon_seen(NetPlan *p, const char *host, uint16_t port, uint64_t now) {
  int kept = 0; // los vencidos se sueltan; el orden de llegada de los demás se conserva
  for (int i = 0; i < p->beacon_count; i++) {
    if (netplan_beacon_fresh(p->beacons[i].at, now)) p->beacons[kept++] = p->beacons[i];
  }
  p->beacon_count = kept;
  for (int i = 0; i < p->beacon_count; i++) {
    if (strcmp(p->beacons[i].host, host) == 0) {
      p->beacons[i].port = port;
      p->beacons[i].at = now;
      return;
    }
  }
  int slot;
  if (p->beacon_count < NP_MAX_BEACONS) slot = p->beacon_count++;
  else if (p->saved_host[0] != '\0' && strcmp(host, p->saved_host) == 0) slot = NP_MAX_BEACONS - 1; // el de la IP guardada siempre entra
  else return; // lleno de avisos frescos: no se deja que un remitente más desplace a los que ya estaban
  copy_host(p->beacons[slot].host, host);
  p->beacons[slot].port = port;
  p->beacons[slot].at = now;
}

static const NpBeacon *find_fresh(const NetPlan *p, const char *host, uint64_t now) {
  for (int i = 0; i < p->beacon_count; i++) {
    if (netplan_beacon_fresh(p->beacons[i].at, now) && strcmp(p->beacons[i].host, host) == 0) return &p->beacons[i];
  }
  return NULL;
}

// Primer aviso fresco cuyo host no es `skip` (NULL: cualquiera).
static const NpBeacon *first_fresh(const NetPlan *p, const char *skip, uint64_t now) {
  for (int i = 0; i < p->beacon_count; i++) {
    if (!netplan_beacon_fresh(p->beacons[i].at, now)) continue;
    if (skip != NULL && strcmp(p->beacons[i].host, skip) == 0) continue;
    return &p->beacons[i];
  }
  return NULL;
}

int netplan_best_beacon(const NetPlan *p, uint64_t now, NpBeacon *out) {
  const NpBeacon *b = p->saved_host[0] != '\0' ? find_fresh(p, p->saved_host, now) : NULL;
  if (b == NULL) b = first_fresh(p, NULL, now);
  if (b == NULL) return 0;
  *out = *b;
  return 1;
}

static void fill(NpTarget *t, const char *host, uint16_t port, NpOrigin origin) {
  copy_host(t->host, host);
  t->port = port;
  t->origin = origin;
}

int netplan_pick(const NetPlan *p, uint64_t now, uint64_t search_since, NpTarget *out) {
  const char *avoid = p->last_failed;
  int have_avoid = avoid[0] != '\0';
  int have_saved = p->saved_host[0] != '\0';
  int saved_is_avoid = have_saved && have_avoid && strcmp(p->saved_host, avoid) == 0;
  const NpBeacon *b;

  if (p->manual && have_saved && !saved_is_avoid) {
    fill(out, p->saved_host, p->saved_port, NP_ORIGIN_MANUAL);
    return 1;
  }
  if (have_avoid && have_saved && !saved_is_avoid) { // tras un fallo: la IP guardada, si es distinta
    b = find_fresh(p, p->saved_host, now);
    fill(out, p->saved_host, b != NULL ? b->port : p->saved_port, p->manual ? NP_ORIGIN_MANUAL : NP_ORIGIN_SAVED);
    return 1;
  }
  if (!have_avoid && have_saved && (b = find_fresh(p, p->saved_host, now)) != NULL) { // el aviso de la IP guardada
    fill(out, b->host, b->port, NP_ORIGIN_BEACON);
    return 1;
  }
  if ((b = first_fresh(p, have_avoid ? avoid : NULL, now)) != NULL) { // el primero recibido (otro que el que falló)
    fill(out, b->host, b->port, NP_ORIGIN_BEACON);
    return 1;
  }
  if (have_avoid && (b = find_fresh(p, avoid, now)) != NULL) { // solo queda el que falló
    fill(out, b->host, b->port, NP_ORIGIN_BEACON);
    return 1;
  }
  if (have_saved && netplan_search_expired(search_since, now)) { // sin avisos: la IP guardada tras la ventana
    fill(out, p->saved_host, p->saved_port, p->manual ? NP_ORIGIN_MANUAL : NP_ORIGIN_SAVED);
    return 1;
  }
  return 0;
}

static int auth_index(const NetPlan *p, const char *host) {
  for (int i = 0; i < p->auth_count; i++) {
    if (strcmp(p->auth[i].host, host) == 0) return i;
  }
  return -1;
}

int netplan_auth_fails(const NetPlan *p, const char *host) {
  int i = auth_index(p, host);
  return i < 0 ? 0 : p->auth[i].fails;
}

NpFailVerdict netplan_on_failure(NetPlan *p, const char *host, int is_auth, int pending_pair) {
  NpFailVerdict v = {NP_FAIL_RETRY, 0};
  copy_host(p->last_failed, host);
  int i = auth_index(p, host);
  if (!is_auth) { // otro tipo de fallo corta la racha de este host
    if (i >= 0) p->auth[i].fails = 0;
    return v;
  }
  if (i < 0) {
    if (p->auth_count == NP_MAX_AUTH_HOSTS) { // lleno: se suelta el más antiguo
      memmove(&p->auth[0], &p->auth[1], sizeof p->auth[0] * (NP_MAX_AUTH_HOSTS - 1));
      p->auth_count--;
    }
    i = p->auth_count++;
    copy_host(p->auth[i].host, host);
    p->auth[i].fails = 0;
  }
  p->auth[i].fails++;
  int known = p->saved_host[0] != '\0' && p->saved_verified;
  int stop = known ? strcmp(host, p->saved_host) == 0 : p->auth[i].fails >= NP_AUTH_MAX_FAILS;
  if (stop) {
    v.action = NP_FAIL_AUTH_STOP;
    v.discard_pairing = pending_pair ? 1 : 0;
  }
  return v;
}

void netplan_on_ready(NetPlan *p, const char *host) {
  (void)host;
  clear_failures(p);
}

void netplan_on_user_retry(NetPlan *p) { clear_failures(p); }

const char *netplan_origin_name(NpOrigin o) {
  switch (o) {
    case NP_ORIGIN_BEACON: return "aviso";
    case NP_ORIGIN_SAVED: return "guardada";
    case NP_ORIGIN_MANUAL: return "manual";
    case NP_ORIGIN_NONE: break;
  }
  return "-";
}

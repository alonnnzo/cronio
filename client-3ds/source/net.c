#include "net.h"

#include <3ds.h>
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <malloc.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#include "diag_state.h"
#include "logic/beacon.h"
#include "logic/netplan.h"

#define SOC_ALIGN 0x1000
#define SOC_BUFFERSIZE 0x100000
#define UDP_PORT 33333
#define SEND_STEP_NS 2000000ULL // 2 ms
#define SEND_MAX_STEPS 250      // 500 ms

static u32 *g_soc_buf;

const char *net_state_name(NetState s) {
  switch (s) {
    case NET_NO_SOC: return "NO_SOC";
    case NET_SEARCHING: return "SEARCHING";
    case NET_CONNECTING: return "CONNECTING";
    case NET_CONNECTED: return "CONNECTED";
    case NET_WAITING: return "WAITING";
  }
  return "?";
}

static void set_nonblock(int s) { fcntl(s, F_SETFL, fcntl(s, F_GETFL, 0) | O_NONBLOCK); }

static void close_sock(int *s) {
  if (*s >= 0) {
    close(*s);
    *s = -1;
  }
}

static void set_reason(Net *n, const char *text) { snprintf(n->reason, sizeof n->reason, "%s", text); }

// Texto para el usuario: sin el número de errno (ese solo va en el diagnóstico). e puede venir negativo.
static const char *errno_reason(int e) { return netplan_errno_reason(netplan_errno_kind(e)); }

// ---------- soc y UDP ----------

static void soc_start(Net *n, uint64_t now);

// Crear un socket falló: tras NETPLAN_SOCK_FAILS_MAX fallos seguidos, como último recurso, se reinicia soc por completo
// (socExit, liberar y volver a reservar el búfer, socInit). Un reinicio deja la red en SEARCHING o NO_SOC.
static void sock_failed(Net *n, uint64_t now) {
  n->sock_fails++;
  if (!netplan_sock_restart_due(n->sock_fails)) return;
  n->sock_fails = 0;
  close_sock(&n->tcp);
  close_sock(&n->udp);
  n->first_len = n->first_off = 0;
  if (n->soc_ok) socExit();
  n->soc_ok = 0;
  free(g_soc_buf);
  g_soc_buf = NULL;
  g_diag.soc_restarts++;
  soc_start(n, now);
}

// Abre el UDP de avisos. 1 si quedó abierto; si no, anota el errno y cuenta un fallo de socket.
static int open_udp(Net *n, uint64_t now) {
  close_sock(&n->udp);
  n->udp_quiet_since = now;
  int s = socket(AF_INET, SOCK_DGRAM, 0);
  if (s < 0) {
    diag_errno(&g_diag, DIAG_CALL_SOCKET, errno);
    n->udp_retry_at = now + 1000;
    sock_failed(n, now);
    return 0;
  }
  int yes = 1;
  setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof yes);
  struct sockaddr_in a;
  memset(&a, 0, sizeof a);
  a.sin_family = AF_INET;
  a.sin_addr.s_addr = INADDR_ANY;
  a.sin_port = htons(UDP_PORT);
  if (bind(s, (struct sockaddr *)&a, sizeof a) < 0) {
    diag_errno(&g_diag, DIAG_CALL_SOCKET, errno);
    close(s);
    n->udp_retry_at = now + 1000;
    sock_failed(n, now);
    return 0;
  }
  set_nonblock(s);
  n->udp = s;
  n->sock_fails = 0;
  return 1;
}

// Vuelve a crear el UDP (tras el reposo o si llevaba mucho sin avisos).
static void recreate_udp(Net *n, uint64_t now) {
  g_diag.udp_recreated++;
  open_udp(n, now);
}

static void soc_start(Net *n, uint64_t now) {
  if (g_soc_buf == NULL) g_soc_buf = memalign(SOC_ALIGN, SOC_BUFFERSIZE);
  Result rc = (Result)0xFFFFFFFFu; // sin búfer
  if (g_soc_buf != NULL) rc = socInit(g_soc_buf, SOC_BUFFERSIZE);
  g_diag.soc_tried = 1;
  g_diag.soc_rc = (uint32_t)rc;
  n->soc_ok = R_SUCCEEDED(rc);
  if (n->soc_ok) {
    n->state = NET_SEARCHING;
    n->state_since = now;
    open_udp(n, now); // si falla, net_update lo reintenta
  } else {
    n->state = NET_NO_SOC;
    n->retry_at = now + NETPLAN_SOC_RETRY_MS;
    set_reason(n, "Sin red: no arrancó el Wi-Fi");
  }
}

int net_init(Net *n, uint64_t now) {
  memset(n, 0, sizeof *n);
  n->udp = n->tcp = -1;
  n->allow_connect = 1;
  netplan_init(&n->plan);
  soc_start(n, now);
  return n->soc_ok;
}

static void close_all(Net *n) {
  close_sock(&n->tcp);
  close_sock(&n->udp);
  n->first_len = n->first_off = 0;
}

void net_exit(Net *n) {
  close_all(n);
  if (n->soc_ok) socExit();
  n->soc_ok = 0;
  free(g_soc_buf);
  g_soc_buf = NULL;
}

void net_wake(Net *n, uint64_t now) {
  close_all(n);
  n->failures = 0;
  n->sock_fails = 0;
  netplan_clear_beacons(&n->plan);
  netplan_on_user_retry(&n->plan);
  if (!n->soc_ok) {
    soc_start(n, now);
    return;
  }
  n->state = NET_SEARCHING;
  n->state_since = now;
  recreate_udp(n, now); // el hold (error de autenticación) se conserva
}

// ---------- configuración ----------

void net_set_saved(Net *n, const char *host, uint16_t port) { netplan_set_saved(&n->plan, host, port); }

void net_set_manual(Net *n, const char *host, uint16_t port) { netplan_set_manual(&n->plan, host, port); }

void net_confirm_saved(Net *n) { netplan_confirm_saved(&n->plan, n->target_host, n->target_port); }

void net_set_allow_connect(Net *n, int allow) { n->allow_connect = allow; }

void net_kick(Net *n, uint64_t now) {
  close_sock(&n->tcp);
  n->first_len = n->first_off = 0;
  n->failures = 0;
  n->hold = 0;
  netplan_on_user_retry(&n->plan);
  if (!n->soc_ok) return;
  n->state = NET_SEARCHING;
  n->state_since = now > NETPLAN_SEARCH_WINDOW_MS ? now - NETPLAN_SEARCH_WINDOW_MS : 0; // ventana ya vencida
}

void net_release(Net *n) { n->hold = 0; }

void net_hold(Net *n) {
  close_sock(&n->tcp);
  n->first_len = n->first_off = 0;
  n->hold = 1;
  if (n->soc_ok) n->state = NET_SEARCHING;
}

// ---------- avisos UDP ----------

static void pump_udp(Net *n, uint64_t now) {
  if (n->udp < 0) return;
  for (int i = 0; i < 4; i++) {
    char buf[512];
    struct sockaddr_in from;
    socklen_t fl = sizeof from;
    int r = recvfrom(n->udp, buf, sizeof buf, 0, (struct sockaddr *)&from, &fl);
    if (r <= 0) return;
    uint16_t port;
    if (beacon_parse(buf, (size_t)r, &port) != 0) continue; // otro programa en el mismo puerto
    const char *ip = inet_ntoa(from.sin_addr);
    netplan_beacon_seen(&n->plan, ip, port, now);
    diag_beacon(&g_diag, ip);
    n->udp_quiet_since = now;
  }
}

// ---------- conexión ----------

// Cierra la conexión y programa el reintento con espera creciente.
static void fail(Net *n, const char *reason, uint64_t now) {
  close_sock(&n->tcp);
  n->first_len = n->first_off = 0;
  set_reason(n, reason);
  n->failures++;
  n->state = NET_WAITING;
  n->retry_at = now + netplan_backoff_ms(n->failures);
}

// Fallo de red (no de autenticación) con el host actual: cuenta para alternar de candidato.
static void fail_net(Net *n, const char *reason, uint64_t now) {
  netplan_on_failure(&n->plan, n->target_host, 0, 0);
  fail(n, reason, now);
}

static void begin_connect(Net *n, const NpTarget *t, uint64_t now) {
  close_sock(&n->tcp);
  n->first_len = n->first_off = 0;
  snprintf(n->target_host, sizeof n->target_host, "%s", t->host);
  n->target_port = t->port != 0 ? t->port : CONFIG_DEFAULT_PORT;
  n->target_origin = t->origin;
  int s = socket(AF_INET, SOCK_STREAM, IPPROTO_IP);
  if (s < 0) {
    int e = errno; // libctru lo deja negativo (-115 = -ENETDOWN): se clasifica por valor absoluto
    diag_errno(&g_diag, DIAG_CALL_SOCKET, e);
    fail(n, errno_reason(e), now); // no es culpa del host: no cuenta para alternar de candidato
    sock_failed(n, now);           // 3 seguidos: reinicio completo de soc (último recurso)
    return;
  }
  n->sock_fails = 0;
  set_nonblock(s);
#ifdef TCP_NODELAY
  int yes = 1;
  setsockopt(s, IPPROTO_TCP, TCP_NODELAY, &yes, sizeof yes); // si el servicio no lo admite, se ignora
#endif
  struct sockaddr_in a;
  memset(&a, 0, sizeof a);
  a.sin_family = AF_INET;
  a.sin_port = htons(n->target_port);
  a.sin_addr.s_addr = inet_addr(n->target_host);
  int r = connect(s, (struct sockaddr *)&a, sizeof a);
  if (r < 0) {
    int e = errno;
    diag_errno(&g_diag, DIAG_CALL_CONNECT, e);
    if (netplan_errno_kind(e) != NP_ERR_PENDING) { // EINPROGRESS (con cualquier signo) es lo normal en no bloqueante
      close(s);
      fail_net(n, errno_reason(e), now);
      return;
    }
  }
  n->tcp = s;
  n->state = NET_CONNECTING;
  n->state_since = now;
}

// El UDP solo importa mientras se busca: si no se pudo abrir se reintenta cada segundo, y si lleva 10 s buscando sin
// ningún aviso se recrea (el socket pudo quedar sordo tras un cambio de red). Fuera de la búsqueda no hay nada que medir.
static void maintain_udp(Net *n, uint64_t now) {
  if (!n->soc_ok) return;
  if (n->state != NET_SEARCHING && n->state != NET_WAITING) {
    n->udp_quiet_since = now;
    return;
  }
  if (n->udp < 0) {
    if (now >= n->udp_retry_at) open_udp(n, now);
  } else if (netplan_udp_stale(n->udp_quiet_since, now)) {
    recreate_udp(n, now);
  }
}

int net_update(Net *n, uint64_t now) {
  maintain_udp(n, now);
  switch (n->state) {
    case NET_NO_SOC:
      if (now >= n->retry_at) soc_start(n, now);
      return 0;

    case NET_SEARCHING: {
      pump_udp(n, now);
      if (!n->allow_connect || n->hold) return 0;
      NpTarget t;
      if (netplan_pick(&n->plan, now, n->state_since, &t)) begin_connect(n, &t, now);
      return 0;
    }

    case NET_CONNECTING: {
      pump_udp(n, now);
      int r = recv(n->tcp, n->first, sizeof n->first, 0);
      int e = errno;
      if (r < 0) diag_errno(&g_diag, DIAG_CALL_RECV, e);
      switch (netplan_recv_verdict(r, e, 0)) {
        case NP_RECV_DATA:
          n->first_len = (size_t)r;
          n->first_off = 0;
          n->state = NET_CONNECTED;
          diag_bytes(&g_diag, (uint64_t)r, 0);
          return 1;
        case NP_RECV_PENDING: // en la consola, recv aún sin conectar puede dar 0 o ENOTCONN: se espera hasta el plazo
          if (netplan_connect_expired(n->state_since, now)) fail_net(n, "El puente no respondió", now);
          return 0;
        case NP_RECV_CLOSED:
          fail_net(n, "El puente cerró la conexión", now);
          return 0;
        case NP_RECV_ERROR:
          fail_net(n, errno_reason(e), now);
          return 0;
      }
      return 0;
    }

    case NET_CONNECTED:
      pump_udp(n, now);
      return 0;

    case NET_WAITING:
      pump_udp(n, now);
      if (!n->hold && now >= n->retry_at) {
        n->state = NET_SEARCHING;
        n->state_since = now;
      }
      return 0;
  }
  return 0;
}

int net_recv(Net *n, uint8_t *buf, size_t cap, uint64_t now) {
  if (n->state != NET_CONNECTED || n->tcp < 0) return -1;
  if (n->first_off < n->first_len) {
    size_t k = n->first_len - n->first_off;
    if (k > cap) k = cap;
    memcpy(buf, n->first + n->first_off, k);
    n->first_off += k;
    return (int)k;
  }
  int r = recv(n->tcp, buf, cap, 0);
  int e = errno;
  if (r < 0) diag_errno(&g_diag, DIAG_CALL_RECV, e);
  switch (netplan_recv_verdict(r, e, 1)) { // ya llegó el primer byte: 0 significa cierre
    case NP_RECV_DATA:
      diag_bytes(&g_diag, (uint64_t)r, 0);
      return r;
    case NP_RECV_PENDING: return 0;
    case NP_RECV_CLOSED:
      fail_net(n, "El puente cerró la conexión", now);
      return -1;
    case NP_RECV_ERROR: break;
  }
  fail_net(n, errno_reason(e), now);
  return -1;
}

int net_send_all(Net *n, const uint8_t *data, size_t len) {
  if (n->tcp < 0) return -1;
  size_t sent = 0;
  int waits = 0;
  while (sent < len) {
    int r = send(n->tcp, data + sent, len - sent, 0);
    if (r > 0) {
      sent += (size_t)r;
      waits = 0;
      diag_bytes(&g_diag, 0, (uint64_t)r);
      continue;
    }
    int e = errno;
    if (r < 0) diag_errno(&g_diag, DIAG_CALL_SEND, e);
    if (r < 0 && netplan_errno_kind(e) == NP_ERR_PENDING && waits++ < SEND_MAX_STEPS) { // EAGAIN, EINTR...
      svcSleepThread(SEND_STEP_NS);
      continue;
    }
    return -1;
  }
  return 0;
}

int net_transport_send(void *ctx, const uint8_t *data, size_t len) { return net_send_all((Net *)ctx, data, len); }

NpFailVerdict net_session_failed(Net *n, int is_auth, int pending_pair, const char *reason, uint64_t now) {
  NpFailVerdict v = netplan_on_failure(&n->plan, n->target_host, is_auth, pending_pair);
  if (v.action == NP_FAIL_AUTH_STOP) {
    set_reason(n, reason);
    net_hold(n);
  } else {
    fail(n, reason, now);
  }
  return v;
}

void net_mark_ready(Net *n) {
  n->failures = 0;
  netplan_on_ready(&n->plan, n->target_host);
}

int net_retry_in_s(const Net *n, uint64_t now) {
  if (n->state != NET_WAITING || n->hold || n->retry_at <= now) return 0;
  return (int)((n->retry_at - now + 999) / 1000);
}

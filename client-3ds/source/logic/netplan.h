// Plazos y decisiones de la red, sin tocar sockets ni reloj (el tiempo entra en milisegundos). net.c y app.c los usan.
#ifndef LOGIC_NETPLAN_H
#define LOGIC_NETPLAN_H

#include <stdint.h>

#define NETPLAN_SEARCH_WINDOW_MS 3000  // esperando el aviso UDP antes de probar la última IP
#define NETPLAN_BEACON_FRESH_MS 6000   // un aviso más viejo ya no sirve para conectar
#define NETPLAN_CONNECT_TIMEOUT_MS 4000
#define NETPLAN_PING_INTERVAL_MS 5000
#define NETPLAN_RX_TIMEOUT_MS 15000    // sin recibir nada: se cierra y se reconecta
#define NETPLAN_UDP_STALE_MS 10000     // buscando sin recibir ningún aviso: se recrea el socket UDP
#define NETPLAN_SOCK_FAILS_MAX 3       // fallos seguidos al crear un socket: último recurso, reiniciar soc
#define NETPLAN_SOC_RETRY_MS 2000
#define NETPLAN_BACKOFF_CAP_MS 5000

// Espera tras el fallo número `failures` (1, 2, 3...): 1 s, 2 s, 4 s, luego 5 s. failures < 1 cuenta como 1.
uint32_t netplan_backoff_ms(int failures);
int netplan_search_expired(uint64_t search_since, uint64_t now);
int netplan_connect_expired(uint64_t connect_since, uint64_t now);
int netplan_beacon_fresh(uint64_t beacon_at, uint64_t now);
int netplan_ping_due(uint64_t last_ping, uint64_t now);
int netplan_rx_timed_out(uint64_t last_rx, uint64_t now);
// El UDP lleva NETPLAN_UDP_STALE_MS en búsqueda sin avisos (quiet_since: creación del socket, último aviso o última vez
// que no se estaba buscando).
int netplan_udp_stale(uint64_t quiet_since, uint64_t now);
// Crear un socket falló `consecutive` veces seguidas: ya toca reiniciar soc por completo.
int netplan_sock_restart_due(int consecutive);

// ---------- errno ----------
//
// libctru 2.7.1 deja errno NEGATIVO tras un socket() fallido (guarda el código convertido sin cambiarle el signo; por
// ejemplo -115 = -ENETDOWN) y positivo tras connect/recv/send. Se clasifica siempre por valor absoluto.
typedef enum {
  NP_ERR_PENDING,      // EAGAIN, EWOULDBLOCK, EINPROGRESS, EALREADY, EINTR: todavía no
  NP_ERR_CLOSED,       // el otro extremo cortó (ECONNRESET, ECONNABORTED, EPIPE, ENOTCONN)
  NP_ERR_REFUSED,      // ECONNREFUSED
  NP_ERR_UNREACHABLE,  // ETIMEDOUT, EHOSTUNREACH, ENETUNREACH
  NP_ERR_NETDOWN,      // ENETDOWN, ENETRESET: la red no está lista (tras el reposo o un cambio de Wi-Fi)
  NP_ERR_OTHER
} NpErrKind;
int netplan_errno_abs(int err);
NpErrKind netplan_errno_kind(int err);
// Texto para el usuario, sin el número crudo (el número solo va en el diagnóstico).
const char *netplan_errno_reason(NpErrKind k);

// ---------- recv tras connect() no bloqueante ----------
//
// Tras un connect no bloqueante la consola da la conexión por hecha con el primer recv() con datos. Mientras no
// llegue ningún byte, un recv que devuelva 0, EAGAIN, EWOULDBLOCK, ENOTCONN o EINPROGRESS significa "todavía no" (en
// la consola, recv sobre un socket aún sin conectar puede dar 0 o ENOTCONN): se espera hasta el plazo de conexión.
// Solo después de recibir el primer byte un recv de 0 es un cierre.
typedef enum {
  NP_RECV_DATA,    // r > 0
  NP_RECV_PENDING, // nada por ahora
  NP_RECV_CLOSED,  // el otro extremo cerró (r == 0 con bytes ya recibidos)
  NP_RECV_ERROR    // error real: err dice cuál
} NpRecvVerdict;
// r: lo que devolvió recv; err: errno (solo cuenta si r < 0); bytes_seen: ya se recibió algún byte en esta conexión.
NpRecvVerdict netplan_recv_verdict(int r, int err, int bytes_seen);

// ---------- a qué IP conectar y qué hacer tras un fallo ----------
//
// Candidatos: avisos UDP frescos (hasta NP_MAX_BEACONS remitentes), la IP guardada (la última que llegó a READY y
// recibió una vista válida; sale de config.ini) y la IP escrita a mano.
//  - Entre los avisos se prefiere el del remitente que coincide con la IP guardada; si ninguno coincide, el primero
//    recibido (el orden de llegada de cada remitente no cambia con avisos repetidos).
//  - Tras un fallo con un host, el siguiente intento va a otro candidato: primero la IP guardada si es distinta, luego
//    otro aviso; se alterna entre candidatos con la espera creciente habitual (netplan_backoff_ms).
//  - Un fallo de autenticación no detiene los reintentos por sí solo. Solo se muestra el error (y se deja de reintentar
//    con esa clave) cuando la IP guardada (que ya autenticó antes con esta clave) responde con fallo de autenticación,
//    o cuando no hay IP guardada y un mismo host falla NP_AUTH_MAX_FAILS veces seguidas.
//  - Al descartar el error, la clave guardada anterior sigue intacta (la app solo la cambia tras una vista válida).
#define NP_HOST_BYTES 16
#define NP_MAX_BEACONS 4
#define NP_MAX_AUTH_HOSTS 4
#define NP_AUTH_MAX_FAILS 3

typedef enum { NP_ORIGIN_NONE, NP_ORIGIN_BEACON, NP_ORIGIN_SAVED, NP_ORIGIN_MANUAL } NpOrigin;

typedef struct {
  char host[NP_HOST_BYTES];
  uint16_t port;
  uint64_t at; // último aviso de este remitente
} NpBeacon;

typedef struct {
  char host[NP_HOST_BYTES];
  int fails;
} NpAuthCount;

typedef struct {
  char saved_host[NP_HOST_BYTES]; // "" si no hay
  uint16_t saved_port;
  int saved_verified;             // 1: ya autenticó con la clave guardada; 0: escrita a mano, sin comprobar
  int manual;                     // la IP escrita a mano manda sobre los avisos mientras no falle
  NpBeacon beacons[NP_MAX_BEACONS];
  int beacon_count;               // en orden de llegada
  char last_failed[NP_HOST_BYTES]; // host del último intento fallido ("" tras un éxito o un reintento manual)
  NpAuthCount auth[NP_MAX_AUTH_HOSTS];
  int auth_count;
} NetPlan;

typedef struct {
  char host[NP_HOST_BYTES];
  uint16_t port;
  NpOrigin origin;
} NpTarget;

typedef enum {
  NP_FAIL_RETRY,      // seguir reintentando solo (con espera creciente)
  NP_FAIL_AUTH_STOP   // mostrar "error de autenticación" y dejar de reintentar con esta clave
} NpFailAction;

typedef struct {
  NpFailAction action;
  int discard_pairing; // AUTH_STOP durante un emparejamiento: descartar el código tecleado (la clave guardada sigue)
} NpFailVerdict;

void netplan_init(NetPlan *p);
// IP guardada (config.ini): se da por verificada. host "" = ninguna.
void netplan_set_saved(NetPlan *p, const char *host, uint16_t port);
// IP escrita a mano: sin verificar; se prueba antes que los avisos hasta que falle. Descarta los avisos vistos.
void netplan_set_manual(NetPlan *p, const char *host, uint16_t port);
// Tras READY y la primera vista válida: esa IP pasa a ser la guardada y verificada.
void netplan_confirm_saved(NetPlan *p, const char *host, uint16_t port);
void netplan_clear_beacons(NetPlan *p);
void netplan_beacon_seen(NetPlan *p, const char *host, uint16_t port, uint64_t now);
// Aviso que se usaría ahora (el mejor de los frescos); 0 si no hay. Para mostrar "Puente encontrado en...".
int netplan_best_beacon(const NetPlan *p, uint64_t now, NpBeacon *out);
// Destino del siguiente intento. search_since: inicio de la búsqueda (ventana de NETPLAN_SEARCH_WINDOW_MS antes de
// probar la IP guardada sin aviso). 0 si todavía hay que esperar.
int netplan_pick(const NetPlan *p, uint64_t now, uint64_t search_since, NpTarget *out);
// Un intento con `host` falló (is_auth: error de autenticación; si no, cualquier otro fallo). pending_pair: había un
// código nuevo sin confirmar.
NpFailVerdict netplan_on_failure(NetPlan *p, const char *host, int is_auth, int pending_pair);
// La sesión con `host` llegó a READY: se cierra la racha de fallos.
void netplan_on_ready(NetPlan *p, const char *host);
// El usuario forzó un reintento (A, Y, o X al escribir la IP en la guía) o hubo reposo: se borran las rachas.
void netplan_on_user_retry(NetPlan *p);
// Fallos de autenticación seguidos con ese host.
int netplan_auth_fails(const NetPlan *p, const char *host);
const char *netplan_origin_name(NpOrigin o);

#endif

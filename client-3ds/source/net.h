// Red de la consola (libctru): búsqueda del puente por aviso UDP, conexión TCP no bloqueante, reintentos con espera
// creciente y reconexión tras el reposo (sin reiniciar soc salvo último recurso). Los plazos y la política (a qué IP conectar, qué hacer tras un
// fallo de autenticación, cuándo un recv significa "aún no conectado") salen de logic/netplan.c.
//
// La consola es siempre cliente. El flujo:
//   SEARCHING   escucha el aviso UDP (puerto 33333). Con aviso fresco conecta a su IP (la del remitente que coincide
//               con la IP guardada, si no el primero recibido); si en 3 s no llega ninguno, prueba la IP guardada.
//   CONNECTING  connect() no bloqueante con plazo de 4 s. No se usa poll + SO_ERROR (dio falsos fallos en la Fase 0):
//               la conexión se da por buena con el primer recv() con datos (el puente envía el challenge al conectar).
//               Mientras no llegue ningún byte, recv() = 0, EAGAIN, ENOTCONN o EINPROGRESS es "pendiente".
//   CONNECTED   hay bytes que leer y se puede escribir.
//   WAITING     tras un fallo, espera 1 s, 2 s, 4 s, 5 s... y vuelve a SEARCHING; el siguiente intento alterna de
//               candidato (primero la IP guardada si el fallo fue con otro host).
//   NO_SOC      el servicio de red no arrancó (por ejemplo sin Wi-Fi): se reintenta cada 2 s.
#ifndef NET_H
#define NET_H

#include <stddef.h>
#include <stdint.h>

#include "logic/config_ini.h"
#include "logic/netplan.h"

typedef enum { NET_NO_SOC, NET_SEARCHING, NET_CONNECTING, NET_CONNECTED, NET_WAITING } NetState;

typedef struct {
  NetState state;
  int soc_ok;
  int udp, tcp;
  uint64_t state_since;   // inicio del estado actual (ventana de búsqueda, plazo de conexión)
  uint64_t retry_at;      // fin de la espera en WAITING / siguiente intento de soc
  int failures;           // fallos seguidos (reinicia net_mark_ready)
  int sock_fails;         // fallos seguidos al crear un socket (3: último recurso, reinicio completo de soc)
  uint64_t udp_retry_at;  // siguiente intento de recrear el UDP si no se pudo abrir
  uint64_t udp_quiet_since; // el UDP lleva buscando sin avisos desde aquí (10 s: se recrea)
  int allow_connect;      // 0: solo escucha avisos (sin clave todavía)
  int hold;               // 1: no reintentar (error de autenticación, hasta net_release)

  NetPlan plan;           // IP guardada o manual, avisos vistos y fallos de autenticación por host

  // destino de la conexión en curso (o la última)
  char target_host[CONFIG_HOST_BYTES];
  uint16_t target_port;
  NpOrigin target_origin;

  uint8_t first[512];     // primeros bytes recibidos al confirmar la conexión
  size_t first_len, first_off;
  char reason[48];        // último motivo de fallo, en español, para mostrarlo
} Net;

const char *net_state_name(NetState s);

// Arranca soc (búfer de 1 MiB alineado) y el socket UDP. Devuelve 1 si soc quedó listo; si no, la app sigue y
// net_update reintenta.
int net_init(Net *n, uint64_t now);
// Cierra todo y apaga soc.
void net_exit(Net *n);
// Tras despertar del reposo: cierra los sockets (TCP y UDP), recrea el UDP y vuelve a buscar. NO reinicia soc: eso
// solo ocurre como último recurso si crear un socket falla 3 veces seguidas (ver netplan_sock_restart_due).
void net_wake(Net *n, uint64_t now);

// IP guardada (la última que llegó a READY con una vista válida): para alternar con los avisos. "" = ninguna.
void net_set_saved(Net *n, const char *host, uint16_t port);
// IP escrita a mano: se prueba antes que los avisos.
void net_set_manual(Net *n, const char *host, uint16_t port);
// La conexión actual ya recibió una vista válida: su IP pasa a ser la guardada.
void net_confirm_saved(Net *n);
void net_set_allow_connect(Net *n, int allow);
// Reintentar ya: cierra la conexión, borra los fallos y la espera; usa un aviso fresco o la IP guardada sin
// esperar la ventana de búsqueda. También suelta net_hold.
void net_kick(Net *n, uint64_t now);
void net_release(Net *n);

// Avanza la máquina de estados (llamar una vez por cuadro). Devuelve 1 si la conexión acaba de quedar confirmada
// (la app crea la sesión y luego lee con net_recv).
int net_update(Net *n, uint64_t now);
// Lee lo disponible: > 0 bytes, 0 nada por ahora, -1 la conexión se cerró (ya se pasó a WAITING).
int net_recv(Net *n, uint8_t *buf, size_t cap, uint64_t now);
// Escribe todo reintentando EAGAIN con esperas cortas (tope ~500 ms). 0 si salió; -1 si no.
int net_send_all(Net *n, const uint8_t *data, size_t len);
// La sesión con el host actual falló (error de protocolo, silencio, autenticación...): cierra la conexión y aplica la
// política de netplan. Con NP_FAIL_RETRY programa el reintento (espera creciente, alternando de candidato); con
// NP_FAIL_AUTH_STOP la deja en espera sin reintentar (net_hold) hasta net_release / net_kick.
NpFailVerdict net_session_failed(Net *n, int is_auth, int pending_pair, const char *reason, uint64_t now);
// La sesión llegó a READY: los reintentos vuelven a empezar desde 1 s.
void net_mark_ready(Net *n);
// Mantiene la conexión cerrada sin reintentar hasta net_release / net_kick (error de autenticación).
void net_hold(Net *n);

// Para Transport.send de la sesión.
int net_transport_send(void *ctx, const uint8_t *data, size_t len);

// Segundos que faltan para el siguiente intento (0 si no está en espera).
int net_retry_in_s(const Net *n, uint64_t now);

#endif

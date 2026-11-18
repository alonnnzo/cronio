// Datos de diagnóstico para la primera prueba en hardware: se rellenan siempre (cuesta poco) y la pantalla de
// diagnóstico (L+R mantenidos 1 s) los muestra en texto pequeño. Sin libctru: el formato se prueba en el PC.
#ifndef LOGIC_DIAG_H
#define LOGIC_DIAG_H

#include <stdint.h>

#define DIAG_LINES 12
#define DIAG_LINE_BYTES 96
#define DIAG_HOST_BYTES 16

typedef enum { DIAG_SOUND_UNKNOWN = 0, DIAG_SOUND_OK, DIAG_SOUND_NO_FIRM, DIAG_SOUND_ERROR } DiagSound;
typedef enum { DIAG_CALL_SOCKET, DIAG_CALL_CONNECT, DIAG_CALL_RECV, DIAG_CALL_SEND, DIAG_CALL_COUNT } DiagCall;

typedef struct {
  // estado actual (la app lo copia cada cuadro)
  const char *net_state;
  const char *session_state;
  char host[DIAG_HOST_BYTES];
  uint16_t port;
  const char *origin;       // "aviso", "guardada", "manual" o "-"
  int net_failures;         // fallos de red seguidos

  // resultados de los servicios (Result en hex); *_tried = 0 si todavía no se intentó
  int soc_tried, ps_tried, mcu_tried;
  // sonido (ndsp): DIAG_SOUND_*; el código es el Result de ndspInit (o de la extracción del firmware si no se pudo extraer)
  int sound_state;
  uint32_t sound_rc;
  uint32_t soc_rc, ps_rc, mcu_rc;

  // último errno de cada llamada (los EAGAIN / EWOULDBLOCK de la rutina no se anotan)
  int err[DIAG_CALL_COUNT];
  const char *last_call;
  int last_errno;

  // avisos UDP
  uint32_t beacons;
  char beacon_from[DIAG_HOST_BYTES];

  // tráfico de la conexión TCP (acumulado)
  uint64_t rx_bytes, tx_bytes;

  // última vista válida
  int have_rev;
  uint64_t rev;

  // cuadros por segundo (se recalcula cada segundo)
  uint32_t frames;
  uint64_t fps_since;
  uint32_t fps_x10;

  // red: reinicios completos de soc, eventos de reposo y despertar de aptHook, veces que se recreó el UDP
  uint32_t soc_restarts, apt_sleeps, apt_wakes, udp_recreated;

  // última causa de cierre de sesión
  int have_close;
  char close_cause[32];
  uint64_t close_at;
  uint32_t close_count;
} Diag;

void diag_init(Diag *d);
const char *diag_call_name(DiagCall c);
// Anota el errno de una llamada que falló (ignora EAGAIN y EWOULDBLOCK).
void diag_errno(Diag *d, DiagCall c, int err);
void diag_beacon(Diag *d, const char *from);
void diag_bytes(Diag *d, uint64_t rx, uint64_t tx);
void diag_rev(Diag *d, uint64_t rev);
// Una vez por cuadro.
void diag_frame(Diag *d, uint64_t now);
// La sesión se cerró; cause es un texto corto (por ejemplo session_error_name o "sin respuesta").
void diag_close(Diag *d, const char *cause, uint64_t now);
void diag_set_target(Diag *d, const char *host, uint16_t port, const char *origin);

// Escribe hasta DIAG_LINES líneas ASCII (<= DIAG_LINE_BYTES). Devuelve cuántas.
int diag_format(const Diag *d, uint64_t now, char lines[DIAG_LINES][DIAG_LINE_BYTES]);

#endif

// Gesto de aprobar una solicitud: máquina de estados pura, sin reloj propio (el tiempo entra en milisegundos).
// Port de packages/simulator/public/approve.js (y approve-guard.js).
//
// Reglas:
//  - Un gesto es "pulsar A" (botón o lápiz) hasta soltar. Solo se aprueba si lo mostrado (id + riesgo + dueño + líneas)
//    al terminar el gesto es lo mismo que al empezarlo.
//  - El gesto debe empezar con la solicitud visible desde hace >= APPROVE_GUARD_MS; si no, queda anulado.
//  - Riesgo normal: se aprueba al soltar. Riesgo alto: al cumplirse APPROVE_HOLD_MS de retención (approve_tick),
//    sobre la misma solicitud; soltar antes no aprueba.
//  - Cualquier cambio de lo mostrado (o que desaparezca) durante el gesto lo anula: hay que soltar y volver a pulsar.
//  - Sin conexión no se emite nada. Una solicitud ya respondida no se vuelve a aprobar.
//  - "Respondida" lo marca quien envía con approve_decided, y solo si el envío salió: si falló, la solicitud sigue
//    pendiente (al reconectar se empieza de cero con approve_reset).
//
// "Sí, no volver a preguntar" es el mismo gesto con la bandera `always` (Y o su botón en lugar de A): mismas guardas, misma
// retención en riesgo alto y mismas anulaciones. Solo se puede iniciar si la tarjeta lo ofrece (ApproveRequest.always no
// NULL), y solo lo termina quien lo empezó (approve_up_always con un gesto normal, o al revés, no hace nada).
//
// Las funciones que pueden aprobar devuelven 1 y escriben el id de la solicitud en out_id (VIEW_ID_BYTES); si no, 0.
#ifndef CORE_APPROVE_H
#define CORE_APPROVE_H

#include <stdint.h>

#include "sha256.h"
#include "view.h"

#define APPROVE_GUARD_MS 500
#define APPROVE_HOLD_MS 1000

typedef enum { APPROVE_SRC_BUTTON = 0, APPROVE_SRC_POINTER = 1 } ApproveSource;

// Lo que se muestra en la tarjeta. owner puede ser NULL (equivale a ""). Todo debe seguir vivo solo durante la llamada.
typedef struct {
  const char *id;
  int high;                 // riesgo alto
  const char *owner;
  const ViewText *lines;
  int line_count;
  const char *always;       // etiqueta de "no volver a preguntar"; NULL si la tarjeta no lo ofrece (entra en la identidad)
} ApproveRequest;

typedef struct {
  int connected;
  int has_shown;
  uint8_t shown_key[SHA256_DIGEST_LEN];
  char shown_id[VIEW_ID_BYTES];
  int shown_high;
  int shown_always;
  uint64_t shown_since;
  int has_decided;
  char decided_id[VIEW_ID_BYTES];
  int has_gesture;
  ApproveSource g_source;
  int g_has_shown; // había una solicitud al empezar
  char g_id[VIEW_ID_BYTES];
  uint8_t g_key[SHA256_DIGEST_LEN];
  int g_high;
  int g_always;    // el gesto es el de "no volver a preguntar"
  uint64_t g_started;
  int g_dead;
  int g_spent;
  int last_always; // lo último que se emitió (approve_up/approve_tick devolvieron 1) fue "no volver a preguntar"
} Approve;

void approve_init(Approve *a);
// Resume de lo mostrado: cambia si cambia el id, el riesgo, el dueño o cualquier línea.
void approve_request_key(const ApproveRequest *r, uint8_t key[SHA256_DIGEST_LEN]);

void approve_connection(Approve *a, int connected);
// Cada vista nueva (o cada cuadro): req NULL si no hay tarjeta. Repetir lo mismo no reinicia nada.
void approve_view(Approve *a, uint64_t now, const ApproveRequest *req);
// repeat: repetición automática de la tecla (se ignora, como un segundo gesto).
void approve_down(Approve *a, uint64_t now, ApproveSource src, int repeat);
int approve_up(Approve *a, uint64_t now, ApproveSource src, char out_id[VIEW_ID_BYTES]);
// Lo mismo para "sí, no volver a preguntar".
void approve_down_always(Approve *a, uint64_t now, ApproveSource src, int repeat);
int approve_up_always(Approve *a, uint64_t now, ApproveSource src, char out_id[VIEW_ID_BYTES]);
// Tras un 1 de approve_up/_always o approve_tick: 1 si lo emitido es "no volver a preguntar", 0 si es aprobar.
int approve_emitted_always(const Approve *a);
// 1 si hay un gesto en curso de "no volver a preguntar" (para dibujar su barra de retención).
int approve_gesture_is_always(const Approve *a);
// Avanza la retención de riesgo alto; llamar en cada cuadro mientras haya gesto.
int approve_tick(Approve *a, uint64_t now, char out_id[VIEW_ID_BYTES]);
void approve_cancel(Approve *a);  // se perdió el foco, etc.: anula el gesto sea de quien sea
// Anula el gesto solo si es de esa fuente (el lápiz salió del botón: no debe tocar un gesto del botón físico).
// Algo tapaba la solicitud (guía, diagnóstico) y dejó de taparla: la guarda de APPROVE_GUARD_MS cuenta desde ahora.
void approve_uncovered(Approve *a, uint64_t now);
void approve_cancel_source(Approve *a, ApproveSource src);
// La decisión (aprobar o rechazar) salió con éxito: no se vuelve a aprobar ni rechazar esa solicitud.
void approve_decided(Approve *a, const char *id);
int approve_is_decided(const Approve *a, const char *id);
// Estado limpio y sin conexión (al terminar la sesión). La guarda de 500 ms cuenta desde que se vuelve a ver la tarjeta.
void approve_reset(Approve *a);
// Llave de lo mostrado ahora (la misma que usa aprobar). 0 si no hay tarjeta.
int approve_shown_key(const Approve *a, uint8_t key[SHA256_DIGEST_LEN]);

// Botón habilitado: hay solicitud sin responder, conexión y ya pasó la guarda.
int approve_ready(const Approve *a, uint64_t now);
// Avance de la retención de riesgo alto, 0..1 (0 si no hay un gesto válido en curso).
float approve_hold_progress(const Approve *a, uint64_t now);

#endif

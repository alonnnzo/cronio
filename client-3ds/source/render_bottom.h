// Pantalla inferior (320x240): agentes -> sesiones -> detalle, con la tarjeta de permiso encima; o, sin vista,
// una pantalla de estado que explica qué pasa y qué botón pulsar. La geometría y las zonas táctiles salen de
// logic/layout.c; aquí solo se pinta con citro2d.
#ifndef RENDER_BOTTOM_H
#define RENDER_BOTTOM_H

#include <stdint.h>

#include "core/nav.h"
#include "core/view.h"
#include "logic/layout.h"

#define STATUS_MAX_LINES 8
#define STATUS_MAX_HINTS 4

typedef struct {
  const char *title;
  uint32_t title_rgb;
  const char *lines[STATUS_MAX_LINES];
  int line_count;
  const char *hints[STATUS_MAX_HINTS];
  int hint_count;
  const char *notice;     // aviso breve (por ejemplo "IP no válida"); NULL si no hay
} StatusScreen;

typedef struct {
  const View *view;       // NULL: se dibuja `status`
  StatusScreen status;
  const Nav *nav;
  const char *card_owner; // dueño de la tarjeta (el mismo texto que entra en la identidad del gesto de aprobar)
  int countdown_s;        // segundos que le quedan a la solicitud; -1 = sin límite (no se dibuja cuenta atrás)
  float hold;             // barra de retención 0..1
  int hold_always;        // la retención es la de "sí, no volver a preguntar" (franja) y no la de aprobar
  int approve_ready;      // el botón de aprobar ya se puede usar (pasó la guarda de 500 ms)
  int ack_ready;          // el botón "A: Visto" de la tarjeta de aviso ya se puede usar (misma guarda de 500 ms)
  int scroll;             // desplazamiento de la lista, en filas (entra y se corrige en render_bottom_layout)
  uint64_t now_ms;
  uint64_t view_at_ms;    // reloj de la consola cuando llegó la vista actual: al `sinceS` de cada sesión se le suma lo que pasó desde aquí
} BottomModel;

// Calcula la disposición y corrige m->scroll. Sin vista, deja el resultado vacío (sin zonas táctiles).
void render_bottom_layout(BottomModel *m, BottomLayout *out);
void render_bottom_draw(const BottomModel *m, const BottomLayout *l);

#endif

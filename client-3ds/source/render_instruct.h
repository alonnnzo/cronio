// Pantalla inferior con la tarjeta "Espera tu instrucción" (Fase 2b, paso 6): una sesión con "Esperar mi respuesta" terminó su turno y su
// Stop está retenido en el puente. Encabezado (agente · proyecto y "N de M"), el comienzo del último mensaje, las filas "Escribir" y
// "Seguir en el PC" y la ayuda del pie. La geometría sale de logic/instruct.c (la misma que usan los toques).
#ifndef RENDER_INSTRUCT_H
#define RENDER_INSTRUCT_H

#include <stdint.h>

#include "core/view.h"
#include "logic/instruct.h"

typedef struct {
  const View *view;       // con view_has_instruction_card(view)
  const Instruct *s;
  int ready;              // ya pasó la guarda de 500 ms: las filas se ven apagadas mientras tanto
  int can_skip;           // hay más solicitudes en cola y el modo permite L/R: la ayuda lo dice
} InstructModel;

void render_instruct_draw(const InstructModel *m);

#endif

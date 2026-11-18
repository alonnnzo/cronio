// Pantalla inferior con una pregunta con alternativas (AskUserQuestion, Fase 2b, paso 4): encabezado y texto de la pregunta, una fila por
// opción (estrella en la recomendada, casilla en multiSelect), "Otra…" y "Responder en el PC" al final, la descripción de la fila
// marcada y la ayuda del pie. La geometría sale de logic/question.c (la misma que usan los toques).
#ifndef RENDER_QUESTION_H
#define RENDER_QUESTION_H

#include <stdint.h>

#include "core/view.h"
#include "logic/question.h"

typedef struct {
  const View *view;       // con view_has_question_card(view)
  const Question *q;
  int ready;              // ya pasó la guarda de 500 ms: las filas se ven apagadas mientras tanto
  int can_skip;           // hay más solicitudes en cola y el modo permite L/R: la ayuda lo dice
} QuestionModel;

void render_question_draw(const QuestionModel *m);

#endif

// Preguntas con alternativas (Fase 2b, paso 4): estado, filas, geometría y reglas de la tarjeta de pregunta (AskUserQuestion),
// sin libctru ni dibujo. Espejo de packages/simulator/public/question.js.
//
// La vista trae una solicitud con kind == REQ_QUESTION y de 1 a 4 preguntas con sus opciones. La consola responde con ÍNDICES, nunca
// con textos (el puente traduce a las etiquetas completas), y NUNCA con una decisión: una pregunta no se aprueba ni se rechaza.
//   answer {answers:[{choose:[0,2]} | {other:"texto"}, ...]}   una entrada por pregunta, en orden, todas juntas al final
//   answer {pc:true}                                            "Responder en el PC": la pregunta vuelve a Claude Code
//
// Filas de cada pregunta: sus opciones; en multiSelect, "Listo" (envía lo marcado, al menos una); "Otra…" (teclado del sistema: lo
// escrito es la respuesta de esa pregunta) y "Responder en el PC".
// Cruceta arriba/abajo (o el lápiz) mueven y A (o tocar la fila) elige; en multiSelect A marca o desmarca y "Listo" envía. B vuelve a
// la pregunta anterior (en la primera no hace nada: B nunca responde ni rechaza).
//
// Guarda: A no hace nada hasta pasados QUESTION_GUARD_MS desde que llegó la tarjeta (y desde cada cambio de pregunta, para que un
// doble toque no elija también la siguiente). Una tarjeta distinta (otro id) empieza de cero; la misma vista repetida no reinicia nada.
#ifndef LOGIC_QUESTION_H
#define LOGIC_QUESTION_H

#include <stdint.h>

#include "../core/msg.h"
#include "../core/view.h"
#include "layout.h"

#define QUESTION_GUARD_MS 500
#define QUESTION_MAX_ROWS (VIEW_MAX_OPTIONS + 3) // opciones, Listo, Otra… y Responder en el PC

typedef enum { QROW_OPTION, QROW_DONE, QROW_OTHER, QROW_PC } QuestionRowKind;

typedef struct {
  QuestionRowKind kind;
  int option; // QROW_OPTION: índice de la opción
} QuestionRow;

typedef struct {
  int connected;
  int has_id;
  ViewId id;                 // la solicitud que se está respondiendo
  uint64_t since;            // desde cuándo se ve esta pregunta (guarda de 500 ms)
  int index;                 // pregunta actual
  int cursor;                // fila marcada de la pregunta actual
  unsigned marks[VIEW_MAX_QUESTIONS]; // multiSelect: bit i = opción i marcada, por pregunta
  MsgAnswer answers[VIEW_MAX_QUESTIONS];
  int answer_count;          // respuestas ya dadas (las de las preguntas anteriores a `index`; al enviar, todas)
  int sent;                  // ya se mandó (o se mandó "Responder en el PC"): no se vuelve a mandar
  int send_pc;               // lo que salió fue "Responder en el PC" y no las respuestas
} Question;

typedef enum {
  QOUT_NONE,
  QOUT_SEND,    // mandar q->answers (q->answer_count, una por pregunta) con la solicitud q->id
  QOUT_SEND_PC, // mandar "Responder en el PC" con la solicitud q->id
  QOUT_OTHER    // abrir el teclado del sistema para la pregunta actual (antes, mandar `hold`)
} QuestionOutKind;

typedef struct {
  QuestionOutKind kind;
} QuestionOut;

void question_init(Question *q);
void question_connection(Question *q, int connected);
// Cada vista nueva (o cada cuadro): req es la solicitud a la vista si es una pregunta; NULL si no hay o es un permiso.
void question_view(Question *q, uint64_t now, const RequestView *req);

// Las filas de la pregunta `qv`: opciones, "Listo" (solo multiSelect), "Otra…" y "Responder en el PC". Devuelve cuántas.
int question_rows(const QuestionView *qv, QuestionRow rows[QUESTION_MAX_ROWS]);
// La pregunta actual de la solicitud, o NULL si no hay una a la vista.
const QuestionView *question_current(const Question *q, const RequestView *req);

// ¿Ya se puede usar A? Conexión, tarjeta sin mandar y pasada la guarda.
int question_ready(const Question *q, uint64_t now);

// Cursor arriba/abajo, sin dar la vuelta.
void question_move(Question *q, const RequestView *req, int dy);
// El cursor salta a esa fila (toque del lápiz); no elige.
void question_select(Question *q, const RequestView *req, int row);
// A (row -1: la fila del cursor) o tocar la fila `row`. Con repeat (repetición de la tecla) no hace nada.
QuestionOut question_activate(Question *q, const RequestView *req, uint64_t now, int row, int repeat);
// B: pasa a la pregunta anterior y rehace su respuesta; en la primera (o ya enviada) no hace nada. Nunca responde.
void question_back(Question *q);
// Lo escrito en "Otra…" (NULL o vacío = canceló). Se quitan los espacios de los extremos, los saltos se vuelven espacios y se corta
// a 200 caracteres.
QuestionOut question_text(Question *q, const RequestView *req, uint64_t now, const char *text);
// Resultado de mandar (QOUT_SEND / QOUT_SEND_PC): con rc != 0 no salió y la tarjeta vuelve a poder responderse.
void question_sent(Question *q, int rc);

// ¿La respuesta de la pregunta `i` ya se dio (para mostrarla marcada al volver con B)? No se usa para decidir nada.
int question_answered(const Question *q, int i);

// ---- geometría (320x240) ----

typedef struct {
  Rect header;                 // fila de arriba: encabezado de la pregunta a la izquierda, "1/3 · 2 de 3" a la derecha
  Rect text;                   // texto de la pregunta (hasta 3 líneas)
  int row_count;
  Rect rows[QUESTION_MAX_ROWS];
  Rect desc;                   // descripción de la fila marcada (2 líneas)
  Rect hint;                   // ayuda del pie
} QuestionLayout;

void question_layout(const QuestionView *qv, QuestionLayout *out);
// Fila bajo (x, y) o -1.
int question_hit_row(const QuestionView *qv, int x, int y);

#endif

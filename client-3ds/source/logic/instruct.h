// Instrucciones por texto (Fase 2b, paso 6): estado, filas y reglas de la tarjeta "Espera tu instrucción", sin libctru ni dibujo.
// Espejo de packages/simulator/public/instruct.js.
//
// Una sesión con "Esperar mi respuesta" que termina su turno deja su `Stop` retenido en el puente: la vista trae una solicitud con
// kind == REQ_INSTRUCTION (la misma cola que los permisos y las preguntas: L/R pasan a otra). No se aprueba ni se rechaza. Filas, en orden:
//   0..n-1  atajos (Fase 3, `request.quick`, hasta 4, en dos columnas) -> mandan su texto fijo con {"t":"instruct","sessionId","text"}
//   n       Escribir          -> abre el teclado del sistema (antes, `hold`); lo escrito se manda con {"t":"instruct","sessionId","text"}
//   n+1     Seguir en el PC   -> {"t":"release","requestId"}: libera sin instrucción y Claude termina como siempre
// El cursor empieza en Escribir (como antes de los atajos: un A suelto abre el teclado, no manda una orden).
// Cruceta arriba/abajo (y izquierda/derecha entre los atajos de una fila) o el lápiz mueven y A (o tocar la fila) elige.
// B no hace nada: NUNCA envía, libera ni rechaza.
// Guarda: A no hace nada hasta pasados INSTRUCT_GUARD_MS desde que llegó la tarjeta (como aprobar y responder). Una tarjeta distinta
// (otro id) empieza de cero; la misma vista repetida no reinicia nada.
#ifndef LOGIC_INSTRUCT_H
#define LOGIC_INSTRUCT_H

#include <stddef.h>
#include <stdint.h>

#include "../core/msg.h"
#include "../core/view.h"
#include "layout.h"

#define INSTRUCT_GUARD_MS 500
#define INSTRUCT_ROWS 2 // las filas fijas: Escribir y Seguir en el PC (van después de los atajos)
#define INSTRUCT_MAX_ROWS (VIEW_MAX_QUICK + INSTRUCT_ROWS)

typedef struct {
  int connected;
  int has_id;
  ViewId id;        // la solicitud (el Stop retenido)
  uint64_t since;   // desde cuándo se ve esta tarjeta (guarda de 500 ms)
  int quick_n;      // atajos de la tarjeta (0 a 4); las filas son quick_n + INSTRUCT_ROWS
  int cursor;       // fila marcada: 0..quick_n-1 atajos, quick_n Escribir, quick_n+1 Seguir en el PC
  int sent;         // ya se mandó una instrucción o "Seguir en el PC": no se vuelve a mandar
} Instruct;

typedef enum {
  IOUT_NONE,
  IOUT_WRITE,   // abrir el teclado del sistema (antes, mandar `hold`)
  IOUT_RELEASE, // mandar "Seguir en el PC" con la solicitud i->id
  IOUT_QUICK    // mandar el texto del atajo `index` (request.quick[index]) como instrucción
} InstructOutKind;

typedef struct {
  InstructOutKind kind;
  int index; // IOUT_QUICK: qué atajo
} InstructOut;

void instruct_init(Instruct *i);
void instruct_connection(Instruct *i, int connected);
// Cada vista nueva (o cada cuadro): req es la solicitud a la vista si es de tipo instrucción; NULL si no hay o es de otro tipo.
void instruct_view(Instruct *i, uint64_t now, const RequestView *req);
// ¿Ya se puede usar A? Conexión, tarjeta sin mandar y pasada la guarda.
int instruct_ready(const Instruct *i, uint64_t now);
// Filas de la tarjeta (atajos + Escribir + Seguir) y la fila de Escribir.
int instruct_row_count(const Instruct *i);
int instruct_write_row(const Instruct *i);
// Arriba/abajo, sin dar la vuelta: entre las dos columnas de atajos salta de a una fila; del último atajo baja a Escribir.
void instruct_move(Instruct *i, int dy);
// Izquierda/derecha: pasa de un atajo al de al lado en la misma fila; fuera de los atajos no hace nada.
void instruct_move_x(Instruct *i, int dx);
// El cursor salta a esa fila (toque del lápiz); no elige.
void instruct_select(Instruct *i, int row);
// A (row -1: la fila del cursor) o tocar la fila `row`. Con repeat no hace nada.
InstructOut instruct_activate(Instruct *i, uint64_t now, int row, int repeat);
// Se mandó una instrucción escrita desde esta tarjeta: no se vuelve a mandar. Con rc != 0 no salió y se puede volver a intentar.
void instruct_sent(Instruct *i, int rc);

// Limpia lo escrito en el teclado: los controles y saltos pasan a espacio, se quitan los espacios de los extremos y se corta a
// MSG_INSTRUCT_MAX_CHARS caracteres. Devuelve los caracteres que quedan (0 = vacío: no se manda). out: MSG_INSTRUCT_BYTES.
int instruct_clean(const char *text, char *out, size_t cap);

// ---- geometría (320x240) ----
// Sin atajos (quick_n == 0) es la tarjeta de siempre: dos filas de 40 px con su ayuda dentro. Con atajos es compacta: los atajos en dos
// columnas (24 px de alto), Escribir y Seguir de 26 px, y la ayuda de la fila marcada y de las teclas abajo (6 filas caben en 240 px).
typedef struct {
  Rect header;               // agente · proyecto a la izquierda, "N de M" a la derecha
  Rect label;                // "Último mensaje:"
  Rect text;                 // el comienzo del último mensaje (hasta 3 líneas)
  int text_pitch;            // separación entre líneas del mensaje
  int compact;               // 1 con atajos
  int rows_n;                // quick_n + INSTRUCT_ROWS
  Rect rows[INSTRUCT_MAX_ROWS]; // en el orden de las filas: atajos, Escribir, Seguir
  Rect help;                 // compacta: ayuda de la fila marcada (vacía si no es compacta)
  Rect hint;
} InstructLayout;

void instruct_layout_n(InstructLayout *out, int quick_n);
// Sin atajos.
void instruct_layout(InstructLayout *out);
// Fila bajo (x, y) para una tarjeta con quick_n atajos, o -1.
int instruct_hit_row(int quick_n, int x, int y);

#endif

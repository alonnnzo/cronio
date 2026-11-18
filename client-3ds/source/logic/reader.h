// Lector del mensaje completo (Fase 2b, paso 1): estado y geometría, sin libctru ni dibujo. Desde el detalle de una sesión,
// A pide `read`; mientras llega la respuesta se muestra "Cargando…", y luego las líneas ya cortadas por el puente, con
// desplazamiento por cruceta, L/R (páginas) y lápiz. B vuelve al detalle.
//
// Reglas de seguridad (las aplica input_logic.c; este módulo solo guarda el estado):
//  - El lector nunca tapa ni intercepta aprobar o rechazar: apenas aparece una tarjeta de permiso se cierra solo y la
//    tarjeta funciona exactamente como desde el detalle. Con el lector abierto no hay tarjeta, así que A y B no pueden
//    aprobar ni rechazar nada.
//  - Es una foto: si llega un mensaje nuevo mientras se lee, no salta; aparece "mensaje nuevo · A recarga".
//  - Dos modos (paso 5): el mensaje completo o un resumen corto. Abre en el ajuste readerDefault y X (o tocar el pie) pide el otro;
//    A recarga en el modo que se estaba viendo.
#ifndef LOGIC_READER_H
#define LOGIC_READER_H

#include "../core/reading.h"
#include "../core/view.h"
#include "layout.h"

#define READER_ROW_H 15        // alto de cada línea de texto (letra a escala 0.42: celda de 12.6 px + 2.4 de aire)
#define READER_BAR_Y 2
#define READER_BAR_H 20
#define READER_STALE_H 16      // barra "mensaje nuevo · A recarga"
#define READER_FOOT_H 15       // pie "X: resumen" / "X: completo" (tocable)
#define READER_QUESTION_HEAD_H 17
#define READER_QUESTION_ROW_H 15
#define READER_MARGIN 4
#define READER_TEXT_X 8
#define READER_TEXT_W 306      // ancho útil de las líneas: de x=8 a 314 (la barra de desplazamiento ocupa 316..318)
#define READER_TAP_SLOP 6      // píxeles de arrastre por debajo de los cuales el toque es un toque, no un desplazamiento

typedef enum { READER_CLOSED = 0, READER_LOADING, READER_SHOWING } ReaderState;

typedef struct {
  ReaderState state;
  ViewId session_id;
  uint32_t seq0;                     // read_seq de la sesión al pedir; una respuesta nueva lo cambia
  int mode;                          // READ_MODE_* que se pidió; con el documento a la vista manda el suyo (reader_shown_mode)
  int top;                           // índice de la primera línea visible
  int stale;                         // llegó un mensaje nuevo después de pedir este
  int from_notice;                   // se abrió con "Leer todo" de una tarjeta de aviso: esa tarjeta no lo cierra (la de permiso sí)
  int snap_known;                    // ya se copió el extracto del último mensaje que mostraba el detalle
  int snap_count;
  ViewText snap[VIEW_MAX_DETAIL_LINES];
  // lápiz
  int drag_active, drag_x, drag_y, drag_acc, drag_moved;
} Reader;

typedef struct {
  Rect bar, back_btn, pos;           // cabecera: título a la izquierda, "n/N" y "B Volver" a la derecha
  int has_stale;
  Rect stale;                        // aviso de mensaje nuevo (tocable: recarga)
  int question_lines;
  Rect question;                     // bloque de la pregunta (alto 0 si no hay)
  Rect foot;                         // pie con el modo al que cambia X
  Rect body;                         // zona de las líneas
  int rows;                          // líneas visibles (>= 1)
} ReaderLayout;

void reader_init(Reader *r);
static inline int reader_active(const Reader *r) { return r->state != READER_CLOSED; }

// Empieza a leer la sesión: queda en "Cargando…" hasta que llegue la respuesta. `read_seq` es session_read_seq al pedir;
// `v` es la vista viva (de ahí se toma el extracto del último mensaje para detectar uno nuevo). También sirve para recargar.
void reader_open(Reader *r, const char *session_id, uint32_t read_seq, const View *v);
void reader_close(Reader *r);

// Modo de lo que se ve: el del documento mostrándose (completo si un puente anterior no lo manda) y, cargando, el pedido.
int reader_shown_mode(const Reader *r, const ReadDoc *doc);

// Una respuesta `text` llegó o ya estaba: si es de esta sesión y es posterior a la petición, pasa a mostrar.
void reader_on_doc(Reader *r, const ReadDoc *doc, uint32_t read_seq);
// Vista nueva: marca "mensaje nuevo" si el extracto del último mensaje cambió desde que se pidió.
void reader_view_changed(Reader *r, const View *v);

void reader_layout(int question_lines, int stale, ReaderLayout *out);
// Tope del desplazamiento: la última página llena. 0 si todo cabe.
int reader_max_top(const ReadDoc *doc, const ReaderLayout *l);
// Mueve `delta` líneas (negativo = hacia el inicio) sin salirse. Devuelve 1 si cambió.
int reader_scroll(Reader *r, const ReadDoc *doc, int delta);
// Una página: las líneas visibles menos una (queda una de contexto). dir: -1 anterior, +1 siguiente.
int reader_page(Reader *r, const ReadDoc *doc, int dir);
// Ajusta top a lo que cabe (tras un documento nuevo o un cambio de la barra de aviso).
void reader_clamp(Reader *r, const ReadDoc *doc);
// Posición para la cabecera: primera y última línea visibles (desde 1) y total. total 0 = nada que contar.
void reader_position(const Reader *r, const ReadDoc *doc, int *first, int *last, int *total);

#endif

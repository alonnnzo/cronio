// Disposición de la pantalla inferior (320x240) y zonas táctiles, como cálculo puro: render_bottom.c dibuja lo que
// dice este módulo y main/app.c resuelve los toques con layout_hit sobre el mismo resultado.
//
//   barra (título, cuenta, "B Volver", modo)        y 2..22
//   aviso de pendientes (modo manual, sin tarjeta)  16 px
//   contenido (agentes / sesiones / detalle)        el resto
//   tarjeta de permiso (abajo, si hay solicitud)    alto según líneas, riesgo, cola y "siempre"
//   tarjeta de aviso (abajo, sin permisos)          alto según líneas y cola; "A: Visto" y "leer todo"
//
// Nada queda fuera de 320x240; la tarjeta más alta (6 líneas, riesgo alto, "N de M", "sí, no volver a preguntar")
// deja al menos LAYOUT_MIN_CONTENT_H píxeles de contenido.
#ifndef LOGIC_LAYOUT_H
#define LOGIC_LAYOUT_H

#include "../core/view.h"

#define LAYOUT_W 320
#define LAYOUT_H 240

#define LAYOUT_BAR_Y 2
#define LAYOUT_BAR_H 20
#define LAYOUT_BANNER_H 16
#define LAYOUT_MARGIN 4

#define LAYOUT_CARD_PAD 3
#define LAYOUT_CARD_HEAD_H 14
#define LAYOUT_CARD_QUEUE_H 16
#define LAYOUT_CARD_RISK_H 14
#define LAYOUT_CARD_LINE_H 13
#define LAYOUT_CARD_BTN_H 24
#define LAYOUT_CARD_GAP 4
#define LAYOUT_CARD_ALWAYS_H 14 // franja "Y: sí, siempre · ..." sobre los botones (más 2 px de separación)
#define LAYOUT_CARD_ALWAYS_GAP 2

// Tarjeta de aviso (Fase 2b, paso 3): agente · proyecto, título del aviso, líneas, "N de M" y los botones "A: Visto" / "Leer todo".
#define LAYOUT_NOTICE_HEAD_H 14
#define LAYOUT_NOTICE_TITLE_H 18
#define LAYOUT_NOTICE_QUEUE_H 16
#define LAYOUT_NOTICE_LINE_H 13
#define LAYOUT_NOTICE_BTN_H 24
#define LAYOUT_NOTICE_GAP 4

#define LAYOUT_READ_H 18 // franja "A: leer todo" al pie del detalle (y la de "Y: avisos", a su derecha)
// Instrucciones por texto (paso 6), sobre la franja anterior: "X: instrucción" y "Esperar" (misma altura) y, si hay cola, un recuadro
// con "En cola (N): ..." y "Borrar" (alto LAYOUT_QUEUE_H).
#define LAYOUT_QUEUE_H 32
#define LAYOUT_STRIP_GAP 2
#define LAYOUT_ROW_H 34
#define LAYOUT_ROW_PITCH 37
#define LAYOUT_MAX_ROWS 8
#define LAYOUT_TILE_COLS 3
#define LAYOUT_TILE_COMPACT_BELOW 56 // alto de casilla por debajo del cual se dibuja la versión compacta
#define LAYOUT_MIN_CONTENT_H 36 // con la franja de "siempre" en la tarjeta más alta quedan 37

#define LAYOUT_MAX_ZONES 32

typedef struct {
  int x, y, w, h;
} Rect;

static inline int rect_contains(const Rect *r, int x, int y) {
  return x >= r->x && y >= r->y && x < r->x + r->w && y < r->y + r->h;
}

typedef enum {
  ZONE_ITEM,       // index = agente (nivel agentes) o sesión (nivel sesiones)
  ZONE_BACK,
  ZONE_MODE,
  ZONE_APPROVE,
  ZONE_DENY,
  ZONE_ALWAYS,     // "sí, no volver a preguntar" (solo si la tarjeta lo ofrece)
  ZONE_SKIP_PREV,
  ZONE_SKIP_NEXT,
  ZONE_READ,       // "A: leer todo" al pie del detalle (sin tarjeta): abre el lector del mensaje completo
  ZONE_ACK,        // "A: Visto" de la tarjeta de aviso
  ZONE_NOTICE_READ, // "Leer todo" de la tarjeta de aviso: abre el lector de esa sesión
  ZONE_NOTIFY,     // "Y: avisos · <modo>" al pie del detalle: cambia el modo de aviso de la sesión
  ZONE_INSTRUCT,   // "X: instrucción" en el detalle: abre el teclado para escribirle a la sesión (paso 6)
  ZONE_WAIT,       // "Esperar mi respuesta: sí/no" en el detalle: alterna el modo de la sesión
  ZONE_CLEAR       // "Borrar" la cola de instrucciones de la sesión
} ZoneKind;

typedef struct {
  ZoneKind kind;
  Rect r;
  int index;
} Zone;

typedef enum { LAYOUT_AGENTS, LAYOUT_SESSIONS, LAYOUT_DETAIL } LayoutLevel;

typedef struct {
  LayoutLevel level;
  int item_count;  // sesiones del agente (nivel sesiones)
  int cursor;
  int scroll;      // desplazamiento anterior, en filas
  int has_banner;  // modo manual con pendientes y sin tarjeta
  int has_card;
  int card_lines;  // 0..6
  int card_high;
  int card_many;   // total > 1: fila "N de M"
  int card_always; // la solicitud ofrece "sí, no volver a preguntar"
  int card_can_skip; // modo en fila: botones de saltar
  int has_notice;    // tarjeta de aviso (se ignora si hay tarjeta de permiso)
  int notice_lines;  // 0..4
  int notice_many;   // total > 1: fila "N de M" con L/R
  int detail_notify; // el detalle abierto trae el modo de aviso de la sesión: se ofrece la franja "Y: avisos"
  int detail_instruct; // el detalle abierto es de una sesión y el puente ofrece instrucciones por texto (paso 6)
  int detail_queue;    // además hay instrucciones en cola: se ofrece el recuadro con "Borrar"
} LayoutInput;

typedef struct {
  Rect bar, back_btn, mode_btn;
  int has_back;
  int title_x, sub_x_max;
  Rect banner;
  int has_banner;
  Rect content;

  Rect tiles[AGENT_COUNT];
  int tile_compact;

  int visible_rows, scroll;
  Rect rows[LAYOUT_MAX_ROWS]; // filas visibles: la fila i muestra la sesión scroll + i

  int has_card;
  Rect card, card_head, card_queue, card_risk, card_lines;
  Rect btn_approve, btn_deny, btn_always, skip_prev, skip_next;
  int has_queue, has_risk, has_skip, has_always;
  int has_read;               // detalle sin tarjeta: franja tocable que abre el lector
  Rect btn_read;
  int has_notify;             // detalle con el modo de aviso de la sesión (sin tarjeta de permiso): franja tocable que lo cambia
  Rect btn_notify;
  int has_instruct;           // detalle con instrucciones por texto (sin tarjeta): "X: instrucción" y "Esperar" sobre la franja de lectura
  Rect btn_instruct, btn_wait;
  int has_queue_box;          // además, hay cola: recuadro "En cola (N): ..." con "Borrar"
  Rect queue_box, btn_clear;
  int footer_top;             // y de lo más alto del pie del detalle (el contenido del detalle llega hasta aquí)

  int has_notice;             // tarjeta de aviso (nunca junto a la de permiso)
  Rect notice, notice_head, notice_title, notice_queue, notice_lines, btn_ack, btn_notice_read;
  int has_notice_queue, has_notice_skip;

  Zone zones[LAYOUT_MAX_ZONES];
  int zone_count;
} BottomLayout;

// Alto de la tarjeta de aviso.
int layout_notice_height(int lines, int many);
// Rellena de LayoutInput lo que sale de la vista (tarjeta de permiso o de aviso, aviso de pendientes y la franja de modo de
// aviso del detalle). El nivel, los elementos, el cursor y el desplazamiento los pone quien llama. `open_session_id` es la
// sesión del detalle abierto ("" si no hay).
void layout_input_from_view(LayoutInput *in, const View *v, const char *open_session_id);
// Alto de la tarjeta de permiso.
int layout_card_height(int lines, int high, int many, int always);
// Desplazamiento mínimo para que el cursor quede visible, dentro de 0..count-visible.
int layout_scroll_for_cursor(int scroll, int cursor, int visible, int count);
void layout_compute(const LayoutInput *in, BottomLayout *out);
// Zona más arriba bajo (x, y), o NULL.
const Zone *layout_hit(const BottomLayout *l, int x, int y);

#endif

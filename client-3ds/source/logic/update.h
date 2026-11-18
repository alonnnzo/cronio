// Actualizar la app desde la propia consola (Fase 7): estado, textos y geometría de la tarjeta de aviso, de la pantalla del menú
// («Actualizar app») y de la pantalla de progreso, sin libctru ni dibujo. La descarga y la instalación (sockets y AM) están en
// updater.c; el dibujo, en render_update.c.
//
// Cuando la vista trae `update` (el puente tiene un .cia más nuevo que esta app) aparece una tarjeta a pantalla completa:
//   A: Actualizar  /  B: Ahora no (la oculta hasta el próximo arranque)
// Las solicitudes (permisos, preguntas, instrucciones) y los avisos con "Visto" van siempre antes que esta tarjeta, y el menú, la guía,
// el diagnóstico y el lector la tapan (lo mismo que a un aviso). Al volver a verse, la guarda de 500 ms empieza de nuevo: lo que se
// pulsó antes no actúa sobre ella (como aprobar).
// Si la app corre como .3dsx (Homebrew Launcher) no se puede instalar sola: la tarjeta lo explica y solo deja "B: Ahora no".
//
// Fases (UpdPhase):
//   UPD_IDLE  sin pantalla propia: la tarjeta aparece sola cuando corresponde
//   UPD_PAGE  abierta desde el menú SELECT, «Actualizar app»: muestra la versión actual y, si hay una nueva, permite instalarla
//   UPD_RUN   descargando e instalando: barra, KB y el texto de cada paso. START no sale
//   UPD_DONE  «Listo. Cronio se va a reiniciar.» (o, si no se puede reiniciar sola, «cierra y abre Cronio»)
//   UPD_FAIL  el error (con la función de AM que falló y su código; o que lo descargado no coincide con lo que anunció el PC) y «se mantiene
//             la versión actual»: una actualización fallida nunca borra la app instalada. A reintenta y B vuelve.
#ifndef LOGIC_UPDATE_H
#define LOGIC_UPDATE_H

#include <stddef.h>
#include <stdint.h>

#include "../core/view.h"
#include "layout.h"
#include "version.h"

#define UPDATE_GUARD_MS 500    // A no hace nada hasta pasado este tiempo desde que se ve la pantalla
#define UPDATE_RESTART_MS 2500 // lo que se ve «Listo» antes de reiniciar
#define UPDATE_ERROR_BYTES 256
#define UPDATE_MAX_LINES 8
#define UPDATE_LINE_BYTES 72
#define UPDATE_STEPS 5
#define UPDATE_DOWNLOAD_PERMILLE 800 // la barra tiene dos tramos: 0-80 % la descarga y 80-100 % la instalación

typedef enum { UPD_IDLE, UPD_PAGE, UPD_RUN, UPD_DONE, UPD_FAIL } UpdPhase;
// Pasos, en orden: conectar, pedir el archivo, descargarlo entero a memoria (y verificarlo), instalarlo y terminar.
typedef enum { UPD_STEP_CONNECT, UPD_STEP_REQUEST, UPD_STEP_DOWNLOAD, UPD_STEP_INSTALL, UPD_STEP_FINISH } UpdStep;

typedef struct {
  char current[VERSION_TEXT_MAX + 1]; // la versión de esta app (APP_VERSION)
  int is_cia;                         // instalada como .cia: se puede actualizar sola
  int has_offer;                      // la vista trae una versión más nueva que la actual
  char offer[VIEW_UPDATE_VERSION_MAX + 1];
  char url[VIEW_UPDATE_URL_MAX + 1];
  uint32_t offer_size;                // bytes del .cia que anunció el PC
  uint8_t offer_sha[VIEW_UPDATE_SHA_LEN]; // su SHA-256: lo descargado se verifica contra él antes de tocar AM
  int connected;                      // hay una vista viva: se sabe qué ofrece el puente
  int dismissed;                      // «Ahora no»: oculta la tarjeta hasta el próximo arranque
  int shown;                          // la pantalla estaba a la vista en el último cuadro
  uint64_t since;                     // desde cuándo se ve (guarda de 500 ms)
  UpdPhase phase;
  UpdStep step;
  uint32_t done, total;               // bytes descargados y totales (total 0 = aún no se sabe)
  int can_restart;                    // UPD_DONE: la app se reinicia sola
  uint64_t finished_at;               // UPD_DONE: cuándo terminó
  char error[UPDATE_ERROR_BYTES];     // UPD_FAIL: qué pasó
} Update;

typedef enum { UPD_OUT_NONE, UPD_OUT_START } UpdOut;

void update_init(Update *u, const char *current, int is_cia);

// Toma el `update` de la vista (NULL: no hay vista viva; lo último que se supo se conserva, pero `connected` baja a 0).
// Hay oferta solo si la versión ofrecida es mayor que la actual; igual, menor o ilegible no cuenta.
void update_view(Update *u, const View *v);

// ¿La tarjeta de aviso (fase UPD_IDLE) está a la vista? Hay oferta, no se descartó y no hay solicitud ni aviso con "Visto".
int update_card_visible(const Update *u, const View *v);
// ¿Se ve alguna pantalla de la actualización? Cualquier fase distinta de UPD_IDLE, o la tarjeta si nada la tapa (`covered`: menú, guía,
// diagnóstico o lector abiertos).
int update_screen_showing(const Update *u, const View *v, int covered);
// Una vez por cuadro (con la vista viva o NULL): actualiza la oferta y la guarda. Devuelve 1 si la pantalla acaba de aparecer.
// Una solicitud o un aviso con "Visto" que llega cierra la pantalla del menú y la del error (los permisos nunca esperan detrás de ellas).
int update_sync(Update *u, const View *v, int covered, uint64_t now);
// ¿Ya pasó la guarda de 500 ms desde que se ve la pantalla?
int update_ready(const Update *u, uint64_t now);

// ¿Se puede instalar ahora? Es .cia, hay una oferta con su dirección y no está ya corriendo.
int update_can_install(const Update *u);
// A (o tocar «Actualizar»/«Reintentar»): si se puede, pasa a UPD_RUN y devuelve UPD_OUT_START (la app arranca la descarga).
UpdOut update_a(Update *u, uint64_t now);
// B (o tocar «Ahora no»/«Volver»): descarta la tarjeta, cierra la pantalla del menú o sale del error. Sin efecto durante la instalación.
void update_b(Update *u, uint64_t now);
// Entrada «Actualizar app» del menú.
void update_open_page(Update *u, uint64_t now);

// Progreso de la instalación (lo llama la app con lo que dice updater.c).
void update_set_step(Update *u, UpdStep step);
void update_set_progress(Update *u, uint32_t done, uint32_t total);
// Falló: la versión instalada se mantiene (una actualización fallida no borra nada).
void update_fail(Update *u, const char *msg, uint64_t now);
// Terminó bien. `can_restart`: la app se reinicia sola (aptSetChainloader); si no, pide cerrar y abrir Cronio.
void update_done(Update *u, int can_restart, uint64_t now);
// ¿Ya se mostró «Listo» el tiempo suficiente para reiniciar?
int update_restart_due(const Update *u, uint64_t now);
// START no sale mientras se instala (ni mientras se muestra «Listo»).
int update_blocks_quit(const Update *u);

// ---- textos ----

// 0 a 1000 (milésimas) de lo descargado; 0 si aún no se sabe el total.
int update_permille(uint32_t done, uint32_t total);
// La barra de los dos tramos: conectar y pedir = 0; descargar = 0-800 según done/total; instalar = 800-1000; terminar = 1000.
int update_bar_permille(UpdStep step, uint32_t done, uint32_t total);
// El número de paso que se muestra («Paso 3 de 5»).
int update_step_number(UpdStep step);
// "123 KB de 345 KB" (el total hacia arriba, lo hecho hacia abajo y nunca más que el total); sin total, "123 KB".
void update_format_kb(char *out, size_t cap, uint32_t done, uint32_t total);
// Parte `text` en líneas de hasta `max_chars` caracteres, cortando en espacios (una palabra más larga se corta). Devuelve las líneas escritas.
int update_wrap(const char *text, int max_chars, char out[][UPDATE_LINE_BYTES], int max_lines);

typedef enum { UPD_TONE_NORMAL, UPD_TONE_OK, UPD_TONE_BAD } UpdTone;

// Todo lo que dibuja render_update.c, ya armado.
typedef struct {
  char label[40];                    // rótulo pequeño de arriba ("ACTUALIZACIÓN")
  char title[56];
  UpdTone tone;                      // color del título
  char lines[UPDATE_MAX_LINES][UPDATE_LINE_BYTES];
  int line_count;
  int has_bar;                       // pantalla de progreso
  int permille;
  char bar_text[16];                 // "45 %"
  char kb_text[40];                  // "123 KB de 345 KB"
  int has_a, has_b;
  char a_label[24], b_label[24];
  int ready;                         // pasó la guarda: los botones se ven activos
} UpdateScreen;

void update_screen(const Update *u, uint64_t now, UpdateScreen *s);

// ---- geometría (320x240) ----
#define UPDATE_LINE_PITCH 17 // separación entre las líneas del cuerpo
typedef struct {
  Rect label, title, body;           // body: la primera línea arranca arriba y las demás bajan UPDATE_LINE_PITCH
  Rect bar, kb;                      // pantalla de progreso
  Rect btn_a, btn_b;                 // A a la izquierda y B a la derecha
  Rect btn_b_solo;                   // sin A, B ocupa todo el ancho
} UpdateLayout;

void update_layout(UpdateLayout *l);
typedef enum { UPD_HIT_NONE, UPD_HIT_A, UPD_HIT_B } UpdHit;
// Botón bajo (x, y) según los botones que tiene la pantalla.
UpdHit update_hit(int has_a, int has_b, int x, int y);

#endif

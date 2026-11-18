// Menú de configuración (Fase 2b, paso 2): pantalla inferior local que abre SELECT. Estado, geometría de las filas y
// qué pasa al pulsar cada una, sin libctru ni dibujo. El puente decide y guarda los ajustes; la consola solo los muestra
// (vienen en view.settings) y pide cambiarlos: aquí no hay valores propios, solo el cursor.
//
// Entradas (nivel raíz):
//   1. Avisos por defecto  -> notifyDefault, A o izquierda/derecha cambian entre todo / lo importante / solo al terminar / silencio
//   2. Pedir "Visto"       -> notifyAck, A o izquierda/derecha alternan
//   3. Sonido              -> sound, A o izquierda/derecha alternan (paso 3b)
//   4. Preguntas en la 3DS -> questions, A o izquierda/derecha alternan (paso 4; apagado, las preguntas se responden en el PC)
//   5. Abrir mensajes en   -> readerDefault, A o izquierda/derecha alternan completo / resumen (paso 5; X lo alterna dentro del lector)
//   6. Esperar instrucción hasta -> instructWaitMax, A o izquierda/derecha cambian entre 5 / 10 / 30 minutos (paso 6)
//   7. Agentes             -> A entra al submenú (un interruptor por agente)
//   8. Guía de botones     -> A abre la guía
//   9. Diagnóstico         -> A alterna la pantalla de diagnóstico (lo mismo que L+R 1 s)
//  10. Tema               -> A o izquierda/derecha alternan claro / oscuro; preferencia local de la consola (config.ini), sin conexión también
//  11. Actualizar app     -> A abre la pantalla de actualización (logic/update.c): versión actual y, si hay una nueva, instalarla; sin conexión también
// Las siete primeras necesitan conexión (una vista con `settings`): sin ella salen desactivadas con "sin conexión".
//
// Seguridad (la aplica input_logic.c): el menú nunca tapa ni intercepta aprobar o rechazar. Una tarjeta de permiso lo cierra
// en el acto (y a la guía que abrió), y con una tarjeta a la vista SELECT no lo abre.
#ifndef LOGIC_MENU_H
#define LOGIC_MENU_H

#include "../core/view.h"
#include "layout.h"

#define MENU_ROOT_ENTRIES 11
#define MENU_AGENT_ROWS AGENT_COUNT

typedef enum { MENU_E_NOTIFY = 0, MENU_E_ACK, MENU_E_SOUND, MENU_E_QUESTIONS, MENU_E_READER, MENU_E_INSTRUCT_WAIT, MENU_E_AGENTS, MENU_E_GUIDE, MENU_E_DIAG, MENU_E_THEME, MENU_E_UPDATE } MenuEntry;
typedef enum { MENU_ROOT = 0, MENU_AGENTS } MenuLevel;

typedef struct {
  int open;
  MenuLevel level;
  int cursor;        // fila del nivel actual
  int root_cursor;   // fila de la raíz a la que se vuelve desde el submenú
} Menu;

typedef enum {
  MENU_OUT_NONE,
  MENU_OUT_NOTIFY,   // value = NotifyMode nuevo
  MENU_OUT_ACK,      // value = 0 o 1
  MENU_OUT_SOUND,    // value = 0 o 1
  MENU_OUT_QUESTIONS, // value = 0 o 1
  MENU_OUT_READER,   // value = READ_MODE_* (0 completo, 1 resumen)
  MENU_OUT_INSTRUCT_WAIT, // value = minutos de espera: 5, 10 o 30
  MENU_OUT_HIDDEN,   // value = máscara de agentes ocultos (bit i = AgentKind i)
  MENU_OUT_GUIDE,    // abrir la guía de botones
  MENU_OUT_DIAG,     // alternar el diagnóstico
  MENU_OUT_THEME,    // value = 0 claro, 1 oscuro (preferencia local de la consola: no va al puente)
  MENU_OUT_UPDATE,   // abrir la pantalla «Actualizar app»
  MENU_OUT_CLOSE     // cerrar el menú
} MenuOutKind;

typedef struct {
  MenuOutKind kind;
  int value;
} MenuOut;

// Geometría (320x240). Las filas de la raíz tienen alto distinto: las dos primeras llevan una línea de ayuda.
typedef struct {
  int count;
  Rect rows[MENU_ROOT_ENTRIES];
  Rect back;         // "B Volver / SELECT Cerrar", tocable
  Rect hint;         // ayuda del pie (submenú de agentes: los permisos de un agente oculto sí llegan)
} MenuLayout;

void menu_init(Menu *m);
void menu_open(Menu *m);
void menu_close(Menu *m);

// 1 si la entrada se puede usar con esta vista (las siete primeras piden una vista con ajustes; la de la espera, que el puente la mande).
int menu_entry_enabled(MenuEntry e, const View *v);
int menu_agent_enabled(const View *v);

// Máscara de agentes ocultos de la vista (0 sin ajustes).
unsigned menu_hidden_mask(const View *v);

// Cursor arriba/abajo, sin dar la vuelta.
void menu_move(Menu *m, int dy);
// A (dir +1) o cruceta izquierda/derecha (dir -1/+1). `cycle_only`: solo cambia valores (izquierda/derecha no entran a
// submenús ni abren cosas).
MenuOut menu_activate(Menu *m, const View *v, int dir, int cycle_only);
// B: del submenú a la raíz; en la raíz cierra.
MenuOut menu_back(Menu *m);

void menu_layout(MenuLevel level, MenuLayout *out);
// Fila bajo (x, y) o -1.
int menu_hit_row(MenuLevel level, int x, int y);
int menu_hit_back(MenuLevel level, int x, int y);

const char *menu_notify_label(NotifyMode m);
const char *menu_entry_title(MenuEntry e);

#endif

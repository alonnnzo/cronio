// Navegación de la pantalla inferior: agentes -> sesiones del agente -> detalle de la sesión.
// Port de packages/simulator/public/nav.js: sin red ni dibujo; cada acción modifica el estado y dice qué mensaje de
// enfoque hay que enviar al puente (entrar al detalle envía focus con la sesión; salir envía focus con null).
//
// agents:   cursor = índice del agente (cuadrícula de NAV_GRID_COLS columnas)
// sessions: cursor = índice dentro de las sesiones de `kind`, en el orden de view.sessions
// detail:   cursor no se usa; además `confirmed` (el puente ya mostró este detalle) y `since` (instante de entrada)
//
// El enfoque de sesión es único en el puente: si otro cliente lo quita (focus null o skip), nav_sync devuelve a
// sesiones sin enviar focus. Para no rebotar entre enviar focus y recibir la vista que lo confirma, esa regla solo
// se aplica tras ver el detalle (`confirmed`) o pasado NAV_DETAIL_CONFIRM_MS desde la entrada.
#ifndef CORE_NAV_H
#define CORE_NAV_H

#include <stdint.h>

#include "view.h"

#define NAV_GRID_COLS 3
#define NAV_DETAIL_CONFIRM_MS 1000

typedef enum { NAV_AGENTS, NAV_SESSIONS, NAV_DETAIL } NavLevel;

typedef struct {
  NavLevel level;
  AgentKind kind;  // AGENT_NONE en agentes
  ViewId session_id; // "" salvo en detalle
  int cursor;
  int confirmed;
  uint64_t since;
} Nav;

typedef enum {
  NAV_OUT_NONE,    // nada que enviar
  NAV_OUT_FOCUS,   // enviar focus con out.session_id
  NAV_OUT_UNFOCUS  // enviar focus con null
} NavOutKind;

typedef struct {
  NavOutKind kind;
  ViewId session_id;
} NavOut;

void nav_init(Nav *n);

// Sesiones de un agente, en el orden de la vista.
int nav_session_count(const View *v, AgentKind kind);
const SessionView *nav_session_at(const View *v, AgentKind kind, int index); // NULL si no existe
// Agentes que se muestran (los no ocultos en la configuración del puente), en el orden de la cuadrícula. En el nivel de
// agentes el cursor y los índices de toque cuentan sobre esta lista.
int nav_agent_count(const View *v);
AgentKind nav_agent_at(const View *v, int index); // AGENT_NONE fuera de rango
// Elementos de la lista del nivel actual (agentes visibles; sesiones del agente; 0 en detalle).
int nav_item_count(const Nav *n, const View *v);

NavOut nav_move(Nav *n, const View *v, int dx, int dy);
// index < 0: usar el cursor (clic o toque pasan el índice tocado, que puede estar fuera de rango).
NavOut nav_enter(Nav *n, const View *v, int index, uint64_t now);
NavOut nav_back(Nav *n, const View *v);
// Abre el detalle de una sesión de la vista desde cualquier nivel (la tarjeta de aviso "Leer todo"). Si ya está abierto no
// envía nada; si la sesión no existe o su agente está oculto, no hace nada.
NavOut nav_open_session(Nav *n, const View *v, const char *session_id, uint64_t now);
// Tras cada vista nueva. now < 0: sin reloj (no vence el plazo de confirmación).
NavOut nav_sync(Nav *n, const View *v, int64_t now);

typedef enum { NAV_B_DENY, NAV_B_BACK } NavBAction;
// B: con tarjeta de permiso rechaza; sin tarjeta vuelve un nivel.
NavBAction nav_b_action(const View *v);
// L / R: saltar al siguiente permiso, solo en modo "en fila" y con más de uno pendiente.
int nav_skip_wanted(const View *v);
// X: modo al que hay que pasar (alterna). 1 = manual, 0 = en fila.
int nav_mode_target_manual(const View *v);

#endif

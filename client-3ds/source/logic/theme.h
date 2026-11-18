// Nombres, colores y etiquetas que comparten las dos pantallas (mismos valores que packages/simulator/public:
// face.js AGENT_STYLES, bottom.js STATE_LABEL / MODE_LABEL / kindSummary / cardOwner).
#ifndef LOGIC_THEME_H
#define LOGIC_THEME_H

#include <stddef.h>
#include <stdint.h>

#include "../core/view.h"

#define THEME_NEUTRAL_RGB 0x3a3d52u // cara sin agente

// "Agente" si kind no es válido.
const char *theme_agent_name(AgentKind kind);
// 0xRRGGBB del agente; el gris neutro de la cara si kind no es válido.
uint32_t theme_agent_rgb(AgentKind kind);
// Color del punto/etiqueta del agente en la pantalla inferior (#ece9f5 si kind no es válido).
uint32_t theme_agent_ui_rgb(AgentKind kind);

const char *theme_state_label(AgentState s);
const char *theme_mode_label(PermMode m);

// Resumen del estado de un agente a partir de sus sesiones ("sin sesiones", "te espera", ...).
const char *theme_kind_summary(const View *v, AgentKind kind);

// Dueño de la tarjeta de permiso: "Claude · título" si la sesión existe, si no el título de la solicitud.
// Es lo que se muestra y lo que entra en la identidad del gesto de aprobar. Sin solicitud escribe "".
void theme_card_owner(const View *v, char *out, size_t cap);

#endif

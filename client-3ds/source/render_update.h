// Pantalla inferior de la actualización de la app (Fase 7): la tarjeta de aviso «Hay una versión nueva…», la pantalla de «Actualizar app»
// del menú, el progreso (barra, KB y texto del paso), «Listo» y el error. Todo el contenido y la geometría salen de logic/update.c.
#ifndef RENDER_UPDATE_H
#define RENDER_UPDATE_H

#include "logic/update.h"

void render_update_draw(const UpdateScreen *s);

#endif

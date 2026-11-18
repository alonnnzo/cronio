// Guía de botones (abajo, 320x240): título, texto de la página, flechas táctiles e indicador "1 de N". Los textos y
// las zonas de las flechas salen de logic/guide.c.
#ifndef RENDER_GUIDE_H
#define RENDER_GUIDE_H

#include "logic/guide.h"

void render_guide_draw(const Guide *g);

#endif

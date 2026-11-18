// Dibujo de la animación de entrada (los números salen de logic/intro.c).
#ifndef RENDER_INTRO_H
#define RENDER_INTRO_H

#include <stdint.h>

#include "logic/intro.h"
#include "logic/stereo.h"

// Carga el logo (gfx/cronio_palabra, incrustado en el ejecutable). 0 si falla: la intro sigue sin el logo.
int render_intro_init(void);
void render_intro_exit(void);

// Pantalla de arriba, con el destino de render del ojo ya activo. face_rgb: color de la cara a la que se llega (gris
// neutro o el del agente); a partir de INTRO_DONE_MS el naranja se funde a él.
void render_intro_top(const IntroFrame *f, StereoEye eye, float slider, uint32_t face_rgb);
// Pantalla de abajo (el fondo del tema ya está dibujado): logo, texto y el negro del principio.
void render_intro_bottom(const IntroFrame *f);

#endif

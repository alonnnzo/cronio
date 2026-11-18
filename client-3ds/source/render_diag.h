// Pantalla de diagnóstico (abajo): estado de red y sesión, errno, resultados de los servicios y contadores, en texto
// pequeño. Se alterna manteniendo L+R 1 s. Las líneas salen de logic/diag.c (diag_format).
#ifndef RENDER_DIAG_H
#define RENDER_DIAG_H

#include "logic/diag.h"

void render_diag_draw(const char lines[][DIAG_LINE_BYTES], int count);

#endif

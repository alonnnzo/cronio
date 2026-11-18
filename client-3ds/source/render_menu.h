// Menú de configuración (abajo, 320x240): filas con su valor, ayuda y el submenú de agentes. La geometría y los textos
// salen de logic/menu.c; los valores, de la vista (view.settings).
#ifndef RENDER_MENU_H
#define RENDER_MENU_H

#include "core/view.h"
#include "logic/menu.h"
#include "logic/update.h"

// v puede ser NULL (sin conexión); diag_on: la pantalla de diagnóstico está activa (se muestra en su fila);
// sound_ok: ndsp funciona en esta consola (si no, la fila de sonido dice que no hay); upd: la actualización de la app (la fila «Actualizar app»
// muestra la versión actual o la nueva disponible; puede ser NULL).
void render_menu_draw(const Menu *m, const View *v, int diag_on, int sound_ok, const Update *upd);

#endif

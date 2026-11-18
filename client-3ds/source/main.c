// 3DS Agent Companion: cliente de la consola. La cara va arriba, las sesiones y los permisos abajo.
//
// START sale. El resto de los botones está en app.c y docs/08-fase-2-cliente-3ds.md.
#include <3ds.h>
#include <citro2d.h>

#include "app.h"
#include "ui_text.h"

// La pila por defecto (32 KB) no alcanza: view_parse y json_parse usan unos 4 KB cada uno y las estructuras grandes
// (Session, View) son estáticas, pero las llamadas anidadas de citro2d y swkbd también piden margen.
u32 __stacksize__ = 0x40000;

int main(void) {
  gfxInitDefault();
  gfxSet3D(true); // 3D estereoscópico: con él activo hay que dibujar los dos ojos en cada cuadro (ver app.c, draw_frame)
  C3D_Init(C3D_DEFAULT_CMDBUF_SIZE);
  C2D_Init(C2D_DEFAULT_MAX_OBJECTS);
  C2D_Prepare();
  AppTargets tg;
  tg.top_left = C2D_CreateScreenTarget(GFX_TOP, GFX_LEFT);
  tg.top_right = C2D_CreateScreenTarget(GFX_TOP, GFX_RIGHT);
  tg.bottom = C2D_CreateScreenTarget(GFX_BOTTOM, GFX_LEFT);
  ui_text_init();

  app_init(&tg);
  while (aptMainLoop()) {
    if (!app_frame(&tg)) break;
  }
  app_exit();

  ui_text_exit();
  C2D_Fini();
  C3D_Fini();
  gfxExit();
  return 0;
}

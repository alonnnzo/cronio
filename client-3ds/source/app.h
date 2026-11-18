// Estado general de la aplicación: configuración, red, sesión con el puente, navegación, gesto de aprobar, entradas
// (botones y táctil), temporizadores, LED y dibujo de las dos pantallas.
//
// Bucle por cuadro (app_frame):
//   1. reposo (salto de reloj > 2 s) -> descartar sockets y sesión, reiniciar soc
//   2. entradas (botones y toque)
//   3. red: net_update, recibir todo lo disponible y pasarlo a session_on_data
//   4. si cambió session_view_seq: nav_sync, approve_view y el focus/unfocus que pida nav
//   5. temporizadores: PING cada 5 s, cierre a los 15 s sin recibir, approve_tick
//   6. dibujar ambas pantallas
//   7. LED si cambió
#ifndef APP_H
#define APP_H

#include <citro2d.h>

// Destinos de dibujo: la pantalla de arriba tiene uno por ojo (3D estereoscópico activo: hay que dibujar los dos en
// cada cuadro) y la de abajo uno.
typedef struct {
  C3D_RenderTarget *top_left, *top_right, *bottom;
} AppTargets;

// Carga la configuración (genera el device_id la primera vez), arranca red, LED, sonido y servicio de azar. Los destinos de
// dibujo sirven para la pantalla "Preparando el sonido…" (la primera vez se extrae el firmware y tarda un poco).
void app_init(const AppTargets *tg);
// Un cuadro. Devuelve 0 cuando hay que salir (START).
int app_frame(const AppTargets *tg);
// Apaga el LED, cierra sockets y servicios.
void app_exit(void);

#endif

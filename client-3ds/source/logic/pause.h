// Reloj virtual que no ve las pausas del bucle principal. El teclado del sistema (swkbd), el menú HOME o el reposo
// detienen el bucle varios segundos; si los temporizadores (ping, silencio de 15 s, guarda de aprobar, plazos de
// conexión, cuenta regresiva) vieran ese salto, cerrarían una conexión sana. Todos leen este reloj en vez de
// osGetTime(): un salto de más de PAUSE_GAP_MS entre dos lecturas cuenta como un solo cuadro normal.
#ifndef LOGIC_PAUSE_H
#define LOGIC_PAUSE_H

#include <stdint.h>

#define PAUSE_GAP_MS 750     // más que esto entre dos lecturas: el bucle estuvo pausado (un envío bloquea hasta 500 ms)
#define PAUSE_FRAME_MS 16    // lo que avanza el reloj virtual en una pausa

typedef struct {
  int started;
  uint64_t last_real;
  uint64_t virt;
  uint64_t paused_ms;   // total de tiempo real descontado
  uint32_t pauses;      // cuántas pausas se vieron
} PauseClock;

void pause_init(PauseClock *c);
// Lee el reloj: real_now es osGetTime(). Devuelve el tiempo virtual (monótono; la primera lectura vale real_now).
uint64_t pause_step(PauseClock *c, uint64_t real_now);

#endif

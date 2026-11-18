// Tiempo en el estado actual de una sesión (Fase 3, panel de agentes), sin libctru. Espejo de packages/simulator/public/elapsed.js.
//
// El reloj de la consola y el del PC pueden no coincidir, así que el puente no manda una hora sino `sinceS`: los segundos que la
// sesión llevaba en su estado cuando armó la vista. La consola le suma su propio tiempo desde que recibió esa vista.
#ifndef LOGIC_ELAPSED_H
#define LOGIC_ELAPSED_H

#include <stddef.h>
#include <stdint.h>

// Segundos totales: since_s + lo que pasó en la consola desde que llegó la vista (view_at_ms -> now_ms). Un reloj que va hacia atrás no resta.
uint64_t elapsed_total_s(uint32_t since_s, uint64_t view_at_ms, uint64_t now_ms);

// Texto corto del tiempo transcurrido: "ahora" (menos de 5 s), "hace 12 s", "hace 3 min", "hace 2 h", "hace 4 d" (se trunca, no se redondea).
// Devuelve cuántos caracteres escribió (sin contar el cero final). Con cap == 0 no escribe nada.
int elapsed_label(uint64_t secs, char *out, size_t cap);

#endif

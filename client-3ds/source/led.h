// LED de aviso de la consola (servicio mcu::HWC). Si no se puede abrir, la app sigue sin LED.
#ifndef LED_H
#define LED_H

#include "core/view.h"

// Devuelve 1 si el LED quedó disponible.
int led_init(void);
// Programa el patrón solo si cambió desde la última vez.
void led_set(LedPattern p);
// Apaga y cierra el servicio.
void led_exit(void);

#endif

// Patrones del LED de aviso según view.led, como tablas de 32 cuadros (el formato de MCU_InfoLedPattern de libctru,
// sin depender de libctru para poder probarlo en el PC).
//   off      apagado
//   working  pulso azul lento
//   ask      parpadeo amarillo
//   done     verde fijo (dura lo que el puente mantenga "done": unos segundos)
//   error    parpadeo rojo rápido
#ifndef LOGIC_LED_PATTERN_H
#define LOGIC_LED_PATTERN_H

#include <stdint.h>

#include "../core/view.h"

#define LED_FRAMES 32

typedef struct {
  uint8_t ticks_per_frame;     // tics de 512 Hz por cuadro (nunca 0)
  uint8_t transition_delay;    // 0 = sin interpolar; = ticks_per_frame = interpolación lineal
  uint8_t last_frame_repeats;
  uint8_t r[LED_FRAMES], g[LED_FRAMES], b[LED_FRAMES];
} LedFrames;

// Lo mismo que mcuTicksFromMs de libctru.
uint8_t led_ticks_from_ms(uint32_t ms);
void led_pattern_build(LedPattern p, LedFrames *out);

#endif

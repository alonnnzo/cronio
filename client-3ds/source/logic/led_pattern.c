#include "led_pattern.h"

#include <string.h>

uint8_t led_ticks_from_ms(uint32_t ms) {
  uint32_t res = 512u * ms / 1000u;
  res = res < 2 ? 1 : res - 1; // no puede ser 0
  res = res > 255 ? 255 : res;
  return (uint8_t)res;
}

static void fill(LedFrames *f, uint8_t r, uint8_t g, uint8_t b, int on_frames, int pulse) {
  for (int i = 0; i < LED_FRAMES; i++) {
    unsigned k;
    if (pulse) k = (unsigned)(i < 16 ? i : 31 - i) * 17u; // triángulo 0..255
    else k = i < on_frames ? 255u : 0u;
    f->r[i] = (uint8_t)(r * k / 255u);
    f->g[i] = (uint8_t)(g * k / 255u);
    f->b[i] = (uint8_t)(b * k / 255u);
  }
}

void led_pattern_build(LedPattern p, LedFrames *out) {
  memset(out, 0, sizeof *out);
  out->ticks_per_frame = led_ticks_from_ms(40);
  switch (p) {
    case VIEW_LED_WORKING:
      out->ticks_per_frame = led_ticks_from_ms(80);
      out->transition_delay = out->ticks_per_frame;
      fill(out, 40, 100, 255, 0, 1);
      break;
    case VIEW_LED_ASK:
      fill(out, 255, 180, 0, 16, 0);
      break;
    case VIEW_LED_DONE:
      fill(out, 0, 255, 60, LED_FRAMES, 0);
      break;
    case VIEW_LED_ERROR:
      out->ticks_per_frame = led_ticks_from_ms(20);
      fill(out, 255, 0, 0, 16, 0);
      break;
    case VIEW_LED_OFF:
    default:
      break;
  }
}

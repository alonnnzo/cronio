#include "led.h"

#include <3ds.h>
#include <string.h>

#include "diag_state.h"
#include "logic/led_pattern.h"

static int g_ready;
static int g_current = -1; // -1: aún no se programó nada

int led_init(void) {
  Result rc = mcuHwcInit();
  g_diag.mcu_tried = 1;
  g_diag.mcu_rc = (uint32_t)rc;
  g_ready = R_SUCCEEDED(rc);
  g_current = -1;
  return g_ready;
}

void led_set(LedPattern p) {
  if (!g_ready || (int)p == g_current) return;
  LedFrames f;
  led_pattern_build(p, &f);
  MCU_InfoLedPattern mp;
  memset(&mp, 0, sizeof mp);
  mp.animation.ticksPerFrame = f.ticks_per_frame;
  mp.animation.frameTransitionDelay = f.transition_delay;
  mp.animation.numLastFrameRepeats = f.last_frame_repeats;
  memcpy(mp.redPattern, f.r, LED_FRAMES);
  memcpy(mp.greenPattern, f.g, LED_FRAMES);
  memcpy(mp.bluePattern, f.b, LED_FRAMES);
  // Si falla no se reintenta en cada cuadro: se anota como programado.
  MCUHWC_SetInfoLedPattern(&mp);
  g_current = (int)p;
}

void led_exit(void) {
  if (!g_ready) return;
  led_set(VIEW_LED_OFF);
  mcuHwcExit();
  g_ready = 0;
}

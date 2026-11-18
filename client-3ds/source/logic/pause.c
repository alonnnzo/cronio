#include "pause.h"

#include <string.h>

void pause_init(PauseClock *c) { memset(c, 0, sizeof *c); }

uint64_t pause_step(PauseClock *c, uint64_t real_now) {
  if (!c->started) {
    c->started = 1;
    c->virt = real_now;
    c->last_real = real_now;
    return c->virt;
  }
  uint64_t d = real_now > c->last_real ? real_now - c->last_real : 0; // el reloj hacia atrás no resta
  c->last_real = real_now > c->last_real ? real_now : c->last_real;
  if (d > PAUSE_GAP_MS) {
    c->virt += PAUSE_FRAME_MS;
    c->paused_ms += d - PAUSE_FRAME_MS;
    c->pauses++;
  } else {
    c->virt += d;
  }
  return c->virt;
}

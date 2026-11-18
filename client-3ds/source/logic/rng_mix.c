#include "rng_mix.h"

#include <string.h>

#include "../core/sha256.h"

static void put64(uint8_t *p, uint64_t v) {
  for (int i = 0; i < 8; i++) p[i] = (uint8_t)(v >> (8 * i));
}

void rng_mix(uint64_t tick, uint64_t time_ms, const char *device_id, uint32_t counter, uint8_t out[32]) {
  uint8_t head[20];
  put64(head, tick);
  put64(head + 8, time_ms);
  for (int i = 0; i < 4; i++) head[16 + i] = (uint8_t)(counter >> (8 * i));
  Sha256 h;
  sha256_init(&h);
  sha256_update(&h, "3dsac-rng-v1", 12);
  sha256_update(&h, head, sizeof head);
  if (device_id != NULL) sha256_update(&h, device_id, strlen(device_id));
  sha256_final(&h, out);
}

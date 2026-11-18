#include "elapsed.h"

#include <stdio.h>

uint64_t elapsed_total_s(uint32_t since_s, uint64_t view_at_ms, uint64_t now_ms) {
  uint64_t local = now_ms > view_at_ms ? (now_ms - view_at_ms) / 1000u : 0u;
  return (uint64_t)since_s + local;
}

int elapsed_label(uint64_t secs, char *out, size_t cap) {
  if (cap == 0) return 0;
  int n;
  if (secs < 5) n = snprintf(out, cap, "ahora");
  else if (secs < 60) n = snprintf(out, cap, "hace %u s", (unsigned)secs);
  else if (secs < 3600) n = snprintf(out, cap, "hace %u min", (unsigned)(secs / 60));
  else if (secs < 86400) n = snprintf(out, cap, "hace %u h", (unsigned)(secs / 3600));
  else n = snprintf(out, cap, "hace %u d", (unsigned)(secs / 86400 > 99999 ? 99999 : secs / 86400));
  if (n < 0) {
    out[0] = '\0';
    return 0;
  }
  return (size_t)n >= cap ? (int)(cap - 1) : n;
}

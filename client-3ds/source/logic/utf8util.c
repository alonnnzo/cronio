#include "utf8util.h"

#include <string.h>

static int is_cont(unsigned char c) { return (c & 0xC0) == 0x80; }

size_t utf8_cp_count(const char *s) {
  size_t n = 0;
  for (; *s; s++) {
    if (!is_cont((unsigned char)*s)) n++;
  }
  return n;
}

size_t utf8_prefix_bytes(const char *s, size_t max_cp) {
  size_t i = 0, cp = 0;
  while (s[i]) {
    if (!is_cont((unsigned char)s[i])) {
      if (cp == max_cp) break;
      cp++;
    }
    i++;
  }
  return i;
}

static const char ELLIPSIS[] = "\xE2\x80\xA6";

int utf8_clip(const char *src, char *dst, size_t cap, size_t max_cp) {
  if (cap == 0) return 0;
  size_t total = utf8_cp_count(src);
  size_t src_bytes = strlen(src);
  if (total <= max_cp && src_bytes < cap) {
    memcpy(dst, src, src_bytes + 1);
    return 0;
  }
  // Hay que recortar: se deja sitio para "…" (3 bytes, 1 punto de código).
  size_t keep_cp = max_cp > 0 ? max_cp - 1 : 0;
  if (keep_cp > total) keep_cp = total;
  size_t bytes = utf8_prefix_bytes(src, keep_cp);
  while (bytes + sizeof ELLIPSIS > cap) {
    if (bytes == 0) break;
    // retroceder un punto de código entero
    bytes--;
    while (bytes > 0 && is_cont((unsigned char)src[bytes])) bytes--;
  }
  if (bytes + sizeof ELLIPSIS > cap) {
    dst[0] = '\0'; // ni "…" cabe
    return 1;
  }
  memcpy(dst, src, bytes);
  memcpy(dst + bytes, ELLIPSIS, sizeof ELLIPSIS);
  return 1;
}

size_t utf8_drop_last(char *s) {
  size_t n = strlen(s);
  if (n == 0) return 0;
  n--;
  while (n > 0 && is_cont((unsigned char)s[n])) n--;
  s[n] = '\0';
  return n;
}

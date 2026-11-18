#include "version.h"

#include <string.h>

int version_parse(const char *s, AppVersion *out) {
  if (s == NULL) return -1;
  size_t n = strlen(s);
  if (n == 0 || n > VERSION_TEXT_MAX) return -1;
  if (s[0] == 'v') s++;
  unsigned parts[3] = {0, 0, 0};
  int part = 0, digits = 0;
  for (const char *p = s;; p++) {
    char c = *p;
    if (c >= '0' && c <= '9') {
      if (++digits > 5) return -1;
      parts[part] = parts[part] * 10u + (unsigned)(c - '0');
    } else if (c == '.' || c == '\0') {
      if (digits == 0 || parts[part] > 65535u) return -1; // parte vacía ("1..2", "1.", ".1") o demasiado grande
      if (c == '\0') break;
      if (++part > 2) return -1; // cuatro partes
      digits = 0;
    } else {
      return -1;
    }
  }
  out->major = parts[0];
  out->minor = parts[1];
  out->micro = parts[2];
  return 0;
}

int version_compare(const AppVersion *a, const AppVersion *b) {
  if (a->major != b->major) return a->major < b->major ? -1 : 1;
  if (a->minor != b->minor) return a->minor < b->minor ? -1 : 1;
  if (a->micro != b->micro) return a->micro < b->micro ? -1 : 1;
  return 0;
}

int version_compare_str(const char *a, const char *b) {
  AppVersion x, y;
  if (version_parse(a, &x) != 0 || version_parse(b, &y) != 0) return VERSION_UNKNOWN;
  return version_compare(&x, &y);
}

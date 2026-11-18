#include "httpget.h"

#include <stdio.h>
#include <string.h>

int httpget_host_is(const HttpUrl *u, const char *host) { return u != NULL && host != NULL && host[0] != 0 && strcmp(u->host, host) == 0; }

int httpget_parse_url(const char *url, HttpUrl *out) {
  if (url == NULL || strncmp(url, "http://", 7) != 0) return -1;
  const char *p = url + 7;
  // host: cuatro números separados por puntos
  size_t host = 0;
  int octets = 0, digits = 0;
  unsigned val = 0;
  for (;; p++) {
    if (*p >= '0' && *p <= '9') {
      val = val * 10u + (unsigned)(*p - '0');
      if (++digits > 3 || val > 255u) return -1;
    } else if (*p == '.' || *p == ':') {
      if (digits == 0) return -1;
      octets++;
      digits = 0;
      val = 0;
      if (*p == ':') break;
      if (octets > 3) return -1;
    } else {
      return -1;
    }
    if (++host > HTTPGET_HOST_MAX) return -1;
  }
  if (octets != 4) return -1;
  memcpy(out->host, url + 7, host);
  out->host[host] = '\0';
  p++; // los dos puntos
  unsigned port = 0;
  digits = 0;
  while (*p >= '0' && *p <= '9') {
    port = port * 10u + (unsigned)(*p - '0');
    if (++digits > 5 || port > 65535u) return -1;
    p++;
  }
  if (digits == 0 || port == 0 || *p != '/') return -1;
  out->port = (uint16_t)port;
  size_t n = 0;
  out->path[n++] = '/';
  p++;
  for (; *p != '\0'; p++) {
    char c = *p;
    int ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '.' || c == '-';
    if (!ok || n >= HTTPGET_PATH_MAX) return -1;
    out->path[n++] = c;
  }
  if (n < 2) return -1; // sin nombre de archivo
  out->path[n] = '\0';
  return 0;
}

int httpget_request(char *out, size_t cap, const HttpUrl *u) {
  int n = snprintf(out, cap, "GET %s HTTP/1.0\r\nHost: %s:%u\r\nUser-Agent: Cronio\r\nConnection: close\r\n\r\n", u->path, u->host, (unsigned)u->port);
  return n < 0 || (size_t)n >= cap ? -1 : n;
}

static int lower(int c) { return c >= 'A' && c <= 'Z' ? c + 32 : c; }

// ¿La línea [s, s+len) empieza con `name` (en minúsculas, sin los dos puntos) seguido de ':'? Devuelve el inicio del valor o NULL.
static const char *header_value(const char *s, size_t len, const char *name) {
  size_t n = strlen(name);
  if (len <= n || s[n] != ':') return NULL;
  for (size_t i = 0; i < n; i++) {
    if (lower((unsigned char)s[i]) != name[i]) return NULL;
  }
  const char *v = s + n + 1;
  const char *end = s + len;
  while (v < end && (*v == ' ' || *v == '\t')) v++;
  return v;
}

int httpget_parse_head(const char *buf, size_t len, HttpHead *out) {
  size_t end = 0;
  int found = 0;
  for (size_t i = 0; i + 3 < len; i++) {
    if (buf[i] == '\r' && buf[i + 1] == '\n' && buf[i + 2] == '\r' && buf[i + 3] == '\n') {
      end = i + 4;
      found = 1;
      break;
    }
  }
  if (!found) {
    if (len >= HTTPGET_HEAD_MAX) return -1;
    // ya se ve que no es HTTP: lo que llegó no empieza como "HTTP/"
    size_t k = len < 5 ? len : 5;
    if (memcmp(buf, "HTTP/", k) != 0) return -1;
    return 0;
  }
  if (end > HTTPGET_HEAD_MAX) return -1;
  // línea de estado: "HTTP/1.x SSS ..."
  if (end < 12 || memcmp(buf, "HTTP/1.", 7) != 0 || (buf[7] != '0' && buf[7] != '1') || buf[8] != ' ') return -1;
  if (!(buf[9] >= '0' && buf[9] <= '9' && buf[10] >= '0' && buf[10] <= '9' && buf[11] >= '0' && buf[11] <= '9')) return -1;
  out->status = (buf[9] - '0') * 100 + (buf[10] - '0') * 10 + (buf[11] - '0');
  out->content_length = -1;
  out->chunked = 0;
  out->head_len = end;
  // el resto de las líneas
  size_t pos = 0;
  while (pos < end && buf[pos] != '\n') pos++;
  pos++;
  while (pos < end) {
    size_t e = pos;
    while (e < end && buf[e] != '\r') e++;
    size_t l = e - pos;
    if (l == 0) break;
    const char *v = header_value(buf + pos, l, "content-length");
    if (v != NULL) {
      int64_t n = 0;
      int digits = 0;
      for (; v < buf + e && *v >= '0' && *v <= '9'; v++) {
        n = n * 10 + (*v - '0');
        if (++digits > 10) return -1;
      }
      if (digits == 0) return -1;
      out->content_length = n;
    }
    v = header_value(buf + pos, l, "transfer-encoding");
    if (v != NULL && (size_t)(buf + e - v) >= 7 && lower((unsigned char)v[0]) == 'c' && lower((unsigned char)v[1]) == 'h') out->chunked = 1;
    pos = e + 2;
  }
  return 1;
}

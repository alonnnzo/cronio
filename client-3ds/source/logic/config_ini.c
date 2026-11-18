#include "config_ini.h"

#include <stdio.h>
#include <string.h>

void config_defaults(Config *c) { memset(c, 0, sizeof *c); }

int config_device_id_valid(const char *s) {
  size_t n = strlen(s);
  if (n < 1 || n > 64) return 0;
  for (size_t i = 0; i < n; i++) {
    char ch = s[i];
    int ok = (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_' ||
             ch == '.' || ch == ':' || ch == '-';
    if (!ok) return 0;
  }
  return 1;
}

int config_ip_valid(const char *s) {
  int octets = 0;
  const char *p = s;
  while (1) {
    int digits = 0, value = 0;
    const char *start = p;
    while (*p >= '0' && *p <= '9') {
      value = value * 10 + (*p - '0');
      digits++;
      p++;
      if (digits > 3) return 0;
    }
    if (digits == 0) return 0;
    if (digits > 1 && *start == '0') return 0; // ceros a la izquierda
    if (value > 255) return 0;
    if (octets == 0 && value == 0) return 0;
    octets++;
    if (*p == '.') {
      p++;
      if (octets == 4) return 0;
      continue;
    }
    break;
  }
  return octets == 4 && *p == '\0';
}

int config_ip_normalize(const char *in, char out[CONFIG_HOST_BYTES]) {
  out[0] = '\0';
  while (*in == ' ' || *in == '\t') in++;
  size_t n = strlen(in);
  while (n > 0 && (in[n - 1] == ' ' || in[n - 1] == '\t' || in[n - 1] == '\r' || in[n - 1] == '\n')) n--;
  if (n == 0 || n >= CONFIG_HOST_BYTES) return -1;
  memcpy(out, in, n);
  out[n] = '\0';
  if (!config_ip_valid(out)) {
    out[0] = '\0';
    return -1;
  }
  return 0;
}

int config_key_hex_valid(const char *s) {
  if (strlen(s) != 64) return 0;
  for (int i = 0; i < 64; i++) {
    char c = s[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return 0;
  }
  return 1;
}

void config_make_device_id(const uint8_t r[4], char out[13]) {
  static const char HEX[] = "0123456789abcdef";
  memcpy(out, "3ds-", 4);
  for (int i = 0; i < 4; i++) {
    out[4 + 2 * i] = HEX[r[i] >> 4];
    out[5 + 2 * i] = HEX[r[i] & 15];
  }
  out[12] = '\0';
}

int config_has_key(const Config *c) { return config_key_hex_valid(c->key_hex); }

uint16_t config_port_or_default(const Config *c) { return c->port != 0 ? c->port : (uint16_t)CONFIG_DEFAULT_PORT; }

// Copia [b, e) recortando espacios; devuelve el largo o -1 si no cabe en cap-1.
static int trim_copy(const char *b, const char *e, char *dst, size_t cap) {
  while (b < e && (*b == ' ' || *b == '\t')) b++;
  while (e > b && (e[-1] == ' ' || e[-1] == '\t' || e[-1] == '\r')) e--;
  size_t n = (size_t)(e - b);
  if (n >= cap) return -1;
  memcpy(dst, b, n);
  dst[n] = '\0';
  return (int)n;
}

int config_parse(const char *text, size_t len, Config *out) {
  config_defaults(out);
  int bad = 0;
  if (len > CONFIG_MAX_FILE) len = CONFIG_MAX_FILE;
  size_t pos = 0;
  while (pos < len) {
    size_t eol = pos;
    while (eol < len && text[eol] != '\n') eol++;
    const char *b = text + pos, *e = text + eol;
    pos = eol + 1;
    while (b < e && (*b == ' ' || *b == '\t')) b++;
    if (b == e || *b == '#' || *b == ';' || *b == '[' || *b == '\r') continue;
    const char *eq = b;
    while (eq < e && *eq != '=') eq++;
    if (eq == e) continue;
    char name[16], value[160];
    if (trim_copy(b, eq, name, sizeof name) < 0) continue; // clave desconocida (demasiado larga)
    if (trim_copy(eq + 1, e, value, sizeof value) < 0) {
      // valor desmesurado: si la clave es conocida, se descarta
      if (!strcmp(name, "device_id") || !strcmp(name, "key") || !strcmp(name, "host") || !strcmp(name, "port") || !strcmp(name, "theme")) bad++;
      continue;
    }
    if (!strcmp(name, "device_id")) {
      if (config_device_id_valid(value)) memcpy(out->device_id, value, strlen(value) + 1);
      else if (value[0]) bad++;
    } else if (!strcmp(name, "key")) {
      if (value[0] == '\0') continue;
      if (config_key_hex_valid(value)) {
        for (int i = 0; i < 64; i++) out->key_hex[i] = (char)(value[i] >= 'A' && value[i] <= 'F' ? value[i] + 32 : value[i]);
        out->key_hex[64] = '\0';
      } else {
        bad++;
      }
    } else if (!strcmp(name, "host")) {
      if (value[0] == '\0') continue;
      if (config_ip_valid(value)) memcpy(out->host, value, strlen(value) + 1);
      else bad++;
    } else if (!strcmp(name, "theme")) {
      if (value[0] == '\0') continue;
      if (!strcmp(value, "dark")) out->dark = 1;
      else if (strcmp(value, "light") != 0) bad++; // cualquier otro valor: se queda el tema claro
    } else if (!strcmp(name, "port")) {
      if (value[0] == '\0') continue;
      long n = 0;
      int ok = 1;
      for (const char *p = value; *p; p++) {
        if (*p < '0' || *p > '9' || n > 65535) {
          ok = 0;
          break;
        }
        n = n * 10 + (*p - '0');
      }
      if (ok && n >= 1 && n <= 65535) out->port = (uint16_t)n;
      else bad++;
    }
  }
  return bad;
}

int config_serialize(const Config *c, char *out, size_t cap) {
  char portbuf[8] = "";
  if (c->port != 0) snprintf(portbuf, sizeof portbuf, "%u", (unsigned)c->port);
  int n = snprintf(out, cap,
                   "# 3DS Agent Companion. No compartas este archivo: key es la clave de emparejamiento.\n"
                   "device_id=%s\n"
                   "key=%s\n"
                   "host=%s\n"
                   "port=%s\n"
                   "theme=%s\n",
                   c->device_id, c->key_hex, c->host, portbuf, c->dark ? "dark" : "light");
  if (n < 0 || (size_t)n >= cap) {
    if (cap > 0) out[0] = '\0';
    return -1;
  }
  return n;
}

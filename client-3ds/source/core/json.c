#include "json.h"

#include <string.h>

typedef struct {
  JsonDoc *d;
  size_t pos;
} Parser;

static int is_ws(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r'; }

static void skip_ws(Parser *p) {
  while (p->pos < p->d->len && is_ws(p->d->src[p->pos])) p->pos++;
}

static int hex_val(unsigned char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

// Lee 4 dígitos hex en s[0..3] (el llamador garantiza que existen). -1 si alguno no lo es.
static int hex4(const unsigned char *s) {
  int v = 0;
  for (int i = 0; i < 4; i++) {
    int h = hex_val(s[i]);
    if (h < 0) return -1;
    v = (v << 4) | h;
  }
  return v;
}

// Largo de una secuencia UTF-8 bien formada que empieza en s (n bytes disponibles), o 0 si es inválida.
// Rechaza sobrelargas, sustitutos (U+D800..DFFF) y todo lo que pase de U+10FFFF.
static size_t utf8_seq_len(const unsigned char *s, size_t n) {
  unsigned char c = s[0];
  if (c < 0x80) return 1;
  if (c >= 0xc2 && c <= 0xdf) return (n >= 2 && (s[1] & 0xc0) == 0x80) ? 2 : 0;
  if (c >= 0xe0 && c <= 0xef) {
    if (n < 3 || (s[1] & 0xc0) != 0x80 || (s[2] & 0xc0) != 0x80) return 0;
    if (c == 0xe0 && s[1] < 0xa0) return 0;
    if (c == 0xed && s[1] > 0x9f) return 0;
    return 3;
  }
  if (c >= 0xf0 && c <= 0xf4) {
    if (n < 4 || (s[1] & 0xc0) != 0x80 || (s[2] & 0xc0) != 0x80 || (s[3] & 0xc0) != 0x80) return 0;
    if (c == 0xf0 && s[1] < 0x90) return 0;
    if (c == 0xf4 && s[1] > 0x8f) return 0;
    return 4;
  }
  return 0;
}

// Recorre el contenido de una cadena desde pos (tras la comilla de apertura) validando escapes y UTF-8.
static int scan_string(Parser *p, size_t *start, size_t *end) {
  const unsigned char *s = (const unsigned char *)p->d->src;
  size_t n = p->d->len;
  size_t i = p->pos + 1;
  *start = i;
  while (i < n) {
    unsigned char c = s[i];
    if (c == '"') {
      *end = i;
      p->pos = i + 1;
      return JSON_OK;
    }
    if (c < 0x20) return JSON_ERR_SYNTAX;
    if (c == '\\') {
      if (i + 1 >= n) return JSON_ERR_SYNTAX;
      unsigned char e = s[i + 1];
      if (e == '"' || e == '\\' || e == '/' || e == 'b' || e == 'f' || e == 'n' || e == 'r' || e == 't') {
        i += 2;
      } else if (e == 'u') {
        if (i + 6 > n || hex4(s + i + 2) < 0) return JSON_ERR_SYNTAX;
        i += 6;
      } else {
        return JSON_ERR_SYNTAX;
      }
      continue;
    }
    if (c >= 0x80) {
      size_t l = utf8_seq_len(s + i, n - i);
      if (l == 0) return JSON_ERR_UTF8;
      i += l;
      continue;
    }
    i++;
  }
  return JSON_ERR_SYNTAX; // cadena sin cerrar
}

static int is_digit(char c) { return c >= '0' && c <= '9'; }

static int scan_number(Parser *p, size_t *start, size_t *end) {
  const char *s = p->d->src;
  size_t n = p->d->len;
  size_t i = p->pos;
  *start = i;
  if (i < n && s[i] == '-') i++;
  if (i >= n || !is_digit(s[i])) return JSON_ERR_SYNTAX;
  if (s[i] == '0') {
    i++;
  } else {
    while (i < n && is_digit(s[i])) i++;
  }
  if (i < n && s[i] == '.') {
    i++;
    if (i >= n || !is_digit(s[i])) return JSON_ERR_SYNTAX;
    while (i < n && is_digit(s[i])) i++;
  }
  if (i < n && (s[i] == 'e' || s[i] == 'E')) {
    i++;
    if (i < n && (s[i] == '+' || s[i] == '-')) i++;
    if (i >= n || !is_digit(s[i])) return JSON_ERR_SYNTAX;
    while (i < n && is_digit(s[i])) i++;
  }
  *end = i;
  p->pos = i;
  return JSON_OK;
}

static int new_token(Parser *p, JsonType type, size_t start, size_t end) {
  if (p->d->count >= JSON_MAX_TOKENS) return -1;
  int idx = p->d->count++;
  JsonTok *t = &p->d->toks[idx];
  t->type = (uint8_t)type;
  t->start = (uint16_t)start;
  t->end = (uint16_t)end;
  t->size = 0;
  t->next = (uint16_t)(idx + 1);
  return idx;
}

static int literal(Parser *p, const char *word, JsonType type) {
  size_t l = strlen(word);
  if (p->d->len - p->pos < l || memcmp(p->d->src + p->pos, word, l) != 0) return JSON_ERR_SYNTAX;
  int idx = new_token(p, type, p->pos, p->pos + l);
  if (idx < 0) return JSON_ERR_TOKENS;
  p->pos += l;
  return JSON_OK;
}

static int parse_value(Parser *p, int depth);

static int parse_string_token(Parser *p) {
  size_t a, b;
  int r = scan_string(p, &a, &b);
  if (r != JSON_OK) return r;
  return new_token(p, JSON_STRING, a, b) < 0 ? JSON_ERR_TOKENS : JSON_OK;
}

static int parse_container(Parser *p, int depth, int is_object) {
  if (depth >= JSON_MAX_DEPTH) return JSON_ERR_DEPTH;
  int idx = new_token(p, is_object ? JSON_OBJECT : JSON_ARRAY, p->pos, p->pos);
  if (idx < 0) return JSON_ERR_TOKENS;
  char close = is_object ? '}' : ']';
  p->pos++; // '{' o '['
  size_t count = 0;
  skip_ws(p);
  if (p->pos < p->d->len && p->d->src[p->pos] == close) {
    p->pos++;
  } else {
    for (;;) {
      skip_ws(p);
      if (is_object) {
        if (p->pos >= p->d->len || p->d->src[p->pos] != '"') return JSON_ERR_SYNTAX;
        int r = parse_string_token(p);
        if (r != JSON_OK) return r;
        skip_ws(p);
        if (p->pos >= p->d->len || p->d->src[p->pos] != ':') return JSON_ERR_SYNTAX;
        p->pos++;
      }
      int r = parse_value(p, depth + 1);
      if (r != JSON_OK) return r;
      count++;
      skip_ws(p);
      if (p->pos >= p->d->len) return JSON_ERR_SYNTAX;
      char c = p->d->src[p->pos++];
      if (c == close) break;
      if (c != ',') return JSON_ERR_SYNTAX;
    }
  }
  JsonTok *t = &p->d->toks[idx];
  t->end = (uint16_t)p->pos;
  t->size = (uint16_t)count;
  t->next = (uint16_t)p->d->count;
  return JSON_OK;
}

static int parse_value(Parser *p, int depth) {
  skip_ws(p);
  if (p->pos >= p->d->len) return JSON_ERR_SYNTAX;
  char c = p->d->src[p->pos];
  switch (c) {
    case '{':
      return parse_container(p, depth, 1);
    case '[':
      return parse_container(p, depth, 0);
    case '"':
      return parse_string_token(p);
    case 't':
      return literal(p, "true", JSON_TRUE);
    case 'f':
      return literal(p, "false", JSON_FALSE);
    case 'n':
      return literal(p, "null", JSON_NULL);
    default:
      if (c == '-' || is_digit(c)) {
        size_t a, b;
        int r = scan_number(p, &a, &b);
        if (r != JSON_OK) return r;
        return new_token(p, JSON_NUMBER, a, b) < 0 ? JSON_ERR_TOKENS : JSON_OK;
      }
      return JSON_ERR_SYNTAX;
  }
}

int json_parse(JsonDoc *doc, const char *src, size_t len) {
  doc->src = src;
  doc->len = len;
  doc->count = 0;
  if (len > JSON_MAX_INPUT) return JSON_ERR_TOO_LONG;
  if (len == 0 || src == NULL) return JSON_ERR_SYNTAX;
  Parser p = {doc, 0};
  int r = parse_value(&p, 0);
  if (r != JSON_OK) {
    doc->count = 0;
    return r;
  }
  skip_ws(&p);
  if (p.pos != len) {
    doc->count = 0;
    return JSON_ERR_SYNTAX;
  }
  return JSON_OK;
}

const JsonTok *json_first(const JsonDoc *doc, const JsonTok *t) {
  if (t == NULL || (t->type != JSON_ARRAY && t->type != JSON_OBJECT) || t->size == 0) return NULL;
  const JsonTok *c = t + 1;
  return c < doc->toks + doc->count ? c : NULL;
}

const JsonTok *json_next(const JsonDoc *doc, const JsonTok *t) {
  if (t == NULL) return NULL;
  const JsonTok *n = doc->toks + t->next;
  return n < doc->toks + doc->count ? n : NULL;
}

const JsonTok *json_get(const JsonDoc *doc, const JsonTok *obj, const char *key) {
  if (obj == NULL || obj->type != JSON_OBJECT) return NULL;
  const JsonTok *found = NULL;
  const JsonTok *k = json_first(doc, obj);
  for (size_t i = 0; i < obj->size && k != NULL; i++) {
    const JsonTok *v = json_next(doc, k);
    if (v == NULL) break;
    if (json_str_eq(doc, k, key)) found = v;
    k = json_next(doc, v);
  }
  return found;
}

const JsonTok *json_at(const JsonDoc *doc, const JsonTok *arr, size_t idx) {
  if (arr == NULL || arr->type != JSON_ARRAY || idx >= arr->size) return NULL;
  const JsonTok *c = json_first(doc, arr);
  for (size_t i = 0; i < idx && c != NULL; i++) c = json_next(doc, c);
  return c;
}

// Cuántos bytes ocupa el punto de código en UTF-8.
static size_t utf8_len_of(uint32_t cp) { return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4; }

static void utf8_put(uint32_t cp, char *out) {
  if (cp < 0x80) {
    out[0] = (char)cp;
  } else if (cp < 0x800) {
    out[0] = (char)(0xc0 | (cp >> 6));
    out[1] = (char)(0x80 | (cp & 0x3f));
  } else if (cp < 0x10000) {
    out[0] = (char)(0xe0 | (cp >> 12));
    out[1] = (char)(0x80 | ((cp >> 6) & 0x3f));
    out[2] = (char)(0x80 | (cp & 0x3f));
  } else {
    out[0] = (char)(0xf0 | (cp >> 18));
    out[1] = (char)(0x80 | ((cp >> 12) & 0x3f));
    out[2] = (char)(0x80 | ((cp >> 6) & 0x3f));
    out[3] = (char)(0x80 | (cp & 0x3f));
  }
}

size_t json_string(const JsonDoc *doc, const JsonTok *tok, char *out, size_t cap, size_t *chars, int *truncated) {
  size_t u = 0;
  int cut = 0;
  size_t w = 0;
  if (chars) *chars = 0;
  if (truncated) *truncated = 0;
  if (cap > 0) out[0] = '\0';
  if (tok == NULL || tok->type != JSON_STRING || tok->end > doc->len || tok->start > tok->end) return 0;
  const unsigned char *s = (const unsigned char *)doc->src;
  size_t i = tok->start, end = tok->end;
  while (i < end) {
    uint32_t cp;
    unsigned char c = s[i];
    if (c == '\\') {
      if (i + 1 >= end) break; // ya validado al analizar; defensa
      unsigned char e = s[i + 1];
      i += 2;
      switch (e) {
        case 'b': cp = '\b'; break;
        case 'f': cp = '\f'; break;
        case 'n': cp = '\n'; break;
        case 'r': cp = '\r'; break;
        case 't': cp = '\t'; break;
        case 'u': {
          if (i + 4 > end) { i = end; cp = 0xfffd; break; }
          int v = hex4(s + i);
          i += 4;
          if (v < 0) { cp = 0xfffd; break; }
          cp = (uint32_t)v;
          if (cp >= 0xd800 && cp <= 0xdbff) {
            int lo = -1;
            if (i + 6 <= end && s[i] == '\\' && s[i + 1] == 'u') lo = hex4(s + i + 2);
            if (lo >= 0xdc00 && lo <= 0xdfff) {
              cp = 0x10000 + (((cp - 0xd800) << 10) | ((uint32_t)lo - 0xdc00));
              i += 6;
            } else {
              cp = 0xfffd;
            }
          } else if (cp >= 0xdc00 && cp <= 0xdfff) {
            cp = 0xfffd;
          } else if (cp == 0) {
            cp = 0xfffd;
          }
          break;
        }
        default: cp = e; break; // '"', '\\', '/'
      }
    } else if (c < 0x80) {
      cp = c;
      i++;
    } else {
      size_t l = utf8_seq_len(s + i, end - i);
      if (l == 0) { // no debería ocurrir tras json_parse; se sustituye y se sigue
        cp = 0xfffd;
        i++;
      } else {
        if (l == 2) cp = ((uint32_t)(c & 0x1f) << 6) | (s[i + 1] & 0x3f);
        else if (l == 3) cp = ((uint32_t)(c & 0x0f) << 12) | ((uint32_t)(s[i + 1] & 0x3f) << 6) | (s[i + 2] & 0x3f);
        else cp = ((uint32_t)(c & 0x07) << 18) | ((uint32_t)(s[i + 1] & 0x3f) << 12) |
                  ((uint32_t)(s[i + 2] & 0x3f) << 6) | (s[i + 3] & 0x3f);
        i += l;
      }
    }
    u++;
    if (!cut) {
      size_t need = utf8_len_of(cp);
      if (cap > 0 && w + need + 1 <= cap) {
        utf8_put(cp, out + w);
        w += need;
      } else {
        cut = 1;
      }
    }
  }
  if (cap > 0) out[w] = '\0';
  if (chars) *chars = u;
  if (truncated) *truncated = cut;
  return w;
}

int json_str_eq(const JsonDoc *doc, const JsonTok *tok, const char *lit) {
  char buf[64];
  size_t l = strlen(lit);
  if (l > 62 || tok == NULL || tok->type != JSON_STRING) return 0;
  int cut = 0;
  size_t w = json_string(doc, tok, buf, sizeof buf, NULL, &cut);
  return !cut && w == l && memcmp(buf, lit, l) == 0;
}

int json_uint(const JsonDoc *doc, const JsonTok *tok, uint64_t *out) {
  if (tok == NULL || tok->type != JSON_NUMBER) return -1;
  const char *s = doc->src + tok->start;
  size_t n = (size_t)tok->end - tok->start;
  if (n == 0 || n > 16) return -1; // 2^53 - 1 tiene 16 dígitos
  if (n > 1 && s[0] == '0') return -1;
  uint64_t v = 0;
  for (size_t i = 0; i < n; i++) {
    if (s[i] < '0' || s[i] > '9') return -1;
    v = v * 10 + (uint64_t)(s[i] - '0');
  }
  if (v > 9007199254740991ull) return -1;
  *out = v;
  return 0;
}

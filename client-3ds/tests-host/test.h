// Marco de pruebas mínimo: macros de aserción, contador y búferes con página de guarda.
// Cada test_*.c es un ejecutable; al final imprime "ASSERTIONS <n> FAILED <m>" y devuelve distinto de cero si algo falló.
#ifndef TEST_H
#define TEST_H

#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if defined(__CYGWIN__) || defined(__unix__) || defined(__linux__) || defined(__APPLE__)
#include <sys/mman.h>
#define TEST_HAVE_GUARD 1
#else
#define TEST_HAVE_GUARD 0
#endif

#define T_UNUSED __attribute__((unused))

static int t_checks = 0;
static int t_fails = 0;

#define CHECK(cond)                                                       \
  do {                                                                    \
    t_checks++;                                                           \
    if (!(cond)) {                                                        \
      t_fails++;                                                          \
      printf("  FALLA %s:%d: %s\n", __FILE__, __LINE__, #cond);           \
    }                                                                     \
  } while (0)

#define CHECK_MSG(cond, ...)                                              \
  do {                                                                    \
    t_checks++;                                                           \
    if (!(cond)) {                                                        \
      t_fails++;                                                          \
      printf("  FALLA %s:%d: %s -- ", __FILE__, __LINE__, #cond);         \
      printf(__VA_ARGS__);                                                \
      printf("\n");                                                       \
    }                                                                     \
  } while (0)

#define CHECK_EQ_INT(a, b)                                                                              \
  do {                                                                                                  \
    long long a_ = (long long)(a), b_ = (long long)(b);                                                 \
    t_checks++;                                                                                         \
    if (a_ != b_) {                                                                                     \
      t_fails++;                                                                                        \
      printf("  FALLA %s:%d: %s == %s (%lld != %lld)\n", __FILE__, __LINE__, #a, #b, a_, b_);           \
    }                                                                                                   \
  } while (0)

#define CHECK_STR(a, b)                                                                                 \
  do {                                                                                                  \
    const char *a_ = (a), *b_ = (b);                                                                    \
    t_checks++;                                                                                         \
    if (a_ == NULL || b_ == NULL || strcmp(a_, b_) != 0) {                                              \
      t_fails++;                                                                                        \
      printf("  FALLA %s:%d: %s == %s\n    obtenido: \"%s\"\n    esperado: \"%s\"\n", __FILE__, __LINE__, \
             #a, #b, a_ ? a_ : "(null)", b_ ? b_ : "(null)");                                          \
    }                                                                                                   \
  } while (0)

#define CHECK_MEM(a, b, n)                                                                              \
  do {                                                                                                  \
    t_checks++;                                                                                         \
    if (memcmp((a), (b), (n)) != 0) {                                                                   \
      t_fails++;                                                                                        \
      printf("  FALLA %s:%d: memoria distinta: %s vs %s (%zu bytes)\n", __FILE__, __LINE__, #a, #b,     \
             (size_t)(n));                                                                              \
    }                                                                                                   \
  } while (0)

#define TEST_BEGIN(name)                   \
  do {                                     \
    setvbuf(stdout, NULL, _IOLBF, 4096);   \
    printf("== %s\n", name);               \
  } while (0)
#define RUN(fn)                            \
  do {                                     \
    printf("  - %s\n", #fn);               \
    fn();                                  \
  } while (0)
#define TEST_END()                                              \
  do {                                                          \
    printf("ASSERTIONS %d FAILED %d\n", t_checks, t_fails);     \
    return t_fails == 0 ? 0 : 1;                                \
  } while (0)

// ---- hex ----

T_UNUSED static int t_hexval(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

// Decodifica la cadena hex completa en out (cap bytes). Devuelve los bytes, o -1 si no es hex válido o no cabe.
T_UNUSED static int t_unhex(const char *hex, uint8_t *out, size_t cap) {
  size_t n = strlen(hex);
  if (n % 2 != 0 || n / 2 > cap) return -1;
  for (size_t i = 0; i < n / 2; i++) {
    int a = t_hexval(hex[2 * i]), b = t_hexval(hex[2 * i + 1]);
    if (a < 0 || b < 0) return -1;
    out[i] = (uint8_t)(a * 16 + b);
  }
  return (int)(n / 2);
}

// ---- búfer con página de guarda ----
// Los datos quedan pegados al final de la región: leer o escribir un byte más allá de `len` toca una página sin
// permisos y el programa cae. Sirve de sustituto de AddressSanitizer, que este gcc (Cygwin) no trae.

#define GUARD_PAGE 65536 // la granularidad de mmap en Cygwin

typedef struct {
  uint8_t *base;
  size_t pages; // bytes de la región de datos (múltiplo de GUARD_PAGE)
} Guard;

T_UNUSED static void guard_init(Guard *g, size_t capacity) {
  g->pages = ((capacity + GUARD_PAGE - 1) / GUARD_PAGE) * GUARD_PAGE;
#if TEST_HAVE_GUARD
  g->base = (uint8_t *)mmap(NULL, g->pages + GUARD_PAGE, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  if (g->base == (uint8_t *)MAP_FAILED || mprotect(g->base + g->pages, GUARD_PAGE, PROT_NONE) != 0) {
    printf("no se pudo crear la página de guarda\n");
    exit(2);
  }
#else
  g->base = (uint8_t *)malloc(g->pages);
#endif
}

// Devuelve un puntero a `len` bytes terminados justo en el borde de la guarda.
T_UNUSED static uint8_t *guard_at_end(Guard *g, size_t len) {
  if (len > g->pages) {
    printf("guard_at_end: %zu excede la capacidad\n", len);
    exit(2);
  }
  return g->base + g->pages - len;
}

// Copia `data` al borde de la guarda y devuelve la copia.
T_UNUSED static uint8_t *guard_copy(Guard *g, const void *data, size_t len) {
  uint8_t *p = guard_at_end(g, len);
  if (len > 0) memcpy(p, data, len);
  return p;
}

#endif

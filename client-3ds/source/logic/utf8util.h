// Utilidades de UTF-8 sin dependencias: contar, recortar y poner "…". Toleran bytes inválidos (un byte de
// continuación suelto cuenta como un carácter más) y nunca cortan una secuencia a la mitad.
#ifndef LOGIC_UTF8UTIL_H
#define LOGIC_UTF8UTIL_H

#include <stddef.h>

// Puntos de código de la cadena (cada byte que no es de continuación abre uno).
size_t utf8_cp_count(const char *s);
// Bytes que ocupan los primeros max_cp puntos de código.
size_t utf8_prefix_bytes(const char *s, size_t max_cp);
// Copia src en dst (cap bytes con NUL). Si tiene más de max_cp puntos de código, o no cabe, corta y termina en "…"
// (U+2026), de modo que el resultado tenga como mucho max_cp puntos de código. Devuelve 1 si recortó.
int utf8_clip(const char *src, char *dst, size_t cap, size_t max_cp);
// Quita el último punto de código; devuelve el largo nuevo (0 si ya estaba vacía).
size_t utf8_drop_last(char *s);

#endif

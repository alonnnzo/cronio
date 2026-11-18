// Lector de JSON mínimo y a prueba de entradas hostiles: sin memoria dinámica, con tope de tokens, de profundidad y
// de largo. Produce una lista de tokens que apuntan al texto original (que debe seguir vivo y sin cambios).
//
// - Objetos, arreglos, cadenas con escapes (\uXXXX con pares sustitutos), números, true/false/null; gramática de
//   JSON.parse (sin comas finales, sin comentarios, sin ceros a la izquierda).
// - Las cadenas deben ser UTF-8 válido y no llevar caracteres de control sin escapar.
// - Un \uXXXX que sea mitad suelta de un par sustituto se decodifica como U+FFFD; \u0000 también (la cadena de C
//   no puede contener NUL).
#ifndef CORE_JSON_H
#define CORE_JSON_H

#include <stddef.h>
#include <stdint.h>

#define JSON_MAX_TOKENS 768 // una vista con 12 sesiones y una pregunta de 4 preguntas por 4 opciones usa unos 520
#define JSON_MAX_DEPTH 16
#define JSON_MAX_INPUT 65535 // los desplazamientos de los tokens son de 16 bits

typedef enum { JSON_NULL, JSON_TRUE, JSON_FALSE, JSON_NUMBER, JSON_STRING, JSON_ARRAY, JSON_OBJECT } JsonType;

enum {
  JSON_OK = 0,
  JSON_ERR_SYNTAX = -1,
  JSON_ERR_DEPTH = -2,
  JSON_ERR_TOKENS = -3,
  JSON_ERR_TOO_LONG = -4,
  JSON_ERR_UTF8 = -5
};

typedef struct {
  uint8_t type;    // JsonType
  uint16_t start;  // desplazamiento en el texto; en cadenas, el primer byte tras la comilla de apertura
  uint16_t end;    // fin exclusivo; en cadenas, la comilla de cierre
  uint16_t size;   // hijos directos: elementos de un arreglo o pares de un objeto
  uint16_t next;   // índice del token que sigue a este y a todo lo que contiene
} JsonTok;

typedef struct {
  const char *src;
  size_t len;
  int count;
  JsonTok toks[JSON_MAX_TOKENS];
} JsonDoc;

// Analiza todo el texto (un solo valor y nada después). Devuelve JSON_OK o un JSON_ERR_*. Con error, doc queda
// inservible. src puede no terminar en NUL; len puede ser 0 (error de sintaxis).
int json_parse(JsonDoc *doc, const char *src, size_t len);

static inline const JsonTok *json_root(const JsonDoc *doc) { return doc->count > 0 ? &doc->toks[0] : NULL; }

// Valor de la clave `key` (ASCII, hasta 62 caracteres) en un objeto; NULL si no es objeto o no está.
// Con claves repetidas gana la última, como en JSON.parse.
const JsonTok *json_get(const JsonDoc *doc, const JsonTok *obj, const char *key);
// Elemento i de un arreglo; NULL si no es arreglo o está fuera de rango.
const JsonTok *json_at(const JsonDoc *doc, const JsonTok *arr, size_t i);
// Primer hijo (elemento de un arreglo; en un objeto, la primera clave) y siguiente hermano. NULL si no hay.
// En un objeto los hijos alternan clave, valor, clave, valor...
const JsonTok *json_first(const JsonDoc *doc, const JsonTok *t);
const JsonTok *json_next(const JsonDoc *doc, const JsonTok *t);

// Decodifica una cadena a UTF-8 en out (terminado en NUL si cap > 0). Si no cabe, se corta en un límite de carácter
// (nunca a mitad de una secuencia UTF-8) y *truncated queda en 1. Devuelve los bytes escritos sin el NUL.
// *chars recibe el largo de la cadena completa en puntos de código (los esquemas zod 4 cuentan así el `max` de una
// cadena: un emoji vale 1), aunque se haya truncado. chars y truncated pueden ser NULL. Si tok no es una cadena, escribe "" y devuelve 0.
size_t json_string(const JsonDoc *doc, const JsonTok *tok, char *out, size_t cap, size_t *chars, int *truncated);

// ¿La cadena decodificada es exactamente `lit`? (lit ASCII, hasta 62 caracteres)
int json_str_eq(const JsonDoc *doc, const JsonTok *tok, const char *lit);

// Entero sin signo en notación simple (solo dígitos, sin ceros a la izquierda, sin fracción ni exponente) y que sea
// un entero seguro de JavaScript (<= 2^53 - 1). 0 si sirve; -1 si no.
int json_uint(const JsonDoc *doc, const JsonTok *tok, uint64_t *out);

#endif

// Versión de la app (APP_VERSION del Makefile, "0.2.0") y su comparación. Sin libctru. Espejo de packages/protocol/src/version.ts.
#ifndef LOGIC_VERSION_H
#define LOGIC_VERSION_H

#define VERSION_TEXT_MAX 16 // largo máximo del texto de una versión (MAX_VERSION_TEXT del protocolo)
#define VERSION_UNKNOWN 2   // version_compare_str: alguna de las dos no se pudo leer

typedef struct {
  unsigned major, minor, micro;
} AppVersion;

// Lee "1", "1.2" o "1.2.3" (cada parte de 0 a 65535, solo dígitos, hasta 5 por parte); una "v" al comienzo se admite y lo que falte vale 0.
// 0 si sirve; -1 si no es una versión (vacía, con letras, signos, espacios o demasiado larga).
int version_parse(const char *s, AppVersion *out);

// -1 si a < b, 0 si son iguales, 1 si a > b.
int version_compare(const AppVersion *a, const AppVersion *b);

// Compara dos textos: -1, 0 o 1; VERSION_UNKNOWN (2) si alguno no es una versión (p. ej. el puente no mandó la suya).
int version_compare_str(const char *a, const char *b);

#endif

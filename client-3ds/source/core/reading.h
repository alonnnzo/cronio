// Mensaje completo de una sesión (Fase 2b, paso 1): la respuesta `text` del puente a `read`. No forma parte de la vista:
// llega solo cuando la consola lo pide, ya limpio de markdown y cortado en líneas de hasta 48 caracteres (READING_MAX_TEXT, propio del lector).
//
// Memoria fija: READING_MAX_LINES líneas de READING_TEXT_BYTES (48 caracteres * 4 bytes UTF-8 + NUL) = unos 46 KB dentro
// de la sesión (estática, no en la pila). Cada línea se copia con tope y terminador, como los demás textos.
#ifndef CORE_READING_H
#define CORE_READING_H

#include "json.h"
#include "view.h"

#define READING_MAX_LINES 240 // MAX_READ_LINES del protocolo
#define READING_MAX_TEXT 48   // MAX_READ_TEXT del protocolo: ancho de línea del lector (el resto del protocolo usa VIEW_MAX_TEXT = 38)
#define READING_TEXT_BYTES (READING_MAX_TEXT * 4 + 1)

typedef char ReadText[READING_TEXT_BYTES];

typedef struct {
  ViewId session_id;
  int line_count;                       // 0 a READING_MAX_LINES; 0 = sesión desconocida o sin mensaje
  ReadText lines[READING_MAX_LINES];
  int truncated;                        // el mensaje no cupo: el puente lo cortó al final ("… sigue en el PC")
  int mode;                             // READ_MODE_*: el modo de las líneas (campo opcional `mode`; ausente = completo)
  int whole;                            // en resumen, el mensaje ya cabía entero y las líneas son el mensaje (campo opcional `short`)
  int question_count;                   // 0 = sin pregunta pendiente; si no, 1 a 3
  ReadText question[VIEW_MAX_QUESTION_LINES];
} ReadDoc;

enum {
  READING_OK = 0,
  READING_ERR_SCHEMA = -2, // mismos valores que VIEW_ERR_*
  READING_ERR_LIMIT = -3
};

// ¿El mensaje ya leído es {"t":"text",...}?
int reading_is_text(const JsonDoc *d);
// Valida y copia un mensaje `text`. Con un error, *out queda a medias: no se debe usar.
int reading_parse_doc(const JsonDoc *d, ReadDoc *out);
// Atajo para las pruebas: analiza el JSON y luego el mensaje. Devuelve VIEW_ERR_JSON si no es JSON válido.
int reading_parse(const char *json, size_t len, ReadDoc *out);

// Líneas del documento que se pueden recorrer: las del puente más, si se cortó, la de "… sigue en el PC".
static inline int reading_total_lines(const ReadDoc *d) { return d->line_count + (d->truncated ? 1 : 0); }

#endif

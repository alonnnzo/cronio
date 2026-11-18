// Pantalla inferior del lector del mensaje completo (Fase 2b, paso 1): cabecera con agente · proyecto, posición "n-m/N" y
// "B Volver"; aviso de mensaje nuevo; la pregunta pendiente arriba; y las líneas que mandó el puente (la consola no parte
// texto). La geometría sale de logic/reader.c; aquí solo se pinta con citro2d.
#ifndef RENDER_READER_H
#define RENDER_READER_H

#include <stdint.h>

#include "core/reading.h"
#include "core/view.h"
#include "logic/reader.h"

typedef struct {
  const View *view;       // para el nombre del agente y el proyecto
  const Reader *reader;
  const ReadDoc *doc;     // NULL mientras carga
  uint64_t now_ms;
} ReaderModel;

void render_reader_draw(const ReaderModel *m);

#endif

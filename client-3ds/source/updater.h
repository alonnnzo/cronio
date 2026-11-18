// Actualizar la app desde la consola (Fase 7): baja el .cia del puente por HTTP (sockets, sin el servicio http:C) ENTERO a memoria
// (unos 370 KB) y solo entonces lo instala con AM:
//
//   conectar (no bloqueante) -> GET /agent-companion.cia -> cabecera (200 y Content-Length) -> descarga a memoria (0-80 % de la barra)
//   -> amInit -> AM_StartCiaInstall(MEDIATYPE_SD) -> FSFILE_Write en trozos de 256 KB con flush -> AM_FinishCiaInstall (80-100 %)
//
// Un corte de red nunca toca AM. Antes de abrirlo se verifica lo descargado: tamaño igual al que anunció el PC (Content-Length == size) y
// SHA-256 igual al de la vista (el HTTP va en claro: sin esto cualquiera en la red podría entregar otro .cia). La dirección debe ser la del
// mismo PC al que está conectada la consola. Si algo no coincide, falla sin tocar AM.
// Si AM falla, se cancela y se mantiene la versión instalada (no se borra nada ni se reintenta). Cada cuadro de la app llama a
// updater_step, que hace una llamada de AM o un poco de descarga (unos 12 ms) y vuelve para que la pantalla de progreso se dibuje. La máquina de estados, los
// pasos y los textos de error salen de logic/updflow.c y logic/update.c; las direcciones y la cabecera, de logic/httpget.c.
#ifndef UPDATER_H
#define UPDATER_H

#include <stdint.h>

#include "logic/update.h"

typedef enum { UPR_RUNNING, UPR_DONE, UPR_FAILED } UpdaterResult;

typedef struct {
  UpdStep step;      // en qué paso va
  uint32_t done;     // bytes del paso en curso: descargados o instalados
  uint32_t total;    // bytes del .cia (0 hasta que el puente los dice)
  char error[UPDATE_ERROR_BYTES]; // UPR_FAILED: qué pasó, con la función que falló y su código, para mostrarlo
} UpdaterStatus;

// Empieza la descarga de `url` (la de `update.url` de la vista) con el tamaño y el SHA-256 que anunció el PC. `expected_host`: el host del
// puente al que está conectada la consola; la dirección debe ser la de ese host. Devuelve 0 si arrancó; -1 si no se pudo (st->error dice por qué).
int updater_start(const char *url, const char *expected_host, uint32_t size, const uint8_t sha256[32], uint64_t now, UpdaterStatus *st);
// Un cuadro de trabajo. Mientras devuelve UPR_RUNNING hay que volver a llamarla (y dibujar el progreso de st).
UpdaterResult updater_step(UpdaterStatus *st, uint64_t now);
// Cancela lo que esté en curso (AM_CancelCIAInstall si ya se había empezado) y libera el socket, la memoria y AM. Se puede llamar siempre.
void updater_cancel(void);

#endif

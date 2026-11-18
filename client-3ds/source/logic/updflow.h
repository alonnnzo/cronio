// Máquina de estados de la actualización de la app (Fase 7), sin libctru: qué hacer con el .cia ya descargado y verificado y cómo
// terminar si AM falla. updater.c ejecuta las llamadas de AM y le cuenta a esta máquina qué salió; aquí se decide el paso siguiente y el
// texto de los errores. Así se prueba en el PC.
//
//   descarga entera a memoria (UF_DOWNLOADING; AM no se toca hasta tener TODOS los bytes: un corte de red nunca deja nada a medias)
//   -> (updater.c verifica tamaño y SHA-256 contra lo que anunció el PC; si no coinciden, ni se abre AM)
//   -> START (AM_StartCiaInstall) -> WRITE (FSFILE_Write, trozos de 256 KB con flush) ... -> FINISH (AM_FinishCiaInstall) -> UF_DONE
//
// Si START, un WRITE o FINISH fallan, NO se reintenta ni se borra nada: si había un manejador de instalación abierto se cancela
// (AM_CancelCIAInstall; tras un START fallido o un FINISH no lo hay) y la actualización termina con el error, con la función y su código.
// La versión instalada se mantiene (instalar el .cia sobre el título en ejecución funciona sin borrarlo antes).
#ifndef LOGIC_UPDFLOW_H
#define LOGIC_UPDFLOW_H

#include <stddef.h>
#include <stdint.h>

#include "update.h"

#define UF_CHUNK_BYTES (256u * 1024u)         // trozo de FSFILE_Write
#define UF_MIN_CIA_BYTES VIEW_UPDATE_SIZE_MIN // un .cia tiene al menos su cabecera, el certificado, el TMD y el ticket
#define UF_MAX_CIA_BYTES VIEW_UPDATE_SIZE_MAX // el .cia entero cabe en memoria: pesa unos 370 KB

// Texto cuando lo descargado no es lo que anunció el PC (tamaño o SHA-256 distintos).
#define UF_ERR_MISMATCH "El archivo descargado no coincide con el que anunció el PC."

typedef enum { UF_OP_START, UF_OP_WRITE, UF_OP_FINISH, UF_OP_CANCEL } UfOp;
typedef enum { UF_DOWNLOADING, UF_INSTALLING, UF_DONE, UF_FAILED } UfState;

typedef struct {
  UfOp op;
  uint32_t offset, len; // UF_OP_WRITE: desde qué byte del .cia y cuántos
  UpdStep step;         // el paso que se muestra mientras se hace
} UfAction;

typedef struct {
  int set;
  UfOp op;
  int32_t rc;
  uint32_t offset, len, written; // UF_OP_WRITE
} UfFault;

typedef struct {
  UfState state;
  uint32_t total, received;       // descarga
  uint32_t offset;                // bytes ya escritos a AM
  int am_touched;                 // alguna vez se entregó una acción de AM
  UfFault fault;                  // lo que falló en AM (la cancelación posterior no cuenta)
  char error[UPDATE_ERROR_BYTES]; // UF_FAILED por AM: el texto con la función y su código
  int have_action;                // se entregó una acción y falta su resultado
  UfAction last;
  int has_next;
  UfAction next;
} UpdFlow;

// `total`: bytes del .cia (el que dijo el puente).
void uf_init(UpdFlow *f, uint32_t total);
// ¿Tamaño aceptable para un .cia? (entre UF_MIN_CIA_BYTES y UF_MAX_CIA_BYTES)
int uf_size_ok(int64_t bytes);
// ¿Lo descargado es lo que anunció el PC? 1 si `len` es `want_size` y el SHA-256 de `buf` es `want_sha` (comparación en tiempo constante).
int uf_verify(const uint8_t *buf, uint32_t len, uint32_t want_size, const uint8_t want_sha[32]);

// Llegaron `n` bytes más de la descarga. Con todos, pasa a UF_INSTALLING. Sin efecto fuera de UF_DOWNLOADING.
void uf_downloaded(UpdFlow *f, uint32_t n);
// La descarga falló (corte, plazo, memoria, verificación): sin tocar AM. UF_FAILED; el texto lo pone quien llama.
void uf_download_failed(UpdFlow *f);

// Próxima acción de AM. 1 si hay una (y hay que contar su resultado con uf_result antes de pedir otra); 0 si no
// (descargando, ya terminó o falló, o falta un resultado).
int uf_next(UpdFlow *f, UfAction *a);
// Resultado de la acción entregada: `rc` de la llamada y, para UF_OP_WRITE, los bytes que dijo haber escrito.
void uf_result(UpdFlow *f, int32_t rc, uint32_t written);

// Bytes del paso en curso: los descargados, o los ya escritos a AM.
uint32_t uf_progress(const UpdFlow *f);

// "FSFILE_Write C8A08BF4 en el byte 0", "AM_StartCiaInstall C8A08BF4".
void uf_fault_text(const UfFault *x, char *out, size_t cap);
const char *uf_op_name(UfOp op);

#endif

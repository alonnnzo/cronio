// Sonido de los avisos (Fase 2b, paso 3b): pegamento con `ndsp` de libctru. La lógica (cuándo suena, cómo se sintetiza) vive en
// logic/chime.c; el firmware se extrae en dsp_extract.c.
//
// Un canal de ndsp, cuatro búferes PCM16 pequeños sintetizados al iniciar. Nada bloquea el bucle: sound_play solo encola.
// Si algo falla (sin firmware, ndspInit con error, sin memoria) la app sigue sin sonido; nunca se cuelga ni cae por esto.
#ifndef SOUND_H
#define SOUND_H

#include <stdint.h>

#include "core/view.h"

typedef enum {
  SOUND_NONE = 0,   // todavía no se inició
  SOUND_READY,      // ndsp funciona
  SOUND_NO_FIRM,    // no hay dspfirm.cdc y no se pudo extraer
  SOUND_ERROR       // ndspInit (o los búferes) fallaron
} SoundStatus;

typedef struct {
  SoundStatus status;
  uint32_t rc;        // Result de ndspInit, o el detalle de la extracción
  int extracted;      // se extrajo el firmware en este inicio
  char msg[112];      // mensaje corto para el usuario ("" si todo bien)
} SoundInit;

// 1 si falta `sdmc:/3ds/dspfirm.cdc` (la app debe mostrar "Preparando el sonido…" antes de sound_init).
int sound_needs_extraction(void);
// Extrae el firmware si falta e inicia ndsp. Puede tardar un segundo la primera vez.
void sound_init(SoundInit *out);
// 1 si ndsp está listo.
int sound_ready(void);
// Encola el sonido (sin bloquear). No hace nada si no hay sonido.
void sound_play(ChimeKind kind);
void sound_exit(void);

#endif

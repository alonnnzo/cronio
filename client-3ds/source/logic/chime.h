// Sonido de los avisos (Fase 2b, paso 3b), parte pura: cuándo suena un `chime` de la vista y cómo se sintetiza cada sonido.
// Sin libctru: el pegamento con ndsp está en source/sound.c.
//
// Compuerta (ChimeGate): el puente manda en cada vista el último aviso con sonido `{kind, seq}`; `seq` sube de uno en uno
// mientras el puente vive. Suena una vez por `seq` nuevo con estas reglas:
//   - el primer `seq` que se ve tras (re)conectar es el punto de partida y NO suena (puede ser un aviso viejo);
//   - una vista sin `chime` fija el punto de partida en 0 (el siguiente aviso, el 1, sí suena);
//   - un `seq` menor que el punto de partida (el puente se reinició) lo reinicia sin sonar;
//   - sin sonido activo (ajuste apagado o sin ndsp) el punto de partida avanza igual, así que apagar el ajuste y volver a
//     encenderlo no suelta avisos viejos;
//   - como máximo un sonido cada CHIME_MIN_GAP_MS; los que llegan antes se descartan (no se acumulan).
#ifndef LOGIC_CHIME_H
#define LOGIC_CHIME_H

#include <stddef.h>
#include <stdint.h>

#include "../core/view.h"

#define CHIME_MIN_GAP_MS 1500u

typedef struct {
  int have_base;        // ya se vio una vista desde que se (re)conectó
  uint32_t last_seq;    // punto de partida / último `seq` atendido (0: ninguno)
  int played;           // ya sonó alguno (para el límite de frecuencia)
  uint64_t last_play_ms;
} ChimeGate;

void chime_gate_init(ChimeGate *g);
// Nueva conexión (o cierre de la sesión): el siguiente `seq` visto es otra vez el punto de partida.
void chime_gate_reset(ChimeGate *g);
// Una vista nueva. `enabled`: el ajuste está activo y ndsp funciona. Devuelve el ChimeKind que debe sonar o -1.
int chime_gate_step(ChimeGate *g, int has_chime, ChimeKind kind, uint32_t seq, int enabled, uint64_t now_ms);

// ---- síntesis ----
#define CHIME_RATE 32728u          // frecuencia nativa del DSP de la 3DS
#define CHIME_MAX_MS 400u
#define CHIME_MAX_SAMPLES ((CHIME_RATE * CHIME_MAX_MS) / 1000u + 1u)
#define CHIME_PEAK 11000           // amplitud máxima (de 32767): volumen moderado

// Escribe el sonido (PCM16 mono a CHIME_RATE) en `out` y devuelve cuántas muestras (0 si el tipo no existe o `cap` no alcanza).
// Dura como máximo CHIME_MAX_MS, empieza y termina en silencio (ataque y caída suaves: sin clics).
size_t chime_synth(ChimeKind kind, int16_t *out, size_t cap);

#endif

#include "chime.h"

#include <math.h>
#include <string.h>

void chime_gate_init(ChimeGate *g) { memset(g, 0, sizeof *g); }

void chime_gate_reset(ChimeGate *g) {
  g->have_base = 0;
  g->last_seq = 0;
}

int chime_gate_step(ChimeGate *g, int has_chime, ChimeKind kind, uint32_t seq, int enabled, uint64_t now_ms) {
  if (!has_chime) { // puente nuevo o sin avisos: el siguiente aviso (seq 1) debe sonar
    g->have_base = 1;
    g->last_seq = 0;
    return -1;
  }
  if (!g->have_base) { // primera vista tras conectar: punto de partida
    g->have_base = 1;
    g->last_seq = seq;
    return -1;
  }
  if (seq < g->last_seq) { // el puente se reinició
    g->last_seq = seq;
    return -1;
  }
  if (seq == g->last_seq) return -1;
  g->last_seq = seq;
  if (!enabled || (unsigned)kind >= (unsigned)CHIME_COUNT) return -1;
  if (g->played && (int64_t)now_ms >= (int64_t)g->last_play_ms && now_ms - g->last_play_ms < CHIME_MIN_GAP_MS) return -1;
  g->played = 1;
  g->last_play_ms = now_ms;
  return (int)kind;
}

// ---- síntesis ----

typedef struct {
  double f0, f1;   // frecuencia inicial y final (Hz); distintas = deslizamiento
  unsigned ms;     // duración de la nota
  unsigned gap_ms; // silencio que sigue
  double harm;     // mezcla del 2.º armónico (0 a 1): más brillo
  double gain;     // 0 a 1
} Note;

#define ATTACK_MS 8u
#define RELEASE_MS 28u

static size_t render(const Note *notes, int n, int16_t *out, size_t cap) {
  size_t total = 0;
  for (int i = 0; i < n; i++) total += (size_t)(notes[i].ms + notes[i].gap_ms) * CHIME_RATE / 1000u;
  if (total == 0 || total > cap || total > CHIME_MAX_SAMPLES) return 0;
  size_t pos = 0;
  const double two_pi = 6.283185307179586;
  for (int i = 0; i < n; i++) {
    const Note *nt = &notes[i];
    size_t len = (size_t)nt->ms * CHIME_RATE / 1000u;
    size_t gap = (size_t)nt->gap_ms * CHIME_RATE / 1000u;
    size_t atk = (size_t)ATTACK_MS * CHIME_RATE / 1000u;
    size_t rel = (size_t)RELEASE_MS * CHIME_RATE / 1000u;
    double phase = 0.0;
    for (size_t k = 0; k < len; k++) {
      double t = len > 1 ? (double)k / (double)(len - 1) : 0.0;
      double f = nt->f0 + (nt->f1 - nt->f0) * t;
      phase += two_pi * f / (double)CHIME_RATE;
      double env = 1.0;
      if (k < atk) env = (double)k / (double)atk;
      if (len - 1 - k < rel) {
        double r = (double)(len - 1 - k) / (double)rel;
        if (r < env) env = r;
      }
      env = env * env * (3.0 - 2.0 * env); // suavizado
      double s = sin(phase) * (1.0 - nt->harm * 0.5) + sin(2.0 * phase) * nt->harm * 0.5;
      double v = s * env * nt->gain * (double)CHIME_PEAK;
      out[pos + k] = (int16_t)(v >= 0 ? v + 0.5 : v - 0.5);
    }
    pos += len;
    for (size_t k = 0; k < gap; k++) out[pos + k] = 0;
    pos += gap;
  }
  return pos;
}

size_t chime_synth(ChimeKind kind, int16_t *out, size_t cap) {
  switch (kind) {
    case CHIME_DONE: { // dos notas que suben (do - sol): "listo"
      static const Note n[] = {{523.25, 523.25, 130, 20, 0.25, 1.0}, {784.0, 784.0, 220, 0, 0.25, 1.0}};
      return render(n, 2, out, cap);
    }
    case CHIME_ASK: { // deslizamiento que sube, como una pregunta
      static const Note n[] = {{440.0, 740.0, 260, 20, 0.2, 1.0}, {880.0, 880.0, 90, 0, 0.2, 0.8}};
      return render(n, 2, out, cap);
    }
    case CHIME_ERROR: { // dos pulsos graves
      static const Note n[] = {{196.0, 196.0, 130, 50, 0.6, 1.0}, {155.56, 155.56, 150, 0, 0.6, 1.0}};
      return render(n, 2, out, cap);
    }
    case CHIME_PERMISSION: { // tres toques agudos: atención
      static const Note n[] = {{1318.5, 1318.5, 80, 30, 0.5, 0.9}, {1760.0, 1760.0, 80, 30, 0.5, 0.9}, {1318.5, 1318.5, 120, 0, 0.5, 0.9}};
      return render(n, 3, out, cap);
    }
    case CHIME_COUNT: break;
  }
  return 0;
}

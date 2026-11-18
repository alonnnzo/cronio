#include "sound.h"

#include <3ds.h>
#include <stdio.h>
#include <string.h>

#include "dsp_extract.h"
#include "logic/chime.h"

#define CHANNEL 0

static int g_ready;
static int16_t *g_buf[CHIME_COUNT];
static size_t g_len[CHIME_COUNT];
static ndspWaveBuf g_wave[CHIME_COUNT];

int sound_needs_extraction(void) { return !dsp_extract_present(); }

static void free_buffers(void) {
  for (int k = 0; k < CHIME_COUNT; k++) {
    if (g_buf[k] != NULL) linearFree(g_buf[k]);
    g_buf[k] = NULL;
    g_len[k] = 0;
  }
}

// Sintetiza los cuatro sonidos en memoria lineal (la que lee el DSP) y vacía la caché.
static int build_buffers(void) {
  for (int k = 0; k < CHIME_COUNT; k++) {
    int16_t *b = linearAlloc(CHIME_MAX_SAMPLES * sizeof(int16_t));
    if (b == NULL) return -1;
    g_buf[k] = b;
    g_len[k] = chime_synth((ChimeKind)k, b, CHIME_MAX_SAMPLES);
    if (g_len[k] == 0) return -1;
    DSP_FlushDataCache(b, (u32)(g_len[k] * sizeof(int16_t)));
  }
  return 0;
}

void sound_init(SoundInit *out) {
  memset(out, 0, sizeof *out);
  out->status = SOUND_NONE;
  g_ready = 0;

  if (!dsp_extract_present()) {
    uint32_t detail = 0;
    DspxStage st = dsp_extract_run(&detail);
    if (st != DSPX_OK) {
      out->status = SOUND_NO_FIRM;
      out->rc = detail != 0 ? detail : (uint32_t)st;
      snprintf(out->msg, sizeof out->msg, "%s", dsp_extract_stage_text(st));
      return;
    }
    out->extracted = 1;
  }

  Result rc = ndspInit();
  if (R_FAILED(rc)) {
    out->status = SOUND_ERROR;
    out->rc = (uint32_t)rc;
    if (out->extracted) snprintf(out->msg, sizeof out->msg, "El sonido quedó listo: cierra la app y ábrela de nuevo.");
    else snprintf(out->msg, sizeof out->msg, "No se pudo iniciar el sonido de la consola.");
    return;
  }
  if (build_buffers() != 0) {
    free_buffers();
    ndspExit();
    out->status = SOUND_ERROR;
    out->rc = 0x00000001u;
    snprintf(out->msg, sizeof out->msg, "Falta memoria para preparar el sonido.");
    return;
  }
  ndspSetOutputMode(NDSP_OUTPUT_STEREO);
  ndspChnReset(CHANNEL);
  ndspChnSetInterp(CHANNEL, NDSP_INTERP_LINEAR);
  ndspChnSetRate(CHANNEL, (float)CHIME_RATE);
  ndspChnSetFormat(CHANNEL, NDSP_FORMAT_MONO_PCM16);
  float mix[12];
  memset(mix, 0, sizeof mix);
  mix[0] = 1.0f; // adelante izquierda
  mix[1] = 1.0f; // adelante derecha
  ndspChnSetMix(CHANNEL, mix);
  g_ready = 1;
  out->status = SOUND_READY;
}

int sound_ready(void) { return g_ready; }

void sound_play(ChimeKind kind) {
  if (!g_ready || (unsigned)kind >= (unsigned)CHIME_COUNT || g_buf[kind] == NULL) return;
  ndspChnWaveBufClear(CHANNEL); // corta lo que suene: un sonido por vez
  ndspWaveBuf *w = &g_wave[kind];
  memset(w, 0, sizeof *w);
  w->data_vaddr = g_buf[kind];
  w->nsamples = (u32)g_len[kind];
  w->looping = false;
  w->status = NDSP_WBUF_FREE;
  ndspChnWaveBufAdd(CHANNEL, w);
}

void sound_exit(void) {
  if (!g_ready) return;
  g_ready = 0;
  ndspChnWaveBufClear(CHANNEL);
  ndspChnReset(CHANNEL);
  ndspExit();
  free_buffers();
}

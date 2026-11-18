#include "dsp_extract.h"

#include <3ds.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "logic/dspfirm.h"

#define TMP_PATH DSP_FIRM_PATH ".tmp"
#define MAX_CODE_COMPRESSED (8u * 1024u * 1024u)

// Menú HOME por región (EE. UU., Japón, Europa, China, Corea, Taiwán). Solo uno existe en cada consola.
static const u64 HOME_TITLES[] = {
    0x0004003000008F02ULL, 0x0004003000008202ULL, 0x0004003000009802ULL,
    0x000400300000A102ULL, 0x000400300000A902ULL, 0x000400300000B102ULL,
};

// Archivo ".code" del ExeFS de un título (archivo 0x2345678A). Ruta binaria de ExeFS: tipo 2 = nombre de 8 bytes ".code".
static Result open_code(Handle *out, u64 tid) {
  u32 archive_path[4] = {(u32)(tid & 0xFFFFFFFFu), (u32)(tid >> 32), 0 /* NAND */, 0};
  static const u32 file_path[5] = {0, 0, 2, 0x646F632Eu /* ".cod" */, 0x00000065u /* "e" */};
  return FSUSER_OpenFileDirectly(out, (FS_ArchiveID)0x2345678Au, fsMakePath(PATH_BINARY, archive_path),
                                 fsMakePath(PATH_BINARY, file_path), FS_OPEN_READ, 0);
}

int dsp_extract_present(void) {
  FILE *f = fopen(DSP_FIRM_PATH, "rb");
  if (f == NULL) return 0;
  int ok = fseek(f, 0, SEEK_END) == 0 && ftell(f) > 0;
  fclose(f);
  return ok;
}

const char *dsp_extract_stage_text(DspxStage s) {
  switch (s) {
    case DSPX_OK: return "";
    case DSPX_NO_TITLE: return "No se encontró el firmware de sonido en esta consola.";
    case DSPX_READ: return "No se pudo leer el firmware de sonido.";
    case DSPX_MEMORY: return "Falta memoria para preparar el sonido.";
    case DSPX_LZSS:
    case DSPX_NO_BLOCK:
    case DSPX_BAD_HASH: return "El firmware de sonido de la consola no es válido.";
    case DSPX_WRITE: return "No se pudo escribir en la tarjeta SD.";
  }
  return "";
}

static int write_file(const uint8_t *data, size_t n) {
  FILE *f = fopen(TMP_PATH, "wb");
  if (f == NULL) return -1;
  int ok = fwrite(data, 1, n, f) == n && fflush(f) == 0;
  if (fclose(f) != 0) ok = 0;
  return ok ? 0 : -1;
}

// Relee el temporal y lo verifica (tamaño exacto y el mismo bloque válido).
static int verify_tmp(const uint8_t *data, size_t n) {
  FILE *f = fopen(TMP_PATH, "rb");
  if (f == NULL) return -1;
  uint8_t *back = malloc(n);
  int ok = 0;
  if (back != NULL) {
    ok = fread(back, 1, n, f) == n && fgetc(f) == EOF && memcmp(back, data, n) == 0 && dspfirm_block_valid(back, n);
    free(back);
  }
  fclose(f);
  return ok ? 0 : -1;
}

DspxStage dsp_extract_run(uint32_t *detail) {
  uint32_t dummy;
  if (detail == NULL) detail = &dummy;
  *detail = 0;

  // 1. abrir el .code del HOME
  Handle h = 0;
  Result rc = -1;
  for (size_t i = 0; i < sizeof HOME_TITLES / sizeof HOME_TITLES[0]; i++) {
    rc = open_code(&h, HOME_TITLES[i]);
    if (R_SUCCEEDED(rc)) break;
  }
  if (R_FAILED(rc)) {
    *detail = (uint32_t)rc;
    return DSPX_NO_TITLE;
  }

  // 2. leerlo entero
  u64 size = 0;
  rc = FSFILE_GetSize(h, &size);
  if (R_FAILED(rc) || size < 16 || size > MAX_CODE_COMPRESSED) {
    FSFILE_Close(h);
    *detail = R_FAILED(rc) ? (uint32_t)rc : 0;
    return DSPX_READ;
  }
  uint8_t *comp = malloc((size_t)size);
  if (comp == NULL) {
    FSFILE_Close(h);
    return DSPX_MEMORY;
  }
  u32 got = 0;
  rc = FSFILE_Read(h, &got, 0, comp, (u32)size);
  FSFILE_Close(h);
  if (R_FAILED(rc) || got != (u32)size) {
    free(comp);
    *detail = R_FAILED(rc) ? (uint32_t)rc : 0;
    return DSPX_READ;
  }

  // 3. descomprimir
  size_t out_len = dspfirm_lzss_size(comp, (size_t)size);
  if (out_len == 0) {
    free(comp);
    return DSPX_LZSS;
  }
  uint8_t *code = malloc(out_len);
  if (code == NULL) {
    free(comp);
    return DSPX_MEMORY;
  }
  int dec = dspfirm_lzss_decompress(comp, (size_t)size, code, out_len);
  free(comp);
  if (dec != 0) {
    free(code);
    return DSPX_LZSS;
  }

  // 4. buscar y verificar el bloque
  size_t off = 0, len = 0;
  int found = dspfirm_find(code, out_len, &off, &len);
  if (found != DSPFIRM_OK) {
    free(code);
    return found == DSPFIRM_ERR_HASH ? DSPX_BAD_HASH : DSPX_NO_BLOCK;
  }

  // 5. escribir en la SD: temporal, releer, renombrar
  mkdir("sdmc:/3ds", 0777);
  remove(TMP_PATH);
  DspxStage result = DSPX_OK;
  if (write_file(code + off, len) != 0 || verify_tmp(code + off, len) != 0) {
    *detail = (uint32_t)errno;
    remove(TMP_PATH);
    result = DSPX_WRITE;
  } else if (rename(TMP_PATH, DSP_FIRM_PATH) != 0) {
    *detail = (uint32_t)errno;
    remove(TMP_PATH);
    result = DSPX_WRITE;
  }
  free(code);
  return result;
}

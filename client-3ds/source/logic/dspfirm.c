#include "dspfirm.h"

#include <string.h>

#include "../core/sha256.h"

static uint32_t rd32(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

size_t dspfirm_lzss_size(const uint8_t *comp, size_t comp_len) {
  if (comp == NULL || comp_len < 8) return 0;
  const uint8_t *footer = comp + comp_len - 8;
  uint32_t top = rd32(footer);
  uint32_t extra = rd32(footer + 4);
  uint32_t flen = (top >> 24) & 0xFFu;
  uint32_t dlen = top & 0xFFFFFFu;
  if (flen < 8 || flen > comp_len || dlen > comp_len) return 0;
  uint64_t total = (uint64_t)comp_len + extra;
  if (total > DSPFIRM_MAX_CODE) return 0;
  return (size_t)total;
}

// Formato (el mismo del .code comprimido de la 3DS): se lee de atrás hacia adelante. Cada grupo es un byte de control (8
// banderas, de la más alta a la más baja) seguido de elementos: bandera 0 = un byte literal; bandera 1 = dos bytes
// (desplazamiento de 12 bits y largo de 4 bits + 3) que copian de lo ya escrito, que está más arriba en `out`.
int dspfirm_lzss_decompress(const uint8_t *comp, size_t comp_len, uint8_t *out, size_t out_len) {
  size_t want = dspfirm_lzss_size(comp, comp_len);
  if (want == 0 || out_len != want || out == NULL) return -1;
  const uint8_t *footer = comp + comp_len - 8;
  uint32_t top = rd32(footer);
  size_t index = comp_len - ((top >> 24) & 0xFFu);
  size_t stop = comp_len - (top & 0xFFFFFFu);
  size_t pos = out_len;
  memset(out, 0, out_len);
  memcpy(out, comp, comp_len); // los bytes comprimidos que no se tocan quedan tal cual (parte alta ya comprimida in situ)
  while (index > stop) {
    uint8_t control = comp[--index];
    for (int i = 0; i < 8; i++) {
      if (index <= stop || pos == 0) break;
      if (control & 0x80) {
        if (index < 2) return -1;
        index -= 2;
        uint32_t seg = (uint32_t)comp[index] | ((uint32_t)comp[index + 1] << 8);
        size_t len = ((seg >> 12) & 15u) + 3u;
        size_t back = (seg & 0x0FFFu) + 2u;
        if (pos < len) return -1;
        for (size_t j = 0; j < len; j++) {
          if (pos + back >= out_len) return -1;
          uint8_t b = out[pos + back];
          out[--pos] = b;
        }
      } else {
        if (pos < 1) return -1;
        out[--pos] = comp[--index];
      }
      control = (uint8_t)(control << 1);
    }
  }
  return 0;
}

#define SEC_TABLE 0x120u
#define SEC_SIZE 0x30u
#define SEC_MAX 10

int dspfirm_block_valid(const uint8_t *b, size_t len) {
  if (b == NULL || len < SEC_TABLE + SEC_SIZE) return 0;
  if (memcmp(b + 0x100, "DSP1", 4) != 0) return 0;
  uint32_t size = rd32(b + 0x104);
  if (size < DSPFIRM_MIN_SIZE || size > DSPFIRM_MAX_SIZE || size > len) return 0;
  int sections = 0;
  for (int i = 0; i < SEC_MAX; i++) {
    size_t at = SEC_TABLE + (size_t)i * SEC_SIZE;
    if (at + SEC_SIZE > size) break;
    const uint8_t *h = b + at;
    uint32_t sec_size = rd32(h + 8);
    if (sec_size == 0) break;
    uint32_t sec_off = rd32(h);
    if (sec_off > size || sec_size > size - sec_off) return 0;
    uint8_t d[SHA256_DIGEST_LEN];
    sha256(b + sec_off, sec_size, d);
    if (memcmp(d, h + 0x10, SHA256_DIGEST_LEN) != 0) return 0;
    sections++;
  }
  return sections > 0;
}

int dspfirm_find(const uint8_t *code, size_t code_len, size_t *off, size_t *size) {
  int saw_magic = 0;
  if (code == NULL || code_len < 0x104) return DSPFIRM_ERR_NOMAGIC;
  for (size_t i = 0x100; i + 8 <= code_len; i++) {
    if (code[i] != 'D' || memcmp(code + i, "DSP1", 4) != 0) continue;
    size_t start = i - 0x100;
    uint32_t sz = rd32(code + i + 4);
    if (sz < DSPFIRM_MIN_SIZE || sz > DSPFIRM_MAX_SIZE || sz > code_len - start) continue;
    saw_magic = 1;
    if (!dspfirm_block_valid(code + start, code_len - start)) continue;
    *off = start;
    *size = sz;
    return DSPFIRM_OK;
  }
  return saw_magic ? DSPFIRM_ERR_HASH : DSPFIRM_ERR_NOMAGIC;
}

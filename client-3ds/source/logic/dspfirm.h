// Firmware del DSP (`dspfirm.cdc`), parte pura: lo que `ndsp` necesita en `sdmc:/3ds/dspfirm.cdc` y que la consola ya trae
// dentro del `.code` del menú HOME. Aquí no hay libctru ni archivos: se descomprime el `.code` (LZSS "hacia atrás" de la 3DS,
// con pie de 8 bytes), se busca el bloque "DSP1" y se comprueba antes de aceptarlo. La lectura del `.code` y la escritura
// del archivo están en source/dsp_extract.c.
//
// Método (el mismo de la herramienta DSP1 de zoogie, MIT: https://github.com/zoogie/DSP1; código propio): el bloque empieza 0x100
// bytes antes del texto "DSP1" (esos 0x100 son una firma RSA), el tamaño está en el entero de 32 bits que sigue al texto y
// una tabla de hasta 10 secciones (0x30 bytes cada una, desde 0x120) trae el desplazamiento, el tamaño y el SHA-256 de cada una.
#ifndef LOGIC_DSPFIRM_H
#define LOGIC_DSPFIRM_H

#include <stddef.h>
#include <stdint.h>

#define DSPFIRM_MAX_SIZE 0x100000u  // el bloque real mide unos 0xC25C; esto es solo un tope de cordura
#define DSPFIRM_MIN_SIZE 0x200u
#define DSPFIRM_MAX_CODE 0x1000000u // tope del .code descomprimido (16 MB)

typedef enum {
  DSPFIRM_OK = 0,
  DSPFIRM_ERR_LZSS = -1,   // el .code no se pudo descomprimir (pie o datos inválidos)
  DSPFIRM_ERR_NOMAGIC = -2,// no hay un bloque "DSP1" válido
  DSPFIRM_ERR_HASH = -3    // hay bloque pero una sección no coincide con su SHA-256
} DspFirmErr;

// Tamaño que tendrá el .code descomprimido (largo comprimido + el "extra" del pie). 0 si el pie no es válido o pasa el tope.
size_t dspfirm_lzss_size(const uint8_t *comp, size_t comp_len);
// Descomprime en `out` (de `out_len` bytes, el valor de dspfirm_lzss_size). 0 si salió bien, -1 si no. No escribe fuera de `out`.
int dspfirm_lzss_decompress(const uint8_t *comp, size_t comp_len, uint8_t *out, size_t out_len);
// Busca el bloque en el .code descomprimido y lo verifica (tamaños dentro de rango, cada sección con su SHA-256).
// Devuelve DSPFIRM_OK y deja en *off y *size dónde está dentro de `code`, o un DspFirmErr.
int dspfirm_find(const uint8_t *code, size_t code_len, size_t *off, size_t *size);
// Comprobación del archivo ya escrito (o leído): mismo criterio que dspfirm_find sobre el bloque tal cual. 1 si vale.
int dspfirm_block_valid(const uint8_t *block, size_t len);

#endif

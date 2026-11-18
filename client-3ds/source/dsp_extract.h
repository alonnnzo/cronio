// Extracción del firmware del DSP desde el sistema de la propia consola (Fase 2b, paso 3b).
//
// `ndsp` necesita `sdmc:/3ds/dspfirm.cdc`. Nintendo no permite repartirlo con la app, pero ya está dentro de la consola: va
// empaquetado en el `.code` del menú HOME (en la NAND). Se lee con el archivo de ExeFS del título del HOME (la misma ruta que usa la
// herramienta DSP1 de zoogie, MIT: https://github.com/zoogie/DSP1), se descomprime, se busca y verifica el bloque (logic/dspfirm.c)
// y se escribe en la SD. Solo se lee la NAND; lo único que se escribe es `sdmc:/3ds/dspfirm.cdc` (por un archivo temporal).
#ifndef DSP_EXTRACT_H
#define DSP_EXTRACT_H

#include <stdint.h>

#define DSP_FIRM_PATH "sdmc:/3ds/dspfirm.cdc"

typedef enum {
  DSPX_OK = 0,
  DSPX_NO_TITLE,  // ningún menú HOME de las seis regiones se pudo abrir
  DSPX_READ,      // falló la lectura del .code
  DSPX_MEMORY,    // no hay memoria para leerlo o descomprimirlo
  DSPX_LZSS,      // el .code no se pudo descomprimir
  DSPX_NO_BLOCK,  // no se encontró el bloque DSP1
  DSPX_BAD_HASH,  // el bloque no pasó la verificación
  DSPX_WRITE      // no se pudo escribir en la SD
} DspxStage;

// 1 si `sdmc:/3ds/dspfirm.cdc` existe y no está vacío.
int dsp_extract_present(void);
// Extrae y escribe el archivo. Devuelve DSPX_OK o la etapa que falló; *detail lleva el Result de libctru o el errno (0 si no hay).
// Nunca deja un archivo a medias: escribe `.tmp`, lo relee y lo verifica, y recién entonces lo renombra.
DspxStage dsp_extract_run(uint32_t *detail);
// Frase corta en español de la etapa (para la pantalla).
const char *dsp_extract_stage_text(DspxStage s);

#endif

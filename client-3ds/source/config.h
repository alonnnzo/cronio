// Configuración en la tarjeta SD: sdmc:/3ds/agent-companion/config.ini (formato y validación en logic/config_ini.c).
#ifndef CONFIG_H
#define CONFIG_H

#include "logic/config_ini.h"

#define CONFIG_DIR "sdmc:/3ds/agent-companion"
#define CONFIG_PATH CONFIG_DIR "/config.ini"

// Lee la configuración (config.ini, o config.ini.bak si una escritura anterior se interrumpió). Sin archivo
// devuelve los valores por defecto. Devuelve 1 si había archivo.
int config_load(Config *c);
// Escritura segura: archivo temporal, copia de respaldo del anterior y renombrado; crea la carpeta.
// 0 si quedó guardado, -1 si no.
int config_save(const Config *c);

#endif

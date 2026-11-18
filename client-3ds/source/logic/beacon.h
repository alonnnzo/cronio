// Aviso UDP del puente (packages/bridge/src/beacon.ts):
//   {"service":"3ds-agent-companion","v":1,"port":33334,"name":"PC"}
// Se valida con el lector de JSON del núcleo; la IP del puente es la del remitente del datagrama.
#ifndef LOGIC_BEACON_H
#define LOGIC_BEACON_H

#include <stddef.h>
#include <stdint.h>

// 0 si es un aviso de este servicio (service correcto, v ausente o 1, port de 1 a 65535); -1 si no.
// data no necesita terminar en NUL.
int beacon_parse(const char *data, size_t len, uint16_t *port);

#endif

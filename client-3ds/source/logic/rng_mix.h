// Respaldo del azar para el nonce cuando no se puede abrir el servicio ps: mezcla el contador de ciclos, la hora,
// el device_id y un contador de llamadas con SHA-256. No es azar criptográfico fuerte: solo evita repetir el nonce.
#ifndef LOGIC_RNG_MIX_H
#define LOGIC_RNG_MIX_H

#include <stdint.h>

void rng_mix(uint64_t tick, uint64_t time_ms, const char *device_id, uint32_t counter, uint8_t out[32]);

#endif

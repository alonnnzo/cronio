// ChaCha20 (RFC 8439, sección 2.4): cifrado de flujo de 256 bits. C99 portátil, sin memoria dinámica ni dependencias.
// El protocolo v2 lo usa con el contador de bloque en 0 y un nonce de 12 bytes = contador de la trama (u32 little endian) + 8 ceros.
#ifndef CORE_CHACHA20_H
#define CORE_CHACHA20_H

#include <stddef.h>
#include <stdint.h>

#define CHACHA20_KEY_LEN 32
#define CHACHA20_NONCE_LEN 12
#define CHACHA20_BLOCK_LEN 64

// Un bloque del flujo de claves (RFC 8439, 2.3): 64 bytes para (clave, contador de bloque, nonce).
void chacha20_block(const uint8_t key[CHACHA20_KEY_LEN], uint32_t counter, const uint8_t nonce[CHACHA20_NONCE_LEN],
                    uint8_t out[CHACHA20_BLOCK_LEN]);

// Cifra o descifra (es lo mismo: XOR con el flujo de claves) `len` bytes de `in` hacia `out`, empezando en el bloque `counter`.
// `in` y `out` pueden ser el mismo búfer (en el sitio). El contador de bloque sube por cada 64 bytes.
void chacha20_xor(const uint8_t key[CHACHA20_KEY_LEN], uint32_t counter, const uint8_t nonce[CHACHA20_NONCE_LEN],
                  const uint8_t *in, uint8_t *out, size_t len);

#endif

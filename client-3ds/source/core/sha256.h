// SHA-256, HMAC-SHA256 y HKDF-SHA256 (RFC 6234, 2104 y 5869). C99 portátil, sin memoria dinámica.
#ifndef CORE_SHA256_H
#define CORE_SHA256_H

#include <stddef.h>
#include <stdint.h>

#define SHA256_DIGEST_LEN 32
#define SHA256_BLOCK_LEN 64

typedef struct {
  uint32_t h[8];
  uint8_t block[SHA256_BLOCK_LEN];
  size_t used;
  uint64_t total; // bytes procesados
} Sha256;

void sha256_init(Sha256 *c);
void sha256_update(Sha256 *c, const void *data, size_t len);
void sha256_final(Sha256 *c, uint8_t out[SHA256_DIGEST_LEN]);
void sha256(const void *data, size_t len, uint8_t out[SHA256_DIGEST_LEN]);

typedef struct {
  Sha256 inner;
  uint8_t okey[SHA256_BLOCK_LEN]; // clave externa (K xor opad)
} Hmac256;

void hmac256_init(Hmac256 *c, const void *key, size_t key_len);
void hmac256_update(Hmac256 *c, const void *data, size_t len);
void hmac256_final(Hmac256 *c, uint8_t out[SHA256_DIGEST_LEN]);
void hmac256(const void *key, size_t key_len, const void *data, size_t len, uint8_t out[SHA256_DIGEST_LEN]);

// HKDF extract+expand. Devuelve 0, o -1 si out_len supera 255 * 32. salt/info pueden ser NULL con largo 0.
int hkdf_sha256(const void *salt, size_t salt_len, const void *ikm, size_t ikm_len, const void *info, size_t info_len,
                uint8_t *out, size_t out_len);

// Comparación en tiempo constante (no depende de dónde difieren los bytes). 1 si son iguales.
int ct_equal(const void *a, const void *b, size_t len);

#endif

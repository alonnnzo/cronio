// Tramas [tipo u8][largo u16 LE][contenido] y su sellado de la v2: contenido cifrado con ChaCha20 y etiqueta de 16 bytes sobre el texto
// cifrado (packages/protocol framing.ts y auth.ts).
#ifndef CORE_FRAME_H
#define CORE_FRAME_H

#include <stddef.h>
#include <stdint.h>

#include "chacha20.h"
#include "sha256.h"

#define FRAME_JSON 1
#define FRAME_AUDIO 2
#define FRAME_PING 3
#define FRAME_PONG 4

#define FRAME_HEADER_LEN 3
#define FRAME_MAX_PAYLOAD 16384
#define FRAME_TAG_LEN 16
#define FRAME_DIR_BRIDGE_TO_CONSOLE 1
#define FRAME_DIR_CONSOLE_TO_BRIDGE 2

// ---- Armado ----

// Escribe [tipo][largo][contenido] en out. Devuelve el total de bytes, o -1 si el contenido pasa de
// FRAME_MAX_PAYLOAD o no cabe en cap.
int frame_encode(uint8_t type, const uint8_t *payload, size_t len, uint8_t *out, size_t cap);

// ---- Lectura en flujo, sin memoria dinámica ----
// Se alimenta con lo que llega del socket; cada llamada completa como máximo una trama. El contenido de la trama
// completa queda en d->buf + FRAME_HEADER_LEN y se puede modificar en el sitio (por ejemplo, abrirla).
// Es válido hasta la siguiente llamada a frame_decoder_feed.

#define FRAME_NEED_MORE 0
#define FRAME_COMPLETE 1
#define FRAME_ERR_TOO_LONG (-1)

typedef struct {
  uint8_t buf[FRAME_HEADER_LEN + FRAME_MAX_PAYLOAD];
  size_t len;      // bytes acumulados en buf
  int done;        // hay una trama completa pendiente de retirar
  uint8_t type;    // válidos si la última llamada devolvió FRAME_COMPLETE
  size_t payload_len;
  int failed;      // el flujo quedó inservible (largo excesivo)
} FrameDecoder;

void frame_decoder_init(FrameDecoder *d);
// Consume de data hasta completar una trama; *used es lo consumido. Tras FRAME_COMPLETE, repetir con lo que sobra.
// Tras FRAME_ERR_TOO_LONG el decodificador no acepta más datos (hay que cerrar la conexión).
int frame_decoder_feed(FrameDecoder *d, const uint8_t *data, size_t len, size_t *used);
static inline uint8_t *frame_decoder_payload(FrameDecoder *d) { return d->buf + FRAME_HEADER_LEN; }

// ---- Sellado (protocolo v2) ----
// A partir de la clave de sesión `ks` (v2) cada dirección tiene dos subclaves, al estilo HKDF-Expand:
//   enc/mac = HMAC-SHA256(ks, "3dsac-v2 enc-b2c" | 0x01)  (y mac-b2c, enc-c2b, mac-c2b según el uso y la dirección).
// Trama sellada = ChaCha20(enc, nonce = [contador u32 LE][8 ceros], bloque 0) del contenido, seguida de
//   etiqueta = HMAC-SHA256(mac, [dir][contador u32 LE][tipo] || texto cifrado)[0..16)
// (encrypt-then-MAC: se verifica antes de descifrar). El contador sube con cada trama y es parte del nonce, así que no puede
// repetirse: la trama con el contador 2^32-1 no se usa (FRAME_COUNTER_MAX) y la sesión debe cerrarse antes.

#define FRAME_COUNTER_MAX 0xffffffffu

typedef struct {
  uint8_t enc[SHA256_DIGEST_LEN];
  uint8_t mac[SHA256_DIGEST_LEN];
  uint8_t dir;
  uint32_t counter;
} FrameSealer;

typedef FrameSealer FrameOpener; // misma forma; el contador cuenta tramas aceptadas

// `ks` es la clave de sesión de la v2 (hs_session_key); `dir` FRAME_DIR_*.
void frame_sealer_init(FrameSealer *s, const uint8_t ks[SHA256_DIGEST_LEN], uint8_t dir);
void frame_opener_init(FrameOpener *o, const uint8_t ks[SHA256_DIGEST_LEN], uint8_t dir);

// Escribe la trama completa del cable (cabecera + contenido cifrado + etiqueta). Devuelve el total de bytes, o -1 si el
// contenido sellado pasa de FRAME_MAX_PAYLOAD, no cabe en cap o el contador está agotado. `payload` puede estar ya en out + FRAME_HEADER_LEN.
int frame_seal(FrameSealer *s, uint8_t type, const uint8_t *payload, size_t len, uint8_t *out, size_t cap);

// Verifica la etiqueta del contenido sellado `sealed` (texto cifrado + 16 bytes), lo descifra EN EL SITIO y devuelve el largo del
// contenido (que queda al principio de `sealed`), o -1 si no coincide, es más corto que la etiqueta o el contador está agotado
// (en ese caso `sealed` no se toca). El contador solo avanza si la etiqueta es válida.
int frame_open(FrameOpener *o, uint8_t type, uint8_t *sealed, size_t sealed_len);

#endif

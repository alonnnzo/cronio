// Saludo 3dsac v2 (packages/protocol auth.ts): puente -> challenge{nonceB}, consola -> hello{v:2, deviceId, nonceC, mac, ...},
// puente -> welcome{mac}. De ahí sale la clave de sesión para sellar (cifrar y autenticar) las tramas. Y la clave del dispositivo
// derivada del código de emparejamiento. Esta consola solo habla la v2: el hello siempre anuncia v:2 y su MAC cubre la versión, el id,
// `appVersion` e `install`; el welcome y la clave de sesión también llevan la versión, así que si alguien en el camino la cambia para
// forzar una v1 sin cifrado, el saludo falla. El `v` del challenge es el del saludo base y sigue en 1.
#ifndef CORE_HANDSHAKE_H
#define CORE_HANDSHAKE_H

#include <stddef.h>
#include <stdint.h>

#define HS_NONCE_LEN 16
#define HS_KEY_LEN 32
#define HS_MAC_LEN 32
#define HS_DEVICE_ID_MAX 64
#define HS_CODE_LEN 16 // caracteres Crockford, sin guiones

// ---- Código de emparejamiento y clave del dispositivo ----

// Pasa a mayúsculas y quita guiones y espacios; valida 16 caracteres del alfabeto Crockford del puente
// (0-9 y A-Z sin I, L, O, U). Escribe 16 caracteres + NUL en out. 0 si sirve, -1 si no.
// No convierte alias (O->0, I/L->1): el puente tampoco, y la clave tiene que salir igual.
int pairing_code_normalize(const char *in, char out[HS_CODE_LEN + 1]);

// HKDF-SHA256(ikm = código normalizado, salt = "3dsac-pair-v1", info = device_id) -> 32 bytes.
// `code` puede venir con guiones y en minúsculas. 0 si el código es válido y el id tiene 1 a 64 caracteres.
int hs_derive_device_key(const char *code, const char *device_id, uint8_t key[HS_KEY_LEN]);

// ---- MACs y clave de sesión (v2) ----

#define HS_PROTOCOL_VERSION 2

// hello = HMAC(K, "hello2" | nonceB | nonceC | 0x02 | lp(device_id) | lp(app_version) | install), con lp(x) = largo u8 y bytes;
// app_version NULL cuenta como cadena vacía; install: 1 "cia" -> 1, 0 "3dsx" -> 2, otro (-1) -> 0. Lo mismo que helloMacV2 del puente.
void hs_hello_mac(const uint8_t k[HS_KEY_LEN], const uint8_t nonce_b[HS_NONCE_LEN], const uint8_t nonce_c[HS_NONCE_LEN],
                  const char *device_id, const char *app_version, int install, uint8_t out[HS_MAC_LEN]);
// welcome = HMAC(K, "welcome2" | nonceC | nonceB | 0x02)
void hs_welcome_mac(const uint8_t k[HS_KEY_LEN], const uint8_t nonce_b[HS_NONCE_LEN],
                    const uint8_t nonce_c[HS_NONCE_LEN], uint8_t out[HS_MAC_LEN]);
// Ks = HMAC(K, "session2" | nonceB | nonceC | 0x02). De Ks salen las claves de cifrado y de etiqueta de cada dirección (frame.h).
void hs_session_key(const uint8_t k[HS_KEY_LEN], const uint8_t nonce_b[HS_NONCE_LEN],
                    const uint8_t nonce_c[HS_NONCE_LEN], uint8_t out[HS_KEY_LEN]);

// ---- Mensajes del saludo (texto JSON) ----

typedef enum { HS_MSG_CHALLENGE, HS_MSG_WELCOME, HS_MSG_ERROR } HsMsgKind;

typedef struct {
  HsMsgKind kind;
  uint8_t nonce_b[HS_NONCE_LEN]; // challenge
  uint8_t mac[HS_MAC_LEN];       // welcome
  char code[32];                 // error: código, cortado
} HsMsg;

// Analiza challenge, welcome o error. 0 si es uno de ellos y está bien formado; -1 si no.
// El challenge se rechaza si trae un `v` distinto de 1.
int hs_parse(const char *json, size_t len, HsMsg *out);

// {"t":"hello","v":2,"deviceId":..,"nonceC":hex,"mac":hex}. Devuelve el largo o -1 (id inválido, o no cabe).
// device_id: 1 a 64 caracteres de [A-Za-z0-9_.:-].
int hs_build_hello(char *out, size_t cap, const char *device_id, const uint8_t nonce_c[HS_NONCE_LEN],
                   const uint8_t mac[HS_MAC_LEN]);

// Igual, con la versión de la app (`appVersion`, p. ej. "0.2.0": solo dígitos y puntos, hasta 16 caracteres; NULL = no se manda) y
// cómo corre (`install`: 1 = "cia" instalada, 0 = "3dsx" desde el Homebrew Launcher, -1 = no se manda). El MAC (hs_hello_mac) tiene que
// calcularse con los mismos valores. Devuelve el largo o -1 (id o versión inválidos, o no cabe).
int hs_build_hello_app(char *out, size_t cap, const char *device_id, const uint8_t nonce_c[HS_NONCE_LEN],
                       const uint8_t mac[HS_MAC_LEN], const char *app_version, int install);

// ---- Hex ----

// Escribe 2*len caracteres en minúscula + NUL. out debe tener 2*len+1 bytes.
void hex_encode(const uint8_t *in, size_t len, char *out);
// Decodifica exactamente `len` bytes desde 2*len dígitos (mayúsculas o minúsculas) y ni un carácter más. 0 o -1.
int hex_decode(const char *hex, size_t hex_len, uint8_t *out, size_t len);

#endif

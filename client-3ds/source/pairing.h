// Entrada de texto del sistema (swkbd) para el emparejamiento y para la IP del puente.
// Cada función bloquea hasta que el usuario acepta o cancela (la app no dibuja mientras tanto).
#ifndef PAIRING_H
#define PAIRING_H

#include <stdint.h>

#include "core/handshake.h"
#include "logic/config_ini.h"

typedef enum {
  PROMPT_OK,       // texto válido
  PROMPT_CANCEL,   // el usuario canceló o cerró el teclado
  PROMPT_INVALID   // lo escrito no es un código / una IP válidos
} PromptResult;

// Pide el código de emparejamiento (teclado normal, hasta 19 caracteres: 16 más guiones), lo normaliza con
// pairing_code_normalize y deriva la clave del dispositivo para device_id. No guarda nada.
PromptResult pairing_prompt_code(const char *device_id, uint8_t key[HS_KEY_LEN]);
// Pide la IP del puente (teclado numérico con "."), recortada y validada. host: CONFIG_HOST_BYTES.
// current puede ser "" o la IP actual, que sirve de texto inicial.
PromptResult pairing_prompt_ip(const char *current, char host[CONFIG_HOST_BYTES]);

// Pide un texto libre para "Otra…" de una pregunta (teclado normal, de 1 a 200 caracteres sin vacío). hint es la ayuda que muestra el
// teclado. Devuelve 1 y deja el texto UTF-8 en out (cap >= 801) si el usuario acepta, 0 si cancela o cierra el teclado.
int pairing_prompt_text(const char *hint, char *out, size_t cap);
// Lo mismo para una instrucción a una sesión (paso 6): de 1 a max_chars caracteres (400) y el botón de confirmar con ese nombre.
// cap debe ser >= max_chars * 4 + 1.
int pairing_prompt_long_text(const char *hint, int max_chars, const char *confirm_label, char *out, size_t cap);

#endif

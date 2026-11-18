#include "pairing.h"

#include <3ds.h>
#include <string.h>

static void wipe(void *p, size_t n) {
  volatile unsigned char *v = (volatile unsigned char *)p;
  while (n--) *v++ = 0;
}

PromptResult pairing_prompt_code(const char *device_id, uint8_t key[HS_KEY_LEN]) {
  SwkbdState kb;
  char text[64];
  memset(text, 0, sizeof text);
  swkbdInit(&kb, SWKBD_TYPE_NORMAL, 2, 19); // 16 caracteres + hasta 3 guiones
  swkbdSetHintText(&kb, "Código del PC (npm run companion -- pair)");
  swkbdSetValidation(&kb, SWKBD_NOTEMPTY_NOTBLANK, 0, 0);
  swkbdSetFeatures(&kb, SWKBD_DEFAULT_QWERTY);
  swkbdSetButton(&kb, SWKBD_BUTTON_LEFT, "Cancelar", false);
  swkbdSetButton(&kb, SWKBD_BUTTON_RIGHT, "Emparejar", true);
  SwkbdButton b = swkbdInputText(&kb, text, sizeof text);
  if (b != SWKBD_BUTTON_CONFIRM) {
    wipe(text, sizeof text);
    return PROMPT_CANCEL;
  }
  char code[HS_CODE_LEN + 1];
  PromptResult r = PROMPT_INVALID;
  if (pairing_code_normalize(text, code) == 0 && hs_derive_device_key(code, device_id, key) == 0) r = PROMPT_OK;
  wipe(text, sizeof text);
  wipe(code, sizeof code);
  return r;
}

PromptResult pairing_prompt_ip(const char *current, char host[CONFIG_HOST_BYTES]) {
  SwkbdState kb;
  char text[48];
  memset(text, 0, sizeof text);
  swkbdInit(&kb, SWKBD_TYPE_NUMPAD, 2, 15);
  swkbdSetNumpadKeys(&kb, '.', 0);
  swkbdSetHintText(&kb, "IP del puente, por ejemplo 192.168.0.10");
  swkbdSetValidation(&kb, SWKBD_NOTEMPTY_NOTBLANK, 0, 0);
  if (current != NULL && current[0] != '\0') swkbdSetInitialText(&kb, current);
  swkbdSetButton(&kb, SWKBD_BUTTON_LEFT, "Cancelar", false);
  swkbdSetButton(&kb, SWKBD_BUTTON_RIGHT, "Conectar", true);
  SwkbdButton b = swkbdInputText(&kb, text, sizeof text);
  if (b != SWKBD_BUTTON_CONFIRM) return PROMPT_CANCEL;
  return config_ip_normalize(text, host) == 0 ? PROMPT_OK : PROMPT_INVALID;
}

int pairing_prompt_long_text(const char *hint, int max_chars, const char *confirm_label, char *out, size_t cap) {
  SwkbdState kb;
  if (cap < 2 || max_chars < 1) return 0;
  out[0] = '\0';
  swkbdInit(&kb, SWKBD_TYPE_NORMAL, 2, max_chars);
  swkbdSetHintText(&kb, hint != NULL ? hint : "Tu instrucción");
  swkbdSetValidation(&kb, SWKBD_NOTEMPTY_NOTBLANK, 0, 0);
  swkbdSetFeatures(&kb, SWKBD_DEFAULT_QWERTY);
  swkbdSetButton(&kb, SWKBD_BUTTON_LEFT, "Cancelar", false);
  swkbdSetButton(&kb, SWKBD_BUTTON_RIGHT, confirm_label != NULL ? confirm_label : "Enviar", true);
  SwkbdButton b = swkbdInputText(&kb, out, cap);
  if (b != SWKBD_BUTTON_CONFIRM) {
    out[0] = '\0';
    return 0;
  }
  return out[0] != '\0';
}

int pairing_prompt_text(const char *hint, char *out, size_t cap) {
  SwkbdState kb;
  if (cap < 2) return 0;
  out[0] = '\0';
  swkbdInit(&kb, SWKBD_TYPE_NORMAL, 2, 200);
  swkbdSetHintText(&kb, hint != NULL ? hint : "Tu respuesta");
  swkbdSetValidation(&kb, SWKBD_NOTEMPTY_NOTBLANK, 0, 0);
  swkbdSetFeatures(&kb, SWKBD_DEFAULT_QWERTY);
  swkbdSetButton(&kb, SWKBD_BUTTON_LEFT, "Cancelar", false);
  swkbdSetButton(&kb, SWKBD_BUTTON_RIGHT, "Enviar", true);
  SwkbdButton b = swkbdInputText(&kb, out, cap);
  if (b != SWKBD_BUTTON_CONFIRM) {
    out[0] = '\0';
    return 0;
  }
  return out[0] != '\0';
}

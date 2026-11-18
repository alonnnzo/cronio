// Configuración de la consola (sdmc:/3ds/agent-companion/config.ini) como funciones puras sobre búferes:
// lectura, escritura y validación. El acceso a la tarjeta SD vive en config.c.
//
//   device_id=3ds-1a2b3c4d      generado una vez
//   key=<64 hex>                vacía si no está emparejada
//   host=192.168.0.10           última IP del puente
//   port=33334                  0/ausente = el puerto por defecto
//   theme=dark                  tema de la consola: dark u light; ausente = claro (preferencia local, no del puente)
#ifndef LOGIC_CONFIG_INI_H
#define LOGIC_CONFIG_INI_H

#include <stddef.h>
#include <stdint.h>

#define CONFIG_DEFAULT_PORT 33334
#define CONFIG_MAX_FILE 1024
#define CONFIG_DEVICE_ID_BYTES 65
#define CONFIG_KEY_HEX_BYTES 65
#define CONFIG_HOST_BYTES 16

typedef struct {
  char device_id[CONFIG_DEVICE_ID_BYTES]; // "" si falta o no es válido
  char key_hex[CONFIG_KEY_HEX_BYTES];     // "" o 64 hex en minúscula
  char host[CONFIG_HOST_BYTES];           // "" o IPv4 con puntos
  uint16_t port;                          // 0 = sin dato
  int dark;                               // tema de la consola: 0 claro (por defecto), 1 oscuro (theme=dark)
} Config;

void config_defaults(Config *c);

// Lee el texto del archivo. Ignora líneas vacías, comentarios (# o ;), secciones ([...]) y claves desconocidas.
// Un valor inválido deja el campo vacío (o 0) y se cuenta. Devuelve cuántos valores se descartaron.
// text no necesita terminar en NUL.
int config_parse(const char *text, size_t len, Config *out);

// Escribe el archivo. Devuelve el largo (sin NUL) o -1 si no cabe en cap.
int config_serialize(const Config *c, char *out, size_t cap);

int config_has_key(const Config *c);
// Puerto a usar: el guardado o CONFIG_DEFAULT_PORT.
uint16_t config_port_or_default(const Config *c);

// device_id: 1 a 64 caracteres de [A-Za-z0-9_.:-] (lo que exige el saludo).
int config_device_id_valid(const char *s);
// IPv4 con puntos: cuatro números de 0 a 255 sin ceros a la izquierda (inet_addr los leería como octales), el
// primero distinto de 0. 1 si sirve.
int config_ip_valid(const char *s);
// Quita espacios de los extremos y valida. Escribe en out (CONFIG_HOST_BYTES). 0 si sirve, -1 si no.
int config_ip_normalize(const char *in, char out[CONFIG_HOST_BYTES]);
// "3ds-" + 8 hex en minúscula a partir de 4 bytes de azar.
void config_make_device_id(const uint8_t r[4], char out[13]);
// 1 si s son exactamente 64 dígitos hexadecimales.
int config_key_hex_valid(const char *s);

#endif

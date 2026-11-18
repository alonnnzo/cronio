// Lo mínimo de HTTP para bajar el .cia del puente (Fase 7): leer la dirección que manda el puente, armar el GET y entender la
// cabecera de la respuesta. Sin libctru: la descarga con sockets está en updater.c.
#ifndef LOGIC_HTTPGET_H
#define LOGIC_HTTPGET_H

#include <stddef.h>
#include <stdint.h>

#define HTTPGET_HOST_MAX 15 // "255.255.255.255"
#define HTTPGET_PATH_MAX 47
#define HTTPGET_HEAD_MAX 2048 // una cabecera más larga que esto se rechaza

typedef struct {
  char host[HTTPGET_HOST_MAX + 1];
  uint16_t port;
  char path[HTTPGET_PATH_MAX + 1]; // con la barra inicial: "/agent-companion.cia"
} HttpUrl;

// "http://a.b.c.d:puerto/archivo": IPv4 con cuatro números de 0 a 255, puerto de 1 a 65535 y un archivo de [A-Za-z0-9_.-] sin más barras.
// 0 si sirve; -1 si no (otro esquema, nombre de host, sin puerto, ruta rara o demasiado larga).
int httpget_parse_url(const char *url, HttpUrl *out);

// ¿La dirección apunta al host `host` (el del puente al que está conectada la consola)? 1 si son idénticos; 0 si no o si falta alguno.
// El .cia solo se baja del mismo PC con el que se habla: un aviso que mande la descarga a otra máquina se rechaza.
int httpget_host_is(const HttpUrl *u, const char *host);

// "GET /archivo HTTP/1.0" con Host y Connection: close. Devuelve el largo o -1 si no cabe.
int httpget_request(char *out, size_t cap, const HttpUrl *u);

typedef struct {
  int status;               // 200, 404...
  int64_t content_length;   // -1 si la respuesta no lo dice
  int chunked;              // Transfer-Encoding: chunked (no se admite)
  size_t head_len;          // bytes de la cabecera, hasta después de la línea en blanco: lo que sigue ya es el cuerpo
} HttpHead;

// Analiza lo recibido hasta ahora. 1 si la cabecera está completa (*out lleno), 0 si todavía falta (llegó parte), -1 si no es HTTP o es demasiado larga.
int httpget_parse_head(const char *buf, size_t len, HttpHead *out);

#endif

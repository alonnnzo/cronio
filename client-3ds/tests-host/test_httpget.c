// HTTP mínimo para bajar el .cia (logic/httpget.c): la dirección que manda el puente, el GET y la cabecera de la respuesta.
#include "test.h"

#include "../source/logic/httpget.h"

static void test_parse_url_ok(void) {
  HttpUrl u;
  CHECK_EQ_INT(httpget_parse_url("http://192.168.0.20:33337/agent-companion.cia", &u), 0);
  CHECK_STR(u.host, "192.168.0.20");
  CHECK_EQ_INT(u.port, 33337);
  CHECK_STR(u.path, "/agent-companion.cia");
  CHECK_EQ_INT(httpget_parse_url("http://1.2.3.4:1/a", &u), 0);
  CHECK_STR(u.host, "1.2.3.4");
  CHECK_EQ_INT(u.port, 1);
  CHECK_STR(u.path, "/a");
  CHECK_EQ_INT(httpget_parse_url("http://255.255.255.255:65535/x_y-z.9", &u), 0);
  CHECK_STR(u.host, "255.255.255.255");
  CHECK_EQ_INT(u.port, 65535);
}

// La descarga solo vale del mismo PC con el que habla la consola (el host del puente al que está conectada).
static void test_host_is(void) {
  HttpUrl u;
  CHECK_EQ_INT(httpget_parse_url("http://192.168.0.20:33337/agent-companion.cia", &u), 0);
  CHECK(httpget_host_is(&u, "192.168.0.20"));
  CHECK(!httpget_host_is(&u, "192.168.0.21"));
  CHECK(!httpget_host_is(&u, "192.168.0.2"));
  CHECK(!httpget_host_is(&u, "192.168.0.200"));
  CHECK(!httpget_host_is(&u, "10.0.0.1"));
  CHECK(!httpget_host_is(&u, ""));
  CHECK(!httpget_host_is(&u, NULL));
  CHECK(!httpget_host_is(NULL, "192.168.0.20"));
}

static void test_parse_url_rejects(void) {
  HttpUrl u;
  static const char *const bad[] = {
      "",
      "https://192.168.0.20:33337/a.cia",
      "http://pc.local:33337/a.cia",
      "http://192.168.0.20/a.cia",              // sin puerto
      "http://192.168.0.20:/a.cia",
      "http://192.168.0.20:0/a.cia",
      "http://192.168.0.20:65536/a.cia",
      "http://192.168.0.20:99999/a.cia",
      "http://192.168.0.20:123456/a.cia",
      "http://192.168.0:33337/a.cia",           // tres números
      "http://192.168.0.20.7:33337/a.cia",      // cinco
      "http://192.168.0.256:33337/a.cia",
      "http://192.168..50:33337/a.cia",
      "http://.1.2.3:33337/a.cia",
      "http://1.2.3.4.:33337/a.cia",
      "http://192.168.0.20:33337",              // sin ruta
      "http://192.168.0.20:33337/",             // sin archivo
      "http://192.168.0.20:33337/a/b.cia",      // más barras
      "http://192.168.0.20:33337/a b.cia",
      "http://192.168.0.20:33337/a?x=1",
      "http://192.168.0.20:33337/..%2f",
      "http://user@192.168.0.20:33337/a.cia",
      "http://1234.1.1.1:33337/a.cia",
  };
  for (size_t i = 0; i < sizeof bad / sizeof bad[0]; i++) CHECK_MSG(httpget_parse_url(bad[i], &u) != 0, "debía rechazar \"%s\"", bad[i]);
  CHECK(httpget_parse_url(NULL, &u) != 0);
  // el archivo más largo que cabe (47) y uno de más
  char url[160];
  snprintf(url, sizeof url, "http://1.2.3.4:5/%.46s", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  CHECK_EQ_INT(httpget_parse_url(url, &u), 0);
  CHECK_EQ_INT((int)strlen(u.path), HTTPGET_PATH_MAX);
  snprintf(url, sizeof url, "http://1.2.3.4:5/%.47s", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  CHECK(httpget_parse_url(url, &u) != 0);
}

static void test_request(void) {
  HttpUrl u;
  CHECK_EQ_INT(httpget_parse_url("http://192.168.0.20:33337/agent-companion.cia", &u), 0);
  char out[256];
  int n = httpget_request(out, sizeof out, &u);
  const char *want = "GET /agent-companion.cia HTTP/1.0\r\nHost: 192.168.0.20:33337\r\nUser-Agent: Cronio\r\nConnection: close\r\n\r\n";
  CHECK_EQ_INT(n, (int)strlen(want));
  CHECK_STR(out, want);
  CHECK_EQ_INT(httpget_request(out, (size_t)n, &u), -1);     // sin sitio para el NUL
  CHECK_EQ_INT(httpget_request(out, (size_t)n + 1, &u), n);  // justo
  CHECK_EQ_INT(httpget_request(out, 0, &u), -1);
}

static int head(const char *s, HttpHead *h) { return httpget_parse_head(s, strlen(s), h); }

static void test_head_ok(void) {
  HttpHead h;
  const char *r = "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 361408\r\nDate: x\r\n\r\nBODY";
  CHECK_EQ_INT(head(r, &h), 1);
  CHECK_EQ_INT(h.status, 200);
  CHECK_EQ_INT(h.content_length, 361408);
  CHECK_EQ_INT(h.chunked, 0);
  CHECK_EQ_INT((int)h.head_len, (int)(strlen(r) - 4)); // lo que sigue (BODY) ya es el cuerpo
  // minúsculas y HTTP/1.0
  CHECK_EQ_INT(head("HTTP/1.0 200 OK\r\ncontent-length:  12\r\n\r\n", &h), 1);
  CHECK_EQ_INT(h.content_length, 12);
  // sin Content-Length
  CHECK_EQ_INT(head("HTTP/1.1 200 OK\r\nX: y\r\n\r\n", &h), 1);
  CHECK_EQ_INT(h.content_length, -1);
  // otros estados
  CHECK_EQ_INT(head("HTTP/1.1 404 Not Found\r\nContent-Length: 12\r\n\r\n", &h), 1);
  CHECK_EQ_INT(h.status, 404);
  CHECK_EQ_INT(head("HTTP/1.1 405 Method Not Allowed\r\nAllow: GET, HEAD\r\n\r\n", &h), 1);
  CHECK_EQ_INT(h.status, 405);
  // por trozos de un solo byte: incompleta hasta la línea en blanco
  const char *full = "HTTP/1.1 200 OK\r\nContent-Length: 7\r\n\r\n";
  for (size_t i = 0; i < strlen(full); i++) CHECK_EQ_INT(httpget_parse_head(full, i, &h), 0);
  CHECK_EQ_INT(httpget_parse_head(full, strlen(full), &h), 1);
  // chunked se marca (la app no lo admite)
  CHECK_EQ_INT(head("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n", &h), 1);
  CHECK_EQ_INT(h.chunked, 1);
}

static void test_head_rejects(void) {
  HttpHead h;
  CHECK_EQ_INT(head("SSH-2.0-OpenSSH\r\n\r\n", &h), -1);
  CHECK_EQ_INT(head("GARBAGE", &h), -1);
  CHECK_EQ_INT(head("HTTP/2 200\r\n\r\n", &h), -1);
  CHECK_EQ_INT(head("HTTP/1.1 2x0 OK\r\n\r\n", &h), -1);
  CHECK_EQ_INT(head("HTTP/1.1 200 OK\r\nContent-Length: abc\r\n\r\n", &h), -1);
  CHECK_EQ_INT(head("HTTP/1.1 200 OK\r\nContent-Length: 99999999999999\r\n\r\n", &h), -1);
  // cabecera sin fin: se rechaza al pasar del tope
  static char big[HTTPGET_HEAD_MAX + 64];
  memset(big, 'a', sizeof big);
  memcpy(big, "HTTP/1.1 200 OK\r\nX: ", 20);
  CHECK_EQ_INT(httpget_parse_head(big, HTTPGET_HEAD_MAX - 1, &h), 0);
  CHECK_EQ_INT(httpget_parse_head(big, HTTPGET_HEAD_MAX, &h), -1);
  // incompleta pero que ya no empieza como HTTP
  CHECK_EQ_INT(httpget_parse_head("HTTX", 4, &h), -1);
  CHECK_EQ_INT(httpget_parse_head("", 0, &h), 0);
}

int main(void) {
  TEST_BEGIN("httpget: dirección del puente, GET y cabecera de la respuesta");
  RUN(test_parse_url_ok);
  RUN(test_host_is);
  RUN(test_parse_url_rejects);
  RUN(test_request);
  RUN(test_head_ok);
  RUN(test_head_rejects);
  TEST_END();
}

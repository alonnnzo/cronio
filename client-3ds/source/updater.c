#include "updater.h"

#include <3ds.h>
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <netinet/in.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#include <stdint.h>

#include "logic/httpget.h"
#include "logic/netplan.h"
#include "logic/updflow.h"

#define CONNECT_TIMEOUT_MS 10000 // sin conectar con el PC
#define HEAD_TIMEOUT_MS 15000    // sin cabecera de respuesta
#define IDLE_TIMEOUT_MS 20000    // sin recibir ni un byte del archivo
#define SLICE_MS 12              // trabajo por cuadro: así la barra se mueve y la pantalla responde
#define RECV_BYTES 16384         // lo que se pide al socket de una vez

typedef enum { P_IDLE, P_CONNECT, P_HEAD, P_BODY, P_INSTALL } Phase;

static struct {
  Phase phase;
  int sock;
  HttpUrl url;
  uint64_t t0;               // desde cuándo se espera lo actual (plazos)
  uint64_t last_data;        // última vez que llegó algo del archivo
  uint8_t head[HTTPGET_HEAD_MAX];
  size_t head_len;
  int req_sent;
  int am_open;               // amInit() hecho
  int cia_open;              // AM_StartCiaInstall() hecho y sin terminar ni cancelar
  Handle cia;
  uint32_t want_size;        // lo que anunció el PC: bytes del .cia
  uint8_t want_sha[32];      // y su SHA-256
  uint8_t *buf;              // el .cia entero, descargado antes de tocar AM
  uint32_t total;
  UpdFlow flow;
  int announced;             // la acción en curso ya se mostró en pantalla: el cuadro siguiente la ejecuta
  UfAction act;
} U = {.sock = -1}; // sock en -1: un descriptor 0 sin abrir no es el nuestro y nunca se cierra

static void set_error(UpdaterStatus *st, const char *fmt, ...) __attribute__((format(printf, 2, 3)));
static void set_error(UpdaterStatus *st, const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(st->error, sizeof st->error, fmt, ap);
  va_end(ap);
}

static void close_socket(void) {
  if (U.sock >= 0) {
    close(U.sock);
    U.sock = -1;
  }
}

// Cancela la instalación a medias (si hay un manejador abierto).
static void cancel_install(void) {
  if (U.cia_open) {
    AM_CancelCIAInstall(U.cia);
    U.cia_open = 0;
  }
}

static void release_all(void) {
  close_socket();
  if (U.am_open) {
    amExit();
    U.am_open = 0;
  }
  free(U.buf);
  U.buf = NULL;
  U.phase = P_IDLE;
}

void updater_cancel(void) {
  cancel_install();
  release_all();
}

// Falló antes de tocar AM (red, cabecera, memoria, verificación): la versión instalada sigue intacta.
static UpdaterResult fail(UpdaterStatus *st) {
  uf_download_failed(&U.flow);
  release_all();
  return UPR_FAILED;
}

int updater_start(const char *url, const char *expected_host, uint32_t size, const uint8_t sha256[32], uint64_t now, UpdaterStatus *st) {
  memset(st, 0, sizeof *st);
  updater_cancel();
  memset(&U, 0, sizeof U);
  U.sock = -1;
  uf_init(&U.flow, 0);
  st->step = UPD_STEP_CONNECT;
  if (httpget_parse_url(url, &U.url) != 0) {
    set_error(st, "La dirección de la descarga no es válida.");
    return -1;
  }
  // solo se baja del PC con el que se habla (el aviso llega por el canal autenticado, pero la dirección de la descarga no se confía sola)
  if (!httpget_host_is(&U.url, expected_host)) {
    set_error(st, "La descarga no viene del PC al que estás conectada. No se instaló nada.");
    return -1;
  }
  if (sha256 == NULL || !uf_size_ok((int64_t)size)) {
    set_error(st, "El PC no dijo el tamaño o la huella (SHA-256) del archivo. No se instaló nada.");
    return -1;
  }
  U.want_size = size;
  memcpy(U.want_sha, sha256, sizeof U.want_sha);
  int s = socket(AF_INET, SOCK_STREAM, IPPROTO_IP);
  if (s < 0) {
    set_error(st, "%s", netplan_errno_reason(netplan_errno_kind(errno)));
    return -1;
  }
  fcntl(s, F_SETFL, fcntl(s, F_GETFL, 0) | O_NONBLOCK);
  struct sockaddr_in a;
  memset(&a, 0, sizeof a);
  a.sin_family = AF_INET;
  a.sin_port = htons(U.url.port);
  a.sin_addr.s_addr = inet_addr(U.url.host);
  if (connect(s, (struct sockaddr *)&a, sizeof a) < 0 && netplan_errno_kind(errno) != NP_ERR_PENDING) {
    NpErrKind kind = netplan_errno_kind(errno);
    close(s);
    if (kind == NP_ERR_REFUSED) set_error(st, "El PC rechazó la conexión: el puente no sirve el archivo.");
    else set_error(st, "%s", netplan_errno_reason(kind));
    return -1;
  }
  U.sock = s;
  U.phase = P_CONNECT;
  U.t0 = now;
  return 0;
}

// Conectar: la conexión no bloqueante termina cuando el socket se puede escribir.
static UpdaterResult step_connect(UpdaterStatus *st, uint64_t now) {
  struct pollfd p;
  p.fd = U.sock;
  p.events = POLLOUT;
  p.revents = 0;
  int r = poll(&p, 1, 0);
  if (r > 0 && (p.revents & (POLLERR | POLLHUP | POLLNVAL))) {
    set_error(st, "El PC rechazó la conexión: ¿el firewall deja pasar el puerto %u?", (unsigned)U.url.port);
    return fail(st);
  }
  if (r > 0 && (p.revents & POLLOUT)) {
    U.phase = P_HEAD;
    U.t0 = now;
    st->step = UPD_STEP_REQUEST;
    return UPR_RUNNING;
  }
  if (now - U.t0 > CONNECT_TIMEOUT_MS) {
    set_error(st, "El PC no respondió: ¿el firewall deja pasar el puerto %u?", (unsigned)U.url.port);
    return fail(st);
  }
  return UPR_RUNNING;
}

// Todo el .cia ya está en memoria: se cierra el socket, se verifica contra lo que anunció el PC y recién entonces se abre AM; la
// instalación ya no depende de la red. Si no coincide, AM no se toca (un .cia cambiado en el camino nunca llega a instalarse).
static UpdaterResult begin_install(UpdaterStatus *st) {
  close_socket();
  if (!uf_verify(U.buf, U.flow.received, U.want_size, U.want_sha)) {
    set_error(st, "%s", UF_ERR_MISMATCH);
    return fail(st);
  }
  Result rc = amInit();
  if (R_FAILED(rc)) {
    set_error(st, "amInit %08lX: no se pudo abrir el servicio de instalación.", (unsigned long)rc);
    return fail(st); // AM no llegó a tocarse: la versión instalada sigue intacta
  }
  U.am_open = 1;
  U.phase = P_INSTALL;
  U.announced = 0;
  st->done = 0;
  st->step = UPD_STEP_INSTALL;
  return UPR_RUNNING;
}

// Llegaron `n` bytes del cuerpo a la memoria. 1 si ya está todo el archivo.
static int take_body(UpdaterStatus *st, size_t n) {
  uf_downloaded(&U.flow, (uint32_t)n);
  st->done = U.flow.received;
  return U.flow.state == UF_INSTALLING;
}

// Pedir el archivo y leer la cabecera; con una respuesta 200 y su tamaño, reserva la memoria y toma lo que ya llegó del cuerpo.
static UpdaterResult step_head(UpdaterStatus *st, uint64_t now) {
  if (!U.req_sent) {
    char req[256];
    int n = httpget_request(req, sizeof req, &U.url);
    int r = n < 0 ? -1 : (int)send(U.sock, req, (size_t)n, 0);
    if (r < 0) {
      NpErrKind k = netplan_errno_kind(errno);
      if (k == NP_ERR_PENDING || k == NP_ERR_CLOSED) { // aún sin conectar del todo (ENOTCONN) o buffer lleno: se reintenta
        if (now - U.t0 > HEAD_TIMEOUT_MS) {
          set_error(st, "El PC no respondió a la petición.");
          return fail(st);
        }
        return UPR_RUNNING;
      }
      set_error(st, "send: %s", netplan_errno_reason(k));
      return fail(st);
    }
    if (r != n) { // la petición es chica y cabe entera en el búfer de envío: un envío parcial no debería pasar
      set_error(st, "No se pudo enviar la petición al PC.");
      return fail(st);
    }
    U.req_sent = 1;
    U.t0 = now;
    return UPR_RUNNING;
  }
  int r = recv(U.sock, U.head + U.head_len, sizeof U.head - U.head_len, 0);
  if (r > 0) {
    U.head_len += (size_t)r;
    U.t0 = now;
  } else if (r == 0) {
    set_error(st, "El PC cerró la conexión sin responder.");
    return fail(st);
  } else {
    NpErrKind k = netplan_errno_kind(errno);
    if (k != NP_ERR_PENDING) {
      set_error(st, "recv: %s", netplan_errno_reason(k));
      return fail(st);
    }
  }
  HttpHead h;
  int pr = httpget_parse_head((const char *)U.head, U.head_len, &h);
  if (pr < 0) {
    set_error(st, "La respuesta del PC no es válida.");
    return fail(st);
  }
  if (pr == 0) {
    if (now - U.t0 > HEAD_TIMEOUT_MS) {
      set_error(st, "El PC no respondió a la petición.");
      return fail(st);
    }
    return UPR_RUNNING;
  }
  if (h.status != 200) {
    if (h.status == 404) set_error(st, "El PC no tiene el archivo de la app (error 404).");
    else set_error(st, "El PC respondió con el error %d.", h.status);
    return fail(st);
  }
  if (h.chunked || h.content_length < 0) {
    set_error(st, "El PC no dijo el tamaño del archivo.");
    return fail(st);
  }
  if (h.content_length != (int64_t)U.want_size) { // el PC avisó un tamaño y entrega otro: no se descarga
    set_error(st, "El tamaño del archivo no es el que anunció el PC (%lld bytes en vez de %u).", (long long)h.content_length, (unsigned)U.want_size);
    return fail(st);
  }
  U.total = (uint32_t)h.content_length;
  st->total = U.total;
  uf_init(&U.flow, U.total);
  U.buf = malloc(U.total);
  if (U.buf == NULL) {
    set_error(st, "malloc: no hay memoria para %u KB.", (unsigned)((U.total + 1023u) / 1024u));
    return fail(st);
  }
  U.phase = P_BODY;
  U.last_data = now;
  st->step = UPD_STEP_DOWNLOAD;
  // lo que ya llegó pegado a la cabecera es el comienzo del archivo
  size_t extra = U.head_len - h.head_len;
  if (extra > U.total) extra = U.total;
  if (extra > 0) {
    memcpy(U.buf, U.head + h.head_len, extra);
    if (take_body(st, extra)) return begin_install(st);
  }
  return UPR_RUNNING;
}

// Cuerpo: un poco por cuadro, todo a memoria. AM no se toca hasta tener el .cia entero: un corte de red no deja nada a medias.
static UpdaterResult step_body(UpdaterStatus *st, uint64_t now) {
  u64 start = osGetTime();
  while (U.flow.received < U.total && osGetTime() - start < SLICE_MS) {
    size_t want = U.total - U.flow.received;
    if (want > RECV_BYTES) want = RECV_BYTES;
    int r = recv(U.sock, U.buf + U.flow.received, want, 0);
    if (r > 0) {
      U.last_data = now;
      if (take_body(st, (size_t)r)) return begin_install(st);
      continue;
    }
    if (r == 0) {
      set_error(st, "La descarga se cortó antes de terminar (%u de %u KB). No se tocó la instalación.", (unsigned)(U.flow.received / 1024u),
                (unsigned)((U.total + 1023u) / 1024u));
      return fail(st);
    }
    NpErrKind k = netplan_errno_kind(errno);
    if (k == NP_ERR_PENDING) break; // nada por ahora: se sigue en el próximo cuadro
    set_error(st, "recv: la descarga se cortó: %s", netplan_errno_reason(k));
    return fail(st);
  }
  st->done = U.flow.received;
  if (now - U.last_data > IDLE_TIMEOUT_MS) {
    set_error(st, "La descarga se detuvo: el PC dejó de enviar datos.");
    return fail(st);
  }
  return UPR_RUNNING;
}

// Instalación desde la memoria, una llamada de AM por cuadro. La acción se anuncia (el paso se dibuja) un cuadro antes de ejecutarla,
// porque AM puede bloquear unos segundos. La máquina de logic/updflow.c decide cómo seguir; si AM falla, cancela y termina con el error.
static UpdaterResult step_install(UpdaterStatus *st) {
  if (!U.announced) {
    if (!uf_next(&U.flow, &U.act)) { // no debería pasar: el flujo siempre tiene una acción mientras instala
      set_error(st, "Error interno de la instalación (updflow).");
      cancel_install();
      release_all();
      return UPR_FAILED;
    }
    U.announced = 1;
    st->step = U.act.step;
    return UPR_RUNNING;
  }
  U.announced = 0;
  Result rc = 0;
  u32 written = 0;
  switch (U.act.op) {
    case UF_OP_START:
      rc = AM_StartCiaInstall(MEDIATYPE_SD, &U.cia);
      if (R_SUCCEEDED(rc)) U.cia_open = 1;
      break;
    case UF_OP_WRITE:
      rc = FSFILE_Write(U.cia, &written, U.act.offset, U.buf + U.act.offset, U.act.len, FS_WRITE_FLUSH);
      break;
    case UF_OP_FINISH:
      rc = AM_FinishCiaInstall(U.cia);
      U.cia_open = 0; // el manejador ya no sirve, haya salido bien o mal
      break;
    case UF_OP_CANCEL:
      rc = AM_CancelCIAInstall(U.cia);
      U.cia_open = 0;
      break;
  }
  uf_result(&U.flow, (int32_t)rc, (uint32_t)written);
  st->done = uf_progress(&U.flow);
  if (U.flow.state == UF_DONE) {
    release_all();
    return UPR_DONE;
  }
  if (U.flow.state == UF_FAILED) {
    snprintf(st->error, sizeof st->error, "%s", U.flow.error);
    release_all();
    return UPR_FAILED;
  }
  return UPR_RUNNING;
}

UpdaterResult updater_step(UpdaterStatus *st, uint64_t now) {
  switch (U.phase) {
    case P_IDLE: return UPR_DONE; // nada en curso
    case P_CONNECT: return step_connect(st, now);
    case P_HEAD: return step_head(st, now);
    case P_BODY: return step_body(st, now);
    case P_INSTALL: return step_install(st);
  }
  return UPR_RUNNING;
}

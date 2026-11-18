#include "diag.h"

#include <errno.h>
#include <stdio.h>
#include <string.h>

static void copy(char *dst, size_t cap, const char *src) {
  size_t n = src != NULL ? strlen(src) : 0;
  if (n >= cap) n = cap - 1;
  if (n > 0) memcpy(dst, src, n);
  dst[n] = '\0';
}

void diag_init(Diag *d) {
  memset(d, 0, sizeof *d);
  d->net_state = "-";
  d->session_state = "-";
  d->origin = "-";
}

const char *diag_call_name(DiagCall c) {
  switch (c) {
    case DIAG_CALL_SOCKET: return "socket";
    case DIAG_CALL_CONNECT: return "connect";
    case DIAG_CALL_RECV: return "recv";
    case DIAG_CALL_SEND: return "send";
    case DIAG_CALL_COUNT: break;
  }
  return "?";
}

void diag_errno(Diag *d, DiagCall c, int err) {
  int e = err < 0 ? -err : err; // libctru deja errno negativo tras socket(): se compara por valor absoluto
  if ((unsigned)c >= (unsigned)DIAG_CALL_COUNT || e == EAGAIN || e == EWOULDBLOCK) return;
  d->err[c] = err; // se guarda tal cual (con su signo)
  d->last_call = diag_call_name(c);
  d->last_errno = err;
}

void diag_beacon(Diag *d, const char *from) {
  d->beacons++;
  copy(d->beacon_from, sizeof d->beacon_from, from);
}

void diag_bytes(Diag *d, uint64_t rx, uint64_t tx) {
  d->rx_bytes += rx;
  d->tx_bytes += tx;
}

void diag_rev(Diag *d, uint64_t rev) {
  d->have_rev = 1;
  d->rev = rev;
}

void diag_frame(Diag *d, uint64_t now) {
  if (d->fps_since == 0 || (int64_t)now < (int64_t)d->fps_since) {
    d->fps_since = now;
    d->frames = 0;
  }
  d->frames++;
  uint64_t el = now - d->fps_since;
  if (el >= 1000) {
    d->fps_x10 = (uint32_t)(((uint64_t)d->frames * 10000u + el / 2) / el);
    d->frames = 0;
    d->fps_since = now;
  }
}

void diag_close(Diag *d, const char *cause, uint64_t now) {
  d->have_close = 1;
  copy(d->close_cause, sizeof d->close_cause, cause);
  d->close_at = now;
  d->close_count++;
}

void diag_set_target(Diag *d, const char *host, uint16_t port, const char *origin) {
  copy(d->host, sizeof d->host, host);
  d->port = port;
  d->origin = origin != NULL ? origin : "-";
}

static const char *rc_text(int tried, uint32_t rc, char buf[12]) {
  if (!tried) return "--------";
  snprintf(buf, 12, "%08lX", (unsigned long)rc);
  return buf;
}

int diag_format(const Diag *d, uint64_t now, char lines[DIAG_LINES][DIAG_LINE_BYTES]) {
  int n = 0;
  char a[12], b[12], c[12];
#define LINE(...) do { if (n < DIAG_LINES) snprintf(lines[n++], DIAG_LINE_BYTES, __VA_ARGS__); } while (0)
  LINE("red %s  sesion %s  fallos %d", d->net_state, d->session_state, d->net_failures);
  if (d->host[0] != '\0') LINE("destino %s:%u (%s)", d->host, (unsigned)d->port, d->origin);
  else LINE("destino: ninguno");
  LINE("socInit %s  psInit %s", rc_text(d->soc_tried, d->soc_rc, a), rc_text(d->ps_tried, d->ps_rc, b));
  LINE("mcuHwcInit %s", rc_text(d->mcu_tried, d->mcu_rc, c));
  switch (d->sound_state) {
    case DIAG_SOUND_OK: LINE("sonido: ok"); break;
    case DIAG_SOUND_NO_FIRM: LINE("sonido: sin dspfirm (extraer %08lX)", (unsigned long)d->sound_rc); break;
    case DIAG_SOUND_ERROR: LINE("sonido: error %08lX", (unsigned long)d->sound_rc); break;
    default: LINE("sonido: sin iniciar"); break;
  }
  LINE("errno socket:%d connect:%d recv:%d send:%d", d->err[DIAG_CALL_SOCKET], d->err[DIAG_CALL_CONNECT],
       d->err[DIAG_CALL_RECV], d->err[DIAG_CALL_SEND]);
  if (d->last_call != NULL) LINE("ultimo errno: %s = %d", d->last_call, d->last_errno);
  else LINE("ultimo errno: ninguno");
  if (d->beacons > 0) LINE("avisos UDP: %lu, el ultimo de %s", (unsigned long)d->beacons, d->beacon_from);
  else LINE("avisos UDP: 0");
  LINE("rx %lu B  tx %lu B", (unsigned long)d->rx_bytes, (unsigned long)d->tx_bytes);
  if (d->have_rev) LINE("rev %lu  fps %u.%u", (unsigned long)d->rev, (unsigned)(d->fps_x10 / 10), (unsigned)(d->fps_x10 % 10));
  else LINE("rev: ninguna  fps %u.%u", (unsigned)(d->fps_x10 / 10), (unsigned)(d->fps_x10 % 10));
  LINE("soc reinicios %lu  apt dor/des %lu/%lu  udp nuevo %lu", (unsigned long)d->soc_restarts,
       (unsigned long)d->apt_sleeps, (unsigned long)d->apt_wakes, (unsigned long)d->udp_recreated);
  if (d->have_close) {
    unsigned long ago = (int64_t)now >= (int64_t)d->close_at ? (unsigned long)((now - d->close_at) / 1000) : 0;
    LINE("cierre: %s (hace %lu s, %lu en total)", d->close_cause, ago, (unsigned long)d->close_count);
  } else {
    LINE("cierre de sesion: ninguno");
  }
#undef LINE
  return n;
}

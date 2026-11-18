// Datos y texto de la pantalla de diagnóstico (logic/diag.c).
#include <errno.h>

#include "test.h"

#include "../source/logic/diag.h"

static char L[DIAG_LINES][DIAG_LINE_BYTES];

static void test_empty(void) {
  Diag d;
  diag_init(&d);
  int n = diag_format(&d, 5000, L);
  CHECK_EQ_INT(n, DIAG_LINES);
  CHECK_STR(L[0], "red -  sesion -  fallos 0");
  CHECK_STR(L[1], "destino: ninguno");
  CHECK_STR(L[2], "socInit --------  psInit --------");
  CHECK_STR(L[3], "mcuHwcInit --------");
  CHECK_STR(L[4], "sonido: sin iniciar");
  CHECK_STR(L[5], "errno socket:0 connect:0 recv:0 send:0");
  CHECK_STR(L[6], "ultimo errno: ninguno");
  CHECK_STR(L[7], "avisos UDP: 0");
  CHECK_STR(L[8], "rx 0 B  tx 0 B");
  CHECK_STR(L[9], "rev: ninguna  fps 0.0");
  CHECK_STR(L[10], "soc reinicios 0  apt dor/des 0/0  udp nuevo 0");
  CHECK_STR(L[11], "cierre de sesion: ninguno");
}

static void test_filled(void) {
  Diag d;
  diag_init(&d);
  d.net_state = "CONNECTING";
  d.session_state = "WAIT_CHALLENGE";
  d.net_failures = 2;
  diag_set_target(&d, "192.168.0.10", 33334, "guardada");
  d.soc_tried = d.ps_tried = d.mcu_tried = 1;
  d.soc_rc = 0;
  d.ps_rc = 0xD8A0A066u;
  d.mcu_rc = 0xC8A06C0Du;
  diag_errno(&d, DIAG_CALL_CONNECT, EINPROGRESS);
  diag_errno(&d, DIAG_CALL_RECV, ENOTCONN);
  diag_errno(&d, DIAG_CALL_SEND, ECONNRESET);
  diag_errno(&d, DIAG_CALL_SOCKET, EMFILE);
  diag_beacon(&d, "192.168.0.10");
  diag_beacon(&d, "192.168.0.40");
  diag_bytes(&d, 120, 0);
  diag_bytes(&d, 4000, 33);
  diag_rev(&d, 17);
  d.soc_restarts = 2;
  d.apt_sleeps = 3;
  d.apt_wakes = 4;
  d.udp_recreated = 5;
  diag_close(&d, "auth", 10000);
  diag_close(&d, "sin respuesta (15 s)", 20000);
  diag_close(&d, "protocol", 30000);
  int n = diag_format(&d, 37500, L);
  CHECK_EQ_INT(n, DIAG_LINES);
  CHECK_STR(L[0], "red CONNECTING  sesion WAIT_CHALLENGE  fallos 2");
  CHECK_STR(L[1], "destino 192.168.0.10:33334 (guardada)");
  CHECK_STR(L[2], "socInit 00000000  psInit D8A0A066");
  CHECK_STR(L[3], "mcuHwcInit C8A06C0D");
  CHECK_STR(L[4], "sonido: sin iniciar");
  CHECK(strstr(L[5], "socket:") != NULL && strstr(L[5], "connect:") != NULL);
  char want[64];
  snprintf(want, sizeof want, "errno socket:%d connect:%d recv:%d send:%d", EMFILE, EINPROGRESS, ENOTCONN, ECONNRESET);
  CHECK_STR(L[5], want);
  snprintf(want, sizeof want, "ultimo errno: socket = %d", EMFILE);
  CHECK_STR(L[6], want);
  CHECK_STR(L[7], "avisos UDP: 2, el ultimo de 192.168.0.40");
  CHECK_STR(L[8], "rx 4120 B  tx 33 B");
  CHECK_STR(L[9], "rev 17  fps 0.0");
  CHECK_STR(L[10], "soc reinicios 2  apt dor/des 3/4  udp nuevo 5");
  CHECK_STR(L[11], "cierre: protocol (hace 7 s, 3 en total)");
  for (int i = 0; i < n; i++) CHECK(strlen(L[i]) < DIAG_LINE_BYTES - 1);
}

// Línea de sonido: ok / sin dspfirm / error <código>, y cabe en el ancho de la pantalla.
static void test_sound_line(void) {
  Diag d;
  diag_init(&d);
  d.sound_state = DIAG_SOUND_OK;
  diag_format(&d, 0, L);
  CHECK_STR(L[4], "sonido: ok");
  d.sound_state = DIAG_SOUND_NO_FIRM;
  d.sound_rc = 0xC8804478u;
  diag_format(&d, 0, L);
  CHECK_STR(L[4], "sonido: sin dspfirm (extraer C8804478)");
  d.sound_state = DIAG_SOUND_ERROR;
  d.sound_rc = 0xD8A0A7FAu;
  int n = diag_format(&d, 0, L);
  CHECK_STR(L[4], "sonido: error D8A0A7FA");
  CHECK_EQ_INT(n, DIAG_LINES);
  CHECK(strlen(L[4]) <= 40); // la pantalla muestra unos 45 caracteres por línea
}

static void test_errno_filter(void) {
  Diag d;
  diag_init(&d);
  diag_errno(&d, DIAG_CALL_RECV, EAGAIN); // rutina: no se anota
  diag_errno(&d, DIAG_CALL_RECV, EWOULDBLOCK);
  CHECK_EQ_INT(d.err[DIAG_CALL_RECV], 0);
  CHECK(d.last_call == NULL);
  diag_errno(&d, DIAG_CALL_RECV, ENOTCONN);
  CHECK_EQ_INT(d.err[DIAG_CALL_RECV], ENOTCONN);
  CHECK_STR(d.last_call, "recv");
  diag_errno(&d, DIAG_CALL_CONNECT, ECONNREFUSED);
  CHECK_STR(d.last_call, "connect");
  CHECK_EQ_INT(d.last_errno, ECONNREFUSED);
  CHECK_EQ_INT(d.err[DIAG_CALL_RECV], ENOTCONN); // cada llamada conserva el suyo
  diag_errno(&d, (DiagCall)99, ECONNREFUSED);   // llamada inválida: no rompe nada
  CHECK_STR(diag_call_name(DIAG_CALL_SOCKET), "socket");
  CHECK_STR(diag_call_name(DIAG_CALL_SEND), "send");
}

// errno negativo (libctru tras socket()): se muestra tal cual y se filtra por valor absoluto.
static void test_negative_errno(void) {
  Diag d;
  diag_init(&d);
  diag_errno(&d, DIAG_CALL_RECV, -EAGAIN); // rutina, aunque venga negativo: no se anota
  CHECK(d.last_call == NULL);
  diag_errno(&d, DIAG_CALL_SOCKET, -115);
  CHECK_EQ_INT(d.err[DIAG_CALL_SOCKET], -115);
  CHECK_STR(d.last_call, "socket");
  CHECK_EQ_INT(d.last_errno, -115);
  diag_format(&d, 0, L);
  CHECK_STR(L[5], "errno socket:-115 connect:0 recv:0 send:0");
  CHECK_STR(L[6], "ultimo errno: socket = -115");
}

static void test_fps(void) {
  Diag d;
  diag_init(&d);
  uint64_t t = 1000;
  for (int i = 0; i < 100; i++) { // ~60 cuadros por segundo
    diag_frame(&d, t);
    t += 17;
  }
  CHECK(d.fps_x10 >= 570 && d.fps_x10 <= 620);
  // el reloj hacia atrás no rompe la cuenta
  diag_frame(&d, 10);
  diag_frame(&d, 30);
  CHECK(d.fps_x10 > 0);
  // una línea de rev con fps formateado
  d.have_rev = 1;
  d.rev = 5;
  diag_format(&d, 99999, L);
  CHECK(strstr(L[9], "fps ") != NULL);
}

static void test_long_values_truncate(void) {
  Diag d;
  diag_init(&d);
  char big[200];
  memset(big, 'x', sizeof big - 1);
  big[sizeof big - 1] = '\0';
  diag_beacon(&d, big);
  diag_close(&d, big, 1);
  diag_set_target(&d, big, 1, "aviso");
  CHECK(strlen(d.beacon_from) < DIAG_HOST_BYTES);
  CHECK(strlen(d.close_cause) < sizeof d.close_cause);
  CHECK(strlen(d.host) < DIAG_HOST_BYTES);
  diag_format(&d, 100, L); // no escribe fuera de las líneas
  for (int i = 0; i < DIAG_LINES; i++) CHECK(strlen(L[i]) < DIAG_LINE_BYTES);
}

int main(void) {
  TEST_BEGIN("diag: datos y texto de la pantalla de diagnóstico");
  RUN(test_empty);
  RUN(test_filled);
  RUN(test_sound_line);
  RUN(test_errno_filter);
  RUN(test_negative_errno);
  RUN(test_fps);
  RUN(test_long_values_truncate);
  TEST_END();
}

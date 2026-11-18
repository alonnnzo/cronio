// Actualizar la app desde la consola (logic/update.c) y su integración en logic/input_logic.c: tarjeta de aviso con guarda,
// pantalla del menú, progreso, error y reinicio; textos y geometría. Sin libctru.
#include "test.h"

#include "../source/logic/input_logic.h"
#include "../source/logic/update.h"

// ---- vistas ----

static View V;

static void v_reset(View *v) {
  memset(v, 0, sizeof *v);
  v->mode = MODE_QUEUE;
  v->face.kind = AGENT_NONE;
  v->face.mood = MOOD_IDLE;
  v->face.line_count = 1;
  strcpy(v->face.lines[0], "x");
}

static void v_update(View *v, const char *version) {
  v_reset(v);
  v->has_update = 1;
  snprintf(v->update.version, sizeof v->update.version, "%s", version);
  strcpy(v->update.url, "http://192.168.0.20:33337/agent-companion.cia");
  v->update.size = 370000;
  memset(v->update.sha256, 0xAB, sizeof v->update.sha256);
}

static void v_with_request(View *v) {
  v_update(v, "0.3.0");
  v->has_request = 1;
  strcpy(v->request.id, "r1");
  strcpy(v->request.session_id, "s");
  strcpy(v->request.title, "t");
  v->request.line_count = 1;
  strcpy(v->request.lines[0], "ls");
  v->request.risk = RISK_NORMAL;
  v->request.expires_in_s = 40;
  v->request.position = 1;
  v->request.total = 1;
  v->pending_count = 1;
}

static void v_with_notice(View *v) {
  v_update(v, "0.3.0");
  v->has_notice = 1;
  strcpy(v->notice.id, "n1");
  strcpy(v->notice.session_id, "s");
  v->notice.kind = NOTICE_DONE;
  strcpy(v->notice.title, "Terminó");
  v->notice.position = v->notice.total = 1;
}

static int has_line(const UpdateScreen *s, const char *text) {
  for (int i = 0; i < s->line_count; i++) {
    if (strstr(s->lines[i], text) != NULL) return 1;
  }
  return 0;
}

// El texto de la pantalla en una sola cadena (las frases largas se parten en líneas).
static const char *all_text(const UpdateScreen *s) {
  static char buf[UPDATE_MAX_LINES * (UPDATE_LINE_BYTES + 1)];
  buf[0] = '\0';
  for (int i = 0; i < s->line_count; i++) {
    strcat(buf, s->lines[i]);
    strcat(buf, " ");
  }
  return buf;
}

// ---- versión nueva y quién la ve ----

static void test_offer_only_when_newer(void) {
  Update u;
  update_init(&u, "0.2.0", 1);
  CHECK(!u.has_offer);
  v_update(&V, "0.3.0");
  update_view(&u, &V);
  CHECK(u.has_offer);
  CHECK_STR(u.offer, "0.3.0");
  CHECK_EQ_INT((int)u.offer_size, 370000); // el tamaño y el sha256 de la oferta son los de la vista: contra ellos se verifica la descarga
  CHECK_EQ_INT(u.offer_sha[0], 0xAB);
  CHECK_EQ_INT(u.offer_sha[31], 0xAB);
  CHECK_STR(u.url, "http://192.168.0.20:33337/agent-companion.cia");
  CHECK(u.connected);
  // la misma, una más vieja o sin el campo: ya no hay oferta (el puente dejó de avisar)
  v_update(&V, "0.2.0");
  update_view(&u, &V);
  CHECK(!u.has_offer);
  v_update(&V, "0.3.0");
  update_view(&u, &V);
  CHECK(u.has_offer);
  v_update(&V, "0.1.9");
  update_view(&u, &V);
  CHECK(!u.has_offer);
  v_update(&V, "0.3.0");
  update_view(&u, &V);
  v_reset(&V);
  update_view(&u, &V);
  CHECK(!u.has_offer);
  CHECK(u.connected);
  // sin vista viva: se conserva lo último, pero ya no se sabe si el puente lo sigue ofreciendo
  v_update(&V, "0.3.0");
  update_view(&u, &V);
  update_view(&u, NULL);
  CHECK(!u.connected);
  CHECK(u.has_offer);
  // la 0.10.0 es mayor que la 0.9.0 (numérica) y una versión ilegible no ofrece nada
  update_init(&u, "0.9.0", 1);
  v_update(&V, "0.10.0");
  update_view(&u, &V);
  CHECK(u.has_offer);
  update_init(&u, "", 1); // la app no sabe su versión
  update_view(&u, &V);
  CHECK(!u.has_offer);
}

static void test_card_priority(void) {
  Update u;
  update_init(&u, "0.2.0", 1);
  v_update(&V, "0.3.0");
  update_view(&u, &V);
  CHECK(update_card_visible(&u, &V));
  CHECK(!update_card_visible(&u, NULL)); // sin vista no hay tarjeta
  // las solicitudes y los avisos con "Visto" van siempre antes
  v_with_request(&V);
  update_view(&u, &V);
  CHECK(!update_card_visible(&u, &V));
  v_with_notice(&V);
  update_view(&u, &V);
  CHECK(!update_card_visible(&u, &V));
  v_update(&V, "0.3.0");
  update_view(&u, &V);
  CHECK(update_card_visible(&u, &V));
  // menú, guía, diagnóstico o lector abiertos la tapan
  CHECK(update_screen_showing(&u, &V, 0));
  CHECK(!update_screen_showing(&u, &V, 1));
}

static void test_guard_and_covering(void) {
  Update u;
  update_init(&u, "0.2.0", 1);
  v_update(&V, "0.3.0");
  CHECK(update_sync(&u, &V, 0, 1000)); // aparece
  CHECK(!update_sync(&u, &V, 0, 1100)); // ya estaba
  CHECK(!update_ready(&u, 1000));
  CHECK(!update_ready(&u, 1499));
  CHECK(update_ready(&u, 1500));
  CHECK_EQ_INT(update_a(&u, 1499), UPD_OUT_NONE); // pulsación temprana: no hace nada
  CHECK_EQ_INT(u.phase, UPD_IDLE);
  // algo la tapa y al volver la guarda empieza de nuevo
  CHECK(!update_sync(&u, &V, 1, 2000));
  CHECK(!u.shown);
  CHECK(update_sync(&u, &V, 0, 2100));
  CHECK(!update_ready(&u, 2599));
  CHECK_EQ_INT(update_a(&u, 2599), UPD_OUT_NONE);
  CHECK(update_ready(&u, 2600));
  // un permiso que llega y se va también reinicia la guarda
  v_with_request(&V);
  CHECK(!update_sync(&u, &V, 0, 3000));
  v_update(&V, "0.3.0");
  CHECK(update_sync(&u, &V, 0, 3100));
  CHECK_EQ_INT(update_a(&u, 3200), UPD_OUT_NONE);
  CHECK_EQ_INT(update_a(&u, 3600), UPD_OUT_START);
  CHECK_EQ_INT(u.phase, UPD_RUN);
}

// Los permisos y avisos mandan sobre la pantalla del menú y la del error: la cierran en el acto (instalando no hay vuelta atrás).
static void test_requests_close_page_and_error(void) {
  Update u;
  update_init(&u, "0.2.0", 1);
  v_update(&V, "0.3.0");
  update_sync(&u, &V, 0, 1000);
  update_open_page(&u, 1000);
  CHECK_EQ_INT(u.phase, UPD_PAGE);
  v_with_request(&V);
  update_sync(&u, &V, 0, 1100);
  CHECK_EQ_INT(u.phase, UPD_IDLE);
  CHECK(!u.shown);
  CHECK(!u.dismissed); // volver a abrirla desde el menú o ver la tarjeta sigue siendo posible
  // lo mismo con un aviso con "Visto"
  v_update(&V, "0.3.0");
  update_sync(&u, &V, 0, 1200);
  update_open_page(&u, 1200);
  v_with_notice(&V);
  update_sync(&u, &V, 0, 1300);
  CHECK_EQ_INT(u.phase, UPD_IDLE);
  // el error también cede, y no se ofrece sola otra vez
  v_update(&V, "0.3.0");
  update_sync(&u, &V, 0, 2000);
  CHECK_EQ_INT(update_a(&u, 3000), UPD_OUT_START);
  update_fail(&u, "x", 4000);
  v_with_request(&V);
  update_sync(&u, &V, 0, 4100);
  CHECK_EQ_INT(u.phase, UPD_IDLE);
  CHECK(u.dismissed);
  // instalando no cede (cortarla a medias es peor)
  update_init(&u, "0.2.0", 1);
  v_update(&V, "0.3.0");
  update_sync(&u, &V, 0, 1000);
  update_a(&u, 2000);
  v_with_request(&V);
  update_sync(&u, &V, 0, 2100);
  CHECK_EQ_INT(u.phase, UPD_RUN);
}

static void test_dismiss_until_restart(void) {
  Update u;
  update_init(&u, "0.2.0", 1);
  v_update(&V, "0.3.0");
  update_sync(&u, &V, 0, 1000);
  update_b(&u, 1100);
  CHECK(u.dismissed);
  CHECK(!update_card_visible(&u, &V));
  CHECK(!update_sync(&u, &V, 0, 1200));
  CHECK(!u.shown);
  v_update(&V, "0.4.0"); // otra versión más nueva: sigue oculta hasta el próximo arranque
  update_view(&u, &V);
  CHECK(!update_card_visible(&u, &V));
  update_init(&u, "0.2.0", 1); // próximo arranque
  update_view(&u, &V);
  CHECK(update_card_visible(&u, &V));
}

static void test_3dsx_cannot_install(void) {
  Update u;
  update_init(&u, "0.2.0", 0);
  v_update(&V, "0.3.0");
  update_sync(&u, &V, 0, 1000);
  CHECK(update_card_visible(&u, &V)); // se ve igual: explica por qué no
  CHECK(!update_can_install(&u));
  CHECK_EQ_INT(update_a(&u, 5000), UPD_OUT_NONE);
  CHECK_EQ_INT(u.phase, UPD_IDLE);
  UpdateScreen s;
  update_screen(&u, 5000, &s);
  CHECK(!s.has_a);
  CHECK(s.has_b);
  CHECK_STR(s.b_label, "B: Ahora no");
  CHECK(has_line(&s, "Hay una versión nueva de Cronio (0.3.0)."));
  CHECK(has_line(&s, "Tienes la 0.2.0."));
  CHECK(has_line(&s, ".3dsx"));
  CHECK(has_line(&s, ".cia"));
  CHECK(strstr(all_text(&s), "paso 4 del programa del PC (QR con FBI)") != NULL);
}

// ---- pantallas ----

static void test_card_screen(void) {
  Update u;
  update_init(&u, "0.2.0", 1);
  v_update(&V, "0.3.0");
  update_sync(&u, &V, 0, 1000);
  UpdateScreen s;
  update_screen(&u, 1100, &s);
  CHECK(!s.ready);
  update_screen(&u, 1600, &s);
  CHECK(s.ready);
  CHECK_STR(s.title, "Actualización disponible");
  CHECK_STR(s.lines[0], "Hay una versión nueva de Cronio (0.3.0).");
  CHECK_STR(s.lines[1], "Tienes la 0.2.0.");
  CHECK(s.has_a && s.has_b);
  CHECK_STR(s.a_label, "A: Actualizar");
  CHECK_STR(s.b_label, "B: Ahora no");
  CHECK(!s.has_bar);
}

static void test_page_screen(void) {
  Update u;
  update_init(&u, "0.2.0", 1);
  UpdateScreen s;
  // sin conexión: no se sabe
  update_open_page(&u, 1000);
  CHECK_EQ_INT(u.phase, UPD_PAGE);
  update_screen(&u, 2000, &s);
  CHECK_STR(s.title, "Actualizar app");
  CHECK_STR(s.lines[0], "Cronio 0.2.0.");
  CHECK(has_line(&s, "Sin conexión con el puente"));
  CHECK(!s.has_a);
  CHECK_STR(s.b_label, "B: Volver");
  // conectado y al día
  v_reset(&V);
  update_view(&u, &V);
  update_screen(&u, 2000, &s);
  CHECK(has_line(&s, "Estás al día"));
  CHECK(!s.has_a);
  // con una versión nueva: se puede instalar desde aquí
  v_update(&V, "0.3.0");
  update_view(&u, &V);
  update_screen(&u, 2000, &s);
  CHECK(has_line(&s, "Hay una versión nueva de Cronio (0.3.0)."));
  CHECK(s.has_a);
  CHECK_STR(s.a_label, "A: Actualizar");
  // B vuelve al menú sin descartar la tarjeta
  update_b(&u, 2100);
  CHECK_EQ_INT(u.phase, UPD_IDLE);
  CHECK(!u.dismissed);
  // ya hay un puente que ofrece la 0.3.0, pero esta app es .3dsx: la pantalla lo explica y no instala
  update_init(&u, "0.2.0", 0);
  v_update(&V, "0.3.0");
  update_view(&u, &V);
  update_open_page(&u, 1000);
  update_screen(&u, 2000, &s);
  CHECK(!s.has_a);
  CHECK(has_line(&s, ".3dsx"));
  CHECK_EQ_INT(update_a(&u, 2000), UPD_OUT_NONE);
}

static void test_progress_screen(void) {
  Update u;
  update_init(&u, "0.2.0", 1);
  v_update(&V, "0.3.0");
  update_sync(&u, &V, 0, 1000);
  CHECK_EQ_INT(update_a(&u, 2000), UPD_OUT_START);
  UpdateScreen s;
  update_screen(&u, 2000, &s);
  CHECK_STR(s.title, "Actualizando Cronio");
  CHECK_STR(s.lines[0], "Conectando con el PC…");
  CHECK_STR(s.lines[1], "Paso 1 de 5");
  CHECK(has_line(&s, "No apagues la consola"));
  CHECK(s.has_bar);
  CHECK_EQ_INT(s.permille, 0);
  CHECK_STR(s.kb_text, "");
  CHECK(!s.has_a && !s.has_b);
  update_set_step(&u, UPD_STEP_REQUEST);
  update_screen(&u, 2000, &s);
  CHECK_STR(s.lines[0], "Pidiendo la versión nueva…");
  CHECK_STR(s.lines[1], "Paso 2 de 5");
  // descarga: tramo 0-80 % de la barra
  update_set_step(&u, UPD_STEP_DOWNLOAD);
  update_set_progress(&u, 123 * 1024, 361408);
  update_screen(&u, 2000, &s);
  CHECK_STR(s.lines[0], "Descargando del PC…");
  CHECK_STR(s.lines[1], "Paso 3 de 5");
  CHECK_EQ_INT(s.permille, 278); // 348 * 0,8
  CHECK_STR(s.bar_text, "27 %");
  CHECK_STR(s.kb_text, "123 KB de 353 KB");
  // instalación: tramo 80-100 %
  update_set_step(&u, UPD_STEP_INSTALL);
  update_set_progress(&u, 0, 361408);
  update_screen(&u, 2000, &s);
  CHECK_STR(s.lines[0], "Instalando…");
  CHECK_STR(s.lines[1], "Paso 4 de 5");
  CHECK_EQ_INT(s.permille, 800);
  update_set_progress(&u, 361408 / 2, 361408);
  update_screen(&u, 2000, &s);
  CHECK_EQ_INT(s.permille, 900);
  update_set_step(&u, UPD_STEP_FINISH);
  update_screen(&u, 2000, &s);
  CHECK_STR(s.lines[0], "Terminando la instalación…");
  CHECK_STR(s.lines[1], "Paso 5 de 5");
  CHECK_EQ_INT(s.permille, 1000);
  CHECK_STR(s.bar_text, "100 %");
  // durante la instalación nada de lo pulsado la corta, y START no sale
  update_b(&u, 2100);
  CHECK_EQ_INT(u.phase, UPD_RUN);
  CHECK_EQ_INT(update_a(&u, 5000), UPD_OUT_NONE);
  CHECK(update_blocks_quit(&u));
  // un progreso que se pasa del total no se pasa de la barra
  update_set_progress(&u, 400000, 361408);
  CHECK_EQ_INT((int)u.done, 361408);
}

static void test_done_and_restart(void) {
  Update u;
  update_init(&u, "0.2.0", 1);
  v_update(&V, "0.3.0");
  update_sync(&u, &V, 0, 1000);
  update_a(&u, 2000);
  update_set_progress(&u, 100, 361408);
  update_done(&u, 1, 9000);
  CHECK_EQ_INT(u.phase, UPD_DONE);
  UpdateScreen s;
  update_screen(&u, 9100, &s);
  CHECK_STR(s.title, "Listo");
  CHECK_EQ_INT(s.tone, UPD_TONE_OK);
  CHECK_STR(s.lines[0], "Listo. Cronio se va a reiniciar.");
  CHECK(s.has_bar);
  CHECK_EQ_INT(s.permille, 1000);
  CHECK(update_blocks_quit(&u));
  CHECK(!update_restart_due(&u, 9000 + UPDATE_RESTART_MS - 1));
  CHECK(update_restart_due(&u, 9000 + UPDATE_RESTART_MS));
  // sin poder reiniciarse sola: pide cerrar y abrir Cronio, no reinicia y deja salir con START
  update_init(&u, "0.2.0", 1);
  update_view(&u, (v_update(&V, "0.3.0"), &V));
  update_sync(&u, &V, 0, 1000);
  update_a(&u, 2000);
  update_done(&u, 0, 9000);
  update_screen(&u, 9100, &s);
  CHECK_STR(s.lines[0], "Listo. Cierra Cronio y ábrela otra vez.");
  CHECK(!update_restart_due(&u, 99999));
  CHECK(!update_blocks_quit(&u));
}

static void test_fail_screen_and_retry(void) {
  Update u;
  update_init(&u, "0.2.0", 1);
  v_update(&V, "0.3.0");
  update_sync(&u, &V, 0, 1000);
  update_a(&u, 2000);
  update_set_progress(&u, 4096, 361408);
  update_fail(&u, "La descarga se cortó: el PC dejó de responder.", 5000);
  CHECK_EQ_INT(u.phase, UPD_FAIL);
  UpdateScreen s;
  update_screen(&u, 5100, &s);
  CHECK_STR(s.title, "No se pudo actualizar");
  CHECK_EQ_INT(s.tone, UPD_TONE_BAD);
  CHECK(has_line(&s, "La descarga se cortó"));
  CHECK(has_line(&s, "Se mantiene la versión actual (0.2.0)."));
  CHECK(s.has_a && s.has_b);
  CHECK_STR(s.a_label, "A: Reintentar");
  CHECK_STR(s.b_label, "B: Volver");
  CHECK(!update_blocks_quit(&u));
  // reintentar: guarda de 500 ms desde que apareció el error, y vuelve a empezar de cero
  CHECK_EQ_INT(update_a(&u, 5200), UPD_OUT_NONE);
  CHECK_EQ_INT(update_a(&u, 5500), UPD_OUT_START);
  CHECK_EQ_INT(u.phase, UPD_RUN);
  CHECK_EQ_INT((int)u.done, 0);
  CHECK_STR(u.error, "");
  // un fallo de AM también mantiene la versión instalada: nada se borra, así que nunca se dice que la app quedó desinstalada
  update_fail(&u, "AM_FinishCiaInstall C8A08BF4", 8000);
  update_screen(&u, 9000, &s);
  CHECK(has_line(&s, "Se mantiene la versión actual (0.2.0)."));
  CHECK(!has_line(&s, "desinstalada"));
  CHECK(!has_line(&s, "QR del paso 4"));
  // B vuelve sin reofrecer la tarjeta (el menú sigue permitiendo reintentar)
  update_b(&u, 9100);
  CHECK_EQ_INT(u.phase, UPD_IDLE);
  CHECK(u.dismissed);
  // un mensaje larguísimo se corta y no desborda
  update_init(&u, "0.2.0", 1);
  char big[400];
  memset(big, 'x', sizeof big - 1);
  big[sizeof big - 1] = '\0';
  update_fail(&u, big, 1000);
  CHECK(strlen(u.error) < UPDATE_ERROR_BYTES);
  update_screen(&u, 2000, &s);
  CHECK(s.line_count <= UPDATE_MAX_LINES);
  // un error real se ve entero, con su código (antes se cortaba a 24 caracteres: «No se pudo escribir la ...»)
  update_init(&u, "0.2.0", 1);
  update_fail(&u, "FSFILE_Write C8A08BF4 en el byte 0", 1000);
  CHECK(strstr(u.error, "FSFILE_Write C8A08BF4 en el byte 0") != NULL);
  update_screen(&u, 2000, &s);
  CHECK(has_line(&s, "FSFILE_Write C8A08BF4"));
  CHECK(has_line(&s, "Se mantiene la versión actual"));
  // y el error de verificación (lo descargado no es lo que anunció el PC) se ve entero
  update_init(&u, "0.2.0", 1);
  update_fail(&u, "El archivo descargado no coincide con el que anunció el PC.", 1000);
  update_screen(&u, 2000, &s);
  CHECK(strstr(all_text(&s), "no coincide con el que anunció el PC") != NULL);
  CHECK(has_line(&s, "Se mantiene la versión actual"));
  CHECK(s.line_count <= UPDATE_MAX_LINES);
}

// ---- textos ----

static void test_bar_permille(void) {
  CHECK_EQ_INT(update_bar_permille(UPD_STEP_CONNECT, 50, 100), 0);
  CHECK_EQ_INT(update_bar_permille(UPD_STEP_REQUEST, 0, 0), 0);
  CHECK_EQ_INT(update_bar_permille(UPD_STEP_DOWNLOAD, 0, 0), 0);
  CHECK_EQ_INT(update_bar_permille(UPD_STEP_DOWNLOAD, 0, 100), 0);
  CHECK_EQ_INT(update_bar_permille(UPD_STEP_DOWNLOAD, 50, 100), 400);
  CHECK_EQ_INT(update_bar_permille(UPD_STEP_DOWNLOAD, 100, 100), 800);
  CHECK_EQ_INT(update_bar_permille(UPD_STEP_DOWNLOAD, 999, 100), 800); // nunca pasa del 80 %
  CHECK_EQ_INT(update_bar_permille(UPD_STEP_INSTALL, 0, 100), 800);
  CHECK_EQ_INT(update_bar_permille(UPD_STEP_INSTALL, 50, 100), 900);
  CHECK_EQ_INT(update_bar_permille(UPD_STEP_INSTALL, 100, 100), 1000);
  CHECK_EQ_INT(update_bar_permille(UPD_STEP_FINISH, 0, 0), 1000);
  CHECK_EQ_INT(update_step_number(UPD_STEP_CONNECT), 1);
  CHECK_EQ_INT(update_step_number(UPD_STEP_INSTALL), 4);
  CHECK_EQ_INT(update_step_number(UPD_STEP_FINISH), 5);
}

static void test_formatting(void) {
  CHECK_EQ_INT(update_permille(0, 0), 0);
  CHECK_EQ_INT(update_permille(50, 0), 0);
  CHECK_EQ_INT(update_permille(0, 100), 0);
  CHECK_EQ_INT(update_permille(50, 100), 500);
  CHECK_EQ_INT(update_permille(100, 100), 1000);
  CHECK_EQ_INT(update_permille(500, 100), 1000); // nunca más que todo
  CHECK_EQ_INT(update_permille(0xFFFFFFFFu, 0xFFFFFFFFu), 1000); // sin desbordar
  char b[64];
  update_format_kb(b, sizeof b, 0, 361408);
  CHECK_STR(b, "0 KB de 353 KB");
  update_format_kb(b, sizeof b, 1023, 361408);
  CHECK_STR(b, "0 KB de 353 KB"); // lo hecho, hacia abajo
  update_format_kb(b, sizeof b, 1025, 1025);
  CHECK_STR(b, "2 KB de 2 KB"); // el total, hacia arriba (y al terminar dice lo mismo que el total)
  update_format_kb(b, sizeof b, 1500, 3000);
  CHECK_STR(b, "1 KB de 3 KB");
  update_format_kb(b, sizeof b, 361408, 361408);
  CHECK_STR(b, "353 KB de 353 KB");
  update_format_kb(b, sizeof b, 999999, 1024);
  CHECK_STR(b, "1 KB de 1 KB"); // no pasa del total
  update_format_kb(b, sizeof b, 2048, 0);
  CHECK_STR(b, "2 KB");
  update_format_kb(b, 5, 2048, 4096);
  CHECK_STR(b, "2 KB"); // se corta en el búfer, con NUL
}

static void test_wrap(void) {
  char out[6][UPDATE_LINE_BYTES];
  int n = update_wrap("uno dos tres cuatro", 8, out, 6);
  CHECK_EQ_INT(n, 3);
  CHECK_STR(out[0], "uno dos");
  CHECK_STR(out[1], "tres");
  CHECK_STR(out[2], "cuatro");
  n = update_wrap("  espacios   de  más  ", 20, out, 6);
  CHECK_EQ_INT(n, 1);
  CHECK_STR(out[0], "espacios de más");
  CHECK_EQ_INT(update_wrap("", 10, out, 6), 0);
  CHECK_EQ_INT(update_wrap("   ", 10, out, 6), 0);
  // una palabra más larga que la línea se corta en trozos
  n = update_wrap("abcdefghijkl", 5, out, 6);
  CHECK_EQ_INT(n, 3);
  CHECK_STR(out[0], "abcde");
  CHECK_STR(out[1], "fghij");
  CHECK_STR(out[2], "kl");
  // los acentos cuentan como un carácter
  n = update_wrap("ñandú ñandú", 5, out, 6);
  CHECK_EQ_INT(n, 2);
  CHECK_STR(out[0], "ñandú");
  CHECK_STR(out[1], "ñandú");
  // el tope de líneas corta el resto
  n = update_wrap("a b c d e f", 1, out, 3);
  CHECK_EQ_INT(n, 3);
  CHECK_STR(out[2], "c");
  CHECK_EQ_INT(update_wrap("a", 0, out, 3), 0);
  CHECK_EQ_INT(update_wrap("a", 3, out, 0), 0);
}

static int overlaps(const Rect *a, const Rect *b) { return a->x < b->x + b->w && b->x < a->x + a->w && a->y < b->y + b->h && b->y < a->y + a->h; }
static int inside(const Rect *r) { return r->x >= 0 && r->y >= 0 && r->x + r->w <= LAYOUT_W && r->y + r->h <= LAYOUT_H; }

static void test_layout_and_hits(void) {
  UpdateLayout l;
  update_layout(&l);
  const Rect *all[] = {&l.label, &l.title, &l.body, &l.bar, &l.kb, &l.btn_a, &l.btn_b, &l.btn_b_solo};
  for (size_t i = 0; i < sizeof all / sizeof all[0]; i++) CHECK_MSG(inside(all[i]), "rect %zu fuera de la pantalla", i);
  CHECK(!overlaps(&l.btn_a, &l.btn_b));
  CHECK(!overlaps(&l.title, &l.body));
  CHECK(!overlaps(&l.body, &l.btn_a));
  CHECK(!overlaps(&l.bar, &l.btn_a));
  CHECK(!overlaps(&l.kb, &l.btn_a));
  CHECK(!overlaps(&l.bar, &l.kb));
  CHECK(l.btn_a.h >= 32 && l.btn_b.h >= 32); // cómodos para el lápiz
  // las 8 líneas del cuerpo caben sobre los botones
  CHECK(l.body.y + UPDATE_MAX_LINES * UPDATE_LINE_PITCH <= l.btn_a.y + 4);
  CHECK_EQ_INT(update_hit(1, 1, l.btn_a.x + 5, l.btn_a.y + 5), UPD_HIT_A);
  CHECK_EQ_INT(update_hit(1, 1, l.btn_b.x + 5, l.btn_b.y + 5), UPD_HIT_B);
  CHECK_EQ_INT(update_hit(1, 1, 160, 100), UPD_HIT_NONE);
  CHECK_EQ_INT(update_hit(0, 1, l.btn_a.x + 5, l.btn_a.y + 5), UPD_HIT_B); // solo B: ocupa todo el ancho
  CHECK_EQ_INT(update_hit(0, 1, 300, l.btn_b_solo.y + 5), UPD_HIT_B);
  CHECK_EQ_INT(update_hit(0, 0, l.btn_a.x + 5, l.btn_a.y + 5), UPD_HIT_NONE);
}

// ---- integración con las entradas ----

typedef struct {
  InputLogic in;
  const View *view;
  int starts, quits, decisions;
} H;

static void run_actions(H *h, const InputActions *acts) {
  for (int i = 0; i < acts->n; i++) {
    switch (acts->a[i].kind) {
      case IN_ACT_UPDATE_START: h->starts++; break;
      case IN_ACT_QUIT: h->quits++; break;
      case IN_ACT_DECISION: h->decisions++; break;
      default: break;
    }
  }
}

static void h_init(H *h, int is_cia) {
  memset(h, 0, sizeof *h);
  input_init(&h->in);
  input_set_app(&h->in, "0.2.0", is_cia);
}

static void frame(H *h, uint64_t now, uint32_t down, uint32_t up, uint32_t held, int tx, int ty) {
  InputFrame f;
  memset(&f, 0, sizeof f);
  f.now = now;
  f.down = down;
  f.up = up;
  f.held = held;
  f.rep = down;
  f.touch_x = tx;
  f.touch_y = ty;
  f.view = h->view;
  InputActions acts;
  input_frame(&h->in, &f, &acts);
  run_actions(h, &acts);
}

static void tap(H *h, uint32_t key, uint64_t t) {
  frame(h, t, key, 0, key, 0, 0);
  frame(h, t + 10, 0, key, 0, 0, 0);
}

static void new_view(H *h, const View *v, uint64_t now) {
  InputActions acts;
  h->view = v;
  input_view_changed(&h->in, v, "Claude", now, &acts);
  run_actions(h, &acts);
}

static void test_input_card_flow(void) {
  H h;
  h_init(&h, 1);
  v_update(&V, "0.3.0");
  new_view(&h, &V, 1000);
  frame(&h, 1000, 0, 0, 0, 0, 0); // la tarjeta aparece
  CHECK(h.in.update.shown);
  CHECK(update_screen_showing(&h.in.update, &V, 0));
  tap(&h, IN_KEY_A, 1100); // pulsación temprana (guarda de 500 ms)
  CHECK_EQ_INT(h.starts, 0);
  CHECK_EQ_INT(h.in.update.phase, UPD_IDLE);
  tap(&h, IN_KEY_A, 1600);
  CHECK_EQ_INT(h.starts, 1);
  CHECK_EQ_INT(h.in.update.phase, UPD_RUN);
  // mientras se instala, START no sale
  frame(&h, 1700, IN_KEY_START, 0, IN_KEY_START, 0, 0);
  CHECK_EQ_INT(h.quits, 0);
}

static void test_input_dismiss_with_b(void) {
  H h;
  h_init(&h, 1);
  v_update(&V, "0.3.0");
  new_view(&h, &V, 1000);
  frame(&h, 1000, 0, 0, 0, 0, 0);
  tap(&h, IN_KEY_B, 1100); // B no tiene guarda: nunca hace daño
  CHECK(h.in.update.dismissed);
  CHECK(!h.in.update.shown || h.in.update.phase == UPD_IDLE);
  frame(&h, 1300, 0, 0, 0, 0, 0);
  CHECK(!h.in.update.shown);
  tap(&h, IN_KEY_A, 2000); // ya no hay tarjeta: A no instala nada
  CHECK_EQ_INT(h.starts, 0);
  // START vuelve a salir
  frame(&h, 2100, IN_KEY_START, 0, IN_KEY_START, 0, 0);
  CHECK_EQ_INT(h.quits, 1);
}

static void test_input_requests_go_first(void) {
  H h;
  h_init(&h, 1);
  v_with_request(&V);
  new_view(&h, &V, 1000);
  frame(&h, 1000, 0, 0, 0, 0, 0);
  CHECK(!h.in.update.shown);
  tap(&h, IN_KEY_A, 2000); // es del permiso, no de la actualización
  CHECK_EQ_INT(h.starts, 0);
  CHECK_EQ_INT(h.in.update.phase, UPD_IDLE);
  // el permiso se va: la tarjeta aparece y su guarda empieza ahí
  v_update(&V, "0.3.0");
  new_view(&h, &V, 3000);
  frame(&h, 3000, 0, 0, 0, 0, 0);
  CHECK(h.in.update.shown);
  tap(&h, IN_KEY_A, 3100);
  CHECK_EQ_INT(h.starts, 0);
  tap(&h, IN_KEY_A, 3600);
  CHECK_EQ_INT(h.starts, 1);
}

static void test_input_3dsx_only_dismiss(void) {
  H h;
  h_init(&h, 0);
  v_update(&V, "0.3.0");
  new_view(&h, &V, 1000);
  frame(&h, 1000, 0, 0, 0, 0, 0);
  CHECK(h.in.update.shown);
  tap(&h, IN_KEY_A, 2000);
  CHECK_EQ_INT(h.starts, 0);
  CHECK_EQ_INT(h.in.update.phase, UPD_IDLE);
  tap(&h, IN_KEY_B, 2100);
  CHECK(h.in.update.dismissed);
}

static void test_input_touch_buttons(void) {
  H h;
  h_init(&h, 1);
  v_update(&V, "0.3.0");
  new_view(&h, &V, 1000);
  frame(&h, 1000, 0, 0, 0, 0, 0);
  UpdateLayout l;
  update_layout(&l);
  int ax = l.btn_a.x + 20, ay = l.btn_a.y + 10, bx = l.btn_b.x + 20, by = l.btn_b.y + 10;
  // un toque antes de la guarda no instala
  frame(&h, 1100, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, ax, ay);
  frame(&h, 1150, 0, IN_KEY_TOUCH, 0, ax, ay);
  CHECK_EQ_INT(h.starts, 0);
  // apoyar en «Actualizar» y soltar fuera no instala
  frame(&h, 2000, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, ax, ay);
  frame(&h, 2050, 0, 0, IN_KEY_TOUCH, 160, 100);
  frame(&h, 2100, 0, IN_KEY_TOUCH, 0, 160, 100);
  CHECK_EQ_INT(h.starts, 0);
  // apoyar en «Ahora no» y soltar ahí la descarta
  frame(&h, 2200, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, bx, by);
  frame(&h, 2250, 0, IN_KEY_TOUCH, 0, bx, by);
  CHECK(h.in.update.dismissed);
  // otra sesión: apoyar y soltar en «Actualizar» instala
  H g;
  h_init(&g, 1);
  new_view(&g, &V, 1000);
  frame(&g, 1000, 0, 0, 0, 0, 0);
  frame(&g, 2000, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, ax, ay);
  frame(&g, 2050, 0, IN_KEY_TOUCH, 0, ax, ay);
  CHECK_EQ_INT(g.starts, 1);
  CHECK_EQ_INT(g.in.update.phase, UPD_RUN);
}

static void test_input_menu_page(void) {
  H h;
  h_init(&h, 1);
  v_update(&V, "0.3.0");
  new_view(&h, &V, 1000);
  frame(&h, 1000, 0, 0, 0, 0, 0);
  // SELECT abre el menú, que tapa la tarjeta (con la guarda de nuevo al volver)
  tap(&h, IN_KEY_SELECT, 1100);
  CHECK(h.in.menu.open);
  CHECK(!h.in.update.shown);
  // la entrada «Actualizar app» es la última
  for (int i = 0; i < MENU_ROOT_ENTRIES - 1; i++) tap(&h, IN_KEY_DOWN, 1200 + (uint64_t)i * 50);
  CHECK_EQ_INT(h.in.menu.cursor, MENU_E_UPDATE);
  tap(&h, IN_KEY_A, 2000);
  CHECK_EQ_INT(h.in.update.phase, UPD_PAGE);
  CHECK(h.in.menu.open); // debajo
  tap(&h, IN_KEY_A, 2100); // guarda
  CHECK_EQ_INT(h.starts, 0);
  tap(&h, IN_KEY_A, 2700);
  CHECK_EQ_INT(h.starts, 1);
  CHECK_EQ_INT(h.in.update.phase, UPD_RUN);
}

static void test_input_page_close_and_offline(void) {
  H h;
  h_init(&h, 1);
  // sin conexión: la entrada del menú sirve igual y muestra que no se sabe
  menu_open(&h.in.menu);
  h.in.menu.cursor = MENU_E_UPDATE;
  tap(&h, IN_KEY_A, 1000);
  CHECK_EQ_INT(h.in.update.phase, UPD_PAGE);
  UpdateScreen s;
  update_screen(&h.in.update, 2000, &s);
  CHECK(has_line(&s, "Sin conexión con el puente"));
  tap(&h, IN_KEY_A, 2000); // no hay nada que instalar
  CHECK_EQ_INT(h.starts, 0);
  tap(&h, IN_KEY_B, 2100); // vuelve al menú
  CHECK_EQ_INT(h.in.update.phase, UPD_IDLE);
  CHECK(h.in.menu.open);
  // SELECT también cierra la pantalla (y no cierra el menú de paso)
  tap(&h, IN_KEY_A, 2200);
  CHECK_EQ_INT(h.in.update.phase, UPD_PAGE);
  tap(&h, IN_KEY_SELECT, 2300);
  CHECK_EQ_INT(h.in.update.phase, UPD_IDLE);
  CHECK(h.in.menu.open);
  // START sale (no hay instalación en curso)
  frame(&h, 2400, IN_KEY_START, 0, IN_KEY_START, 0, 0);
  CHECK_EQ_INT(h.quits, 1);
}

// Con la pantalla del menú abierta, un permiso que llega la cierra y el menú también: la tarjeta de permiso se responde sin pasos de más.
static void test_input_request_closes_page_and_menu(void) {
  H h;
  h_init(&h, 1);
  v_update(&V, "0.3.0");
  new_view(&h, &V, 1000);
  frame(&h, 1000, 0, 0, 0, 0, 0);
  tap(&h, IN_KEY_SELECT, 1100);
  for (int i = 0; i < MENU_ROOT_ENTRIES - 1; i++) tap(&h, IN_KEY_DOWN, 1200 + (uint64_t)i * 50);
  tap(&h, IN_KEY_A, 2000);
  CHECK_EQ_INT(h.in.update.phase, UPD_PAGE);
  v_with_request(&V);
  new_view(&h, &V, 3000);
  frame(&h, 3000, 0, 0, 0, 0, 0);
  CHECK_EQ_INT(h.in.update.phase, UPD_IDLE);
  CHECK(!h.in.menu.open);
  CHECK(!h.in.update.shown);
  CHECK_EQ_INT(h.starts, 0);
}

static void test_input_fail_retry_and_back(void) {
  H h;
  h_init(&h, 1);
  v_update(&V, "0.3.0");
  new_view(&h, &V, 1000);
  frame(&h, 1000, 0, 0, 0, 0, 0);
  tap(&h, IN_KEY_A, 1600);
  CHECK_EQ_INT(h.in.update.phase, UPD_RUN);
  update_fail(&h.in.update, "No se pudo conectar con el PC.", 5000);
  frame(&h, 5000, 0, 0, 0, 0, 0);
  tap(&h, IN_KEY_A, 5100); // guarda
  CHECK_EQ_INT(h.starts, 1);
  tap(&h, IN_KEY_A, 5700);
  CHECK_EQ_INT(h.starts, 2); // reintenta
  update_fail(&h.in.update, "otra vez", 8000);
  frame(&h, 8000, 0, 0, 0, 0, 0);
  tap(&h, IN_KEY_B, 8100);
  CHECK_EQ_INT(h.in.update.phase, UPD_IDLE);
  CHECK(h.in.update.dismissed);
  // sin tarjeta, START sale
  frame(&h, 8300, IN_KEY_START, 0, IN_KEY_START, 0, 0);
  CHECK_EQ_INT(h.quits, 1);
}

static void test_input_done_no_restart_allows_start(void) {
  H h;
  h_init(&h, 1);
  v_update(&V, "0.3.0");
  new_view(&h, &V, 1000);
  frame(&h, 1000, 0, 0, 0, 0, 0);
  tap(&h, IN_KEY_A, 1600);
  update_done(&h.in.update, 0, 9000);
  frame(&h, 9100, IN_KEY_START, 0, IN_KEY_START, 0, 0);
  CHECK_EQ_INT(h.quits, 1); // sin reinicio automático, START cierra y se abre de nuevo a mano
  H g;
  h_init(&g, 1);
  new_view(&g, &V, 1000);
  frame(&g, 1000, 0, 0, 0, 0, 0);
  tap(&g, IN_KEY_A, 1600);
  update_done(&g.in.update, 1, 9000);
  frame(&g, 9100, IN_KEY_START, 0, IN_KEY_START, 0, 0);
  CHECK_EQ_INT(g.quits, 0); // con reinicio automático no se puede salir a medias
}

int main(void) {
  TEST_BEGIN("update: actualizar la app desde la consola (tarjeta, menú, progreso, error y reinicio)");
  RUN(test_offer_only_when_newer);
  RUN(test_card_priority);
  RUN(test_guard_and_covering);
  RUN(test_requests_close_page_and_error);
  RUN(test_dismiss_until_restart);
  RUN(test_3dsx_cannot_install);
  RUN(test_card_screen);
  RUN(test_page_screen);
  RUN(test_progress_screen);
  RUN(test_done_and_restart);
  RUN(test_fail_screen_and_retry);
  RUN(test_bar_permille);
  RUN(test_formatting);
  RUN(test_wrap);
  RUN(test_layout_and_hits);
  RUN(test_input_card_flow);
  RUN(test_input_dismiss_with_b);
  RUN(test_input_requests_go_first);
  RUN(test_input_3dsx_only_dismiss);
  RUN(test_input_touch_buttons);
  RUN(test_input_menu_page);
  RUN(test_input_page_close_and_offline);
  RUN(test_input_request_closes_page_and_menu);
  RUN(test_input_fail_retry_and_back);
  RUN(test_input_done_no_restart_allows_start);
  TEST_END();
}

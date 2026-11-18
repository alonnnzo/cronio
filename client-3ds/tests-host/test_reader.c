// Lector del mensaje completo (logic/reader.c + su integración en logic/input_logic.c), sin libctru.
// Lo central: A en el detalle abre el lector y pide `read`; la cruceta, L/R y el lápiz desplazan; B vuelve; y una tarjeta
// de permiso lo cierra en el acto sin que el lector pueda aprobar ni rechazar nada.
#include "test.h"

#include "../source/logic/input_logic.h"
#include "../source/logic/reader.h"

#define CX(r) ((r).x + (r).w / 2)
#define CY(r) ((r).y + (r).h / 2)

// ---- documentos y vistas ----

static ReadDoc DOC;

static void doc_make(ReadDoc *d, const char *session_id, int lines, int truncated, int question) {
  memset(d, 0, sizeof *d);
  strcpy(d->session_id, session_id);
  d->line_count = lines;
  for (int i = 0; i < lines; i++) snprintf(d->lines[i], sizeof d->lines[i], "linea %d", i + 1);
  d->truncated = truncated;
  d->question_count = question;
  for (int i = 0; i < question; i++) snprintf(d->question[i], sizeof d->question[i], "pregunta %d", i + 1);
}

static View V_DETAIL, V_DETAIL2, V_CARD, V_CARD_DETAIL, V_NO_DETAIL;

static void view_base(View *v) {
  memset(v, 0, sizeof *v);
  v->mode = MODE_QUEUE;
  v->face.kind = AGENT_NONE;
  v->face.mood = MOOD_IDLE;
  v->face.line_count = 1;
  strcpy(v->face.lines[0], "x");
  v->session_count = 1;
  strcpy(v->sessions[0].id, "s1");
  v->sessions[0].kind = AGENT_CLAUDE;
  strcpy(v->sessions[0].title, "Ajustar el hero");
  strcpy(v->sessions[0].project, "mi-portal");
}

static void view_detail(View *v, const char *first_line) {
  view_base(v);
  v->has_detail = 1;
  strcpy(v->detail.session_id, "s1");
  v->detail.line_count = 2;
  strcpy(v->detail.last_message[0], first_line);
  strcpy(v->detail.last_message[1], "segunda");
}

static void view_card(View *v, int with_detail) {
  if (with_detail) view_detail(v, "Listo el hero");
  else view_base(v);
  v->has_request = 1;
  strcpy(v->request.id, "r1");
  strcpy(v->request.session_id, "s1");
  strcpy(v->request.title, "t");
  v->request.line_count = 1;
  strcpy(v->request.lines[0], "ls");
  v->request.risk = RISK_NORMAL;
  v->request.position = 1;
  v->request.total = 1;
  v->pending_count = 1;
}

// ---- arnés (lo que hace app.c, con los envíos simulados) ----

typedef struct {
  InputLogic in;
  BottomLayout lay;
  const View *view;
  const ReadDoc *doc;
  uint32_t read_seq;
  int send_fails;
  int reads, focus, unfocus, decisions, modes, skips;
  char last_read[VIEW_ID_BYTES];
  int last_read_mode;
  int last_decision;
} H;

static void relayout(H *h) {
  LayoutInput li;
  memset(&li, 0, sizeof li);
  li.level = h->in.nav.level == NAV_DETAIL ? LAYOUT_DETAIL : h->in.nav.level == NAV_SESSIONS ? LAYOUT_SESSIONS : LAYOUT_AGENTS;
  li.item_count = 5;
  if (h->view != NULL) layout_input_from_view(&li, h->view, h->in.nav.session_id);
  if (h->view != NULL) layout_compute(&li, &h->lay);
  else memset(&h->lay, 0, sizeof h->lay);
}

static void exec(H *h, const InputActions *acts) {
  for (int i = 0; i < acts->n; i++) {
    const InputAction *a = &acts->a[i];
    int rc = 0;
    switch (a->kind) {
      case IN_ACT_READ:
        h->reads++;
        strcpy(h->last_read, a->id);
        h->last_read_mode = a->flag;
        rc = h->send_fails ? -1 : 0;
        break;
      case IN_ACT_DECISION: h->decisions++; h->last_decision = a->flag; break;
      case IN_ACT_FOCUS: h->focus++; break;
      case IN_ACT_UNFOCUS: h->unfocus++; break;
      case IN_ACT_MODE: h->modes++; break;
      case IN_ACT_SKIP: h->skips++; break;
      case IN_ACT_ACK:
      case IN_ACT_SKIP_NOTICE:
      case IN_ACT_SESSION_NOTIFY:
      case IN_ACT_SETTING_NOTIFY:
      case IN_ACT_SETTING_ACK:
      case IN_ACT_SETTING_SOUND:
      case IN_ACT_SETTING_QUESTIONS:
      case IN_ACT_SETTING_READER:
      case IN_ACT_ANSWER:
      case IN_ACT_ANSWER_PC:
      case IN_ACT_QUESTION_OTHER:
      case IN_ACT_SETTING_HIDDEN:
      case IN_ACT_INSTRUCT_WRITE:
      case IN_ACT_INSTRUCT_SEND:
      case IN_ACT_INSTRUCT_CLEAR:
      case IN_ACT_RELEASE:
      case IN_ACT_SESSION_WAIT:
      case IN_ACT_SETTING_INSTRUCT_WAIT:
      case IN_ACT_PAIR_CODE:
      case IN_ACT_THEME:
      case IN_ACT_UPDATE_START:
      case IN_ACT_MANUAL_IP:
      case IN_ACT_RETRY:
      case IN_ACT_QUIT: break;
    }
    input_action_done(&h->in, a, rc);
  }
}

static void h_view(H *h, const View *v, uint64_t now) {
  InputActions acts;
  h->view = v;
  input_view_changed(&h->in, v, "Claude", now, &acts);
  exec(h, &acts);
  relayout(h);
}

static void h_frame(H *h, uint64_t now, uint32_t down, uint32_t up, uint32_t held, int x, int y) {
  InputFrame f;
  InputActions acts;
  memset(&f, 0, sizeof f);
  f.now = now;
  f.down = down;
  f.up = up;
  f.held = held;
  f.rep = down;
  f.touch_x = x;
  f.touch_y = y;
  f.view = h->view;
  f.layout = &h->lay;
  f.doc = h->doc;
  f.read_seq = h->read_seq;
  input_frame(&h->in, &f, &acts);
  exec(h, &acts);
}

static void tap(H *h, uint32_t key, uint64_t at) {
  h_frame(h, at, key, 0, key, 0, 0);
  h_frame(h, at + 30, 0, key, 0, 0, 0);
}

// El puente contesta: llega un texto y la app avisa al lector.
static void reply(H *h, const ReadDoc *d) {
  h->doc = d;
  h->read_seq++;
  reader_on_doc(&h->in.reader, d, h->read_seq);
}

// Detalle de s1 abierto (agentes -> sesiones -> detalle, con la cruceta y A), sin tarjeta.
static void h_in_detail(H *h, const View *v) {
  memset(h, 0, sizeof *h);
  input_init(&h->in);
  h->view = v;
  InputActions acts;
  input_session_ready(&h->in, &acts); // hay conexión: sin esto aprobar no se habilita
  input_view_changed(&h->in, v, "Claude", 0, &acts);
  relayout(h);
  tap(h, IN_KEY_A, 100); // agentes -> sesiones de Claude
  tap(h, IN_KEY_A, 200); // sesiones -> detalle de s1
  relayout(h);
  h->focus = h->reads = 0;
}

// ---- reader.c: geometría y desplazamiento ----

static void test_layout(void) {
  ReaderLayout l;
  reader_layout(0, 0, &l);
  CHECK_EQ_INT(l.body.y, 24);
  CHECK_EQ_INT(l.rows, 13); // con el pie del modo (15 px) una menos que sin él
  CHECK(!l.has_stale);
  CHECK_EQ_INT(l.foot.y, LAYOUT_H - 2 - READER_FOOT_H);
  CHECK_EQ_INT(l.foot.h, READER_FOOT_H);
  CHECK_EQ_INT(l.body.y + l.body.h, l.foot.y); // el pie no se solapa con las líneas
  reader_layout(0, 1, &l); // con el aviso de mensaje nuevo: 18 px menos
  CHECK(l.has_stale);
  CHECK_EQ_INT(l.body.y, 42);
  CHECK_EQ_INT(l.rows, 12);
  reader_layout(3, 0, &l); // con la pregunta (3 líneas)
  CHECK_EQ_INT(l.question.h, READER_QUESTION_HEAD_H + 3 * READER_QUESTION_ROW_H + 2);
  CHECK_EQ_INT(l.body.y, 24 + l.question.h + 3);
  CHECK_EQ_INT(l.rows, 8);
  reader_layout(9, 1, &l); // se acota a 3 líneas
  CHECK_EQ_INT(l.question_lines, 3);
  // todo dentro de 320x240
  CHECK(l.body.y + l.body.h <= LAYOUT_H);
  CHECK(l.back_btn.x + l.back_btn.w <= LAYOUT_W);
  CHECK(l.pos.x + l.pos.w <= l.back_btn.x);
  // el rectángulo de "B Volver" no se pisa con la cabecera de la barra principal más de lo necesario
  CHECK(l.back_btn.y >= READER_BAR_Y && l.back_btn.y + l.back_btn.h <= READER_BAR_Y + READER_BAR_H);
}

static void test_scroll_and_pages(void) {
  Reader r;
  doc_make(&DOC, "s1", 40, 0, 0);
  reader_open(&r, "s1", 0, NULL);
  CHECK_EQ_INT(r.state, READER_LOADING);
  CHECK_EQ_INT(reader_scroll(&r, &DOC, 1), 0); // cargando: no se desplaza
  reader_on_doc(&r, &DOC, 1);
  CHECK_EQ_INT(r.state, READER_SHOWING);
  CHECK_EQ_INT(r.top, 0);
  CHECK_EQ_INT(reader_scroll(&r, &DOC, -1), 0);   // no pasa del inicio
  CHECK_EQ_INT(reader_scroll(&r, &DOC, 1), 1);
  CHECK_EQ_INT(r.top, 1);
  CHECK_EQ_INT(reader_page(&r, &DOC, 1), 1);       // 13 filas (con el pie del modo): avanza 12
  CHECK_EQ_INT(r.top, 13);
  CHECK_EQ_INT(reader_page(&r, &DOC, 1), 1);
  CHECK_EQ_INT(r.top, 25);
  CHECK_EQ_INT(reader_page(&r, &DOC, 1), 1);
  CHECK_EQ_INT(r.top, 27);                          // 40 - 13 = 27: la última página llena
  CHECK_EQ_INT(reader_page(&r, &DOC, 1), 0);
  CHECK_EQ_INT(reader_scroll(&r, &DOC, 1), 0);
  CHECK_EQ_INT(reader_page(&r, &DOC, -1), 1);
  CHECK_EQ_INT(r.top, 15);
  int first, last, total;
  reader_position(&r, &DOC, &first, &last, &total);
  CHECK_EQ_INT(first, 16);
  CHECK_EQ_INT(last, 28);
  CHECK_EQ_INT(total, 40);

  // un documento corto cabe entero: no hay desplazamiento
  doc_make(&DOC, "s1", 5, 0, 0);
  reader_on_doc(&r, &DOC, 2);
  CHECK_EQ_INT(r.top, 0);
  CHECK_EQ_INT(reader_scroll(&r, &DOC, 3), 0);
  reader_position(&r, &DOC, &first, &last, &total);
  CHECK_EQ_INT(last, 5);

  // truncado: una línea más ("… sigue en el PC")
  doc_make(&DOC, "s1", 15, 1, 0); // 16 líneas con la de "sigue en el PC"; caben 13
  reader_on_doc(&r, &DOC, 3);
  reader_position(&r, &DOC, &first, &last, &total);
  CHECK_EQ_INT(total, 16);
  CHECK_EQ_INT(reader_scroll(&r, &DOC, 5), 1);
  CHECK_EQ_INT(r.top, 3);

  // con pregunta arriba caben menos líneas
  doc_make(&DOC, "s1", 30, 0, 3);
  reader_on_doc(&r, &DOC, 4);
  reader_page(&r, &DOC, 1);
  CHECK_EQ_INT(r.top, 10); // venía en 3 (tope del documento anterior); con 8 filas avanza 7
}

static void test_doc_matching(void) {
  Reader r;
  doc_make(&DOC, "otra", 3, 0, 0);
  reader_open(&r, "s1", 5, NULL);
  reader_on_doc(&r, &DOC, 5); // misma secuencia: es la respuesta anterior, no la que se pidió
  CHECK_EQ_INT(r.state, READER_LOADING);
  reader_on_doc(&r, &DOC, 6); // otra sesión: se ignora
  CHECK_EQ_INT(r.state, READER_LOADING);
  strcpy(DOC.session_id, "s1");
  reader_on_doc(&r, &DOC, 6);
  CHECK_EQ_INT(r.state, READER_SHOWING);
  reader_close(&r);
  CHECK(!reader_active(&r));
  reader_on_doc(&r, &DOC, 7); // cerrado: nada
  CHECK(!reader_active(&r));
}

static void test_stale_detection(void) {
  Reader r;
  view_detail(&V_DETAIL, "Listo el hero");
  reader_open(&r, "s1", 0, &V_DETAIL);
  CHECK(r.snap_known);
  reader_view_changed(&r, &V_DETAIL);
  CHECK(!r.stale);
  view_detail(&V_DETAIL2, "Otro mensaje distinto");
  reader_view_changed(&r, &V_DETAIL2);
  CHECK(r.stale);

  // si el detalle todavía no estaba al abrir, la primera vista que lo trae fija la foto sin avisar
  reader_open(&r, "s1", 0, &V_NO_DETAIL);
  CHECK(!r.snap_known);
  reader_view_changed(&r, &V_DETAIL);
  CHECK(r.snap_known && !r.stale);
  reader_view_changed(&r, &V_DETAIL);
  CHECK(!r.stale);
  reader_view_changed(&r, &V_DETAIL2);
  CHECK(r.stale);
}

// ---- input_logic.c: abrir, controles, cerrar ----

static void test_a_opens_only_in_detail(void) {
  H h;
  memset(&h, 0, sizeof h);
  input_init(&h.in);
  h.view = &V_DETAIL;
  InputActions acts;
  input_view_changed(&h.in, &V_DETAIL, "Claude", 0, &acts);
  relayout(&h);
  tap(&h, IN_KEY_A, 100); // agentes -> sesiones
  CHECK_EQ_INT(h.reads, 0);
  CHECK(!reader_active(&h.in.reader));
  tap(&h, IN_KEY_A, 200); // sesiones -> detalle
  CHECK_EQ_INT(h.reads, 0);
  CHECK(!reader_active(&h.in.reader));
  CHECK_EQ_INT(h.in.nav.level, NAV_DETAIL);
  tap(&h, IN_KEY_A, 300); // detalle: abre el lector
  CHECK_EQ_INT(h.reads, 1);
  CHECK_STR(h.last_read, "s1");
  CHECK_EQ_INT(h.in.reader.state, READER_LOADING);
}

static void test_read_zone_in_layout(void) {
  H h;
  h_in_detail(&h, &V_DETAIL);
  CHECK(h.lay.has_read);
  const Zone *z = layout_hit(&h.lay, CX(h.lay.btn_read), CY(h.lay.btn_read));
  CHECK(z != NULL && z->kind == ZONE_READ);
  CHECK(h.lay.btn_read.y >= h.lay.content.y && h.lay.btn_read.y + h.lay.btn_read.h <= h.lay.content.y + h.lay.content.h);
  CHECK(h.lay.btn_read.x + h.lay.btn_read.w <= LAYOUT_W && h.lay.btn_read.y + h.lay.btn_read.h <= LAYOUT_H);
  // tocar la franja abre el lector
  h_frame(&h, 400, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, CX(h.lay.btn_read), CY(h.lay.btn_read));
  h_frame(&h, 450, 0, IN_KEY_TOUCH, 0, 0, 0);
  CHECK_EQ_INT(h.reads, 1);
  CHECK_EQ_INT(h.in.reader.state, READER_LOADING);
  // con tarjeta no se ofrece
  h_view(&h, &V_CARD_DETAIL, 1000);
  CHECK(!h.lay.has_read);
  CHECK(layout_hit(&h.lay, CX(h.lay.btn_read), CY(h.lay.btn_read)) == NULL || layout_hit(&h.lay, CX(h.lay.btn_read), CY(h.lay.btn_read))->kind != ZONE_READ);
  // ni en agentes ni en sesiones
  memset(&h, 0, sizeof h);
  input_init(&h.in);
  h.view = &V_DETAIL;
  relayout(&h);
  CHECK(!h.lay.has_read);
}

static void test_controls(void) {
  H h;
  h_in_detail(&h, &V_DETAIL);
  doc_make(&DOC, "s1", 100, 0, 0);
  tap(&h, IN_KEY_A, 300);
  // cargando: las flechas no hacen nada y A no vuelve a pedir
  tap(&h, IN_KEY_DOWN, 320);
  CHECK_EQ_INT(h.in.reader.top, 0);
  tap(&h, IN_KEY_A, 340);
  CHECK_EQ_INT(h.reads, 1);
  reply(&h, &DOC);
  CHECK_EQ_INT(h.in.reader.state, READER_SHOWING);

  tap(&h, IN_KEY_DOWN, 400);
  CHECK_EQ_INT(h.in.reader.top, 1);
  tap(&h, IN_KEY_DOWN, 430);
  tap(&h, IN_KEY_UP, 460);
  CHECK_EQ_INT(h.in.reader.top, 1);
  tap(&h, IN_KEY_RIGHT, 500); // página
  CHECK_EQ_INT(h.in.reader.top, 13);
  tap(&h, IN_KEY_LEFT, 530);
  CHECK_EQ_INT(h.in.reader.top, 1);
  tap(&h, IN_KEY_R, 600); // L / R: página al soltar
  CHECK_EQ_INT(h.in.reader.top, 13);
  tap(&h, IN_KEY_L, 650);
  CHECK_EQ_INT(h.in.reader.top, 1);

  // el acorde L+R (diagnóstico) no pasa de página
  h_frame(&h, 700, IN_KEY_L | IN_KEY_R, 0, IN_KEY_L | IN_KEY_R, 0, 0);
  h_frame(&h, 800, 0, IN_KEY_L, IN_KEY_R, 0, 0);
  h_frame(&h, 830, 0, IN_KEY_R, 0, 0, 0);
  CHECK_EQ_INT(h.in.reader.top, 1);

  // nada de esto envió focus, decisiones, modo ni salto; Y se traga (X pide el resumen: ver test_mode_toggle)
  tap(&h, IN_KEY_Y, 950);
  CHECK_EQ_INT(h.modes, 0);
  CHECK_EQ_INT(h.decisions + h.focus + h.unfocus + h.skips, 0);
  CHECK_EQ_INT(h.reads, 1);

  // B vuelve al detalle: sin cerrar el enfoque
  tap(&h, IN_KEY_B, 1000);
  CHECK(!reader_active(&h.in.reader));
  CHECK_EQ_INT(h.in.nav.level, NAV_DETAIL);
  CHECK_EQ_INT(h.unfocus, 0);
  // otra B ya es la de siempre: un nivel atrás
  tap(&h, IN_KEY_B, 1100);
  CHECK_EQ_INT(h.in.nav.level, NAV_SESSIONS);
  CHECK_EQ_INT(h.unfocus, 1);
}

// ---- paso 5: completo / resumen ----

static void set_reader_default(View *v, int mode) {
  v->has_settings = 1;
  v->settings.reader_default = mode;
}

static void test_mode_toggle(void) {
  H h;
  h_in_detail(&h, &V_DETAIL);
  doc_make(&DOC, "s1", 100, 0, 0);
  tap(&h, IN_KEY_A, 300); // abre en completo (sin ajustes en la vista)
  CHECK_EQ_INT(h.reads, 1);
  CHECK_EQ_INT(h.last_read_mode, READ_MODE_FULL);
  // cargando: X no hace nada (no hay qué alternar)
  tap(&h, IN_KEY_X, 320);
  CHECK_EQ_INT(h.reads, 1);
  reply(&h, &DOC);
  tap(&h, IN_KEY_DOWN, 400);
  tap(&h, IN_KEY_DOWN, 430);
  CHECK_EQ_INT(h.in.reader.top, 2);

  // X: pide el resumen, vuelve a cargar y empieza arriba; no manda modo de permisos ni nada más
  tap(&h, IN_KEY_X, 500);
  CHECK_EQ_INT(h.reads, 2);
  CHECK_EQ_INT(h.last_read_mode, READ_MODE_SUMMARY);
  CHECK_STR(h.last_read, "s1");
  CHECK_EQ_INT(h.in.reader.state, READER_LOADING);
  CHECK_EQ_INT(h.in.reader.top, 0);
  CHECK_EQ_INT(h.modes, 0);
  CHECK_EQ_INT(h.decisions + h.focus + h.unfocus + h.skips, 0);
  // mientras carga X vuelve a no hacer nada
  tap(&h, IN_KEY_X, 520);
  CHECK_EQ_INT(h.reads, 2);

  // llega el resumen: la cabecera y el pie hablan del modo del documento
  doc_make(&DOC, "s1", 6, 0, 0);
  DOC.mode = READ_MODE_SUMMARY;
  reply(&h, &DOC);
  CHECK_EQ_INT(h.in.reader.state, READER_SHOWING);
  CHECK_EQ_INT(reader_shown_mode(&h.in.reader, &DOC), READ_MODE_SUMMARY);

  // X otra vez: de vuelta al completo
  tap(&h, IN_KEY_X, 600);
  CHECK_EQ_INT(h.reads, 3);
  CHECK_EQ_INT(h.last_read_mode, READ_MODE_FULL);
  CHECK_EQ_INT(h.in.reader.mode, READ_MODE_FULL);

  // tocar el pie hace lo mismo (un toque corto; un arrastre no)
  doc_make(&DOC, "s1", 100, 0, 0);
  reply(&h, &DOC);
  ReaderLayout l;
  reader_layout(0, 0, &l);
  CHECK(l.foot.h == READER_FOOT_H && l.foot.y + l.foot.h <= LAYOUT_H);
  h_frame(&h, 700, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, CX(l.foot), CY(l.foot));
  h_frame(&h, 720, 0, 0, IN_KEY_TOUCH, CX(l.foot), CY(l.foot) - 40);
  h_frame(&h, 740, 0, IN_KEY_TOUCH, 0, 0, 0);
  CHECK_EQ_INT(h.reads, 3);
  h_frame(&h, 800, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, CX(l.foot), CY(l.foot));
  h_frame(&h, 830, 0, IN_KEY_TOUCH, 0, 0, 0);
  CHECK_EQ_INT(h.reads, 4);
  CHECK_EQ_INT(h.last_read_mode, READ_MODE_SUMMARY);
  CHECK(reader_active(&h.in.reader));
}

static void test_mode_default_and_reload(void) {
  // el ajuste "Abrir mensajes en: resumen" abre el lector en resumen
  static View vs;
  view_detail(&vs, "Listo el hero");
  set_reader_default(&vs, READ_MODE_SUMMARY);
  H h;
  h_in_detail(&h, &vs);
  tap(&h, IN_KEY_A, 300);
  CHECK_EQ_INT(h.reads, 1);
  CHECK_EQ_INT(h.last_read_mode, READ_MODE_SUMMARY);
  CHECK_EQ_INT(h.in.reader.mode, READ_MODE_SUMMARY);
  doc_make(&DOC, "s1", 6, 0, 0);
  DOC.mode = READ_MODE_SUMMARY;
  reply(&h, &DOC);
  // X pasa al completo y A (mensaje nuevo) recarga en el modo que se estaba viendo
  tap(&h, IN_KEY_X, 400);
  CHECK_EQ_INT(h.last_read_mode, READ_MODE_FULL);
  doc_make(&DOC, "s1", 60, 0, 0);
  reply(&h, &DOC);
  view_detail(&V_DETAIL2, "Otro mensaje distinto");
  set_reader_default(&V_DETAIL2, READ_MODE_SUMMARY); // el ajuste no pisa lo que se ve ahora
  h_view(&h, &V_DETAIL2, 1000);
  CHECK(h.in.reader.stale);
  tap(&h, IN_KEY_A, 1100);
  CHECK_EQ_INT(h.reads, 3);
  CHECK_EQ_INT(h.last_read_mode, READ_MODE_FULL);
  CHECK_EQ_INT(h.in.reader.state, READER_LOADING);
  // y al revés: viendo el resumen, recargar pide el resumen
  doc_make(&DOC, "s1", 6, 0, 0);
  DOC.mode = READ_MODE_SUMMARY;
  reply(&h, &DOC);
  view_detail(&V_DETAIL, "Y otro mas");
  h_view(&h, &V_DETAIL, 2000);
  tap(&h, IN_KEY_X, 2100); // resumen -> completo
  doc_make(&DOC, "s1", 60, 0, 0);
  reply(&h, &DOC);
  tap(&h, IN_KEY_X, 2200); // completo -> resumen
  CHECK_EQ_INT(h.last_read_mode, READ_MODE_SUMMARY);
  doc_make(&DOC, "s1", 6, 0, 0);
  DOC.mode = READ_MODE_SUMMARY;
  reply(&h, &DOC);
  view_detail(&V_DETAIL2, "Mensaje cuarto");
  h_view(&h, &V_DETAIL2, 3000);
  int before = h.reads;
  tap(&h, IN_KEY_A, 3100);
  CHECK_EQ_INT(h.reads, before + 1);
  CHECK_EQ_INT(h.last_read_mode, READ_MODE_SUMMARY);
}

static void test_mode_with_old_bridge(void) {
  // un puente anterior no manda mode: el documento cuenta como completo aunque se haya pedido el resumen, y X ofrece el resumen
  static View vs;
  view_detail(&vs, "Listo el hero");
  set_reader_default(&vs, READ_MODE_SUMMARY);
  H h;
  h_in_detail(&h, &vs);
  tap(&h, IN_KEY_A, 300);
  doc_make(&DOC, "s1", 20, 0, 0); // mode = completo por defecto
  reply(&h, &DOC);
  CHECK_EQ_INT(reader_shown_mode(&h.in.reader, &DOC), READ_MODE_FULL);
  tap(&h, IN_KEY_X, 400);
  CHECK_EQ_INT(h.last_read_mode, READ_MODE_SUMMARY);
}

static void test_mode_never_touches_cards(void) {
  // con una tarjeta de permiso el lector se cierra y X no pide nada: A aprueba como siempre
  H h;
  h_in_detail(&h, &V_DETAIL);
  doc_make(&DOC, "s1", 30, 0, 0);
  tap(&h, IN_KEY_A, 300);
  reply(&h, &DOC);
  view_card(&V_CARD_DETAIL, 1);
  h_view(&h, &V_CARD_DETAIL, 1000);
  CHECK(!reader_active(&h.in.reader));
  int before = h.reads;
  tap(&h, IN_KEY_X, 1100);
  CHECK_EQ_INT(h.reads, before);
  CHECK_EQ_INT(h.modes, 1); // X con una tarjeta sigue siendo el modo de permisos de siempre, no el del lector
}

static void test_pen(void) {
  H h;
  h_in_detail(&h, &V_DETAIL);
  doc_make(&DOC, "s1", 100, 0, 0);
  tap(&h, IN_KEY_A, 300);
  reply(&h, &DOC);
  ReaderLayout l;
  reader_layout(0, 0, &l);

  // arrastrar hacia arriba 3 líneas: el texto sube (top aumenta)
  h_frame(&h, 400, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, 150, 200);
  h_frame(&h, 420, 0, 0, IN_KEY_TOUCH, 150, 200 - READER_ROW_H);
  h_frame(&h, 440, 0, 0, IN_KEY_TOUCH, 150, 200 - 3 * READER_ROW_H);
  h_frame(&h, 460, 0, IN_KEY_TOUCH, 0, 0, 0);
  CHECK_EQ_INT(h.in.reader.top, 3);
  // hacia abajo: vuelve (se acumulan los píxeles sobrantes)
  h_frame(&h, 500, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, 150, 100);
  h_frame(&h, 520, 0, 0, IN_KEY_TOUCH, 150, 100 + 7);
  h_frame(&h, 540, 0, 0, IN_KEY_TOUCH, 150, 100 + 15);
  h_frame(&h, 560, 0, IN_KEY_TOUCH, 0, 0, 0);
  CHECK_EQ_INT(h.in.reader.top, 2);
  CHECK(reader_active(&h.in.reader));
  // un arrastre largo sobre "B Volver" no cierra
  h_frame(&h, 600, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, CX(l.back_btn), CY(l.back_btn));
  h_frame(&h, 620, 0, 0, IN_KEY_TOUCH, CX(l.back_btn), CY(l.back_btn) + 40);
  h_frame(&h, 640, 0, IN_KEY_TOUCH, 0, 0, 0);
  CHECK(reader_active(&h.in.reader));
  // un toque corto sí
  h_frame(&h, 700, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, CX(l.back_btn), CY(l.back_btn));
  h_frame(&h, 730, 0, IN_KEY_TOUCH, 0, 0, 0);
  CHECK(!reader_active(&h.in.reader));
  CHECK_EQ_INT(h.in.nav.level, NAV_DETAIL);
}

static void test_stale_reload(void) {
  H h;
  h_in_detail(&h, &V_DETAIL);
  doc_make(&DOC, "s1", 50, 0, 0);
  tap(&h, IN_KEY_A, 300);
  reply(&h, &DOC);
  tap(&h, IN_KEY_DOWN, 400);
  CHECK_EQ_INT(h.in.reader.top, 1);
  // llega un mensaje nuevo: no salta, solo avisa
  h_view(&h, &V_DETAIL2, 1000);
  CHECK(reader_active(&h.in.reader));
  CHECK(h.in.reader.stale);
  CHECK_EQ_INT(h.in.reader.top, 1);
  CHECK_EQ_INT(h.reads, 1);
  // A recarga: foto nueva, vuelve a cargar y empieza arriba
  tap(&h, IN_KEY_A, 1100);
  CHECK_EQ_INT(h.reads, 2);
  CHECK_EQ_INT(h.in.reader.state, READER_LOADING);
  CHECK(!h.in.reader.stale);
  reply(&h, &DOC);
  CHECK_EQ_INT(h.in.reader.top, 0);
  // tocar el aviso también recarga
  h_view(&h, &V_DETAIL, 2000);
  CHECK(h.in.reader.stale);
  ReaderLayout l;
  reader_layout(0, 1, &l);
  h_frame(&h, 2100, IN_KEY_TOUCH, 0, IN_KEY_TOUCH, CX(l.stale), CY(l.stale));
  h_frame(&h, 2130, 0, IN_KEY_TOUCH, 0, 0, 0);
  CHECK_EQ_INT(h.reads, 3);
}

// ---- seguridad: la tarjeta de permiso manda siempre ----

static void test_card_closes_reader_and_approve_works(void) {
  H h;
  h_in_detail(&h, &V_DETAIL);
  doc_make(&DOC, "s1", 50, 0, 0);
  tap(&h, IN_KEY_A, 300);
  reply(&h, &DOC);
  CHECK(reader_active(&h.in.reader));
  // dentro del lector A y B no deciden nada
  tap(&h, IN_KEY_A, 400);
  tap(&h, IN_KEY_B, 500); // cierra el lector; no rechaza
  CHECK_EQ_INT(h.decisions, 0);
  tap(&h, IN_KEY_A, 600); // otra vez
  reply(&h, &DOC);
  CHECK(reader_active(&h.in.reader));

  // llega una tarjeta: el lector se cierra en el acto
  h_view(&h, &V_CARD_DETAIL, 2000);
  CHECK(!reader_active(&h.in.reader));
  CHECK_EQ_INT(h.in.nav.level, NAV_DETAIL);
  CHECK_EQ_INT(h.decisions, 0);
  // la guarda de 500 ms sigue valiendo para aprobar, igual que sin lector
  tap(&h, IN_KEY_A, 2100);
  CHECK_EQ_INT(h.decisions, 0);
  tap(&h, IN_KEY_A, 2600);
  CHECK_EQ_INT(h.decisions, 1);
  CHECK_EQ_INT(h.last_decision, 1);
}

static void test_card_closes_reader_and_deny_works(void) {
  H h;
  h_in_detail(&h, &V_DETAIL);
  doc_make(&DOC, "s1", 50, 0, 0);
  tap(&h, IN_KEY_A, 300);
  reply(&h, &DOC);
  h_view(&h, &V_CARD_DETAIL, 2000);
  CHECK(!reader_active(&h.in.reader));
  tap(&h, IN_KEY_B, 2010); // rechazar no tiene guarda
  CHECK_EQ_INT(h.decisions, 1);
  CHECK_EQ_INT(h.last_decision, 0);
  CHECK_EQ_INT(h.in.nav.level, NAV_DETAIL); // B rechazó; no volvió ni cerró nada más
  CHECK_EQ_INT(h.unfocus, 0);
}

static void test_card_in_same_frame_as_keypress(void) {
  // la vista con tarjeta llega y, en el mismo cuadro, ya hay una pulsación: nunca la atiende el lector
  H h;
  h_in_detail(&h, &V_DETAIL);
  doc_make(&DOC, "s1", 50, 0, 0);
  tap(&h, IN_KEY_A, 300);
  reply(&h, &DOC);
  h.view = &V_CARD_DETAIL; // la vista viva ya trae tarjeta, pero input_view_changed aún no corrió
  relayout(&h);
  tap(&h, IN_KEY_DOWN, 500);
  CHECK(!reader_active(&h.in.reader)); // input_frame lo cerró por su cuenta
  CHECK_EQ_INT(h.decisions, 0);
}

static void test_card_while_loading(void) {
  H h;
  h_in_detail(&h, &V_DETAIL);
  tap(&h, IN_KEY_A, 300);
  CHECK_EQ_INT(h.in.reader.state, READER_LOADING);
  h_view(&h, &V_CARD_DETAIL, 400);
  CHECK(!reader_active(&h.in.reader));
  // la respuesta que llega después no reabre nada
  doc_make(&DOC, "s1", 5, 0, 0);
  reply(&h, &DOC);
  CHECK(!reader_active(&h.in.reader));
}

static void test_a_with_card_never_opens(void) {
  H h;
  h_in_detail(&h, &V_DETAIL);
  h_view(&h, &V_CARD_DETAIL, 1000);
  tap(&h, IN_KEY_A, 1100);
  CHECK_EQ_INT(h.reads, 0);
  CHECK(!reader_active(&h.in.reader));
  tap(&h, IN_KEY_A, 1700); // aprueba, no abre
  CHECK_EQ_INT(h.reads, 0);
  CHECK_EQ_INT(h.decisions, 1);
}

// ---- cierres ----

static void test_closes_on_nav_change_and_session_end(void) {
  H h;
  h_in_detail(&h, &V_DETAIL);
  doc_make(&DOC, "s1", 50, 0, 0);
  tap(&h, IN_KEY_A, 300);
  reply(&h, &DOC);
  // el puente ya no tiene este enfoque (otro cliente lo quitó): nav vuelve a sesiones y el lector se cierra
  h_view(&h, &V_DETAIL, 400); // detalle presente: confirma
  h_view(&h, &V_NO_DETAIL, 500);
  CHECK_EQ_INT(h.in.nav.level, NAV_SESSIONS);
  CHECK(!reader_active(&h.in.reader));

  h_in_detail(&h, &V_DETAIL);
  tap(&h, IN_KEY_A, 300);
  input_session_end(&h.in);
  CHECK(!reader_active(&h.in.reader));
}

static void test_send_failure_closes(void) {
  H h;
  h_in_detail(&h, &V_DETAIL);
  h.send_fails = 1;
  tap(&h, IN_KEY_A, 300);
  CHECK_EQ_INT(h.reads, 1);
  CHECK(!reader_active(&h.in.reader));
}

static void test_overlays_swallow_input(void) {
  H h;
  h_in_detail(&h, &V_DETAIL);
  doc_make(&DOC, "s1", 50, 0, 0);
  tap(&h, IN_KEY_A, 300);
  reply(&h, &DOC);

  // el menú (SELECT) se abre encima: B lo cierra a él, no al lector; la cruceta mueve el cursor del menú, no el lector
  tap(&h, IN_KEY_SELECT, 400);
  CHECK(h.in.menu.open);
  tap(&h, IN_KEY_DOWN, 450);
  CHECK_EQ_INT(h.in.reader.top, 0);
  CHECK_EQ_INT(h.in.menu.cursor, 1);
  tap(&h, IN_KEY_B, 500);
  CHECK(!h.in.menu.open);
  CHECK(reader_active(&h.in.reader));

  // el diagnóstico (L+R 1 s) lo tapa: se traga B y la cruceta
  h_frame(&h, 600, IN_KEY_L | IN_KEY_R, 0, IN_KEY_L | IN_KEY_R, 0, 0);
  h_frame(&h, 1700, 0, 0, IN_KEY_L | IN_KEY_R, 0, 0);
  CHECK(h.in.diag_on);
  tap(&h, IN_KEY_DOWN, 1800);
  tap(&h, IN_KEY_B, 1900);
  CHECK(reader_active(&h.in.reader));
  CHECK_EQ_INT(h.in.reader.top, 0);
}

static void test_other_session_doc_and_reuse(void) {
  H h;
  h_in_detail(&h, &V_DETAIL);
  tap(&h, IN_KEY_A, 300);
  doc_make(&DOC, "otra", 10, 0, 0);
  reply(&h, &DOC);
  CHECK_EQ_INT(h.in.reader.state, READER_LOADING); // la respuesta de otra sesión no cuenta
  doc_make(&DOC, "s1", 10, 0, 0);
  reply(&h, &DOC);
  CHECK_EQ_INT(h.in.reader.state, READER_SHOWING);
  // cerrar y abrir de nuevo empieza de cero
  tap(&h, IN_KEY_DOWN, 400);
  tap(&h, IN_KEY_B, 500);
  tap(&h, IN_KEY_A, 600);
  CHECK_EQ_INT(h.reads, 2);
  CHECK_EQ_INT(h.in.reader.top, 0);
  CHECK_EQ_INT(h.in.reader.state, READER_LOADING);
}

int main(void) {
  TEST_BEGIN("reader: lector del mensaje completo (estado, controles y cierre ante una tarjeta de permiso)");
  view_detail(&V_DETAIL, "Listo el hero");
  view_detail(&V_DETAIL2, "Otro mensaje distinto");
  view_card(&V_CARD, 0);
  view_card(&V_CARD_DETAIL, 1);
  view_base(&V_NO_DETAIL);
  RUN(test_layout);
  RUN(test_scroll_and_pages);
  RUN(test_doc_matching);
  RUN(test_stale_detection);
  RUN(test_a_opens_only_in_detail);
  RUN(test_read_zone_in_layout);
  RUN(test_controls);
  RUN(test_mode_toggle);
  RUN(test_mode_default_and_reload);
  RUN(test_mode_with_old_bridge);
  RUN(test_mode_never_touches_cards);
  RUN(test_pen);
  RUN(test_stale_reload);
  RUN(test_card_closes_reader_and_approve_works);
  RUN(test_card_closes_reader_and_deny_works);
  RUN(test_card_in_same_frame_as_keypress);
  RUN(test_card_while_loading);
  RUN(test_a_with_card_never_opens);
  RUN(test_closes_on_nav_change_and_session_end);
  RUN(test_send_failure_closes);
  RUN(test_overlays_swallow_input);
  RUN(test_other_session_doc_and_reuse);
  TEST_END();
}

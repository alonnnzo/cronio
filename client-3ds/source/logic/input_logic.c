#include "input_logic.h"

#include <string.h>

#include "../core/sha256.h"

// ---------- acciones ----------

static void push(InputActions *o, InputActionKind kind, const char *id, int flag) {
  if (o->n >= INPUT_MAX_ACTIONS) return;
  InputAction *a = &o->a[o->n++];
  memset(a, 0, sizeof *a);
  a->kind = kind;
  a->flag = flag;
  if (id != NULL) {
    size_t n = strlen(id);
    if (n > VIEW_MAX_ID) n = VIEW_MAX_ID;
    memcpy(a->id, id, n);
  }
}

static void push_nav(InputActions *o, NavOut n) {
  if (n.kind == NAV_OUT_FOCUS) push(o, IN_ACT_FOCUS, n.session_id, 0);
  else if (n.kind == NAV_OUT_UNFOCUS) push(o, IN_ACT_UNFOCUS, NULL, 0);
}

// Una sola decisión por tanda: la segunda se descarta (el envío de la primera todavía no marcó nada).
static void push_decision(InputActions *o, const char *id, int flag) {
  for (int i = 0; i < o->n; i++) {
    if (o->a[i].kind == IN_ACT_DECISION) return;
  }
  push(o, IN_ACT_DECISION, id, flag);
}

// Aprobación que acaba de salir de la máquina de estados: 1 aprobar, 2 aprobar y no volver a preguntar.
static int approve_flag(const InputLogic *in) { return approve_emitted_always(&in->approve) ? 2 : 1; }

// "Visto": una por tanda, como las decisiones.
static void push_ack(InputActions *o, const char *id) {
  for (int i = 0; i < o->n; i++) {
    if (o->a[i].kind == IN_ACT_ACK) return;
  }
  push(o, IN_ACT_ACK, id, 0);
}

// La tarjeta visible ofrece "no volver a preguntar".
static int offers_always(const View *v) { return view_has_permission_card(v) && v->request.has_always; }

// ---------- rechazar ----------

// Guarda la identidad de lo mostrado (la misma llave que aprobar). 0 si no hay tarjeta.
static int capture_key(const InputLogic *in, const View *v, uint8_t key[SHA256_DIGEST_LEN]) {
  if (!view_has_permission_card(v)) return 0;
  return approve_shown_key(&in->approve, key);
}

// Rechaza solo si lo mostrado ahora es lo mismo que al empezar el gesto. Sin guarda de 500 ms: rechazar es seguro.
static void try_deny(const InputLogic *in, const uint8_t key[SHA256_DIGEST_LEN], const View *v, InputActions *out) {
  uint8_t cur[SHA256_DIGEST_LEN];
  if (!view_has_permission_card(v) || !in->approve.connected) return;
  if (!approve_shown_key(&in->approve, cur) || !ct_equal(cur, key, sizeof cur)) return;
  if (strcmp(in->approve.shown_id, v->request.id) != 0) return;
  if (approve_is_decided(&in->approve, v->request.id)) return;
  push_decision(out, v->request.id, 0);
}

// ---------- navegación ----------

static void do_enter(InputLogic *in, const View *v, int index, uint64_t now, InputActions *out) {
  push_nav(out, nav_enter(&in->nav, v, index, now));
}

static void do_back(InputLogic *in, const View *v, InputActions *out) { push_nav(out, nav_back(&in->nav, v)); }

// ---------- lápiz ----------

static void start_reading(InputLogic *in, const InputFrame *f, InputActions *out);
static void open_notice_reader(InputLogic *in, const InputFrame *f, InputActions *out);
static void cycle_notify(InputLogic *in, const View *v, InputActions *out);

// ¿Se puede escribirle a la sesión del detalle abierto? Sin tarjeta (ni de permiso, ni de aviso) y solo si el puente ofrece instrucciones
// por texto (manda `instructWaitMax`). Con una tarjeta a la vista manda la tarjeta.
static int detail_instruct_ok(const InputLogic *in, const View *v) {
  return v != NULL && !v->has_request && !view_has_notice_card(v) && in->nav.level == NAV_DETAIL && in->nav.session_id[0] != '\0' &&
         v->has_detail && strcmp(v->detail.session_id, in->nav.session_id) == 0 && v->has_settings && v->settings.has_instruct_wait;
}

static void touch_down(InputLogic *in, const InputFrame *f) {
  in->pen_active = 1;
  in->pen_on_approve = 0;
  in->pen_always = 0;
  in->pen_on_ack = 0;
  in->deny_pen_armed = 0;
  in->pen_x = f->touch_x;
  in->pen_y = f->touch_y;
  const Zone *z = (f->view != NULL && !in->diag_on && f->layout != NULL) ? layout_hit(f->layout, f->touch_x, f->touch_y) : NULL;
  in->pen_zone_valid = z != NULL;
  if (z == NULL) return;
  in->pen_kind = z->kind;
  in->pen_index = z->index;
  if (z->kind == ZONE_APPROVE || z->kind == ZONE_ALWAYS) {
    in->pen_on_approve = 1;
    in->pen_always = z->kind == ZONE_ALWAYS;
    if (in->pen_always) approve_down_always(&in->approve, f->now, APPROVE_SRC_POINTER, 0);
    else approve_down(&in->approve, f->now, APPROVE_SRC_POINTER, 0);
  } else if (z->kind == ZONE_DENY) {
    in->deny_pen_armed = capture_key(in, f->view, in->deny_pen_key);
  } else if (z->kind == ZONE_ACK) {
    in->pen_on_ack = 1;
    approve_down(&in->ack, f->now, APPROVE_SRC_POINTER, 0);
  }
}

static void touch_held(InputLogic *in, const InputFrame *f) {
  in->pen_x = f->touch_x;
  in->pen_y = f->touch_y;
  if (in->pen_on_approve && f->layout != NULL &&
      !rect_contains(in->pen_always ? &f->layout->btn_always : &f->layout->btn_approve, f->touch_x, f->touch_y)) {
    approve_cancel_source(&in->approve, APPROVE_SRC_POINTER); // el lápiz salió del botón; un gesto del botón físico sigue
    in->pen_on_approve = 0;
  }
  if (in->pen_on_ack && f->layout != NULL && !rect_contains(&f->layout->btn_ack, f->touch_x, f->touch_y)) {
    approve_cancel_source(&in->ack, APPROVE_SRC_POINTER);
    in->pen_on_ack = 0;
  }
}

static void touch_up(InputLogic *in, const InputFrame *f, InputActions *out) {
  int was_active = in->pen_active, on_approve = in->pen_on_approve, zone_valid = in->pen_zone_valid;
  int always = in->pen_always;
  int deny_armed = in->deny_pen_armed;
  int on_ack = in->pen_on_ack;
  ZoneKind kind = in->pen_kind;
  int index = in->pen_index, x = in->pen_x, y = in->pen_y;
  in->pen_active = in->pen_on_approve = in->pen_zone_valid = in->deny_pen_armed = in->pen_on_ack = 0;
  if (!was_active || f->layout == NULL) return;
  if (on_ack) {
    char id[VIEW_ID_BYTES];
    if (rect_contains(&f->layout->btn_ack, x, y) && approve_up(&in->ack, f->now, APPROVE_SRC_POINTER, id)) push_ack(out, id);
    else approve_cancel_source(&in->ack, APPROVE_SRC_POINTER);
    return;
  }
  if (on_approve) {
    char id[VIEW_ID_BYTES];
    const Rect *btn = always ? &f->layout->btn_always : &f->layout->btn_approve;
    int sent = rect_contains(btn, x, y) && (always ? approve_up_always(&in->approve, f->now, APPROVE_SRC_POINTER, id)
                                                   : approve_up(&in->approve, f->now, APPROVE_SRC_POINTER, id));
    if (sent) {
      push_decision(out, id, approve_flag(in));
    } else {
      approve_cancel_source(&in->approve, APPROVE_SRC_POINTER);
    }
    return;
  }
  if (!zone_valid || f->view == NULL) return;
  const Zone *z = layout_hit(f->layout, x, y);
  if (z == NULL || z->kind != kind || z->index != index) return; // soltó en otro sitio
  switch (z->kind) {
    case ZONE_ITEM: do_enter(in, f->view, z->index, f->now, out); break;
    case ZONE_BACK: do_back(in, f->view, out); break;
    case ZONE_MODE: push(out, IN_ACT_MODE, NULL, nav_mode_target_manual(f->view)); break;
    case ZONE_DENY:
      if (deny_armed) try_deny(in, in->deny_pen_key, f->view, out);
      break;
    case ZONE_SKIP_PREV:
    case ZONE_SKIP_NEXT:
      if (nav_skip_wanted(f->view)) push(out, IN_ACT_SKIP, NULL, 0);
      else if (view_has_notice_card(f->view) && f->view->notice.total > 1) push(out, IN_ACT_SKIP_NOTICE, NULL, 0);
      break;
    case ZONE_READ: start_reading(in, f, out); break;
    case ZONE_NOTICE_READ: open_notice_reader(in, f, out); break;
    case ZONE_NOTIFY: cycle_notify(in, f->view, out); break;
    case ZONE_INSTRUCT:
      if (detail_instruct_ok(in, f->view)) push(out, IN_ACT_INSTRUCT_WRITE, in->nav.session_id, 0);
      break;
    case ZONE_WAIT:
      if (detail_instruct_ok(in, f->view)) push(out, IN_ACT_SESSION_WAIT, in->nav.session_id, !f->view->detail.wait_for_me);
      break;
    case ZONE_CLEAR:
      if (detail_instruct_ok(in, f->view) && f->view->detail.instr_count > 0) push(out, IN_ACT_INSTRUCT_CLEAR, in->nav.session_id, 0);
      break;
    case ZONE_ACK:
    case ZONE_APPROVE:
    case ZONE_ALWAYS: break;
  }
}

// ---------- cuadro ----------

static void drop_gestures(InputLogic *in, uint64_t now);

// ---------- lector del mensaje completo ----------

// Modo en que abre el lector: el ajuste readerDefault del puente (completo si no manda ajustes).
static int default_read_mode(const View *v) { return v != NULL && v->has_settings && v->settings.reader_default ? READ_MODE_SUMMARY : READ_MODE_FULL; }

// Abre (o recarga) el lector del detalle abierto. Solo en el detalle y sin tarjeta: con tarjeta, A es aprobar.
static void start_reading(InputLogic *in, const InputFrame *f, InputActions *out) {
  const View *v = f->view;
  // con una tarjeta de aviso A la marca "Visto": se lee con "Leer todo" de la tarjeta (open_notice_reader)
  if (v == NULL || v->has_request || view_has_notice_card(v) || in->nav.level != NAV_DETAIL || in->nav.session_id[0] == '\0') return;
  int mode = default_read_mode(v);
  reader_open(&in->reader, in->nav.session_id, f->read_seq, v);
  in->reader.mode = mode;
  in->pen_active = in->pen_on_approve = in->pen_zone_valid = in->deny_pen_armed = in->pen_always = in->pen_on_ack = 0;
  push(out, IN_ACT_READ, in->nav.session_id, mode);
}

// Recarga el lector abierto (llegó un mensaje nuevo) o cambia de modo (X): foto nueva, desde arriba. Vale también para el abierto
// con "Leer todo" de un aviso, que start_reading no podría abrir con la tarjeta a la vista. `mode` es el que se pide; con -1 se
// conserva el que se estaba viendo (recargar no cambia de modo).
static void reload_reading(InputLogic *in, const InputFrame *f, InputActions *out, int mode) {
  const View *v = f->view;
  if (v == NULL || v->has_request || in->nav.level != NAV_DETAIL || in->nav.session_id[0] == '\0') return;
  int from_notice = in->reader.from_notice;
  if (mode < 0) mode = reader_shown_mode(&in->reader, f->doc);
  reader_open(&in->reader, in->nav.session_id, f->read_seq, v);
  in->reader.from_notice = from_notice;
  in->reader.mode = mode;
  in->pen_active = in->pen_on_approve = in->pen_zone_valid = in->deny_pen_armed = in->pen_always = in->pen_on_ack = 0;
  push(out, IN_ACT_READ, in->nav.session_id, mode);
}

// "Leer todo" de la tarjeta de aviso: abre el detalle de esa sesión y su lector. El aviso sigue ahí: B vuelve a él.
static void open_notice_reader(InputLogic *in, const InputFrame *f, InputActions *out) {
  const View *v = f->view;
  if (!view_has_notice_card(v) || reader_active(&in->reader)) return;
  const SessionView *s = view_find_session(v, v->notice.session_id);
  if (s == NULL || view_agent_hidden(v, s->kind)) return;
  push_nav(out, nav_open_session(&in->nav, v, s->id, f->now));
  int mode = default_read_mode(v);
  reader_open(&in->reader, s->id, f->read_seq, v);
  in->reader.from_notice = 1;
  in->reader.mode = mode;
  in->pen_active = in->pen_on_approve = in->pen_zone_valid = in->deny_pen_armed = in->pen_always = in->pen_on_ack = 0;
  push(out, IN_ACT_READ, s->id, mode);
}

// Y (o la franja del detalle): siguiente modo de aviso de la sesión abierta. Solo si el puente manda su modo y no hay un
// permiso a la vista (con permiso Y es "no volver a preguntar").
static void cycle_notify(InputLogic *in, const View *v, InputActions *out) {
  if (v == NULL || v->has_request || in->nav.level != NAV_DETAIL || in->nav.session_id[0] == '\0') return;
  if (!v->has_detail || !v->detail.has_notify || strcmp(v->detail.session_id, in->nav.session_id) != 0) return;
  push(out, IN_ACT_SESSION_NOTIFY, in->nav.session_id, ((int)v->detail.notify + 1) % NOTIFY_COUNT);
}

// El lector solo existe mientras el detalle de su sesión está abierto y no hay tarjeta de permiso.
static int reader_must_close(const InputLogic *in, const View *v) {
  if (v == NULL || v->has_request || in->nav.level != NAV_DETAIL || strcmp(in->nav.session_id, in->reader.session_id) != 0) return 1;
  // un aviso cierra el lector (como un permiso), salvo el que se abrió justamente con "Leer todo" de ese aviso
  return view_has_notice_card(v) && !in->reader.from_notice;
}

void input_init(InputLogic *in) {
  memset(in, 0, sizeof *in);
  nav_init(&in->nav);
  reader_init(&in->reader);
  update_init(&in->update, "", 0);
  menu_init(&in->menu);
  question_init(&in->question);
  instruct_init(&in->instruct);
  in->i_pen_row = -1;
  approve_init(&in->approve);
  approve_init(&in->ack);
}

void input_set_app(InputLogic *in, const char *version, int is_cia) { update_init(&in->update, version, is_cia); }

// Y abre el teclado del código solo sin vista (sin conexión o sin emparejar): ahí no hay tarjeta ni nada que se pueda
// pulsar por error. Con conexión, el código se pide desde la guía (SELECT, última página).
int input_settings_allowed(const InputLogic *in, const View *v) {
  (void)in;
  return v == NULL;
}

// L + R juntos 1 s alternan el diagnóstico. L o R solos saltan al soltar, salvo que en esa pulsación se hayan visto
// juntos (así el atajo no salta).
static void lr_logic(InputLogic *in, const InputFrame *f, InputActions *out, int notice_skip_ok) {
  int l = (f->held & IN_KEY_L) != 0, r = (f->held & IN_KEY_R) != 0;
  if (l && r) {
    if (!in->lr_chord) {
      in->lr_chord = 1;
      in->lr_fired = 0;
      in->lr_since = f->now;
    } else if (!in->lr_fired && (int64_t)f->now - (int64_t)in->lr_since >= INPUT_DIAG_HOLD_MS) {
      in->diag_on = !in->diag_on;
      drop_gestures(in, f->now); // el diagnóstico tapa o destapa la tarjeta: sin gestos en curso y guarda de 500 ms de nuevo
      in->lr_fired = 1;
    }
  }
  if ((f->up & (IN_KEY_L | IN_KEY_R)) && !in->lr_chord && !in->diag_on && f->view != NULL) {
    if (nav_skip_wanted(f->view)) push(out, IN_ACT_SKIP, NULL, 0);
    else if (notice_skip_ok && view_has_notice_card(f->view) && f->view->notice.total > 1) push(out, IN_ACT_SKIP_NOTICE, NULL, 0);
  }
  if (!l && !r) in->lr_chord = 0;
}

// ---------- guía ----------

// Abrir o cerrar la guía o el diagnóstico deja todo gesto en curso anulado y reinicia la guarda de 500 ms: lo que se
// pulsó antes no debe actuar sobre la app de debajo, y la tarjeta tapada no se ha visto.
static void drop_gestures(InputLogic *in, uint64_t now) {
  approve_uncovered(&in->approve, now);
  approve_uncovered(&in->ack, now);
  in->pen_active = in->pen_on_approve = in->pen_zone_valid = in->deny_pen_armed = in->pen_always = in->pen_on_ack = 0;
  in->deny_btn_armed = 0;
  in->lr_chord = 1; // L o R sostenidos en este momento no saltan al soltarse
}

// Con la guía abierta las entradas no llegan a la app: solo cambian de página, cierran, piden la IP (X) o el código (Y) en su página.
static void guide_frame(InputLogic *in, const InputFrame *f, InputActions *out) {
  Guide *g = &in->guide;
  if (f->down & (IN_KEY_SELECT | IN_KEY_B)) {
    guide_close(g);
    drop_gestures(in, f->now);
    return;
  }
  if (f->rep & IN_KEY_LEFT) guide_move(g, -1);
  if (f->rep & IN_KEY_RIGHT) guide_move(g, 1);
  if (f->down & IN_KEY_TOUCH) guide_move(g, guide_hit_arrow(f->touch_x, f->touch_y));
  if ((f->down & IN_KEY_X) && guide_ip_here(g)) {
    guide_close(g);
    menu_close(&in->menu);
    drop_gestures(in, f->now);
    push(out, IN_ACT_MANUAL_IP, NULL, 0);
  } else if ((f->down & IN_KEY_Y) && guide_ip_here(g)) { // misma página: Y pide el código de emparejamiento
    guide_close(g);
    menu_close(&in->menu);
    drop_gestures(in, f->now);
    push(out, IN_ACT_PAIR_CODE, NULL, 0);
  }
}

// ---------- menú de configuración ----------

// El menú solo existe sin tarjeta de permiso: apenas aparece una se cierra (con la guía que abrió) y la tarjeta manda.
// Lo mismo con una tarjeta de aviso: primero se marca "Visto".
static int menu_must_close(const View *v) { return v != NULL && (v->has_request || view_has_notice_card(v)); }

static void menu_act(InputLogic *in, const InputFrame *f, MenuOut o, InputActions *out) {
  switch (o.kind) {
    case MENU_OUT_NONE: break;
    case MENU_OUT_NOTIFY: push(out, IN_ACT_SETTING_NOTIFY, NULL, o.value); break;
    case MENU_OUT_ACK: push(out, IN_ACT_SETTING_ACK, NULL, o.value); break;
    case MENU_OUT_SOUND: push(out, IN_ACT_SETTING_SOUND, NULL, o.value); break;
    case MENU_OUT_QUESTIONS: push(out, IN_ACT_SETTING_QUESTIONS, NULL, o.value); break;
    case MENU_OUT_READER: push(out, IN_ACT_SETTING_READER, NULL, o.value); break;
    case MENU_OUT_INSTRUCT_WAIT: push(out, IN_ACT_SETTING_INSTRUCT_WAIT, NULL, o.value); break;
    case MENU_OUT_HIDDEN: push(out, IN_ACT_SETTING_HIDDEN, NULL, o.value); break;
    case MENU_OUT_THEME: push(out, IN_ACT_THEME, NULL, o.value); break;
    case MENU_OUT_GUIDE:
      guide_open(&in->guide); // encima del menú: al cerrarla se vuelve aquí
      drop_gestures(in, f->now);
      break;
    case MENU_OUT_DIAG:
      in->diag_on = !in->diag_on; // lo mismo que L+R 1 s
      drop_gestures(in, f->now);
      break;
    case MENU_OUT_UPDATE:
      update_open_page(&in->update, f->now); // encima del menú: al cerrarla se vuelve aquí
      drop_gestures(in, f->now);
      break;
    case MENU_OUT_CLOSE:
      menu_close(&in->menu);
      drop_gestures(in, f->now);
      break;
  }
}

// Con el menú abierto (y sin tarjeta) las entradas son suyas; lo que no usa se traga. Solo se mantiene el acorde L+R.
static void menu_frame(InputLogic *in, const InputFrame *f, InputActions *out) {
  Menu *m = &in->menu;
  if (f->down & IN_KEY_B) menu_act(in, f, menu_back(m), out);
  if (m->open) {
    int dy = ((f->rep & IN_KEY_DOWN) ? 1 : 0) - ((f->rep & IN_KEY_UP) ? 1 : 0);
    if (dy != 0) menu_move(m, dy);
  }
  if (m->open && (f->down & IN_KEY_A)) menu_act(in, f, menu_activate(m, f->view, 1, 0), out);
  if (m->open) {
    int dx = ((f->down & IN_KEY_RIGHT) ? 1 : 0) - ((f->down & IN_KEY_LEFT) ? 1 : 0);
    if (dx != 0) menu_act(in, f, menu_activate(m, f->view, dx, 1), out);
  }
  if (m->open && (f->down & IN_KEY_TOUCH)) {
    if (menu_hit_back(m->level, f->touch_x, f->touch_y)) {
      menu_act(in, f, menu_back(m), out);
    } else {
      int row = menu_hit_row(m->level, f->touch_x, f->touch_y);
      if (row >= 0) {
        m->cursor = row;
        if (m->level == MENU_ROOT) m->root_cursor = row;
        menu_act(in, f, menu_activate(m, f->view, 1, 0), out);
      }
    }
  }
  lr_logic(in, f, out, 1);
}

// Con el lector abierto (y sin tarjeta, ver reader_must_close) las entradas son suyas: A recarga si hay un mensaje nuevo,
// B vuelve al detalle, la cruceta y L/R desplazan, el lápiz arrastra; lo demás se traga. Solo se mantiene el acorde L+R.
static void reader_frame(InputLogic *in, const InputFrame *f, InputActions *out) {
  Reader *r = &in->reader;
  const ReadDoc *doc = f->doc;
  ReaderLayout l;
  reader_layout(doc != NULL && r->state == READER_SHOWING ? doc->question_count : 0, r->stale, &l);

  if (f->down & IN_KEY_B) {
    reader_close(r); // vuelve al detalle: la navegación no cambió
    return;
  }
  if ((f->down & IN_KEY_A) && r->stale) {
    reload_reading(in, f, out, -1); // recarga: foto nueva, en el mismo modo
    return;
  }
  // X: el otro modo (completo / resumen). Solo con el texto a la vista: cargando no hay nada que alternar
  if ((f->down & IN_KEY_X) && r->state == READER_SHOWING && doc != NULL) {
    reload_reading(in, f, out, reader_shown_mode(r, doc) == READ_MODE_SUMMARY ? READ_MODE_FULL : READ_MODE_SUMMARY);
    return;
  }
  int dy = ((f->rep & IN_KEY_DOWN) ? 1 : 0) - ((f->rep & IN_KEY_UP) ? 1 : 0);
  if (dy != 0) reader_scroll(r, doc, dy);
  int dx = ((f->rep & IN_KEY_RIGHT) ? 1 : 0) - ((f->rep & IN_KEY_LEFT) ? 1 : 0);
  if (dx != 0) reader_page(r, doc, dx);
  // L / R pasan de página al soltar, salvo que en esa pulsación se hayan visto juntos (el acorde del diagnóstico)
  if (!in->lr_chord) {
    if (f->up & IN_KEY_L) reader_page(r, doc, -1);
    if (f->up & IN_KEY_R) reader_page(r, doc, 1);
  }
  lr_logic(in, f, out, 0); // en el lector L/R son páginas, no otro aviso

  // lápiz: arrastrar desplaza (arrastrar hacia abajo muestra lo anterior); un toque corto en "B Volver" o en el aviso
  if (f->down & IN_KEY_TOUCH) {
    r->drag_active = 1;
    r->drag_x = f->touch_x;
    r->drag_y = f->touch_y;
    r->drag_acc = 0;
    r->drag_moved = 0;
  } else if ((f->held & IN_KEY_TOUCH) && r->drag_active) {
    int d = f->touch_y - r->drag_y;
    r->drag_x = f->touch_x;
    r->drag_y = f->touch_y;
    r->drag_moved += d < 0 ? -d : d;
    r->drag_acc += d;
    while (r->drag_acc >= READER_ROW_H) {
      reader_scroll(r, doc, -1);
      r->drag_acc -= READER_ROW_H;
    }
    while (r->drag_acc <= -READER_ROW_H) {
      reader_scroll(r, doc, 1);
      r->drag_acc += READER_ROW_H;
    }
  }
  if ((f->up & IN_KEY_TOUCH) && r->drag_active) {
    int tap = r->drag_moved < READER_TAP_SLOP, x = r->drag_x, y = r->drag_y;
    r->drag_active = 0;
    if (tap && rect_contains(&l.back_btn, x, y)) {
      reader_close(r);
    } else if (tap && l.has_stale && rect_contains(&l.stale, x, y)) {
      reload_reading(in, f, out, -1);
    } else if (tap && r->state == READER_SHOWING && doc != NULL && rect_contains(&l.foot, x, y)) {
      reload_reading(in, f, out, reader_shown_mode(r, doc) == READ_MODE_SUMMARY ? READ_MODE_FULL : READ_MODE_SUMMARY);
    }
  }
}

// ---------- preguntas con alternativas ----------

static void question_act(InputLogic *in, QuestionOut o, InputActions *out) {
  switch (o.kind) {
    case QOUT_NONE: break;
    case QOUT_SEND: push(out, IN_ACT_ANSWER, in->question.id, 0); break;
    case QOUT_SEND_PC: push(out, IN_ACT_ANSWER_PC, in->question.id, 0); break;
    case QOUT_OTHER: push(out, IN_ACT_QUESTION_OTHER, in->question.id, 0); break;
  }
}

// Con una pregunta a la vista las entradas son suyas: arriba/abajo y el lápiz mueven, A (o tocar la fila) elige, B vuelve a la
// pregunta anterior (nunca rechaza ni responde), L/R saltan a otra solicitud; lo demás se traga. Solo se mantiene el acorde L+R.
static void question_frame(InputLogic *in, const InputFrame *f, InputActions *out) {
  const RequestView *req = &f->view->request;
  Question *q = &in->question;
  int dy = ((f->rep & IN_KEY_DOWN) ? 1 : 0) - ((f->rep & IN_KEY_UP) ? 1 : 0);
  if (dy != 0) question_move(q, req, dy);
  if (f->down & IN_KEY_A) question_act(in, question_activate(q, req, f->now, -1, 0), out);
  if (f->down & IN_KEY_B) question_back(q);
  const QuestionView *qv = question_current(q, req);
  if (qv != NULL) {
    // lápiz: al apoyar marca la fila; solo se elige si se suelta sobre la misma fila (el toque suelto no elige por accidente)
    if (f->down & IN_KEY_TOUCH) {
      in->q_pen_row = question_hit_row(qv, f->touch_x, f->touch_y);
      in->q_pen_active = 1;
      if (in->q_pen_row >= 0) question_select(q, req, in->q_pen_row);
    } else if ((f->held & IN_KEY_TOUCH) && in->q_pen_active) {
      if (question_hit_row(qv, f->touch_x, f->touch_y) != in->q_pen_row) in->q_pen_row = -1; // salió de la fila
    }
    if ((f->up & IN_KEY_TOUCH) && in->q_pen_active) {
      int row = in->q_pen_row;
      in->q_pen_active = 0;
      if (row >= 0) question_act(in, question_activate(q, req, f->now, row, 0), out);
    }
  }
  lr_logic(in, f, out, 0); // L/R: la siguiente solicitud (permisos y preguntas comparten cola)
}

// ---------- actualizar la app ----------

static void update_act(InputActions *out, UpdOut o) {
  if (o == UPD_OUT_START) push(out, IN_ACT_UPDATE_START, NULL, 0);
}

// Con la pantalla de actualización a la vista (tarjeta de aviso, pantalla del menú o error) las entradas son suyas: A actualiza (o reintenta),
// B descarta o vuelve; los botones también se tocan con el lápiz (se elige al soltar sobre el mismo botón). Lo demás se traga.
// SELECT cierra la pantalla del menú. Solo se mantiene el acorde L+R.
static void update_frame(InputLogic *in, const InputFrame *f, InputActions *out) {
  Update *u = &in->update;
  if (in->diag_on) { // el diagnóstico la tapa: solo vale el acorde que lo cierra
    lr_logic(in, f, out, 0);
    return;
  }
  UpdateScreen s;
  update_screen(u, f->now, &s);
  if ((f->down & IN_KEY_A) && s.has_a) update_act(out, update_a(u, f->now));
  if (u->phase != UPD_RUN && (f->down & IN_KEY_B) && s.has_b) update_b(u, f->now);
  if (u->phase == UPD_PAGE && (f->down & IN_KEY_SELECT)) update_b(u, f->now);
  if (u->phase != UPD_RUN) {
    if (f->down & IN_KEY_TOUCH) {
      in->u_pen = update_hit(s.has_a, s.has_b, f->touch_x, f->touch_y);
    } else if ((f->held & IN_KEY_TOUCH) && in->u_pen != 0 && (int)update_hit(s.has_a, s.has_b, f->touch_x, f->touch_y) != in->u_pen) {
      in->u_pen = 0; // salió del botón
    }
    if (f->up & IN_KEY_TOUCH) {
      int pen = in->u_pen;
      in->u_pen = 0;
      if (pen == UPD_HIT_A) update_act(out, update_a(u, f->now));
      else if (pen == UPD_HIT_B) update_b(u, f->now);
    }
  }
  lr_logic(in, f, out, 0);
}

// ---------- instrucciones por texto ----------

static void instruct_act(InputLogic *in, const RequestView *req, InstructOut o, InputActions *out) {
  switch (o.kind) {
    case IOUT_NONE: break;
    case IOUT_WRITE: push(out, IN_ACT_INSTRUCT_WRITE, req->session_id, 0); break;
    case IOUT_RELEASE: push(out, IN_ACT_RELEASE, in->instruct.id, 0); break;
    case IOUT_QUICK:
      // atajo de un toque: su texto fijo sale como una instrucción escrita (la misma acción que lo del teclado)
      if (o.index >= 0 && o.index < req->quick_count && instruct_clean(req->quick[o.index].text, in->instruct_text, sizeof in->instruct_text) >= 1) {
        push(out, IN_ACT_INSTRUCT_SEND, req->session_id, 0);
      } else {
        instruct_sent(&in->instruct, 1); // texto vacío tras limpiar: no sale nada y se puede volver a elegir
      }
      break;
  }
}

// Con la tarjeta "Espera tu instrucción" a la vista las entradas son suyas: la cruceta y el lápiz mueven, A (o tocar la fila) elige,
// B no hace nada (nunca envía ni libera), L/R saltan a otra solicitud; lo demás se traga. Solo se mantiene el acorde L+R.
static void instruct_frame(InputLogic *in, const InputFrame *f, InputActions *out) {
  const RequestView *req = &f->view->request;
  Instruct *s = &in->instruct;
  int dy = ((f->rep & IN_KEY_DOWN) ? 1 : 0) - ((f->rep & IN_KEY_UP) ? 1 : 0);
  int dx = ((f->rep & IN_KEY_RIGHT) ? 1 : 0) - ((f->rep & IN_KEY_LEFT) ? 1 : 0);
  if (dy != 0) instruct_move(s, dy);
  if (dx != 0) instruct_move_x(s, dx);
  if (f->down & IN_KEY_A) instruct_act(in, req, instruct_activate(s, f->now, -1, 0), out);
  // lápiz: al apoyar marca la fila; solo se elige si se suelta sobre la misma fila (el toque suelto no elige por accidente)
  if (f->down & IN_KEY_TOUCH) {
    in->i_pen_row = instruct_hit_row(s->quick_n, f->touch_x, f->touch_y);
    in->i_pen_active = 1;
    if (in->i_pen_row >= 0) instruct_select(s, in->i_pen_row);
  } else if ((f->held & IN_KEY_TOUCH) && in->i_pen_active) {
    if (instruct_hit_row(s->quick_n, f->touch_x, f->touch_y) != in->i_pen_row) in->i_pen_row = -1; // salió de la fila
  }
  if ((f->up & IN_KEY_TOUCH) && in->i_pen_active) {
    int row = in->i_pen_row;
    in->i_pen_active = 0;
    if (row >= 0) instruct_act(in, req, instruct_activate(s, f->now, row, 0), out);
  }
  lr_logic(in, f, out, 0); // L/R: la siguiente solicitud (permisos, preguntas e instrucciones comparten cola)
}

void input_instruct_text(InputLogic *in, const View *v, const char *session_id, const char *text, InputActions *out) {
  out->n = 0;
  if (v == NULL || session_id == NULL || session_id[0] == '\0' || text == NULL) return;
  if (instruct_clean(text, in->instruct_text, sizeof in->instruct_text) < 1) return;
  // desde la tarjeta: ya no se puede volver a mandar ni a liberar mientras sale
  if (view_has_instruction_card(v) && strcmp(v->request.session_id, session_id) == 0) in->instruct.sent = 1;
  push(out, IN_ACT_INSTRUCT_SEND, session_id, 0);
}

void input_question_text(InputLogic *in, const View *v, uint64_t now, const char *text, InputActions *out) {
  out->n = 0;
  if (!view_has_question_card(v)) return;
  question_act(in, question_text(&in->question, &v->request, now, text), out);
}

void input_frame(InputLogic *in, const InputFrame *f, InputActions *out) {
  out->n = 0;
  const View *v = f->view;
  // START sale, salvo mientras se instala una actualización (cortarla a medias deja la instalación sin terminar)
  if ((f->down & IN_KEY_START) && !update_blocks_quit(&in->update)) {
    push(out, IN_ACT_QUIT, NULL, 0);
    return;
  }
  // actualizar la app: toma el `update` de la vista y lleva la guarda de 500 ms de la pantalla (menú, guía, diagnóstico y lector la tapan)
  if (update_sync(&in->update, v, in->menu.open || in->guide.open || in->diag_on || reader_active(&in->reader), f->now)) drop_gestures(in, f->now);
  if (in->update.phase != UPD_IDLE) { // pantalla del menú, instalando o con error: manda ella (la tarjeta de aviso va más abajo)
    update_frame(in, f, out);
    return;
  }
  // sin tarjeta de aviso a la vista no puede haber un gesto de "Visto" en curso
  if (!view_has_notice_card(v) && in->ack.has_shown) approve_view(&in->ack, f->now, NULL);
  // el menú (y la guía que abrió) no sobreviven a una tarjeta de permiso o de aviso: se cierran antes de atender nada
  if (in->menu.open && menu_must_close(v)) {
    menu_close(&in->menu);
    guide_close(&in->guide);
  }
  if (in->guide.open) {
    guide_frame(in, f, out);
    return;
  }
  if ((f->down & IN_KEY_SELECT) && !in->diag_on) { // con el diagnóstico abierto SELECT no hace nada
    if (in->menu.open) {
      menu_close(&in->menu);
      drop_gestures(in, f->now);
    } else if (!menu_must_close(v)) { // con una tarjeta a la vista no se abre: primero se responde
      menu_open(&in->menu);
      drop_gestures(in, f->now);
    }
    return;
  }

  // con el diagnóstico abierto la tarjeta está tapada: A, B, X, Y, cruceta, toque y el salto con L/R se tragan.
  // Solo valen START (arriba) y el acorde L+R, que lo cierra.
  if (in->diag_on) {
    lr_logic(in, f, out, 1);
    return;
  }

  if (in->menu.open) {
    menu_frame(in, f, out);
    return;
  }

  // pregunta con alternativas: pantalla y reglas propias; nada de lo que se pulse aquí aprueba, rechaza ni toca un permiso
  if (view_has_question_card(v)) {
    question_frame(in, f, out);
    return;
  }
  in->q_pen_active = 0;

  // fin de turno retenido ("Espera tu instrucción"): pantalla y reglas propias, como la pregunta
  if (view_has_instruction_card(v)) {
    instruct_frame(in, f, out);
    return;
  }
  in->i_pen_active = 0;

  // versión nueva de la app: tarjeta a pantalla completa (después de las solicitudes, que la tapan; ver update_card_visible)
  if (in->update.shown && in->update.phase == UPD_IDLE) {
    update_frame(in, f, out);
    return;
  }
  in->u_pen = 0;

  // lector del mensaje completo: si ya no corresponde (tarjeta, otro nivel) se cierra y el cuadro sigue como siempre
  if (reader_active(&in->reader)) {
    if (reader_must_close(in, v)) {
      reader_close(&in->reader);
    } else {
      reader_frame(in, f, out);
      return;
    }
  }

  // táctil
  if (f->down & IN_KEY_TOUCH) touch_down(in, f);
  else if ((f->held & IN_KEY_TOUCH) && in->pen_active) touch_held(in, f);
  if (f->up & IN_KEY_TOUCH) touch_up(in, f, out);

  // A: aprobar (con sus reglas) y, si no hay tarjeta, entrar
  if (f->down & IN_KEY_A) {
    approve_down(&in->approve, f->now, APPROVE_SRC_BUTTON, 0);
    if (view_has_notice_card(v)) {
      approve_down(&in->ack, f->now, APPROVE_SRC_BUTTON, 0); // con un aviso, A solo lo marca "Visto": no entra ni lee
    } else if (v != NULL && !v->has_request) {
      if (in->nav.level == NAV_DETAIL) start_reading(in, f, out); // en el detalle A no hacía nada: ahora lee todo
      else do_enter(in, v, -1, f->now, out);
    }
    else if (v == NULL && f->can_retry) push(out, IN_ACT_RETRY, NULL, 0);
  }
  if (f->up & IN_KEY_A) {
    char id[VIEW_ID_BYTES];
    if (approve_up(&in->approve, f->now, APPROVE_SRC_BUTTON, id)) push_decision(out, id, approve_flag(in));
    if (approve_up(&in->ack, f->now, APPROVE_SRC_BUTTON, id)) push_ack(out, id);
  }

  // B: con tarjeta rechaza (al soltar, sobre la misma solicitud); sin tarjeta vuelve un nivel
  if ((f->down & IN_KEY_B) && v != NULL) {
    if (nav_b_action(v) == NAV_B_DENY) in->deny_btn_armed = capture_key(in, v, in->deny_btn_key);
    else do_back(in, v, out);
  }
  if (f->up & IN_KEY_B) {
    if (in->deny_btn_armed) try_deny(in, in->deny_btn_key, v, out);
    in->deny_btn_armed = 0;
  }

  if (v != NULL && (f->rep & (IN_KEY_UP | IN_KEY_DOWN | IN_KEY_LEFT | IN_KEY_RIGHT))) {
    int dx = ((f->rep & IN_KEY_RIGHT) ? 1 : 0) - ((f->rep & IN_KEY_LEFT) ? 1 : 0);
    int dy = ((f->rep & IN_KEY_DOWN) ? 1 : 0) - ((f->rep & IN_KEY_UP) ? 1 : 0);
    nav_move(&in->nav, v, dx, dy);
  }
  lr_logic(in, f, out, 1);
  if (v != NULL && (f->down & IN_KEY_X)) {
    // en el detalle de una sesión (sin tarjeta, con instrucciones por texto) X le escribe; en las demás pantallas sigue alternando el modo
    if (detail_instruct_ok(in, v)) push(out, IN_ACT_INSTRUCT_WRITE, in->nav.session_id, 0);
    else push(out, IN_ACT_MODE, NULL, nav_mode_target_manual(v));
  }
  if (detail_instruct_ok(in, v)) {
    if (f->down & (IN_KEY_LEFT | IN_KEY_RIGHT)) push(out, IN_ACT_SESSION_WAIT, in->nav.session_id, !v->detail.wait_for_me);
    if ((f->down & IN_KEY_DOWN) && v->detail.instr_count > 0) push(out, IN_ACT_INSTRUCT_CLEAR, in->nav.session_id, 0);
  }

  // Y: con una tarjeta que ofrece "no volver a preguntar" es ese gesto (como A). Sin tarjeta no hace nada, salvo sin
  // vista (sin conexión o sin emparejar), donde abre el código de emparejamiento
  if (f->down & IN_KEY_Y) {
    if (offers_always(v)) approve_down_always(&in->approve, f->now, APPROVE_SRC_BUTTON, 0);
    else if (v != NULL && !v->has_request && in->nav.level == NAV_DETAIL) cycle_notify(in, v, out);
    else if (input_settings_allowed(in, v)) push(out, IN_ACT_PAIR_CODE, NULL, 0);
  }
  if (f->up & IN_KEY_Y) {
    char id[VIEW_ID_BYTES];
    if (approve_up_always(&in->approve, f->now, APPROVE_SRC_BUTTON, id)) push_decision(out, id, approve_flag(in));
  }
}

void input_view_changed(InputLogic *in, const View *v, const char *owner, uint64_t now, InputActions *out) {
  out->n = 0;
  NavOut o = nav_sync(&in->nav, v, (int64_t)now);
  if (in->menu.open && menu_must_close(v)) { // llegó una tarjeta: manda la tarjeta
    menu_close(&in->menu);
    guide_close(&in->guide);
  }
  if (reader_active(&in->reader)) {
    if (reader_must_close(in, v)) reader_close(&in->reader); // llegó una tarjeta (o cambió el nivel): manda la tarjeta
    else reader_view_changed(&in->reader, v);
  }
  // el fin de turno retenido tampoco es un permiso: su propia máquina cuenta su propia guarda
  int had_instruct = in->instruct.has_id;
  instruct_view(&in->instruct, now, view_has_instruction_card(v) ? &v->request : NULL);
  if (!had_instruct && in->instruct.has_id) drop_gestures(in, now);
  // la pregunta con alternativas no es un permiso: la máquina de aprobar nunca la ve, la suya cuenta su propia guarda
  int had_question = in->question.has_id;
  question_view(&in->question, now, view_has_question_card(v) ? &v->request : NULL);
  if (!had_question && in->question.has_id) drop_gestures(in, now); // lo que se pulsó antes no debe actuar sobre la pregunta
  if (view_has_permission_card(v)) {
    ApproveRequest r = {v->request.id,         v->request.risk == RISK_HIGH, owner, v->request.lines,
                        v->request.line_count, v->request.has_always ? v->request.always : NULL};
    approve_view(&in->approve, now, &r);
  } else {
    approve_view(&in->approve, now, NULL);
  }
  // la tarjeta de aviso tiene su propia identidad (id + líneas): si cambia o llega un permiso, el gesto de "Visto" se anula
  if (view_has_notice_card(v)) {
    ApproveRequest n = {v->notice.id, 0, "aviso", v->notice.lines, v->notice.line_count, NULL};
    approve_view(&in->ack, now, &n);
  } else {
    approve_view(&in->ack, now, NULL);
  }
  push_nav(out, o);
}

void input_tick(InputLogic *in, const View *v, uint64_t now, InputActions *out) {
  out->n = 0;
  // detalle abierto sin confirmar: el plazo de nav puede vencer sin vista nueva
  if (v != NULL && in->nav.level == NAV_DETAIL && !in->nav.confirmed) push_nav(out, nav_sync(&in->nav, v, (int64_t)now));
  char id[VIEW_ID_BYTES];
  if (approve_tick(&in->approve, now, id)) push_decision(out, id, approve_flag(in));
}

void input_session_ready(InputLogic *in, InputActions *out) {
  out->n = 0;
  approve_connection(&in->approve, 1);
  approve_connection(&in->ack, 1);
  question_connection(&in->question, 1);
  instruct_connection(&in->instruct, 1);
  if (in->nav.level == NAV_DETAIL) push(out, IN_ACT_FOCUS, in->nav.session_id, 0);
}

void input_session_end(InputLogic *in) {
  approve_reset(&in->approve);
  approve_reset(&in->ack);
  question_init(&in->question);
  in->q_pen_active = 0;
  instruct_init(&in->instruct);
  in->i_pen_active = 0;
  reader_close(&in->reader);
  in->pen_active = in->pen_on_approve = in->pen_zone_valid = in->deny_pen_armed = in->pen_on_ack = 0;
  in->deny_btn_armed = 0;
}

void input_action_done(InputLogic *in, const InputAction *act, int rc) {
  if (act->kind == IN_ACT_DECISION && rc == 0) approve_decided(&in->approve, act->id);
  if (act->kind == IN_ACT_ACK && rc == 0) approve_decided(&in->ack, act->id); // ya está vista: no se repite
  if ((act->kind == IN_ACT_ANSWER || act->kind == IN_ACT_ANSWER_PC) && rc != 0) question_sent(&in->question, rc); // no salió: se puede volver a responder
  if ((act->kind == IN_ACT_RELEASE || act->kind == IN_ACT_INSTRUCT_SEND) && rc != 0) instruct_sent(&in->instruct, rc); // no salió: se puede volver a elegir
  if (act->kind == IN_ACT_READ && rc != 0) reader_close(&in->reader); // no salió: no se queda cargando para siempre
}

int input_session_failed(const Session *s) { return s->state == SESSION_FAILED; }

#include "render_bottom.h"

#include <stdio.h>
#include <string.h>

#include "logic/elapsed.h"
#include "logic/menu.h"
#include "logic/palette.h"
#include "logic/theme.h"
#include "ui_draw.h"
#include "ui_scale.h"
#include "ui_text.h"

// Colores de la marca Cronio (logic/palette.h; los de packages/simulator/public/styles.css)
#define C_INK (pal()->ink)
#define C_MUTE (pal()->mute)
#define C_OK (pal()->ok_text)     // texto verde
#define C_WARN (pal()->bad_text)
#define C_ASK (pal()->sky_text)   // pide permiso / textos celestes
#define C_LINE (pal()->line)

static float cell(float scale) { return UI_TEXT_CELL_H * scale; }
// y de un texto de esa escala centrado en un rectángulo de alto h
static float center_y(float y, float h, float scale) { return y + (h - cell(scale)) / 2.0f - 1.0f; }

static void plural(char *out, size_t cap, int n, const char *one, const char *many) {
  snprintf(out, cap, "%d %s", n, n == 1 ? one : many);
}

void render_bottom_layout(BottomModel *m, BottomLayout *out) {
  if (m->view == NULL || m->nav == NULL) {
    memset(out, 0, sizeof *out);
    return;
  }
  const View *v = m->view;
  LayoutInput in;
  memset(&in, 0, sizeof in);
  in.level = m->nav->level == NAV_AGENTS ? LAYOUT_AGENTS : m->nav->level == NAV_SESSIONS ? LAYOUT_SESSIONS : LAYOUT_DETAIL;
  in.item_count = m->nav->level == NAV_SESSIONS ? nav_session_count(v, m->nav->kind) : nav_agent_count(v);
  in.cursor = m->nav->cursor;
  in.scroll = m->scroll;
  layout_input_from_view(&in, v, m->nav->level == NAV_DETAIL ? m->nav->session_id : "");
  layout_compute(&in, out);
  if (in.level == LAYOUT_SESSIONS) m->scroll = out->scroll;
}

// ---------- pantalla de estado ----------

static void draw_status(const BottomModel *m) {
  const StatusScreen *s = &m->status;
  float y = 14;
  ui_text_draw(s->title ? s->title : "", 160, y, S_HEAD, S_MIN, 300, ui_rgb(s->title_rgb, 1.0f), UI_ALIGN_CENTER);
  ui_rect(60, y + 30, 200, 1, ui_rgb(C_LINE, 1.0f));
  y = 56;
  for (int i = 0; i < s->line_count && i < STATUS_MAX_LINES; i++) {
    ui_text_draw(s->lines[i], 160, y, S_BODY, S_MIN, 300, ui_rgb(C_INK, 1.0f), UI_ALIGN_CENTER);
    y += 17;
  }
  float hy = LAYOUT_H - 8 - 16.0f * (float)s->hint_count;
  if (s->notice != NULL && s->notice[0] != 0) ui_text_draw(s->notice, 160, hy - 20, S_SMALL, S_MIN, 304, ui_rgb(C_WARN, 1.0f), UI_ALIGN_CENTER);
  for (int i = 0; i < s->hint_count && i < STATUS_MAX_HINTS; i++) {
    ui_text_draw(s->hints[i], 160, hy, S_SMALL, S_MIN, 304, ui_rgb(C_ASK, 1.0f), UI_ALIGN_CENTER);
    hy += 16;
  }
}

// ---------- barra ----------

static void draw_button(const Rect *r, const char *label, UiBtnKind kind, uint32_t text) {
  ui_button((float)r->x, (float)r->y, (float)r->w, (float)r->h, kind, label, S_SMALL, 0, 1.0f, 0, text);
}

static void draw_bar(const BottomModel *m, const BottomLayout *l) {
  const View *v = m->view;
  const Nav *n = m->nav;
  char sub[VIEW_TEXT_BYTES + 16];
  const char *title;
  sub[0] = '\0';
  if (n->level == NAV_AGENTS) {
    title = "Agentes";
    plural(sub, sizeof sub, v->session_count, "sesión", "sesiones");
  } else if (n->level == NAV_SESSIONS) {
    title = theme_agent_name(n->kind);
    plural(sub, sizeof sub, nav_session_count(v, n->kind), "sesión", "sesiones");
  } else {
    title = theme_agent_name(n->kind);
    const SessionView *s = view_find_session(v, n->session_id);
    if (s != NULL) snprintf(sub, sizeof sub, "%s", s->title);
  }
  // barra superior (estilo HOME): degradado blanco -> gris muy claro y una línea de 1 px abajo
  ui_vgrad(0, 0, LAYOUT_W, (float)(l->bar.y + l->bar.h), pal()->bar_top, pal()->bar_bot);
  ui_rect(0, (float)(l->bar.y + l->bar.h), LAYOUT_W, 1, ui_rgb(C_LINE, 1.0f));
  float ty = center_y(l->bar.y, l->bar.h, S_TITLE);
  float tw = ui_text_draw(title, (float)l->title_x, ty, S_TITLE, S_MIN, 110, ui_rgb(C_INK, 1.0f), UI_ALIGN_LEFT);
  float sx = (float)l->title_x + tw + 8.0f;
  float sw = (float)l->sub_x_max - sx;
  if (sw > 20.0f) ui_text_draw(sub, sx, center_y(l->bar.y, l->bar.h, S_SMALL), S_SMALL, S_MIN, sw, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_LEFT);

  if (l->has_back) draw_button(&l->back_btn, "B Volver", UI_BTN_NORMAL, 0);
  int manual = v->mode == MODE_MANUAL;
  draw_button(&l->mode_btn, theme_mode_label(v->mode), manual ? UI_BTN_PRIMARY : UI_BTN_NORMAL, 0);
}

static void draw_banner(const BottomModel *m, const BottomLayout *l) {
  if (!l->has_banner) return;
  char txt[96];
  int n = (int)m->view->pending_count;
  snprintf(txt, sizeof txt, "%d %s \xC2\xB7 entra a la sesión que lo pide", n, n == 1 ? "permiso pendiente" : "permisos pendientes");
  ui_rrect((float)l->banner.x, (float)l->banner.y, (float)l->banner.w, (float)l->banner.h, 8, ui_rgb(PAL_SKY, 1.0f));
  ui_rrect((float)l->banner.x + 1, (float)l->banner.y + 1, (float)l->banner.w - 2, (float)l->banner.h - 2, 7, ui_rgb(pal()->sky_strip, 1.0f));
  ui_text_draw(txt, l->banner.x + 6, center_y(l->banner.y, l->banner.h, S_SMALL), S_SMALL, S_MIN, l->banner.w - 12, ui_rgb(C_ASK, 1.0f), UI_ALIGN_LEFT);
}

// ---------- agentes ----------

static void draw_agents(const BottomModel *m, const BottomLayout *l) {
  const View *v = m->view;
  int pulse = (int)((m->now_ms / 500u) % 2u);
  int shown = nav_agent_count(v);
  if (shown == 0) { // todos ocultos en la configuración
    ui_text_draw("Todos los agentes están ocultos", LAYOUT_W / 2.0f, l->content.y + 20, S_BODY, S_MIN, 300, ui_rgb(C_INK, 1.0f), UI_ALIGN_CENTER);
    ui_text_draw("SELECT > Agentes para mostrarlos", LAYOUT_W / 2.0f, l->content.y + 40, S_SMALL, S_MIN, 300, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_CENTER);
  }
  for (int i = 0; i < shown; i++) {
    AgentKind kind = nav_agent_at(v, i);
    const Rect *t = &l->tiles[i];
    int count = nav_session_count(v, kind);
    int asking = 0;
    for (int k = 0; k < v->session_count; k++) {
      if (v->sessions[k].kind == kind && v->sessions[k].state == STATE_ASK) asking = 1;
    }
    uint32_t rgb = theme_agent_ui_rgb(kind);
    // ficha: relieve de 2 px; con permiso pendiente borde de 2 px del agente (y late); la selección es el borde celeste de 3 px
    int sel = m->nav->level == NAV_AGENTS && m->nav->cursor == i;
    uint32_t g_top = asking && pulse ? pal()->pulse : pal()->row_top, g_bot = asking && pulse ? pal()->pulse : pal()->row_bot;
    ui_panel((float)t->x, (float)t->y, (float)t->w, (float)t->h, 12, g_top, g_bot, sel ? PAL_SKY : asking ? rgb : C_LINE,
             sel ? 3.0f : asking ? 2.0f : 1.0f, pal()->edge);
    float alpha = count ? 1.0f : 0.35f;
    char num[8];
    snprintf(num, sizeof num, "%d", count);

    if (l->tile_compact) {
      ui_agent_square((float)t->x + 8, (float)t->y + (float)t->h / 2.0f - 8.0f, 16.0f, rgb, alpha);
      ui_text_draw(theme_agent_name(kind), t->x + 30, center_y(t->y, (float)t->h, S_SMALL), S_SMALL, S_MIN,
                   t->w - 48, ui_rgb(count ? C_INK : C_MUTE, 1.0f), UI_ALIGN_LEFT);
      if (count) ui_text_draw(num, t->x + t->w - 8, center_y(t->y, (float)t->h, S_SMALL), S_SMALL, S_MIN, 16, ui_rgb(C_INK, 1.0f), UI_ALIGN_RIGHT);
      continue;
    }

    float r = (float)t->h * 0.2f;
    if (r < 14.0f) r = 14.0f;
    if (r > 20.0f) r = 20.0f;
    float total = 2 * r + 4 + cell(S_BODY) + 1 + cell(S_TINY);
    float top = t->y + ((float)t->h - total) / 2.0f;
    float cx = t->x + t->w / 2.0f;
    ui_agent_square(cx - r, top, 2 * r, rgb, alpha);
    ui_text_draw(theme_agent_name(kind), cx, top + 2 * r + 4, S_BODY, S_MIN, t->w - 8, ui_rgb(count ? C_INK : C_MUTE, 1.0f), UI_ALIGN_CENTER);
    ui_text_draw(theme_kind_summary(v, kind), cx, top + 2 * r + 5 + cell(S_BODY), S_TINY, S_MIN, t->w - 8, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_CENTER);
    if (count) {  // contador arriba a la derecha
      float bw = 16.0f;
      ui_rrect(t->x + t->w - bw - 6, t->y + 5, bw, 16, 8, ui_rgb(PAL_SKY, 1.0f));
      ui_text_draw(num, t->x + t->w - bw / 2.0f - 6, t->y + 5 + (16 - cell(S_TINY)) / 2.0f - 1, S_TINY, S_MIN, 14, ui_rgb(PAL_WHITE, 1.0f), UI_ALIGN_CENTER);
    }
  }
}

// ---------- sesiones ----------

static uint32_t state_color(AgentState s) {
  switch (s) {
    case STATE_ASK: return C_ASK;
    case STATE_ERROR: return C_WARN;
    case STATE_DONE: return C_OK;
    default: return C_MUTE;
  }
}

static void draw_sessions(const BottomModel *m, const BottomLayout *l) {
  const View *v = m->view;
  const Nav *n = m->nav;
  int count = nav_session_count(v, n->kind);
  if (count == 0) {
    char msg[64];
    snprintf(msg, sizeof msg, "No hay sesiones abiertas de %s", theme_agent_name(n->kind));
    ui_text_draw(msg, 160, l->content.y + l->content.h / 2.0f - 8, S_BODY, S_MIN, 300, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_CENTER);
    return;
  }
  for (int i = 0; i < l->visible_rows && l->scroll + i < count; i++) {
    int idx = l->scroll + i;
    const SessionView *s = nav_session_at(v, n->kind, idx);
    if (s == NULL) continue;
    const Rect *r = &l->rows[i];
    int sel = idx == n->cursor;
    ui_panel((float)r->x, (float)r->y, (float)r->w, (float)r->h, 10, pal()->row_top, pal()->row_alt,
             sel || s->state == STATE_ASK ? PAL_SKY : C_LINE, sel ? 3.0f : 1.0f, pal()->edge);
    char st[VIEW_TEXT_BYTES + 32];
    if (s->model[0]) snprintf(st, sizeof st, "%s \xC2\xB7 %s", s->model, theme_state_label(s->state));
    else snprintf(st, sizeof st, "%s", theme_state_label(s->state));
    float right = r->x + r->w - 8.0f;
    float stw = ui_text_draw(st, right, r->y + 4, S_SMALL, S_MIN, 130, ui_rgb(state_color(s->state), 1.0f), UI_ALIGN_RIGHT);
    ui_text_draw(s->title, r->x + 8, r->y + 3, S_BODY, S_MIN, (float)r->w - 24 - stw, ui_rgb(C_INK, 1.0f), UI_ALIGN_LEFT);
    // segunda línea: la actividad a la izquierda y, en gris a la derecha, cuánto lleva en este estado (el reloj es el de la consola)
    float y2 = r->y + 3 + cell(S_BODY) + 2;
    float tw = 0.0f;
    if (s->has_since) {
      char el[24];
      elapsed_label(elapsed_total_s(s->since_s, m->view_at_ms, m->now_ms), el, sizeof el);
      tw = ui_text_draw(el, right, y2, S_SMALL, S_MIN, 90, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_RIGHT);
    }
    ui_text_draw(s->activity, r->x + 8, y2, S_SMALL, S_MIN, (float)r->w - 16 - (tw > 0.0f ? tw + 8.0f : 0.0f), ui_rgb(C_MUTE, 1.0f), UI_ALIGN_LEFT);
  }
  if (count > l->visible_rows) {  // barra de desplazamiento
    float th = (float)l->content.h;
    float len = th * (float)l->visible_rows / (float)count;
    float off = th * (float)l->scroll / (float)count;
    ui_rect(LAYOUT_W - 4, (float)l->content.y, 2, th, ui_rgb(C_LINE, 1.0f));
    ui_rect(LAYOUT_W - 4, (float)l->content.y + off, 2, len, ui_rgb(C_MUTE, 1.0f));
  }
}

// ---------- detalle ----------

static void draw_field(float y, const char *label, const char *value, float bottom) {
  if (y + cell(S_BODY) > bottom) return;
  float lw = ui_text_draw(label, 8, y, S_BODY, S_MIN, 120, ui_rgb(C_INK, 1.0f), UI_ALIGN_LEFT);
  ui_text_draw(value[0] ? value : "\xE2\x80\x94", 8 + lw + 5, y, S_BODY, S_MIN, 304 - lw - 5, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_LEFT);
}

static void draw_detail(const BottomModel *m, const BottomLayout *l) {
  const View *v = m->view;
  // sin tarjeta, A abre el lector del mensaje completo (con tarjeta de permiso A aprueba; con una de aviso, marca "Visto")
  if (l->has_read) draw_button(&l->btn_read, "A: leer todo el mensaje", UI_BTN_NORMAL, pal()->sky_text);
  if (l->has_notify) {
    char lab[VIEW_TEXT_BYTES + 16];
    snprintf(lab, sizeof lab, "Y: avisos \xC2\xB7 %s", menu_notify_label(v->detail.notify));
    draw_button(&l->btn_notify, lab, UI_BTN_NORMAL, v->detail.notify == NOTIFY_SILENT ? C_MUTE : pal()->sky_text);
  }
  const SessionView *s = view_find_session(v, m->nav->session_id);
  if (s == NULL) return;
  if (l->has_instruct) {
    // instrucciones por texto (paso 6): escribirle a la sesión y "Esperar mi respuesta"; con cola, el recuadro con "Borrar"
    draw_button(&l->btn_instruct, "X: escribir instrucci\xC3\xB3n", UI_BTN_NORMAL, C_OK);
    char lab[48];
    snprintf(lab, sizeof lab, "Izq/Der \xC2\xB7 Esperar: %s", v->detail.wait_for_me ? "s\xC3\xAD" : "no");
    draw_button(&l->btn_wait, lab, UI_BTN_NORMAL, v->detail.wait_for_me ? C_OK : C_MUTE);
  }
  if (l->has_queue_box) {
    const Rect *q = &l->queue_box;
    ui_panel((float)q->x, (float)q->y, (float)q->w, (float)q->h, 8, pal()->row_top, pal()->row_bot, C_LINE, 1.0f, 0);
    char qt[VIEW_TEXT_BYTES + 24];
    snprintf(qt, sizeof qt, "En cola (%d): %s", v->detail.instr_count, v->detail.instr_first);
    ui_text_draw(qt, (float)q->x + 6, center_y((float)q->y + 1, 16.0f, S_SMALL), S_SMALL, S_MIN, (float)q->w - 12 - (float)l->btn_clear.w, ui_rgb(C_INK, 1.0f), UI_ALIGN_LEFT);
    draw_button(&l->btn_clear, "Abajo: borrar", UI_BTN_NORMAL, C_WARN);
    // la instrucción sale en el próximo fin de turno de la sesión; si ya terminó, hay que escribirle desde el PC para que siga
    const char *hint = s->state == STATE_WORKING ? "Sale cuando termine este turno." : "Ya termin\xC3\xB3: esc\xC3\xAD" "bele desde el PC para que siga.";
    ui_text_draw(hint, (float)q->x + 6, (float)q->y + 18, S_SMALL, S_MIN, (float)q->w - 12, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_LEFT);
  }
  float bottom = (float)l->footer_top; // al pie quedan las franjas del detalle (leer, avisos, instrucciones y su cola)
  float y = (float)l->content.y + 4;
  const float step = 16.0f;
  char buf[VIEW_TEXT_BYTES + 40];
  draw_field(y, "Proyecto:", s->project, bottom);
  y += step;
  snprintf(buf, sizeof buf, "%s \xC2\xB7 %s", s->model[0] ? s->model : "\xE2\x80\x94", theme_state_label(s->state));
  draw_field(y, "Modelo:", buf, bottom);
  y += step;
  draw_field(y, "Ahora:", s->activity, bottom);
  y += step + 2;
  int has = v->has_detail && strcmp(v->detail.session_id, s->id) == 0;
  if (has && v->detail.question_count > 0) {
    // la pregunta que espera respuesta, completa y resaltada, antes del último mensaje
    int n = v->detail.question_count;
    float bh = 17.0f + 14.0f * (float)n + 2.0f;
    if (y + bh <= bottom) {
      ui_panel(4, y - 2, LAYOUT_W - 8, bh, 8, pal()->card, pal()->card, PAL_SKY, 1.0f, 0);
      ui_text_draw("Te pregunta:", 10, y + 1, S_SMALL, S_MIN, 296, ui_rgb(C_ASK, 1.0f), UI_ALIGN_LEFT);
      for (int i = 0; i < n; i++) ui_text_draw(v->detail.question[i], 10, y + 17 + 14.0f * (float)i, S_SMALL, S_MIN, 300, ui_rgb(C_INK, 1.0f), UI_ALIGN_LEFT);
      y += bh + 3;
    }
  }
  if (y + cell(S_BODY) <= bottom) ui_text_draw("Último mensaje:", 8, y, S_BODY, S_MIN, 300, ui_rgb(C_INK, 1.0f), UI_ALIGN_LEFT);
  y += step;
  if (!has || v->detail.line_count == 0) {
    if (y + cell(S_BODY) <= bottom) ui_text_draw("\xE2\x80\x94", 8, y, S_BODY, S_MIN, 300, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_LEFT);
    return;
  }
  for (int i = 0; i < v->detail.line_count; i++) {
    if (y + cell(S_SMALL) > bottom) break;
    ui_text_draw(v->detail.last_message[i], 8, y, S_SMALL, S_MIN, 304, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_LEFT);
    y += 14;
  }
}

// ---------- tarjeta de permiso ----------

static void draw_card(const BottomModel *m, const BottomLayout *l) {
  if (!l->has_card) return;
  const View *v = m->view;
  const RequestView *rq = &v->request;
  int high = rq->risk == RISK_HIGH;
  const SessionView *owner_s = view_find_session(v, rq->session_id);
  uint32_t agent = owner_s ? theme_agent_ui_rgb(owner_s->kind) : C_LINE;
  const Rect *c = &l->card;
  uint32_t fill = high ? pal()->bad_bg : pal()->card;
  ui_panel((float)c->x, (float)c->y, (float)c->w, (float)c->h, 14, fill, fill, high ? PAL_BAD : agent, 2.0f, high ? PAL_BAD_DK : pal()->edge);

  // cabecera: dueño y cuenta regresiva
  float cdw = 0;
  if (m->countdown_s >= 0) {
    char cd[16];
    snprintf(cd, sizeof cd, "%d s", m->countdown_s);
    cdw = ui_text_draw(cd, (float)(l->card_head.x + l->card_head.w), center_y(l->card_head.y, l->card_head.h, S_SMALL), S_SMALL, S_MIN, 50, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_RIGHT);
  }
  ui_text_draw(m->card_owner ? m->card_owner : "", (float)l->card_head.x, center_y(l->card_head.y, l->card_head.h, S_BODY), S_BODY, S_MIN,
               (float)l->card_head.w - cdw - 8, ui_rgb(C_INK, 1.0f), UI_ALIGN_LEFT);

  // "N de M" y saltar
  if (l->has_queue) {
    char pos[24];
    snprintf(pos, sizeof pos, "%u de %u", (unsigned)rq->position, (unsigned)rq->total);
    const Rect *q = &l->card_queue;
    ui_text_draw(pos, q->x + q->w / 2.0f, center_y(q->y, q->h, S_SMALL), S_SMALL, S_MIN, q->w - 80, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_CENTER);
    if (l->has_skip) {
      draw_button(&l->skip_prev, "< L", UI_BTN_NORMAL, 0);
      draw_button(&l->skip_next, "R >", UI_BTN_NORMAL, 0);
    }
  }

  // aviso de riesgo alto
  if (l->has_risk) {
    const Rect *r = &l->card_risk;
    ui_rrect((float)r->x, (float)r->y, (float)r->w, (float)r->h, 6, ui_rgb(PAL_BAD, 1.0f));
    ui_text_draw("¡Acción de riesgo! Mantén A 1 segundo", r->x + 6, center_y(r->y, r->h, S_SMALL), S_SMALL, S_MIN, r->w - 12, ui_rgb(PAL_WHITE, 1.0f), UI_ALIGN_LEFT);
  }

  // líneas del comando
  if (rq->line_count > 0) { // caja del comando
    ui_panel((float)l->card_lines.x - 2, (float)l->card_lines.y - 1, (float)l->card_lines.w + 4,
             (float)(l->card_lines.h > 0 ? l->card_lines.h : rq->line_count * LAYOUT_CARD_LINE_H) + 2, 6, pal()->cmd_bg, pal()->cmd_bg, C_LINE, 1.0f, 0);
  }
  for (int i = 0; i < rq->line_count && i < VIEW_MAX_LINES; i++) {
    ui_text_draw(rq->lines[i], (float)l->card_lines.x, (float)l->card_lines.y + (float)(i * LAYOUT_CARD_LINE_H) + 1, S_SMALL, S_MIN,
                 (float)l->card_lines.w, ui_rgb(C_INK, 1.0f), UI_ALIGN_LEFT);
  }

  // "sí, no volver a preguntar": franja sobre los botones, con la misma retención que aprobar en riesgo alto
  if (l->has_always && rq->has_always) {
    const Rect *s = &l->btn_always;
    char txt[VIEW_TEXT_BYTES + 32];
    snprintf(txt, sizeof txt, "%sY: sí, siempre \xC2\xB7 %s", high ? "Mantén " : "", rq->always);
    // blanco con borde verde de 2 px y texto verde oscuro; al retener, una barra verde clara crece de izquierda a derecha
    float ra = m->approve_ready ? 1.0f : 0.4f;
    ui_panel((float)s->x, (float)s->y, (float)s->w, (float)s->h, 7, pal()->card, pal()->card, PAL_OK, 2.0f, 0);
    if (m->hold > 0.0f && m->hold_always) ui_rect((float)s->x + 2, (float)s->y + 2, ((float)s->w - 4) * (m->hold > 1.0f ? 1.0f : m->hold), (float)s->h - 4, ui_rgb(PAL_OK_HI, 0.55f));
    ui_text_draw(txt, s->x + s->w / 2.0f, center_y(s->y, s->h, S_SMALL), S_SMALL, S_MIN, s->w - 8, ui_rgb(pal()->ok_text, ra), UI_ALIGN_CENTER);
  }

  // botones: aprobar verde, rechazar rojo (texto blanco en negrita; la barra de retención es blanca al 55 %)
  const Rect *a = &l->btn_approve;
  float dim = m->approve_ready ? 1.0f : 0.4f;
  ui_button((float)a->x, (float)a->y, (float)a->w, (float)a->h, UI_BTN_OK, high ? "Mantén A · Aprobar" : "A · Aprobar", S_BODY, 0, dim, 0, 0);
  if (m->hold > 0.0f && !m->hold_always) ui_rect((float)a->x + 1, (float)a->y + 1, ((float)a->w - 2) * (m->hold > 1.0f ? 1.0f : m->hold), (float)a->h - 2, ui_rgb(PAL_WHITE, 0.55f));
  const Rect *d = &l->btn_deny;
  ui_button((float)d->x, (float)d->y, (float)d->w, (float)d->h, UI_BTN_BAD, "B · Rechazar", S_BODY, 0, 1.0f, 0, 0);
}

// ---------- tarjeta de aviso ----------

static uint32_t notice_kind_rgb(NoticeKind k) {
  switch (k) {
    case NOTICE_ERROR: return C_WARN;
    case NOTICE_ASK: return C_ASK;
    case NOTICE_IDLE: return C_MUTE;
    default: return C_OK;
  }
}

static void draw_notice(const BottomModel *m, const BottomLayout *l) {
  if (!l->has_notice) return;
  const View *v = m->view;
  const NoticeView *n = &v->notice;
  const SessionView *owner_s = view_find_session(v, n->session_id);
  const Rect *c = &l->notice;
  (void)owner_s;
  ui_panel((float)c->x, (float)c->y, (float)c->w, (float)c->h, 14, pal()->sky_bg, pal()->sky_bg, PAL_SKY, 3.0f, 0);

  // cabecera: "AVISO" (nunca dice "permiso") y de quién es
  float aw = ui_text_draw("AVISO", (float)l->notice_head.x, center_y(l->notice_head.y, l->notice_head.h, S_SMALL), S_SMALL, S_MIN, 60, ui_rgb(C_ASK, 1.0f), UI_ALIGN_LEFT);
  char who[VIEW_TEXT_BYTES * 2 + 8];
  snprintf(who, sizeof who, "%s \xC2\xB7 %s", n->agent, n->project);
  ui_text_draw(who, (float)l->notice_head.x + aw + 8, center_y(l->notice_head.y, l->notice_head.h, S_BODY), S_BODY, S_MIN, (float)l->notice_head.w - aw - 8, ui_rgb(C_INK, 1.0f), UI_ALIGN_LEFT);
  ui_text_draw(n->title, (float)l->notice_title.x, center_y(l->notice_title.y, l->notice_title.h, S_HEAD), S_HEAD, S_MIN, (float)l->notice_title.w, ui_rgb(notice_kind_rgb(n->kind), 1.0f), UI_ALIGN_LEFT);

  if (l->has_notice_queue) {
    char pos[24];
    snprintf(pos, sizeof pos, "%u de %u", (unsigned)n->position, (unsigned)n->total);
    const Rect *q = &l->notice_queue;
    ui_text_draw(pos, q->x + q->w / 2.0f, center_y(q->y, q->h, S_SMALL), S_SMALL, S_MIN, q->w - 80, ui_rgb(C_MUTE, 1.0f), UI_ALIGN_CENTER);
    draw_button(&l->skip_prev, "< L", UI_BTN_NORMAL, 0);
    draw_button(&l->skip_next, "R >", UI_BTN_NORMAL, 0);
  }
  for (int i = 0; i < n->line_count && i < VIEW_MAX_NOTICE_LINES; i++) {
    ui_text_draw(n->lines[i], (float)l->notice_lines.x, (float)l->notice_lines.y + (float)(i * LAYOUT_NOTICE_LINE_H) + 1, S_SMALL, S_MIN,
                 (float)l->notice_lines.w, ui_rgb(C_INK, 1.0f), UI_ALIGN_LEFT);
  }
  const Rect *a = &l->btn_ack;
  ui_button((float)a->x, (float)a->y, (float)a->w, (float)a->h, UI_BTN_PRIMARY, "A: Visto", S_BODY, 0, m->ack_ready ? 1.0f : 0.4f, 0, 0);
  const Rect *r = &l->btn_notice_read;
  ui_button((float)r->x, (float)r->y, (float)r->w, (float)r->h, UI_BTN_NORMAL, "Leer todo", S_BODY, 0, 1.0f, 0, 0);
}

void render_bottom_draw(const BottomModel *m, const BottomLayout *l) {
  // el fondo (degradado y rayitas) lo pinta app.c con ui_bg_bottom antes de llamar aquí
  if (m->view == NULL || m->nav == NULL) {
    draw_status(m);
    return;
  }
  switch (m->nav->level) {
    case NAV_AGENTS: draw_agents(m, l); break;
    case NAV_SESSIONS: draw_sessions(m, l); break;
    default: draw_detail(m, l); break;
  }
  draw_banner(m, l);
  draw_bar(m, l);
  draw_card(m, l);
  draw_notice(m, l);
}

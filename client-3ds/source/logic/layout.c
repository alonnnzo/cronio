#include "layout.h"

#include <string.h>

static int clampi(int n, int lo, int hi) { return n < lo ? lo : n > hi ? hi : n; }

static Rect rect(int x, int y, int w, int h) {
  Rect r = {x, y, w, h};
  return r;
}

int layout_card_height(int lines, int high, int many, int always) {
  lines = clampi(lines, 0, VIEW_MAX_LINES);
  return LAYOUT_CARD_PAD + LAYOUT_CARD_HEAD_H + (many ? LAYOUT_CARD_QUEUE_H : 0) + (high ? LAYOUT_CARD_RISK_H + 1 : 0) +
         lines * LAYOUT_CARD_LINE_H + LAYOUT_CARD_GAP + (always ? LAYOUT_CARD_ALWAYS_H + LAYOUT_CARD_ALWAYS_GAP : 0) +
         LAYOUT_CARD_BTN_H + LAYOUT_CARD_PAD;
}

int layout_notice_height(int lines, int many) {
  lines = clampi(lines, 0, VIEW_MAX_NOTICE_LINES);
  return LAYOUT_CARD_PAD + LAYOUT_NOTICE_HEAD_H + LAYOUT_NOTICE_TITLE_H + (many ? LAYOUT_NOTICE_QUEUE_H : 0) +
         lines * LAYOUT_NOTICE_LINE_H + LAYOUT_NOTICE_GAP + LAYOUT_NOTICE_BTN_H + LAYOUT_CARD_PAD;
}

void layout_input_from_view(LayoutInput *in, const View *v, const char *open_session_id) {
  // la pregunta con alternativas tiene su propia pantalla (question.c): aquí solo cuenta la tarjeta de permiso
  in->has_card = view_has_permission_card(v);
  in->has_banner = !v->has_request && v->pending_count > 0;
  in->card_lines = in->card_high = in->card_many = in->card_always = in->card_can_skip = 0;
  if (view_has_permission_card(v)) {
    in->card_lines = v->request.line_count;
    in->card_high = v->request.risk == RISK_HIGH;
    in->card_many = v->request.total > 1;
    in->card_can_skip = v->mode == MODE_QUEUE;
    in->card_always = v->request.has_always;
  }
  in->has_notice = view_has_notice_card(v);
  in->notice_lines = in->has_notice ? v->notice.line_count : 0;
  in->notice_many = in->has_notice && v->notice.total > 1;
  int open = open_session_id != NULL && open_session_id[0] != '\0' && v->has_detail && strcmp(v->detail.session_id, open_session_id) == 0;
  in->detail_notify = open && v->detail.has_notify;
  in->detail_instruct = open && v->has_settings && v->settings.has_instruct_wait;
  in->detail_queue = in->detail_instruct && v->detail.instr_count > 0;
}

int layout_scroll_for_cursor(int scroll, int cursor, int visible, int count) {
  if (visible < 1) visible = 1;
  int max_scroll = count > visible ? count - visible : 0;
  scroll = clampi(scroll, 0, max_scroll);
  if (cursor < scroll) scroll = cursor;
  else if (cursor >= scroll + visible) scroll = cursor - visible + 1;
  return clampi(scroll, 0, max_scroll);
}

static void add_zone(BottomLayout *l, ZoneKind kind, Rect r, int index) {
  if (l->zone_count >= LAYOUT_MAX_ZONES) return;
  Zone *z = &l->zones[l->zone_count++];
  z->kind = kind;
  z->r = r;
  z->index = index;
}

void layout_compute(const LayoutInput *in, BottomLayout *l) {
  memset(l, 0, sizeof *l);

  // barra
  l->bar = rect(0, LAYOUT_BAR_Y, LAYOUT_W, LAYOUT_BAR_H);
  l->mode_btn = rect(244, LAYOUT_BAR_Y + 1, 70, LAYOUT_BAR_H - 2);
  l->has_back = in->level != LAYOUT_AGENTS;
  l->back_btn = rect(176, LAYOUT_BAR_Y + 1, 62, LAYOUT_BAR_H - 2);
  l->title_x = 6;
  l->sub_x_max = (l->has_back ? l->back_btn.x : l->mode_btn.x) - 6;

  int top = LAYOUT_BAR_Y + LAYOUT_BAR_H + 2; // 24
  l->has_banner = in->has_banner && !in->has_card;
  if (l->has_banner) {
    l->banner = rect(LAYOUT_MARGIN, top, LAYOUT_W - 2 * LAYOUT_MARGIN, LAYOUT_BANNER_H);
    top += LAYOUT_BANNER_H + 2;
  }

  // tarjeta
  int bottom = LAYOUT_H - 2;
  l->has_card = in->has_card;
  if (l->has_card) {
    int lines = clampi(in->card_lines, 0, VIEW_MAX_LINES);
    int h = layout_card_height(lines, in->card_high, in->card_many, in->card_always);
    int cw = LAYOUT_W - 2 * LAYOUT_MARGIN;
    l->card = rect(LAYOUT_MARGIN, LAYOUT_H - 3 - h, cw, h);
    int ix = l->card.x + 6, iw = cw - 12;
    int y = l->card.y + LAYOUT_CARD_PAD;
    l->card_head = rect(ix, y, iw, LAYOUT_CARD_HEAD_H);
    y += LAYOUT_CARD_HEAD_H;
    l->has_queue = in->card_many;
    if (l->has_queue) {
      l->card_queue = rect(ix, y, iw, LAYOUT_CARD_QUEUE_H);
      l->has_skip = in->card_can_skip;
      l->skip_prev = rect(ix, y, 36, LAYOUT_CARD_QUEUE_H);
      l->skip_next = rect(ix + iw - 36, y, 36, LAYOUT_CARD_QUEUE_H);
      y += LAYOUT_CARD_QUEUE_H;
    }
    l->has_risk = in->card_high;
    if (l->has_risk) {
      l->card_risk = rect(ix, y + 1, iw, LAYOUT_CARD_RISK_H);
      y += LAYOUT_CARD_RISK_H + 1;
    }
    l->card_lines = rect(ix, y, iw, lines * LAYOUT_CARD_LINE_H);
    y += lines * LAYOUT_CARD_LINE_H + LAYOUT_CARD_GAP;
    l->has_always = in->card_always;
    if (l->has_always) {
      l->btn_always = rect(ix, y, iw, LAYOUT_CARD_ALWAYS_H);
      y += LAYOUT_CARD_ALWAYS_H + LAYOUT_CARD_ALWAYS_GAP;
    }
    int bw = (iw - 6) / 2;
    l->btn_approve = rect(ix, y, bw, LAYOUT_CARD_BTN_H);
    l->btn_deny = rect(ix + bw + 6, y, iw - bw - 6, LAYOUT_CARD_BTN_H);
    bottom = l->card.y - 3;
  }
  // tarjeta de aviso: ocupa el lugar de la de permiso, que siempre manda si llegan las dos
  l->has_notice = in->has_notice && !in->has_card;
  if (l->has_notice) {
    int lines = clampi(in->notice_lines, 0, VIEW_MAX_NOTICE_LINES);
    int h = layout_notice_height(lines, in->notice_many);
    int cw = LAYOUT_W - 2 * LAYOUT_MARGIN;
    l->notice = rect(LAYOUT_MARGIN, LAYOUT_H - 3 - h, cw, h);
    int ix = l->notice.x + 6, iw = cw - 12;
    int y = l->notice.y + LAYOUT_CARD_PAD;
    l->notice_head = rect(ix, y, iw, LAYOUT_NOTICE_HEAD_H);
    y += LAYOUT_NOTICE_HEAD_H;
    l->notice_title = rect(ix, y, iw, LAYOUT_NOTICE_TITLE_H);
    y += LAYOUT_NOTICE_TITLE_H;
    l->has_notice_queue = in->notice_many;
    if (l->has_notice_queue) {
      l->notice_queue = rect(ix, y, iw, LAYOUT_NOTICE_QUEUE_H);
      l->has_notice_skip = 1;
      l->skip_prev = rect(ix, y, 36, LAYOUT_NOTICE_QUEUE_H);
      l->skip_next = rect(ix + iw - 36, y, 36, LAYOUT_NOTICE_QUEUE_H);
      y += LAYOUT_NOTICE_QUEUE_H;
    }
    l->notice_lines = rect(ix, y, iw, lines * LAYOUT_NOTICE_LINE_H);
    y += lines * LAYOUT_NOTICE_LINE_H + LAYOUT_NOTICE_GAP;
    int bw = (iw - 6) * 3 / 5; // "A: Visto" más ancho que "Leer todo"
    l->btn_ack = rect(ix, y, bw, LAYOUT_NOTICE_BTN_H);
    l->btn_notice_read = rect(ix + bw + 6, y, iw - bw - 6, LAYOUT_NOTICE_BTN_H);
    bottom = l->notice.y - 3;
  }
  l->content = rect(0, top, LAYOUT_W, bottom - top);
  l->footer_top = l->content.y + l->content.h;

  // contenido
  if (in->level == LAYOUT_AGENTS) {
    int cols = LAYOUT_TILE_COLS, gap = 4;
    int tw = (LAYOUT_W - 2 * LAYOUT_MARGIN - (cols - 1) * gap) / cols;
    int th = (l->content.h - gap) / 2;
    if (th > 96) th = 96;
    l->tile_compact = th < LAYOUT_TILE_COMPACT_BELOW;
    int shown = in->item_count < AGENT_COUNT ? in->item_count : AGENT_COUNT; // solo los agentes no ocultos
    for (int i = 0; i < shown; i++) {
      int c = i % cols, r = i / cols;
      l->tiles[i] = rect(LAYOUT_MARGIN + c * (tw + gap), l->content.y + r * (th + gap), tw, th);
      add_zone(l, ZONE_ITEM, l->tiles[i], i);
    }
  } else if (in->level == LAYOUT_SESSIONS) {
    int vis = clampi((l->content.h + (LAYOUT_ROW_PITCH - LAYOUT_ROW_H)) / LAYOUT_ROW_PITCH, 1, LAYOUT_MAX_ROWS);
    l->visible_rows = vis;
    l->scroll = layout_scroll_for_cursor(in->scroll, in->cursor, vis, in->item_count);
    for (int i = 0; i < vis && l->scroll + i < in->item_count; i++) {
      l->rows[i] = rect(LAYOUT_MARGIN, l->content.y + i * LAYOUT_ROW_PITCH, LAYOUT_W - 2 * LAYOUT_MARGIN - 4, LAYOUT_ROW_H);
      add_zone(l, ZONE_ITEM, l->rows[i], l->scroll + i);
    }
  } else if (!l->has_card) {
    // detalle: al pie, la entrada al lector del mensaje completo (con tarjeta de permiso o de aviso, A no abre nada: aprueba
    // o marca "Visto", y no se ofrece) y, a su derecha, el modo de aviso de la sesión
    int y = l->content.y + l->content.h - LAYOUT_READ_H;
    if (in->detail_instruct && !l->has_notice) {
      int yb = y - LAYOUT_READ_H - LAYOUT_STRIP_GAP;
      l->has_instruct = 1;
      l->btn_instruct = rect(LAYOUT_MARGIN, yb, 150, LAYOUT_READ_H);
      l->btn_wait = rect(LAYOUT_MARGIN + 150 + 4, yb, LAYOUT_W - 2 * LAYOUT_MARGIN - 150 - 4, LAYOUT_READ_H);
      add_zone(l, ZONE_INSTRUCT, l->btn_instruct, 0);
      add_zone(l, ZONE_WAIT, l->btn_wait, 0);
      l->footer_top = yb;
      if (in->detail_queue) {
        int yc = yb - LAYOUT_QUEUE_H - LAYOUT_STRIP_GAP;
        l->has_queue_box = 1;
        l->queue_box = rect(LAYOUT_MARGIN, yc, LAYOUT_W - 2 * LAYOUT_MARGIN, LAYOUT_QUEUE_H);
        l->btn_clear = rect(LAYOUT_W - LAYOUT_MARGIN - 88, yc + 1, 86, 16);
        add_zone(l, ZONE_CLEAR, l->btn_clear, 0);
        l->footer_top = yc;
      }
    }
    if (!l->has_notice) {
      l->has_read = 1;
      l->btn_read = rect(LAYOUT_MARGIN, y, 150, LAYOUT_READ_H);
      add_zone(l, ZONE_READ, l->btn_read, 0);
    }
    if (in->detail_notify) {
      l->has_notify = 1;
      l->btn_notify = rect(LAYOUT_MARGIN + 150 + 4, y, LAYOUT_W - 2 * LAYOUT_MARGIN - 150 - 4, LAYOUT_READ_H);
      add_zone(l, ZONE_NOTIFY, l->btn_notify, 0);
    }
    if ((l->has_read || l->has_notify) && y < l->footer_top) l->footer_top = y;
  }

  // botones de la barra y de la tarjeta (encima de lo anterior)
  if (l->has_back) add_zone(l, ZONE_BACK, l->back_btn, 0);
  add_zone(l, ZONE_MODE, l->mode_btn, 0);
  if (l->has_card) {
    if (l->has_skip) {
      add_zone(l, ZONE_SKIP_PREV, l->skip_prev, 0);
      add_zone(l, ZONE_SKIP_NEXT, l->skip_next, 0);
    }
    add_zone(l, ZONE_APPROVE, l->btn_approve, 0);
    if (l->has_always) add_zone(l, ZONE_ALWAYS, l->btn_always, 0);
    add_zone(l, ZONE_DENY, l->btn_deny, 0);
  }
  if (l->has_notice) {
    if (l->has_notice_skip) {
      add_zone(l, ZONE_SKIP_PREV, l->skip_prev, 0);
      add_zone(l, ZONE_SKIP_NEXT, l->skip_next, 0);
    }
    add_zone(l, ZONE_ACK, l->btn_ack, 0);
    add_zone(l, ZONE_NOTICE_READ, l->btn_notice_read, 0);
  }
}

const Zone *layout_hit(const BottomLayout *l, int x, int y) {
  for (int i = l->zone_count - 1; i >= 0; i--) {
    if (rect_contains(&l->zones[i].r, x, y)) return &l->zones[i];
  }
  return NULL;
}

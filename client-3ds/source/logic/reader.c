#include "reader.h"

#include <string.h>

static Rect rect(int x, int y, int w, int h) {
  Rect r = {x, y, w, h};
  return r;
}

void reader_init(Reader *r) { memset(r, 0, sizeof *r); }

void reader_close(Reader *r) { reader_init(r); }

static void copy_id(char dst[VIEW_ID_BYTES], const char *src) {
  size_t n = strlen(src);
  if (n > VIEW_MAX_ID) n = VIEW_MAX_ID;
  memcpy(dst, src, n);
  dst[n] = '\0';
}

// ¿El detalle que muestra la vista es el de esta sesión?
static int detail_of(const Reader *r, const View *v) {
  return v != NULL && v->has_detail && strcmp(v->detail.session_id, r->session_id) == 0;
}

static void take_snapshot(Reader *r, const View *v) {
  r->snap_known = 0;
  r->snap_count = 0;
  if (!detail_of(r, v)) return; // el detalle todavía no llegó: se toma con la primera vista que lo traiga
  r->snap_count = v->detail.line_count;
  for (int i = 0; i < r->snap_count; i++) memcpy(r->snap[i], v->detail.last_message[i], sizeof r->snap[i]);
  r->snap_known = 1;
}

void reader_open(Reader *r, const char *session_id, uint32_t read_seq, const View *v) {
  reader_init(r);
  copy_id(r->session_id, session_id);
  r->state = READER_LOADING;
  r->seq0 = read_seq;
  take_snapshot(r, v);
}

int reader_shown_mode(const Reader *r, const ReadDoc *doc) {
  if (r->state == READER_SHOWING && doc != NULL) return doc->mode == READ_MODE_SUMMARY ? READ_MODE_SUMMARY : READ_MODE_FULL;
  return r->mode == READ_MODE_SUMMARY ? READ_MODE_SUMMARY : READ_MODE_FULL;
}

void reader_on_doc(Reader *r, const ReadDoc *doc, uint32_t read_seq) {
  if (r->state == READER_CLOSED || doc == NULL || read_seq == r->seq0) return;
  if (strcmp(doc->session_id, r->session_id) != 0) return; // respuesta de otra sesión: no es la que se pidió
  r->seq0 = read_seq;
  if (r->state == READER_LOADING) r->top = 0;
  r->state = READER_SHOWING;
  reader_clamp(r, doc);
}

void reader_view_changed(Reader *r, const View *v) {
  if (r->state == READER_CLOSED || v == NULL) return;
  if (!r->snap_known) {
    take_snapshot(r, v);
    return;
  }
  if (!detail_of(r, v)) return;
  if (v->detail.line_count != r->snap_count) {
    r->stale = 1;
    return;
  }
  for (int i = 0; i < r->snap_count; i++) {
    if (strcmp(v->detail.last_message[i], r->snap[i]) != 0) {
      r->stale = 1;
      return;
    }
  }
}

void reader_layout(int question_lines, int stale, ReaderLayout *out) {
  memset(out, 0, sizeof *out);
  out->bar = rect(0, READER_BAR_Y, LAYOUT_W, READER_BAR_H);
  out->back_btn = rect(LAYOUT_W - READER_MARGIN - 62, READER_BAR_Y + 1, 62, READER_BAR_H - 2);
  out->pos = rect(out->back_btn.x - 6 - 64, READER_BAR_Y, 64, READER_BAR_H);
  int y = READER_BAR_Y + READER_BAR_H + 2;
  out->has_stale = stale;
  if (stale) {
    out->stale = rect(READER_MARGIN, y, LAYOUT_W - 2 * READER_MARGIN, READER_STALE_H);
    y += READER_STALE_H + 2;
  }
  if (question_lines < 0) question_lines = 0;
  if (question_lines > VIEW_MAX_QUESTION_LINES) question_lines = VIEW_MAX_QUESTION_LINES;
  out->question_lines = question_lines;
  if (question_lines > 0) {
    int h = READER_QUESTION_HEAD_H + READER_QUESTION_ROW_H * question_lines + 2;
    out->question = rect(READER_MARGIN, y, LAYOUT_W - 2 * READER_MARGIN, h);
    y += h + 3;
  }
  int bottom = LAYOUT_H - 2 - READER_FOOT_H;
  out->foot = rect(0, bottom, LAYOUT_W, READER_FOOT_H);
  out->body = rect(0, y, LAYOUT_W, bottom - y);
  out->rows = out->body.h / READER_ROW_H;
  if (out->rows < 1) out->rows = 1;
}

static void layout_for(const Reader *r, const ReadDoc *doc, ReaderLayout *l) {
  reader_layout(doc != NULL && r->state == READER_SHOWING ? doc->question_count : 0, r->stale, l);
}

int reader_max_top(const ReadDoc *doc, const ReaderLayout *l) {
  int total = doc != NULL ? reading_total_lines(doc) : 0;
  return total > l->rows ? total - l->rows : 0;
}

void reader_clamp(Reader *r, const ReadDoc *doc) {
  ReaderLayout l;
  layout_for(r, doc, &l);
  int max = reader_max_top(doc, &l);
  if (r->top > max) r->top = max;
  if (r->top < 0) r->top = 0;
}

int reader_scroll(Reader *r, const ReadDoc *doc, int delta) {
  if (r->state != READER_SHOWING || doc == NULL) return 0;
  int before = r->top;
  r->top += delta;
  reader_clamp(r, doc);
  return r->top != before;
}

int reader_page(Reader *r, const ReadDoc *doc, int dir) {
  ReaderLayout l;
  layout_for(r, doc, &l);
  int step = l.rows > 1 ? l.rows - 1 : 1;
  return reader_scroll(r, doc, dir < 0 ? -step : step);
}

void reader_position(const Reader *r, const ReadDoc *doc, int *first, int *last, int *total) {
  *first = *last = *total = 0;
  if (r->state != READER_SHOWING || doc == NULL) return;
  ReaderLayout l;
  layout_for(r, doc, &l);
  *total = reading_total_lines(doc);
  if (*total == 0) return;
  *first = r->top + 1;
  *last = r->top + l.rows;
  if (*last > *total) *last = *total;
}

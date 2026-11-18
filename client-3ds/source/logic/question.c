#include "question.h"

#include <string.h>

static void copy_id(char dst[VIEW_ID_BYTES], const char *src) {
  size_t n = strlen(src);
  if (n > VIEW_MAX_ID) n = VIEW_MAX_ID;
  memcpy(dst, src, n);
  dst[n] = '\0';
}

void question_init(Question *q) { memset(q, 0, sizeof *q); }

void question_connection(Question *q, int connected) { q->connected = connected ? 1 : 0; }

void question_view(Question *q, uint64_t now, const RequestView *req) {
  int connected = q->connected;
  if (req == NULL || req->kind != REQ_QUESTION || req->question_count < 1) {
    question_init(q);
    q->connected = connected;
    return;
  }
  if (q->has_id && strcmp(q->id, req->id) == 0) return; // la misma tarjeta: no reinicia nada
  question_init(q);
  q->connected = connected;
  q->has_id = 1;
  copy_id(q->id, req->id);
  q->since = now;
}

int question_rows(const QuestionView *qv, QuestionRow rows[QUESTION_MAX_ROWS]) {
  int n = 0;
  for (int i = 0; i < qv->option_count && n < QUESTION_MAX_ROWS; i++) {
    rows[n].kind = QROW_OPTION;
    rows[n].option = i;
    n++;
  }
  if (qv->multi) {
    rows[n].kind = QROW_DONE;
    rows[n].option = -1;
    n++;
  }
  rows[n].kind = QROW_OTHER;
  rows[n].option = -1;
  n++;
  rows[n].kind = QROW_PC;
  rows[n].option = -1;
  n++;
  return n;
}

const QuestionView *question_current(const Question *q, const RequestView *req) {
  if (req == NULL || req->kind != REQ_QUESTION || req->question_count < 1) return NULL;
  int i = q->index < req->question_count ? q->index : req->question_count - 1;
  return &req->questions[i];
}

int question_ready(const Question *q, uint64_t now) {
  return q->connected && q->has_id && !q->sent && (int64_t)now - (int64_t)q->since >= QUESTION_GUARD_MS;
}

void question_move(Question *q, const RequestView *req, int dy) {
  const QuestionView *qv = question_current(q, req);
  if (qv == NULL || q->sent) return;
  QuestionRow rows[QUESTION_MAX_ROWS];
  int n = question_rows(qv, rows);
  int c = q->cursor + (dy > 0 ? 1 : dy < 0 ? -1 : 0);
  if (c < 0) c = 0;
  if (c > n - 1) c = n - 1;
  q->cursor = c;
}

void question_select(Question *q, const RequestView *req, int row) {
  const QuestionView *qv = question_current(q, req);
  if (qv == NULL || q->sent) return;
  QuestionRow rows[QUESTION_MAX_ROWS];
  if (row < 0 || row >= question_rows(qv, rows)) return;
  q->cursor = row;
}

// Guarda la respuesta de la pregunta actual y pasa a la siguiente; si era la última, manda todas.
static QuestionOut advance(Question *q, const RequestView *req, uint64_t now, const MsgAnswer *answer) {
  QuestionOut out = {QOUT_NONE};
  q->answers[q->index] = *answer;
  q->answer_count = q->index + 1;
  if (q->index + 1 < req->question_count) {
    q->index++;
    q->cursor = 0;
    q->since = now; // la guarda vuelve a contar: un doble toque no elige también la siguiente
    return out;
  }
  q->sent = 1;
  q->send_pc = 0;
  out.kind = QOUT_SEND;
  return out;
}

QuestionOut question_activate(Question *q, const RequestView *req, uint64_t now, int row, int repeat) {
  QuestionOut none = {QOUT_NONE};
  const QuestionView *qv = question_current(q, req);
  if (qv == NULL || repeat || !question_ready(q, now)) return none;
  QuestionRow rows[QUESTION_MAX_ROWS];
  int n = question_rows(qv, rows);
  if (row < 0) row = q->cursor;
  if (row < 0 || row >= n) return none;
  q->cursor = row;
  const QuestionRow *r = &rows[row];
  MsgAnswer a;
  memset(&a, 0, sizeof a);
  switch (r->kind) {
    case QROW_OPTION:
      if (qv->multi) {
        q->marks[q->index] ^= 1u << (unsigned)r->option;
        return none;
      }
      a.mask = 1u << (unsigned)r->option;
      return advance(q, req, now, &a);
    case QROW_DONE:
      if (q->marks[q->index] == 0) return none; // al menos una
      a.mask = q->marks[q->index];
      return advance(q, req, now, &a);
    case QROW_OTHER: {
      QuestionOut o = {QOUT_OTHER};
      return o;
    }
    case QROW_PC: {
      q->sent = 1;
      q->send_pc = 1;
      QuestionOut o = {QOUT_SEND_PC};
      return o;
    }
  }
  return none;
}

void question_back(Question *q) {
  if (q->sent || q->index == 0) return;
  q->index--;
  q->cursor = 0;
  q->answer_count = q->index;
}

QuestionOut question_text(Question *q, const RequestView *req, uint64_t now, const char *text) {
  QuestionOut none = {QOUT_NONE};
  if (text == NULL || question_current(q, req) == NULL || q->sent) return none;
  MsgAnswer a;
  memset(&a, 0, sizeof a);
  a.is_other = 1;
  // espacios de los extremos fuera, cualquier racha de espacios o saltos en uno solo, hasta 200 caracteres
  size_t w = 0;
  int chars = 0, pending_space = 0;
  for (const unsigned char *p = (const unsigned char *)text; *p; p++) {
    if (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r') {
      pending_space = w > 0;
      continue;
    }
    int lead = (*p & 0xc0) != 0x80; // los bytes de continuación no cuentan como carácter
    if (lead) {
      if (chars + (pending_space ? 2 : 1) > MSG_OTHER_MAX_CHARS) break;
      if (pending_space) {
        a.other[w++] = ' ';
        chars++;
        pending_space = 0;
      }
      chars++;
    } else if (w == 0) {
      continue;
    }
    if (w + 1 >= sizeof a.other) break;
    a.other[w++] = (char)*p;
  }
  a.other[w] = '\0';
  if (w == 0) return none;
  return advance(q, req, now, &a);
}

void question_sent(Question *q, int rc) {
  if (rc == 0) return;
  q->sent = 0; // no salió: se puede volver a responder
  q->send_pc = 0;
}

int question_answered(const Question *q, int i) { return i >= 0 && i < q->answer_count; }

// ---- geometría ----

#define Q_X 8
#define Q_W 304
#define Q_TOP 4
#define Q_HEADER_H 14
#define Q_TEXT_LINE_H 13
#define Q_ROW_H 18
#define Q_ROW_GAP 1
#define Q_DESC_H 28
#define Q_HINT_H 12

void question_layout(const QuestionView *qv, QuestionLayout *out) {
  memset(out, 0, sizeof *out);
  int lines = qv->text_count < 1 ? 1 : qv->text_count > VIEW_MAX_QUESTION_LINES ? VIEW_MAX_QUESTION_LINES : qv->text_count;
  out->header.x = Q_X;
  out->header.y = Q_TOP;
  out->header.w = Q_W;
  out->header.h = Q_HEADER_H;
  out->text.x = Q_X;
  out->text.y = Q_TOP + Q_HEADER_H;
  out->text.w = Q_W;
  out->text.h = lines * Q_TEXT_LINE_H;
  QuestionRow rows[QUESTION_MAX_ROWS];
  out->row_count = question_rows(qv, rows);
  int y = out->text.y + out->text.h + 3;
  for (int i = 0; i < out->row_count; i++) {
    out->rows[i].x = Q_X;
    out->rows[i].y = y;
    out->rows[i].w = Q_W;
    out->rows[i].h = Q_ROW_H;
    y += Q_ROW_H + Q_ROW_GAP;
  }
  // la descripción y la ayuda van pegadas al pie: la pregunta más alta (3 líneas, 4 opciones, multiSelect) sigue cabiendo
  out->hint.x = Q_X;
  out->hint.y = LAYOUT_H - Q_HINT_H - 2;
  out->hint.w = Q_W;
  out->hint.h = Q_HINT_H;
  out->desc.x = Q_X;
  out->desc.y = out->hint.y - Q_DESC_H;
  out->desc.w = Q_W;
  out->desc.h = Q_DESC_H;
}

int question_hit_row(const QuestionView *qv, int x, int y) {
  QuestionLayout l;
  question_layout(qv, &l);
  for (int i = 0; i < l.row_count; i++) {
    if (rect_contains(&l.rows[i], x, y)) return i;
  }
  return -1;
}

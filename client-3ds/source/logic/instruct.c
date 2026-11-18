#include "instruct.h"

#include <string.h>

static void copy_id(char dst[VIEW_ID_BYTES], const char *src) {
  size_t n = strlen(src);
  if (n > VIEW_MAX_ID) n = VIEW_MAX_ID;
  memcpy(dst, src, n);
  dst[n] = '\0';
}

void instruct_init(Instruct *i) { memset(i, 0, sizeof *i); }

void instruct_connection(Instruct *i, int connected) { i->connected = connected ? 1 : 0; }

void instruct_view(Instruct *i, uint64_t now, const RequestView *req) {
  int connected = i->connected;
  if (req == NULL || req->kind != REQ_INSTRUCTION) {
    instruct_init(i);
    i->connected = connected;
    return;
  }
  if (i->has_id && strcmp(i->id, req->id) == 0) return; // la misma tarjeta: no reinicia nada
  instruct_init(i);
  i->connected = connected;
  i->has_id = 1;
  copy_id(i->id, req->id);
  i->since = now;
  i->quick_n = req->quick_count < 0 ? 0 : req->quick_count > VIEW_MAX_QUICK ? VIEW_MAX_QUICK : req->quick_count;
  i->cursor = i->quick_n; // Escribir
}

int instruct_row_count(const Instruct *i) { return i->quick_n + INSTRUCT_ROWS; }
int instruct_write_row(const Instruct *i) { return i->quick_n; }

int instruct_ready(const Instruct *i, uint64_t now) {
  return i->connected && i->has_id && !i->sent && (int64_t)now - (int64_t)i->since >= INSTRUCT_GUARD_MS;
}

void instruct_move(Instruct *i, int dy) {
  if (!i->has_id || i->sent || dy == 0) return;
  int n = i->quick_n;
  int c = i->cursor;
  if (dy > 0) {
    if (c < n) c = (c + 2 < n) ? c + 2 : n; // atajos: baja una fila; desde la última, a Escribir
    else if (c < n + INSTRUCT_ROWS - 1) c++;
  } else {
    if (c > n) c--;
    else if (c == n) c = n > 0 ? n - 1 : n; // de Escribir al último atajo
    else if (c - 2 >= 0) c -= 2;
  }
  i->cursor = c;
}

void instruct_move_x(Instruct *i, int dx) {
  if (!i->has_id || i->sent || i->cursor >= i->quick_n) return;
  int c = i->cursor;
  if (dx > 0 && c % 2 == 0 && c + 1 < i->quick_n) i->cursor = c + 1;
  else if (dx < 0 && c % 2 == 1) i->cursor = c - 1;
}

void instruct_select(Instruct *i, int row) {
  if (!i->has_id || i->sent || row < 0 || row >= instruct_row_count(i)) return;
  i->cursor = row;
}

InstructOut instruct_activate(Instruct *i, uint64_t now, int row, int repeat) {
  InstructOut out = {IOUT_NONE, 0};
  if (repeat || !instruct_ready(i, now)) return out;
  if (row < 0) row = i->cursor;
  if (row >= instruct_row_count(i)) return out;
  i->cursor = row;
  if (row < i->quick_n) {
    i->sent = 1; // el atajo sale en el acto: no se vuelve a mandar (instruct_sent con rc != 0 lo libera)
    out.kind = IOUT_QUICK;
    out.index = row;
    return out;
  }
  if (row == i->quick_n) {
    out.kind = IOUT_WRITE; // el teclado no marca la tarjeta como enviada: se puede cancelar
    return out;
  }
  i->sent = 1;
  out.kind = IOUT_RELEASE;
  return out;
}

void instruct_sent(Instruct *i, int rc) {
  if (rc != 0) i->sent = 0; // no salió: se puede volver a elegir
  else i->sent = 1;
}

int instruct_clean(const char *text, char *out, size_t cap) {
  if (cap == 0) return 0;
  out[0] = '\0';
  if (text == NULL) return 0;
  size_t n = 0;
  int chars = 0;
  const unsigned char *p = (const unsigned char *)text;
  // 1) recorta los extremos (espacios y controles) y pasa los controles internos a espacio
  while (*p != '\0' && (*p <= ' ' || *p == 0x7f)) p++;
  const unsigned char *last = p + strlen((const char *)p);
  while (last > p && (last[-1] <= ' ' || last[-1] == 0x7f)) last--;
  while (p < last && chars < MSG_INSTRUCT_MAX_CHARS) {
    unsigned c = *p;
    size_t len = c < 0x80 ? 1 : (c >> 5) == 0x6 ? 2 : (c >> 4) == 0xe ? 3 : (c >> 3) == 0x1e ? 4 : 1;
    if (p + len > last || n + len + 1 > cap) break;
    if (len == 1 && (c < 0x20 || c == 0x7f)) {
      out[n++] = ' ';
    } else {
      memcpy(out + n, p, len);
      n += len;
    }
    p += len;
    chars++;
  }
  // 2) un corte puede haber dejado espacios al final
  while (n > 0 && out[n - 1] == ' ') {
    n--;
    chars--;
  }
  out[n] = '\0';
  return chars;
}

// ---- geometría ----

void instruct_layout_n(InstructLayout *l, int quick_n) {
  if (quick_n < 0) quick_n = 0;
  if (quick_n > VIEW_MAX_QUICK) quick_n = VIEW_MAX_QUICK;
  memset(l, 0, sizeof *l);
  l->rows_n = quick_n + INSTRUCT_ROWS;
  if (quick_n == 0) {
    l->header = (Rect){8, 6, 304, 22};
    l->label = (Rect){8, 34, 304, 14};
    l->text = (Rect){8, 50, 304, 3 * 14};
    l->text_pitch = 14;
    l->rows[0] = (Rect){8, 104, 304, 40};
    l->rows[1] = (Rect){8, 150, 304, 40};
    l->hint = (Rect){8, 200, 304, 26};
    return;
  }
  l->compact = 1;
  l->header = (Rect){8, 4, 304, 20};
  l->label = (Rect){8, 26, 304, 12};
  l->text = (Rect){8, 39, 304, 3 * 13};
  l->text_pitch = 13;
  // atajos en dos columnas de 150 px (4 px de separación), 24 px de alto y 4 px entre filas
  for (int k = 0; k < quick_n; k++) l->rows[k] = (Rect){8 + (k % 2) * 154, 82 + (k / 2) * 28, 150, 24};
  int ye = 82 + ((quick_n + 1) / 2) * 28;
  l->rows[quick_n] = (Rect){8, ye + 2, 304, 26};
  l->rows[quick_n + 1] = (Rect){8, ye + 32, 304, 26};
  l->help = (Rect){8, ye + 62, 304, 14};
  l->hint = (Rect){8, 222, 304, 14};
}

void instruct_layout(InstructLayout *l) { instruct_layout_n(l, 0); }

int instruct_hit_row(int quick_n, int x, int y) {
  InstructLayout l;
  instruct_layout_n(&l, quick_n);
  for (int i = 0; i < l.rows_n; i++) {
    if (rect_contains(&l.rows[i], x, y)) return i;
  }
  return -1;
}

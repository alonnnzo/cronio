#include "update.h"

#include <stdio.h>
#include <string.h>

#include "utf8util.h"

void update_init(Update *u, const char *current, int is_cia) {
  memset(u, 0, sizeof *u);
  snprintf(u->current, sizeof u->current, "%s", current != NULL ? current : "");
  u->is_cia = is_cia != 0;
  u->phase = UPD_IDLE;
}

void update_view(Update *u, const View *v) {
  if (v == NULL) {
    u->connected = 0; // lo último que se supo se conserva (p. ej. para reintentar), pero ya no se sabe si el puente sigue ofreciéndolo
    return;
  }
  u->connected = 1;
  u->has_offer = 0;
  if (v->has_update && version_compare_str(u->current, v->update.version) == -1) {
    u->has_offer = 1;
    snprintf(u->offer, sizeof u->offer, "%s", v->update.version);
    snprintf(u->url, sizeof u->url, "%s", v->update.url);
    u->offer_size = v->update.size;
    memcpy(u->offer_sha, v->update.sha256, sizeof u->offer_sha);
  }
}

int update_card_visible(const Update *u, const View *v) {
  return u->phase == UPD_IDLE && u->has_offer && !u->dismissed && v != NULL && !v->has_request && !v->has_notice;
}

int update_screen_showing(const Update *u, const View *v, int covered) {
  if (u->phase != UPD_IDLE) return 1;
  return !covered && update_card_visible(u, v);
}

int update_sync(Update *u, const View *v, int covered, uint64_t now) {
  update_view(u, v);
  // las solicitudes y los avisos con "Visto" van siempre antes: la pantalla del menú y la del error ceden (con el error, además, no se vuelve a ofrecer sola)
  if (v != NULL && (v->has_request || v->has_notice) && (u->phase == UPD_PAGE || u->phase == UPD_FAIL)) {
    if (u->phase == UPD_FAIL) u->dismissed = 1;
    u->phase = UPD_IDLE;
    u->shown = 0;
  }
  int showing = update_screen_showing(u, v, covered);
  int appeared = showing && !u->shown;
  if (appeared) u->since = now; // la guarda de 500 ms empieza cada vez que la pantalla vuelve a verse
  u->shown = showing;
  return appeared;
}

int update_ready(const Update *u, uint64_t now) { return u->shown && now >= u->since && now - u->since >= UPDATE_GUARD_MS; }

int update_can_install(const Update *u) {
  return u->is_cia && u->has_offer && u->url[0] != '\0' && (u->phase == UPD_IDLE || u->phase == UPD_PAGE || u->phase == UPD_FAIL);
}

UpdOut update_a(Update *u, uint64_t now) {
  if (!update_ready(u, now) || !update_can_install(u)) return UPD_OUT_NONE;
  u->phase = UPD_RUN;
  u->step = UPD_STEP_CONNECT;
  u->done = u->total = 0;
  u->error[0] = '\0';
  u->shown = 1;
  u->since = now;
  return UPD_OUT_START;
}

void update_b(Update *u, uint64_t now) {
  (void)now;
  switch (u->phase) {
    case UPD_IDLE:
      u->dismissed = 1; // «Ahora no»: hasta el próximo arranque
      u->shown = 0;
      break;
    case UPD_PAGE:
      u->phase = UPD_IDLE;
      u->shown = 0;
      break;
    case UPD_FAIL:
      u->phase = UPD_IDLE;
      u->dismissed = 1; // no se vuelve a ofrecer sola después de un error; el menú sigue permitiendo reintentar
      u->shown = 0;
      break;
    case UPD_RUN:
    case UPD_DONE: break;
  }
}

void update_open_page(Update *u, uint64_t now) {
  if (u->phase != UPD_IDLE) return;
  u->phase = UPD_PAGE;
  u->shown = 1;
  u->since = now;
}

void update_set_step(Update *u, UpdStep step) {
  if (u->phase == UPD_RUN) u->step = step;
}

void update_set_progress(Update *u, uint32_t done, uint32_t total) {
  if (u->phase != UPD_RUN) return;
  if (total > 0 && done > total) done = total;
  u->done = done;
  u->total = total;
}

void update_fail(Update *u, const char *msg, uint64_t now) {
  u->phase = UPD_FAIL;
  utf8_clip(msg != NULL ? msg : "", u->error, sizeof u->error, 200); // el mensaje entero, con su código: se parte en líneas al dibujarlo
  u->shown = 1;
  u->since = now;
}

void update_done(Update *u, int can_restart, uint64_t now) {
  u->phase = UPD_DONE;
  u->step = UPD_STEP_FINISH;
  if (u->total > 0) u->done = u->total;
  u->can_restart = can_restart != 0;
  u->finished_at = now;
  u->shown = 1;
  u->since = now;
}

int update_restart_due(const Update *u, uint64_t now) {
  return u->phase == UPD_DONE && u->can_restart && now >= u->finished_at && now - u->finished_at >= UPDATE_RESTART_MS;
}

int update_blocks_quit(const Update *u) { return u->phase == UPD_RUN || (u->phase == UPD_DONE && u->can_restart); }

// ---------- textos ----------

int update_permille(uint32_t done, uint32_t total) {
  if (total == 0) return 0;
  if (done > total) done = total;
  return (int)(((uint64_t)done * 1000u) / total);
}

int update_bar_permille(UpdStep step, uint32_t done, uint32_t total) {
  int p = update_permille(done, total);
  switch (step) {
    case UPD_STEP_CONNECT:
    case UPD_STEP_REQUEST: return 0;
    case UPD_STEP_DOWNLOAD: return p * UPDATE_DOWNLOAD_PERMILLE / 1000;
    case UPD_STEP_INSTALL: return UPDATE_DOWNLOAD_PERMILLE + p * (1000 - UPDATE_DOWNLOAD_PERMILLE) / 1000;
    case UPD_STEP_FINISH: return 1000;
  }
  return 0;
}

int update_step_number(UpdStep step) { return (int)step + 1; }

void update_format_kb(char *out, size_t cap, uint32_t done, uint32_t total) {
  if (cap == 0) return;
  if (total > 0 && done > total) done = total;
  unsigned d = done / 1024u;
  if (total == 0) {
    snprintf(out, cap, "%u KB", d);
    return;
  }
  unsigned t = (unsigned)(((uint64_t)total + 1023u) / 1024u);
  if (d > t || done >= total) d = t; // al terminar dice "353 KB de 353 KB", no "352 de 353"
  snprintf(out, cap, "%u KB de %u KB", d, t);
}

// Bytes de la secuencia UTF-8 que empieza en `s` (1 si es inválida).
static size_t cp_len(const char *s) {
  unsigned char c = (unsigned char)s[0];
  size_t n = c >= 0xF0 ? 4 : c >= 0xE0 ? 3 : c >= 0xC0 ? 2 : 1;
  for (size_t i = 1; i < n; i++) {
    if (((unsigned char)s[i] & 0xC0) != 0x80) return 1;
  }
  return n;
}

int update_wrap(const char *text, int max_chars, char out[][UPDATE_LINE_BYTES], int max_lines) {
  if (max_lines <= 0 || max_chars <= 0) return 0;
  int lines = 0;
  size_t used = 0; // bytes de la línea en curso
  int chars = 0;   // caracteres de la línea en curso
  const char *p = text;
  out[0][0] = '\0';
  for (;;) {
    while (*p == ' ') p++;
    if (*p == '\0') break;
    size_t wbytes = 0;
    int wchars = 0;
    while (p[wbytes] != '\0' && p[wbytes] != ' ') {
      wbytes += cp_len(p + wbytes);
      wchars++;
    }
    if (wchars > max_chars) { // una palabra más larga que la línea se corta; el resto sigue como otra palabra
      wbytes = utf8_prefix_bytes(p, (size_t)max_chars);
      wchars = max_chars;
    }
    int need = chars > 0;
    if (chars + need + wchars > max_chars) {
      if (lines + 1 >= max_lines) break; // no hay más sitio
      lines++;
      out[lines][0] = '\0';
      used = 0;
      chars = 0;
      need = 0;
    }
    if (used + (size_t)need + wbytes + 1 > UPDATE_LINE_BYTES) break;
    if (need) out[lines][used++] = ' ';
    memcpy(out[lines] + used, p, wbytes);
    used += wbytes;
    out[lines][used] = '\0';
    chars += need + wchars;
    p += wbytes;
  }
  return chars > 0 ? lines + 1 : lines;
}

static void add_line(UpdateScreen *s, const char *text) {
  if (s->line_count < UPDATE_MAX_LINES) snprintf(s->lines[s->line_count++], UPDATE_LINE_BYTES, "%.71s", text); // 71 = UPDATE_LINE_BYTES - 1
}

// Agrega un texto largo partido en líneas de hasta 46 caracteres.
static void add_wrapped(UpdateScreen *s, const char *text) {
  char tmp[UPDATE_MAX_LINES][UPDATE_LINE_BYTES];
  int n = update_wrap(text, 46, tmp, UPDATE_MAX_LINES - s->line_count);
  for (int i = 0; i < n; i++) add_line(s, tmp[i]);
}

static const char *step_text(UpdStep step) {
  switch (step) {
    case UPD_STEP_CONNECT: return "Conectando con el PC…";
    case UPD_STEP_REQUEST: return "Pidiendo la versión nueva…";
    case UPD_STEP_DOWNLOAD: return "Descargando del PC…";
    case UPD_STEP_INSTALL: return "Instalando…";
    case UPD_STEP_FINISH: return "Terminando la instalación…";
  }
  return "";
}

static void offer_lines(const Update *u, UpdateScreen *s) {
  char b[UPDATE_LINE_BYTES];
  snprintf(b, sizeof b, "Hay una versión nueva de Cronio (%s).", u->offer);
  add_line(s, b);
  snprintf(b, sizeof b, "Tienes la %s.", u->current);
  add_line(s, b);
  add_line(s, "");
  if (u->is_cia) {
    add_line(s, "Se descarga del PC y se instala sola.");
    add_line(s, "Cronio se reinicia al terminar.");
  } else {
    add_wrapped(s, "Así, como .3dsx, no se puede instalar sola. Instálala como .cia desde el paso 4 del programa del PC (QR con FBI).");
  }
}

void update_screen(const Update *u, uint64_t now, UpdateScreen *s) {
  memset(s, 0, sizeof *s);
  snprintf(s->label, sizeof s->label, "ACTUALIZACIÓN");
  s->ready = update_ready(u, now);
  char b[UPDATE_LINE_BYTES];
  switch (u->phase) {
    case UPD_RUN:
      snprintf(s->title, sizeof s->title, "Actualizando Cronio");
      add_line(s, step_text(u->step));
      snprintf(b, sizeof b, "Paso %d de %d", update_step_number(u->step), UPDATE_STEPS);
      add_line(s, b);
      add_line(s, "No apagues la consola ni cierres Cronio.");
      s->has_bar = 1;
      s->permille = update_bar_permille(u->step, u->done, u->total);
      snprintf(s->bar_text, sizeof s->bar_text, "%d %%", s->permille / 10);
      if (u->step >= UPD_STEP_DOWNLOAD && u->total > 0) update_format_kb(s->kb_text, sizeof s->kb_text, u->done, u->total);
      break;
    case UPD_DONE:
      s->tone = UPD_TONE_OK;
      snprintf(s->title, sizeof s->title, "Listo");
      add_line(s, u->can_restart ? "Listo. Cronio se va a reiniciar." : "Listo. Cierra Cronio y ábrela otra vez.");
      snprintf(b, sizeof b, "Ya tienes la versión %s.", u->offer);
      add_line(s, b);
      s->has_bar = 1;
      s->permille = 1000;
      snprintf(s->bar_text, sizeof s->bar_text, "100 %%");
      if (u->total > 0) update_format_kb(s->kb_text, sizeof s->kb_text, u->total, u->total);
      break;
    case UPD_FAIL:
      s->tone = UPD_TONE_BAD;
      snprintf(s->title, sizeof s->title, "No se pudo actualizar");
      add_wrapped(s, u->error);
      add_line(s, "");
      snprintf(b, sizeof b, "Se mantiene la versión actual (%s).", u->current);
      add_line(s, b);
      s->has_b = 1;
      snprintf(s->b_label, sizeof s->b_label, "B: Volver");
      if (update_can_install(u)) {
        s->has_a = 1;
        snprintf(s->a_label, sizeof s->a_label, "A: Reintentar");
      }
      break;
    case UPD_PAGE:
      snprintf(s->title, sizeof s->title, "Actualizar app");
      if (u->has_offer) {
        offer_lines(u, s);
      } else {
        snprintf(b, sizeof b, "Cronio %s.", u->current);
        add_line(s, b);
        if (u->connected) add_line(s, "Estás al día: el PC no tiene una versión más nueva.");
        else add_wrapped(s, "Sin conexión con el puente: no puedo saber si hay una versión nueva.");
      }
      s->has_b = 1;
      snprintf(s->b_label, sizeof s->b_label, "B: Volver");
      if (update_can_install(u)) {
        s->has_a = 1;
        snprintf(s->a_label, sizeof s->a_label, "A: Actualizar");
      }
      break;
    case UPD_IDLE:
      snprintf(s->title, sizeof s->title, "Actualización disponible");
      offer_lines(u, s);
      s->has_b = 1;
      snprintf(s->b_label, sizeof s->b_label, "B: Ahora no");
      if (update_can_install(u)) {
        s->has_a = 1;
        snprintf(s->a_label, sizeof s->a_label, "A: Actualizar");
      }
      break;
  }
}

// ---------- geometría ----------

void update_layout(UpdateLayout *l) {
  l->label = (Rect){8, 8, 304, 14};
  l->title = (Rect){8, 24, 304, 24};
  l->body = (Rect){8, 56, 304, 8 * UPDATE_LINE_PITCH};
  l->bar = (Rect){16, 118, 288, 24};
  l->kb = (Rect){16, 148, 288, 16};
  l->btn_a = (Rect){8, 196, 148, 36};
  l->btn_b = (Rect){164, 196, 148, 36};
  l->btn_b_solo = (Rect){8, 196, 304, 36};
}

UpdHit update_hit(int has_a, int has_b, int x, int y) {
  UpdateLayout l;
  update_layout(&l);
  if (has_a && rect_contains(&l.btn_a, x, y)) return UPD_HIT_A;
  if (has_b && rect_contains(has_a ? &l.btn_b : &l.btn_b_solo, x, y)) return UPD_HIT_B;
  return UPD_HIT_NONE;
}

#include "test.h"

#include <stdarg.h>

#include "../source/core/reading.h"
#include "../source/core/view.h"
#include "fixtures/views_fixture.h"

static Guard IN;
static Guard VG;

typedef struct {
  char *buf;
  size_t cap, len;
} Out;

static void emit(Out *o, const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(o->buf + o->len, o->cap - o->len, fmt, ap);
  va_end(ap);
  if (n < 0 || (size_t)n >= o->cap - o->len) {
    printf("dump_view: búfer lleno\n");
    exit(2);
  }
  o->len += (size_t)n;
}

// Mismo formato que dumpMessage en packages/bridge/scripts/gen-view-fixtures.ts.
static void dump_view(const View *v, Out *o) {
  emit(o, "rev=%llu\n", (unsigned long long)v->rev);
  emit(o, "session_count=%d\n", v->session_count);
  for (int i = 0; i < v->session_count; i++) {
    const SessionView *s = &v->sessions[i];
    emit(o, "session[%d].id=%s\nsession[%d].kind=%s\nsession[%d].title=%s\n", i, s->id, i, view_kind_name(s->kind), i,
         s->title);
    emit(o, "session[%d].project=%s\nsession[%d].model=%s\n", i, s->project, i, s->model);
    emit(o, "session[%d].state=%s\nsession[%d].activity=%s\n", i, view_state_name(s->state), i, s->activity);
    emit(o, "session[%d].since=%lld\n", i, s->has_since ? (long long)s->since_s : -1LL);
  }
  emit(o, "has_request=%d\n", v->has_request);
  if (v->has_request) {
    const RequestView *r = &v->request;
    emit(o, "request.id=%s\nrequest.session_id=%s\nrequest.kind=%s\nrequest.title=%s\n", r->id, r->session_id, view_request_kind_name(r->kind), r->title);
    emit(o, "request.line_count=%d\n", r->line_count);
    for (int i = 0; i < r->line_count; i++) emit(o, "request.line[%d]=%s\n", i, r->lines[i]);
    emit(o, "request.risk=%s\nrequest.expires_in_s=%u\n", view_risk_name(r->risk), (unsigned)r->expires_in_s);
    emit(o, "request.position=%u\nrequest.total=%u\n", (unsigned)r->position, (unsigned)r->total);
    if (r->has_always) emit(o, "request.always=%s\n", r->always);
    emit(o, "request.question_count=%d\n", r->question_count);
    for (int i = 0; i < r->question_count; i++) {
      const QuestionView *q = &r->questions[i];
      emit(o, "request.q[%d].header=%s\nrequest.q[%d].text_count=%d\n", i, q->header, i, q->text_count);
      for (int j = 0; j < q->text_count; j++) emit(o, "request.q[%d].text[%d]=%s\n", i, j, q->text[j]);
      emit(o, "request.q[%d].multi=%d\nrequest.q[%d].option_count=%d\n", i, q->multi, i, q->option_count);
      for (int k = 0; k < q->option_count; k++) {
        const OptionView *op = &q->options[k];
        emit(o, "request.q[%d].opt[%d].label=%s\nrequest.q[%d].opt[%d].desc_count=%d\n", i, k, op->label, i, k, op->desc_count);
        for (int m = 0; m < op->desc_count; m++) emit(o, "request.q[%d].opt[%d].desc[%d]=%s\n", i, k, m, op->desc[m]);
        emit(o, "request.q[%d].opt[%d].recommended=%d\n", i, k, op->recommended);
      }
    }
    emit(o, "request.quick_count=%d\n", r->quick_count);
    for (int i = 0; i < r->quick_count; i++) emit(o, "request.quick[%d].label=%s\nrequest.quick[%d].text=%s\n", i, r->quick[i].label, i, r->quick[i].text);
  }
  emit(o, "pending_count=%u\nmode=%s\n", (unsigned)v->pending_count, view_mode_name(v->mode));
  emit(o, "face.kind=%s\nface.mood=%s\nface.line_count=%d\n", view_kind_name(v->face.kind), view_mood_name(v->face.mood),
       v->face.line_count);
  for (int i = 0; i < v->face.line_count; i++) emit(o, "face.line[%d]=%s\n", i, v->face.lines[i]);
  emit(o, "has_detail=%d\n", v->has_detail);
  if (v->has_detail) {
    emit(o, "detail.session_id=%s\ndetail.line_count=%d\n", v->detail.session_id, v->detail.line_count);
    for (int i = 0; i < v->detail.line_count; i++) emit(o, "detail.line[%d]=%s\n", i, v->detail.last_message[i]);
    emit(o, "detail.question_count=%d\n", v->detail.question_count);
    for (int i = 0; i < v->detail.question_count; i++) emit(o, "detail.question[%d]=%s\n", i, v->detail.question[i]);
    emit(o, "detail.notify=%s\n", v->detail.has_notify ? view_notify_name(v->detail.notify) : "none");
    emit(o, "detail.instr_count=%d\ndetail.instr_first=%s\ndetail.wait_for_me=%d\n", v->detail.instr_count, v->detail.instr_count > 0 ? v->detail.instr_first : "", v->detail.wait_for_me);
  }
  emit(o, "led=%s\n", view_led_name(v->led));
  emit(o, "has_settings=%d\n", v->has_settings);
  if (v->has_settings) {
    emit(o, "settings.notify_default=%s\nsettings.notify_ack=%d\nsettings.sound=%d\nsettings.questions=%d\nsettings.reader_default=%s\n", view_notify_name(v->settings.notify_default), v->settings.notify_ack, v->settings.sound, v->settings.questions, v->settings.reader_default ? "summary" : "full");
    emit(o, "settings.instruct_wait=%d\n", v->settings.has_instruct_wait ? v->settings.instruct_wait_max : 0);
    emit(o, "settings.hidden_count=%d\n", v->settings.hidden_count);
    for (int i = 0; i < v->settings.hidden_count; i++) emit(o, "settings.hidden[%d]=%s\n", i, view_kind_name(v->settings.hidden[i]));
  }
  emit(o, "has_notice=%d\n", v->has_notice);
  if (v->has_notice) {
    const NoticeView *n = &v->notice;
    emit(o, "notice.id=%s\nnotice.session_id=%s\nnotice.kind=%s\nnotice.agent=%s\n", n->id, n->session_id, view_notice_kind_name(n->kind), n->agent);
    emit(o, "notice.project=%s\nnotice.title=%s\nnotice.line_count=%d\n", n->project, n->title, n->line_count);
    for (int i = 0; i < n->line_count; i++) emit(o, "notice.line[%d]=%s\n", i, n->lines[i]);
    emit(o, "notice.position=%u\nnotice.total=%u\n", (unsigned)n->position, (unsigned)n->total);
  }
  emit(o, "has_chime=%d\n", v->has_chime);
  if (v->has_chime) emit(o, "chime.kind=%s\nchime.seq=%u\n", view_chime_kind_name(v->chime.kind), (unsigned)v->chime.seq);
  emit(o, "has_update=%d\n", v->has_update);
  if (v->has_update) {
    char hex[VIEW_UPDATE_SHA_LEN * 2 + 1];
    for (int i = 0; i < VIEW_UPDATE_SHA_LEN; i++) snprintf(hex + 2 * i, 3, "%02x", v->update.sha256[i]);
    emit(o, "update.version=%s\nupdate.url=%s\nupdate.size=%u\nupdate.sha256=%s\n", v->update.version, v->update.url, (unsigned)v->update.size, hex);
  }
}

// Mismo formato que dumpMessageRaw (rama "text") en gen-view-fixtures.ts.
static void dump_text(const ReadDoc *d, Out *o) {
  emit(o, "text.session_id=%s\ntext.line_count=%d\n", d->session_id, d->line_count);
  for (int i = 0; i < d->line_count; i++) emit(o, "text.line[%d]=%s\n", i, d->lines[i]);
  emit(o, "text.truncated=%d\ntext.question_count=%d\n", d->truncated, d->question_count);
  emit(o, "text.mode=%s\ntext.short=%d\n", d->mode == READ_MODE_SUMMARY ? "summary" : "full", d->whole);
  for (int i = 0; i < d->question_count; i++) emit(o, "text.question[%d]=%s\n", i, d->question[i]);
}

static char *dumpbuf;

static int parse_n(const char *json, size_t len, View *v) {
  const char *p = (const char *)guard_copy(&IN, json, len);
  return view_parse(p, len, v);
}

static void test_fixtures(void) {
  View *v = (View *)guard_at_end(&VG, sizeof(View));
  int valid = 0, invalid = 0, stricter = 0;
  for (int i = 0; i < VIEW_FIXTURE_COUNT; i++) {
    const ViewFixture *f = &VIEW_FIXTURES[i];
    memset(v, 0xa5, sizeof *v); // lo que no se escribe no debe tomarse por válido
    int r = parse_n(f->json, f->json_len, v);
    if (f->zod_valid && !f->c_valid) stricter++;
    if (!f->c_valid) {
      invalid++;
      CHECK_MSG(r < 0, "%s: debía rechazarse (zod: %s) y dio %d", f->name, f->zod_valid ? "válido" : "inválido", r);
      continue;
    }
    valid++;
    if (strncmp(f->expected, "error=", 6) == 0) {
      CHECK_MSG(r == VIEW_BRIDGE_ERROR, "%s: debía ser un error del puente y dio %d", f->name, r);
      char want[64];
      snprintf(want, sizeof want, "error=%s\n", v->error_code);
      CHECK_STR(want, f->expected);
      continue;
    }
    CHECK_MSG(r == VIEW_OK, "%s: debía aceptarse y dio %d", f->name, r);
    if (r != VIEW_OK) continue;
    Out o = {dumpbuf, 65536, 0};
    dumpbuf[0] = '\0';
    dump_view(v, &o);
    CHECK_MSG(strcmp(dumpbuf, f->expected) == 0, "%s: el volcado no coincide con el de zod/TypeScript", f->name);
    if (strcmp(dumpbuf, f->expected) != 0) {
      // localizar la primera línea distinta
      const char *a = dumpbuf, *b = f->expected;
      while (*a && *a == *b) a++, b++;
      printf("    primera diferencia: C=\"%.60s\" TS=\"%.60s\"\n", a, b);
    }
  }
  printf("  fixtures: %d aceptados, %d rechazados (%d de ellos válidos para zod pero estrictos en C)\n", valid, invalid,
         stricter);
  CHECK(valid >= 50 && invalid >= 100);
}

// Mensajes text (respuesta a read): los esquemas zod y reading_parse deben coincidir, y el volcado también.
static ReadDoc TD;

static void test_text_fixtures(void) {
  int valid = 0, invalid = 0;
  for (int i = 0; i < TEXT_FIXTURE_COUNT; i++) {
    const ViewFixture *f = &TEXT_FIXTURES[i];
    const char *p = (const char *)guard_copy(&IN, f->json, f->json_len);
    memset(&TD, 0xa5, sizeof TD);
    int r = reading_parse(p, f->json_len, &TD);
    if (!f->c_valid) {
      invalid++;
      CHECK_MSG(r < 0, "%s: debía rechazarse y dio %d", f->name, r);
      continue;
    }
    valid++;
    CHECK_MSG(r == READING_OK, "%s: debía aceptarse y dio %d", f->name, r);
    if (r != READING_OK) continue;
    Out o = {dumpbuf, 65536, 0};
    dumpbuf[0] = '\0';
    dump_text(&TD, &o);
    CHECK_MSG(strcmp(dumpbuf, f->expected) == 0, "%s: el volcado no coincide con el de zod/TypeScript", f->name);
    if (strcmp(dumpbuf, f->expected) != 0) {
      const char *a = dumpbuf, *b = f->expected;
      while (*a && *a == *b) a++, b++;
      printf("    primera diferencia: C=\"%.60s\" TS=\"%.60s\"\n", a, b);
    }
  }
  printf("  textos: %d aceptados, %d rechazados\n", valid, invalid);
  CHECK(valid >= 15 && invalid >= 15);
}

static const ViewFixture *tfix(const char *name) {
  for (int i = 0; i < TEXT_FIXTURE_COUNT; i++) {
    if (strcmp(TEXT_FIXTURES[i].name, name) == 0) return &TEXT_FIXTURES[i];
  }
  printf("fixture inexistente: %s\n", name);
  exit(2);
}

static void test_text_known_values(void) {
  const ViewFixture *f = tfix("reader/question");
  CHECK_EQ_INT(reading_parse(f->json, f->json_len, &TD), READING_OK);
  CHECK(TD.question_count >= 1 && TD.question_count <= 3);
  CHECK_EQ_INT(TD.truncated, 0);
  CHECK_STR(TD.session_id, "s1");

  // el peor caso medido en el puente: cortado por bytes, con unas 150 líneas de 48 caracteres
  f = tfix("reader/worst-case-accents");
  CHECK_EQ_INT(reading_parse(f->json, f->json_len, &TD), READING_OK);
  CHECK_EQ_INT(TD.truncated, 1);
  CHECK(TD.line_count > 150 && TD.line_count <= READING_MAX_LINES);
  CHECK_EQ_INT(reading_total_lines(&TD), TD.line_count + 1);
  CHECK(f->json_len <= 16368); // cabe en una trama sellada (MAX_PAYLOAD menos la etiqueta)

  f = tfix("reader/max-lines");
  CHECK_EQ_INT(reading_parse(f->json, f->json_len, &TD), READING_OK);
  CHECK_EQ_INT(TD.line_count, READING_MAX_LINES);
  CHECK_EQ_INT(TD.truncated, 1);

  f = tfix("reader/unknown-session");
  CHECK_EQ_INT(reading_parse(f->json, f->json_len, &TD), READING_OK);
  CHECK_EQ_INT(TD.line_count, 0);
  CHECK_EQ_INT(TD.mode, READ_MODE_FULL); // un puente anterior no manda mode; este lo manda "full"

  // paso 5: resumen, resumen que ya era el mensaje (short) y modo completo explícito
  f = tfix("reader/summary-bullets");
  CHECK_EQ_INT(reading_parse(f->json, f->json_len, &TD), READING_OK);
  CHECK_EQ_INT(TD.mode, READ_MODE_SUMMARY);
  CHECK_EQ_INT(TD.whole, 0);
  CHECK(TD.line_count >= 5 && TD.line_count <= 12);
  f = tfix("reader/summary-short");
  CHECK_EQ_INT(reading_parse(f->json, f->json_len, &TD), READING_OK);
  CHECK_EQ_INT(TD.mode, READ_MODE_SUMMARY);
  CHECK_EQ_INT(TD.whole, 1);
  f = tfix("reader/full-mode-explicit");
  CHECK_EQ_INT(reading_parse(f->json, f->json_len, &TD), READING_OK);
  CHECK_EQ_INT(TD.mode, READ_MODE_FULL);
  CHECK_EQ_INT(TD.whole, 0);
  f = tfix("text-mut/mode-bad");
  CHECK(reading_parse(f->json, f->json_len, &TD) < 0);
  f = tfix("text-mut/mode-null");
  CHECK(reading_parse(f->json, f->json_len, &TD) < 0);
  f = tfix("text-mut/short-string");
  CHECK(reading_parse(f->json, f->json_len, &TD) < 0);
  f = tfix("text-mut/short-false");
  CHECK_EQ_INT(reading_parse(f->json, f->json_len, &TD), READING_OK);
  CHECK_EQ_INT(TD.whole, 0);

  // un mensaje text no es una vista ni un error, y una vista no es un texto
  View *v = (View *)guard_at_end(&VG, sizeof(View));
  CHECK(view_parse(f->json, f->json_len, v) < 0);
  const ViewFixture *vw = &VIEW_FIXTURES[0];
  for (int i = 0; i < VIEW_FIXTURE_COUNT; i++) {
    if (strcmp(VIEW_FIXTURES[i].name, "bridge/one-session") == 0) vw = &VIEW_FIXTURES[i];
  }
  CHECK(reading_parse(vw->json, vw->json_len, &TD) < 0);
}

static void test_countdown(void) {
  RequestView r;
  memset(&r, 0, sizeof r);
  r.expires_in_s = 45;
  CHECK_EQ_INT(view_countdown_s(&r, 46000, 1000), 45);
  CHECK_EQ_INT(view_countdown_s(&r, 46000, 1001), 45); // redondeo hacia arriba
  CHECK_EQ_INT(view_countdown_s(&r, 46000, 45001), 1);
  CHECK_EQ_INT(view_countdown_s(&r, 46000, 46000), 0);
  CHECK_EQ_INT(view_countdown_s(&r, 46000, 90000), 0); // vencida: 0, nunca negativo
  // sin límite: sin cuenta atrás, pase el tiempo que pase, y nunca vencida
  r.expires_in_s = 0;
  CHECK_EQ_INT(view_countdown_s(&r, 0, 0), -1);
  CHECK_EQ_INT(view_countdown_s(&r, 1000, 999999999u), -1);
}

static void test_no_limit_fixture(void) {
  View *v = (View *)guard_at_end(&VG, sizeof(View));
  const char *json =
      "{\"t\":\"view\",\"rev\":1,\"view\":{\"sessions\":[{\"id\":\"s1\",\"kind\":\"claude\",\"title\":\"a\","
      "\"project\":\"a\",\"model\":\"m\",\"state\":\"ask\",\"activity\":\"x\"}],\"request\":{\"id\":\"r1\",\"sessionId\":"
      "\"s1\",\"title\":\"t\",\"lines\":[\"ls\"],\"risk\":\"normal\",\"expiresInS\":0,\"position\":1,\"total\":1},"
      "\"pendingCount\":1,\"mode\":\"queue\",\"face\":{\"kind\":\"claude\",\"mood\":\"ask\",\"lines\":[\"x\"]},"
      "\"detail\":null,\"led\":\"ask\"}}";
  CHECK_EQ_INT(parse_n(json, strlen(json), v), VIEW_OK);
  CHECK_EQ_INT(v->has_request, 1);
  CHECK_EQ_INT(v->request.expires_in_s, 0);
  CHECK_EQ_INT(view_countdown_s(&v->request, 0, 123456), -1);
}

static void test_always_field(void) {
  View *v = (View *)guard_at_end(&VG, sizeof(View));
  const char *head =
      "{\"t\":\"view\",\"rev\":1,\"view\":{\"sessions\":[{\"id\":\"s1\",\"kind\":\"claude\",\"title\":\"a\","
      "\"project\":\"a\",\"model\":\"m\",\"state\":\"ask\",\"activity\":\"x\"}],\"request\":{\"id\":\"r1\",\"sessionId\":"
      "\"s1\",\"title\":\"t\",\"lines\":[\"ls\"],\"risk\":\"normal\",\"expiresInS\":0,\"position\":1,\"total\":1";
  const char *tail =
      "},\"pendingCount\":1,\"mode\":\"queue\",\"face\":{\"kind\":\"claude\",\"mood\":\"ask\",\"lines\":[\"x\"]},"
      "\"detail\":null,\"led\":\"ask\"}}";
  char json[1024];
  // sin el campo: no ofrece la opción (y no queda basura de una vista anterior)
  snprintf(json, sizeof json, "%s%s", head, tail);
  memset(v, 0xa5, sizeof *v);
  CHECK_EQ_INT(parse_n(json, strlen(json), v), VIEW_OK);
  CHECK_EQ_INT(v->request.has_always, 0);
  CHECK_STR(v->request.always, "");
  // con el campo
  snprintf(json, sizeof json, "%s,\"always\":\"Bash(npm test)\"%s", head, tail);
  CHECK_EQ_INT(parse_n(json, strlen(json), v), VIEW_OK);
  CHECK_EQ_INT(v->request.has_always, 1);
  CHECK_STR(v->request.always, "Bash(npm test)");
  // vacío, nulo o de otro tipo: se rechaza, como zod
  const char *bad[] = {"\"always\":\"\"", "\"always\":null", "\"always\":5", "\"always\":[\"a\"]"};
  for (size_t i = 0; i < sizeof bad / sizeof bad[0]; i++) {
    snprintf(json, sizeof json, "%s,%s%s", head, bad[i], tail);
    CHECK_MSG(parse_n(json, strlen(json), v) < 0, "debía rechazarse: %s", bad[i]);
  }
}

// Versión nueva de la app (campo opcional `update`): ausente = nada que avisar; presente exige versión y dirección con el formato del puente.
static void test_update_field(void) {
  View *v = (View *)guard_at_end(&VG, sizeof(View));
  const char *head =
      "{\"t\":\"view\",\"rev\":1,\"view\":{\"sessions\":[],\"request\":null,\"pendingCount\":0,\"mode\":\"queue\","
      "\"face\":{\"kind\":null,\"mood\":\"idle\",\"lines\":[\"x\"]},\"detail\":null,\"led\":\"off\"";
  char json[1024];
  snprintf(json, sizeof json, "%s}}", head);
  memset(v, 0xa5, sizeof *v);
  CHECK_EQ_INT(parse_n(json, strlen(json), v), VIEW_OK);
  CHECK_EQ_INT(v->has_update, 0);
  const char *sha = "00112233445566778899aabbccddeeff0123456789abcdef0123456789abcdef";
  snprintf(json, sizeof json, "%s,\"update\":{\"version\":\"0.3.0\",\"url\":\"http://192.168.0.20:33337/agent-companion.cia\",\"size\":370000,\"sha256\":\"%s\"}}}", head, sha);
  CHECK_EQ_INT(parse_n(json, strlen(json), v), VIEW_OK);
  CHECK_EQ_INT(v->has_update, 1);
  CHECK_STR(v->update.version, "0.3.0");
  CHECK_STR(v->update.url, "http://192.168.0.20:33337/agent-companion.cia");
  CHECK_EQ_INT((int)v->update.size, 370000);
  CHECK_EQ_INT(v->update.sha256[0], 0x00);
  CHECK_EQ_INT(v->update.sha256[1], 0x11);
  CHECK_EQ_INT(v->update.sha256[8], 0x88);
  CHECK_EQ_INT(v->update.sha256[15], 0xff);
  CHECK_EQ_INT(v->update.sha256[31], 0xef);
  // campos de más (un puente más nuevo) se ignoran
  snprintf(json, sizeof json, "%s,\"update\":{\"version\":\"0.3.0\",\"url\":\"http://192.168.0.20:33337/agent-companion.cia\",\"size\":370000,\"sha256\":\"%s\",\"sig\":\"x\",\"extra\":{\"a\":1}}}}", head, sha);
  CHECK_EQ_INT(parse_n(json, strlen(json), v), VIEW_OK);
  CHECK_EQ_INT(v->has_update, 1);
  // sin size o sin sha256 (puente viejo) o con valores que no valen: la vista se acepta pero NO hay oferta (no se instala nada sin verificar)
  const char *noffer[] = {
      "\"update\":{\"version\":\"0.3.0\",\"url\":\"http://192.168.0.20:33337/agent-companion.cia\"}",
      "\"update\":{\"version\":\"0.3.0\",\"url\":\"http://192.168.0.20:33337/agent-companion.cia\",\"size\":370000}",
      "\"update\":{\"version\":\"0.3.0\",\"url\":\"http://192.168.0.20:33337/agent-companion.cia\",\"sha256\":\"00112233445566778899aabbccddeeff0123456789abcdef0123456789abcdef\"}",
      "\"update\":{\"version\":\"0.3.0\",\"url\":\"http://192.168.0.20:33337/agent-companion.cia\",\"size\":\"370000\",\"sha256\":\"00112233445566778899aabbccddeeff0123456789abcdef0123456789abcdef\"}",
      "\"update\":{\"version\":\"0.3.0\",\"url\":\"http://192.168.0.20:33337/agent-companion.cia\",\"size\":370000,\"sha256\":5}",
      "\"update\":{\"version\":\"0.3.0\",\"url\":\"http://192.168.0.20:33337/agent-companion.cia\",\"size\":8191,\"sha256\":\"00112233445566778899aabbccddeeff0123456789abcdef0123456789abcdef\"}",
      "\"update\":{\"version\":\"0.3.0\",\"url\":\"http://192.168.0.20:33337/agent-companion.cia\",\"size\":8388609,\"sha256\":\"00112233445566778899aabbccddeeff0123456789abcdef0123456789abcdef\"}",
      "\"update\":{\"version\":\"0.3.0\",\"url\":\"http://192.168.0.20:33337/agent-companion.cia\",\"size\":-5,\"sha256\":\"00112233445566778899aabbccddeeff0123456789abcdef0123456789abcdef\"}",
      "\"update\":{\"version\":\"0.3.0\",\"url\":\"http://192.168.0.20:33337/agent-companion.cia\",\"size\":370000.5,\"sha256\":\"00112233445566778899aabbccddeeff0123456789abcdef0123456789abcdef\"}",
      "\"update\":{\"version\":\"0.3.0\",\"url\":\"http://192.168.0.20:33337/agent-companion.cia\",\"size\":370000,\"sha256\":\"00112233445566778899aabbccddeeff0123456789abcdef0123456789abcde\"}",
      "\"update\":{\"version\":\"0.3.0\",\"url\":\"http://192.168.0.20:33337/agent-companion.cia\",\"size\":370000,\"sha256\":\"00112233445566778899aabbccddeeff0123456789abcdef0123456789abcdef0\"}",
      "\"update\":{\"version\":\"0.3.0\",\"url\":\"http://192.168.0.20:33337/agent-companion.cia\",\"size\":370000,\"sha256\":\"00112233445566778899AABBCCDDEEFF0123456789ABCDEF0123456789ABCDEF\"}",
      "\"update\":{\"version\":\"0.3.0\",\"url\":\"http://192.168.0.20:33337/agent-companion.cia\",\"size\":370000,\"sha256\":\"0011223344556677889g\"}",
  };
  for (size_t i = 0; i < sizeof noffer / sizeof noffer[0]; i++) {
    snprintf(json, sizeof json, "%s,%s}}", head, noffer[i]);
    memset(v, 0xa5, sizeof *v);
    CHECK_MSG(parse_n(json, strlen(json), v) == VIEW_OK, "la vista debía aceptarse: %s", noffer[i]);
    CHECK_MSG(v->has_update == 0, "no debía haber oferta: %s", noffer[i]);
  }
  // lo que zod rechaza (versión de dos partes, otro esquema, sin puerto, ruta rara, campos de otro tipo o faltantes), también
  const char *bad[] = {
      "\"update\":{\"version\":\"0.3\",\"url\":\"http://192.168.0.20:33337/a.cia\"}",
      "\"update\":{\"version\":\"0.3.0.1\",\"url\":\"http://192.168.0.20:33337/a.cia\"}",
      "\"update\":{\"version\":\"a.b.c\",\"url\":\"http://192.168.0.20:33337/a.cia\"}",
      "\"update\":{\"version\":\"0.3.0\",\"url\":\"https://192.168.0.20:33337/a.cia\"}",
      "\"update\":{\"version\":\"0.3.0\",\"url\":\"http://pc.local:33337/a.cia\"}",
      "\"update\":{\"version\":\"0.3.0\",\"url\":\"http://192.168.0.20/a.cia\"}",
      "\"update\":{\"version\":\"0.3.0\",\"url\":\"http://192.168.0.20:33337/a/b.cia\"}",
      "\"update\":{\"version\":\"0.3.0\",\"url\":\"http://192.168.0.20:33337/\"}",
      "\"update\":{\"version\":\"0.3.0\"}",
      "\"update\":{\"url\":\"http://192.168.0.20:33337/a.cia\"}",
      "\"update\":{\"version\":3,\"url\":5}",
      "\"update\":null",
      "\"update\":\"0.3.0\"",
  };
  for (size_t i = 0; i < sizeof bad / sizeof bad[0]; i++) {
    snprintf(json, sizeof json, "%s,%s}}", head, bad[i]);
    CHECK_MSG(parse_n(json, strlen(json), v) < 0, "debía rechazarse: %s", bad[i]);
  }
}

// Ajustes del puente (campo opcional `settings`): ausente = sin ajustes; presente exige los tres campos.
static void test_settings_field(void) {
  View *v = (View *)guard_at_end(&VG, sizeof(View));
  const char *head =
      "{\"t\":\"view\",\"rev\":1,\"view\":{\"sessions\":[],\"request\":null,\"pendingCount\":0,\"mode\":\"queue\","
      "\"face\":{\"kind\":null,\"mood\":\"idle\",\"lines\":[\"x\"]},\"detail\":null,\"led\":\"off\"";
  char json[1024];
  memset(v, 0xa5, sizeof *v);
  snprintf(json, sizeof json, "%s}}", head);
  CHECK_EQ_INT(parse_n(json, strlen(json), v), VIEW_OK);
  CHECK_EQ_INT(v->has_settings, 0);
  CHECK_EQ_INT(view_agent_hidden(v, AGENT_CLAUDE), 0);
  AgentKind list[AGENT_COUNT];
  CHECK_EQ_INT(view_visible_agents(v, list), AGENT_COUNT);

  snprintf(json, sizeof json, "%s,\"settings\":{\"notifyDefault\":\"end\",\"notifyAck\":false,\"hiddenAgents\":[\"cursor\",\"claude\"]}}}", head);
  memset(v, 0xa5, sizeof *v);
  CHECK_EQ_INT(parse_n(json, strlen(json), v), VIEW_OK);
  CHECK_EQ_INT(v->has_settings, 1);
  CHECK_EQ_INT(v->settings.notify_default, NOTIFY_END);
  CHECK_EQ_INT(v->settings.notify_ack, 0);
  CHECK_EQ_INT(v->settings.sound, 1); // ausente: un puente anterior cuenta como activo
  CHECK_EQ_INT(v->settings.reader_default, READ_MODE_FULL); // ausente: completo
  CHECK_EQ_INT(v->settings.hidden_count, 2);
  CHECK_EQ_INT(view_agent_hidden(v, AGENT_CURSOR), 1);
  CHECK_EQ_INT(view_agent_hidden(v, AGENT_CLAUDE), 1);
  CHECK_EQ_INT(view_agent_hidden(v, AGENT_GEMINI), 0);
  CHECK_EQ_INT(view_visible_agents(v, list), 3);
  CHECK_EQ_INT(list[0], AGENT_GEMINI);
  CHECK_EQ_INT(list[1], AGENT_CODEX);
  CHECK_EQ_INT(list[2], AGENT_HERMES);
  CHECK_STR(view_notify_name(NOTIFY_SILENT), "silent");

  // paso 5: readerDefault "full" / "summary"; otro valor, otro tipo o null se rechazan
  snprintf(json, sizeof json, "%s,\"settings\":{\"notifyDefault\":\"all\",\"notifyAck\":true,\"readerDefault\":\"summary\",\"hiddenAgents\":[]}}}", head);
  memset(v, 0xa5, sizeof *v);
  CHECK_EQ_INT(parse_n(json, strlen(json), v), VIEW_OK);
  CHECK_EQ_INT(v->settings.reader_default, READ_MODE_SUMMARY);
  snprintf(json, sizeof json, "%s,\"settings\":{\"notifyDefault\":\"all\",\"notifyAck\":true,\"readerDefault\":\"full\",\"hiddenAgents\":[]}}}", head);
  CHECK_EQ_INT(parse_n(json, strlen(json), v), VIEW_OK);
  CHECK_EQ_INT(v->settings.reader_default, READ_MODE_FULL);

  const char *bad[] = {
      "\"settings\":{\"notifyDefault\":\"all\",\"notifyAck\":true,\"readerDefault\":\"brief\",\"hiddenAgents\":[]}",
      "\"settings\":{\"notifyDefault\":\"all\",\"notifyAck\":true,\"readerDefault\":true,\"hiddenAgents\":[]}",
      "\"settings\":{\"notifyDefault\":\"all\",\"notifyAck\":true,\"readerDefault\":null,\"hiddenAgents\":[]}",
      "\"settings\":null",
      "\"settings\":[]",
      "\"settings\":{}",
      "\"settings\":{\"notifyDefault\":\"loud\",\"notifyAck\":true,\"hiddenAgents\":[]}",
      "\"settings\":{\"notifyDefault\":\"all\",\"notifyAck\":1,\"hiddenAgents\":[]}",
      "\"settings\":{\"notifyDefault\":\"all\",\"notifyAck\":true}",
      "\"settings\":{\"notifyDefault\":\"all\",\"notifyAck\":true,\"hiddenAgents\":[\"nadie\"]}",
      "\"settings\":{\"notifyDefault\":\"all\",\"notifyAck\":true,\"hiddenAgents\":\"claude\"}",
      "\"settings\":{\"notifyDefault\":\"all\",\"notifyAck\":true,\"hiddenAgents\":[\"claude\",\"claude\",\"claude\",\"claude\",\"claude\",\"claude\"]}",
  };
  for (size_t i = 0; i < sizeof bad / sizeof bad[0]; i++) {
    snprintf(json, sizeof json, "%s,%s}}", head, bad[i]);
    CHECK_MSG(parse_n(json, strlen(json), v) < 0, "debía rechazarse: %s", bad[i]);
  }
}

// Pregunta que espera respuesta: cara de hasta 4 líneas y campo opcional `detail.question` (1 a 3 líneas).
static void test_question_field(void) {
  View *v = (View *)guard_at_end(&VG, sizeof(View));
  const char *head =
      "{\"t\":\"view\",\"rev\":1,\"view\":{\"sessions\":[{\"id\":\"s1\",\"kind\":\"claude\",\"title\":\"a\","
      "\"project\":\"a\",\"model\":\"m\",\"state\":\"ask\",\"activity\":\"x\"}],\"request\":null,\"pendingCount\":0,"
      "\"mode\":\"queue\",\"face\":{\"kind\":\"claude\",\"mood\":\"ask\",\"lines\":";
  char json[1400];
  // cara de 4 líneas y detalle con pregunta de 3
  snprintf(json, sizeof json,
           "%s[\"t\",\"uno\",\"dos\",\"tres\"]},\"detail\":{\"sessionId\":\"s1\",\"lastMessage\":[\"m\"],"
           "\"question\":[\"Â¿uno?\",\"dos\",\"tres\"]},\"led\":\"ask\"}}",
           head);
  memset(v, 0xa5, sizeof *v);
  CHECK_EQ_INT(parse_n(json, strlen(json), v), VIEW_OK);
  CHECK_EQ_INT(v->face.line_count, 4);
  CHECK_STR(v->face.lines[3], "tres");
  CHECK_EQ_INT(v->has_detail, 1);
  CHECK_EQ_INT(v->detail.line_count, 1);
  CHECK_EQ_INT(v->detail.question_count, 3);
  CHECK_STR(v->detail.question[0], "Â¿uno?");
  CHECK_STR(v->detail.question[2], "tres");
  // sin el campo: question_count = 0 aunque la memoria traiga basura
  snprintf(json, sizeof json,
           "%s[\"t\"]},\"detail\":{\"sessionId\":\"s1\",\"lastMessage\":[]},\"led\":\"ask\"}}", head);
  memset(v, 0xa5, sizeof *v);
  CHECK_EQ_INT(parse_n(json, strlen(json), v), VIEW_OK);
  CHECK_EQ_INT(v->detail.question_count, 0);
  // 5 líneas de cara; pregunta de 0, de 4, nula o de otro tipo: se rechazan (como zod)
  snprintf(json, sizeof json,
           "%s[\"1\",\"2\",\"3\",\"4\",\"5\"]},\"detail\":null,\"led\":\"ask\"}}", head);
  CHECK(parse_n(json, strlen(json), v) < 0);
  const char *bad[] = {"[]", "[\"1\",\"2\",\"3\",\"4\"]", "null", "\"hola\"", "[5]"};
  for (size_t i = 0; i < sizeof bad / sizeof bad[0]; i++) {
    snprintf(json, sizeof json,
             "%s[\"t\"]},\"detail\":{\"sessionId\":\"s1\",\"lastMessage\":[],\"question\":%s},\"led\":\"ask\"}}", head, bad[i]);
    CHECK_MSG(parse_n(json, strlen(json), v) < 0, "debía rechazarse: question=%s", bad[i]);
  }
}

static void test_known_values(void) {
  View *v = (View *)guard_at_end(&VG, sizeof(View));
  // lo que dice el ejemplo del protocolo, a mano (independiente del volcado)
  const char *json =
      "{\"t\":\"view\",\"rev\":7,\"view\":{\"sessions\":[{\"id\":\"s1\",\"kind\":\"claude\",\"title\":\"mi-portal\","
      "\"project\":\"mi-portal\",\"model\":\"Opus\",\"state\":\"ask\",\"activity\":\"Esperando permiso\"},{\"id\":\"s2\","
      "\"kind\":\"codex\",\"title\":\"ATLAS\",\"project\":\"ATLAS\",\"model\":\"GPT\",\"state\":\"working\","
      "\"activity\":\"Leyendo el runner\"}],\"request\":{\"id\":\"r1\",\"sessionId\":\"s1\",\"title\":\"Claude pide "
      "permiso\",\"lines\":[\"npm install sharp\"],\"risk\":\"normal\",\"expiresInS\":45,\"position\":1,\"total\":2},"
      "\"pendingCount\":2,\"mode\":\"queue\",\"face\":{\"kind\":\"claude\",\"mood\":\"ask\",\"lines\":[\"Claude necesita "
      "permiso (1 de 2)\",\"npm install sharp \xc2\xb7 mi-portal\"]},\"detail\":null,\"led\":\"ask\"}}";
  CHECK_EQ_INT(parse_n(json, strlen(json), v), VIEW_OK);
  CHECK_EQ_INT(v->rev, 7);
  CHECK_EQ_INT(v->session_count, 2);
  CHECK_STR(v->sessions[0].id, "s1");
  CHECK_EQ_INT(v->sessions[0].kind, AGENT_CLAUDE);
  CHECK_EQ_INT(v->sessions[0].state, STATE_ASK);
  CHECK_STR(v->sessions[0].activity, "Esperando permiso");
  CHECK_EQ_INT(v->sessions[1].kind, AGENT_CODEX);
  CHECK_EQ_INT(v->sessions[1].state, STATE_WORKING);
  CHECK_EQ_INT(v->has_request, 1);
  CHECK_STR(v->request.id, "r1");
  CHECK_STR(v->request.session_id, "s1");
  CHECK_EQ_INT(v->request.line_count, 1);
  CHECK_STR(v->request.lines[0], "npm install sharp");
  CHECK_EQ_INT(v->request.risk, RISK_NORMAL);
  CHECK_EQ_INT(v->request.expires_in_s, 45);
  CHECK_EQ_INT(v->request.position, 1);
  CHECK_EQ_INT(v->request.total, 2);
  CHECK_EQ_INT(v->pending_count, 2);
  CHECK_EQ_INT(v->mode, MODE_QUEUE);
  CHECK_EQ_INT(v->face.kind, AGENT_CLAUDE);
  CHECK_EQ_INT(v->face.mood, MOOD_ASK);
  CHECK_EQ_INT(v->face.line_count, 2);
  CHECK_STR(v->face.lines[1], "npm install sharp \xc2\xb7 mi-portal");
  CHECK_EQ_INT(v->has_detail, 0);
  CHECK_EQ_INT(v->led, VIEW_LED_ASK);
  CHECK(view_find_session(v, "s2") == &v->sessions[1]);
  CHECK(view_find_session(v, "zz") == NULL);

  // rev mayor que 32 bits se conserva (el puente usa números de JS)
  const char *big =
      "{\"t\":\"view\",\"rev\":9007199254740991,\"view\":{\"sessions\":[],\"request\":null,\"pendingCount\":0,"
      "\"mode\":\"manual\",\"face\":{\"kind\":null,\"mood\":\"idle\",\"lines\":[\"x\"]},\"detail\":null,\"led\":\"off\"}}";
  CHECK_EQ_INT(parse_n(big, strlen(big), v), VIEW_OK);
  CHECK(v->rev == 9007199254740991ull);
  CHECK_EQ_INT(v->face.kind, AGENT_NONE);
  CHECK_EQ_INT(v->mode, MODE_MANUAL);

  // error del puente: el código se corta a 31 bytes sin romper un carácter
  char err[300];
  strcpy(err, "{\"t\":\"error\",\"code\":\"");
  size_t l = strlen(err);
  for (int i = 0; i < 20; i++) memcpy(err + l + i * 3, "\xe2\x82\xac", 3); // 20 euros = 60 bytes
  strcpy(err + l + 60, "\"}");
  CHECK_EQ_INT(parse_n(err, strlen(err), v), VIEW_BRIDGE_ERROR);
  CHECK_EQ_INT(strlen(v->error_code), 30); // 10 euros enteros; el 11 no cabe en 31
}

static void test_text_limits(void) {
  View *v = (View *)guard_at_end(&VG, sizeof(View));
  // 38 caracteres de 3 bytes = 114 bytes
  char json[2000];
  char euros[200] = {0};
  for (int i = 0; i < 38; i++) strcat(euros, "\xe2\x82\xac");
  snprintf(json, sizeof json,
           "{\"t\":\"view\",\"rev\":1,\"view\":{\"sessions\":[],\"request\":null,\"pendingCount\":0,\"mode\":\"queue\","
           "\"face\":{\"kind\":null,\"mood\":\"idle\",\"lines\":[\"%s\"]},\"detail\":null,\"led\":\"off\"}}",
           euros);
  CHECK_EQ_INT(parse_n(json, strlen(json), v), VIEW_OK);
  CHECK_EQ_INT(strlen(v->face.lines[0]), 114);
  CHECK_EQ_INT(sizeof(ViewText), 153);
  strcat(euros, "\xe2\x82\xac"); // 39
  snprintf(json, sizeof json,
           "{\"t\":\"view\",\"rev\":1,\"view\":{\"sessions\":[],\"request\":null,\"pendingCount\":0,\"mode\":\"queue\","
           "\"face\":{\"kind\":null,\"mood\":\"idle\",\"lines\":[\"%s\"]},\"detail\":null,\"led\":\"off\"}}",
           euros);
  CHECK_EQ_INT(parse_n(json, strlen(json), v), VIEW_ERR_LIMIT);

  // 38 emoji = 38 puntos de código (76 unidades UTF-16, 152 bytes): caben justo; 39 no
  char emoji[400] = {0};
  for (int i = 0; i < 38; i++) strcat(emoji, "\xf0\x9f\x98\x80");
  snprintf(json, sizeof json,
           "{\"t\":\"view\",\"rev\":1,\"view\":{\"sessions\":[],\"request\":null,\"pendingCount\":0,\"mode\":\"queue\","
           "\"face\":{\"kind\":null,\"mood\":\"idle\",\"lines\":[\"%s\"]},\"detail\":null,\"led\":\"off\"}}",
           emoji);
  CHECK_EQ_INT(parse_n(json, strlen(json), v), VIEW_OK);
  CHECK_EQ_INT(strlen(v->face.lines[0]), 152);
  strcat(emoji, "\xf0\x9f\x98\x80");
  snprintf(json, sizeof json,
           "{\"t\":\"view\",\"rev\":1,\"view\":{\"sessions\":[],\"request\":null,\"pendingCount\":0,\"mode\":\"queue\","
           "\"face\":{\"kind\":null,\"mood\":\"idle\",\"lines\":[\"%s\"]},\"detail\":null,\"led\":\"off\"}}",
           emoji);
  CHECK_EQ_INT(parse_n(json, strlen(json), v), VIEW_ERR_LIMIT);
}

static void test_ids_and_names(void) {
  CHECK(view_id_valid("s1"));
  CHECK(view_id_valid("Az09_.:-"));
  CHECK(view_id_valid("a"));
  char id48[49], id49[50];
  memset(id48, 'a', 48);
  id48[48] = 0;
  memset(id49, 'a', 49);
  id49[49] = 0;
  CHECK(view_id_valid(id48));
  CHECK(!view_id_valid(id49));
  CHECK(!view_id_valid(""));
  CHECK(!view_id_valid("a b"));
  CHECK(!view_id_valid("a/b"));
  CHECK(!view_id_valid("a\"b"));
  CHECK(!view_id_valid("a\\b"));
  CHECK(!view_id_valid("\xc3\xa9"));
  CHECK(!view_id_valid("a\nb"));
  CHECK_STR(view_kind_name(AGENT_HERMES), "hermes");
  CHECK_STR(view_kind_name(AGENT_NONE), "none");
  CHECK_STR(view_state_name(STATE_ASK), "ask");
  CHECK_STR(view_mood_name(MOOD_DONE), "done");
  CHECK_STR(view_led_name(VIEW_LED_ERROR), "error");
  CHECK_STR(view_mode_name(MODE_MANUAL), "manual");
  CHECK_STR(view_risk_name(RISK_HIGH), "high");
  CHECK_STR(view_state_name((AgentState)99), "?");
}

int main(void) {
  TEST_BEGIN("view: validación como los esquemas zod, con los ejemplos del puente real");
  guard_init(&IN, 70000);
  guard_init(&VG, sizeof(View));
  dumpbuf = (char *)malloc(65536);
  printf("  sizeof(View) = %zu, sizeof(SessionView) = %zu\n", sizeof(View), sizeof(SessionView));
  RUN(test_fixtures);
  RUN(test_text_fixtures);
  RUN(test_text_known_values);
  RUN(test_always_field);
  RUN(test_update_field);
  RUN(test_settings_field);
  RUN(test_question_field);
  RUN(test_known_values);
  RUN(test_countdown);
  RUN(test_no_limit_fixture);
  RUN(test_text_limits);
  RUN(test_ids_and_names);
  TEST_END();
}

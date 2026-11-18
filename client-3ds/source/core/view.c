#include "view.h"

#include <string.h>

#include "json.h"

static const char *const KIND_NAMES[AGENT_COUNT] = {"claude", "gemini", "codex", "cursor", "hermes"};
static const char *const STATE_NAMES[STATE_COUNT] = {"idle", "working", "ask", "done", "error"};
static const char *const LED_NAMES[VIEW_LED_COUNT] = {"off", "working", "ask", "done", "error"};
static const char *const MODE_NAMES[2] = {"queue", "manual"};
static const char *const RISK_NAMES[2] = {"normal", "high"};
static const char *const REQUEST_KIND_NAMES[3] = {"permission", "question", "instruction"};
static const char *const NOTIFY_NAMES[NOTIFY_COUNT] = {"all", "important", "end", "silent"};
static const char *const NOTICE_NAMES[NOTICE_KIND_COUNT] = {"done", "ask", "error", "idle"};
static const char *const CHIME_NAMES[CHIME_COUNT] = {"done", "ask", "error", "permission"};

const char *view_kind_name(AgentKind k) { return k >= 0 && k < AGENT_COUNT ? KIND_NAMES[k] : "none"; }
const char *view_state_name(AgentState s) { return (unsigned)s < STATE_COUNT ? STATE_NAMES[s] : "?"; }
const char *view_mood_name(Mood m) { return (unsigned)m < MOOD_COUNT ? STATE_NAMES[m] : "?"; }
const char *view_led_name(LedPattern l) { return (unsigned)l < VIEW_LED_COUNT ? LED_NAMES[l] : "?"; }
const char *view_mode_name(PermMode m) { return m == MODE_QUEUE || m == MODE_MANUAL ? MODE_NAMES[m] : "?"; }
const char *view_notify_name(NotifyMode m) { return (unsigned)m < NOTIFY_COUNT ? NOTIFY_NAMES[m] : "?"; }
const char *view_notice_kind_name(NoticeKind k) { return (unsigned)k < NOTICE_KIND_COUNT ? NOTICE_NAMES[k] : "?"; }
const char *view_chime_kind_name(ChimeKind k) { return (unsigned)k < CHIME_COUNT ? CHIME_NAMES[k] : "?"; }
const char *view_request_kind_name(RequestKind k) { return (unsigned)k < 3 ? REQUEST_KIND_NAMES[k] : "?"; }
const char *view_risk_name(Risk r) { return r == RISK_NORMAL || r == RISK_HIGH ? RISK_NAMES[r] : "?"; }

int view_id_valid(const char *id) {
  size_t n = 0;
  for (; id[n] != '\0'; n++) {
    char c = id[n];
    int ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '.' ||
             c == ':' || c == '-';
    if (!ok || n >= VIEW_MAX_ID) return 0;
  }
  return n >= 1;
}

const SessionView *view_find_session(const View *v, const char *session_id) {
  for (int i = 0; i < v->session_count; i++) {
    if (strcmp(v->sessions[i].id, session_id) == 0) return &v->sessions[i];
  }
  return NULL;
}

int view_agent_hidden(const View *v, AgentKind kind) {
  if (v == NULL || !v->has_settings) return 0;
  for (int i = 0; i < v->settings.hidden_count; i++) {
    if (v->settings.hidden[i] == kind) return 1;
  }
  return 0;
}

int view_visible_agents(const View *v, AgentKind out[AGENT_COUNT]) {
  int n = 0;
  for (int i = 0; i < AGENT_COUNT; i++) {
    if (!view_agent_hidden(v, (AgentKind)i)) out[n++] = (AgentKind)i;
  }
  return n;
}

// ---- Lectura de campos con validación ----

#define TRY(expr)          \
  do {                     \
    int r_ = (expr);       \
    if (r_ != VIEW_OK) return r_; \
  } while (0)

static int get_text(const JsonDoc *d, const JsonTok *t, char *dst) {
  if (t == NULL || t->type != JSON_STRING) return VIEW_ERR_SCHEMA;
  size_t chars = 0;
  json_string(d, t, dst, VIEW_TEXT_BYTES, &chars, NULL);
  return chars > VIEW_MAX_TEXT ? VIEW_ERR_LIMIT : VIEW_OK;
}

// Como get_text, pero con su propio tope de caracteres y bytes (los comandos rápidos); no admite texto vacío.
static int get_text_max(const JsonDoc *d, const JsonTok *t, char *dst, size_t bytes, size_t max_chars) {
  if (t == NULL || t->type != JSON_STRING) return VIEW_ERR_SCHEMA;
  size_t chars = 0;
  json_string(d, t, dst, bytes, &chars, NULL);
  return chars > max_chars || chars < 1 ? VIEW_ERR_LIMIT : VIEW_OK;
}

static int get_id(const JsonDoc *d, const JsonTok *t, char *dst) {
  if (t == NULL || t->type != JSON_STRING) return VIEW_ERR_SCHEMA;
  int cut = 0;
  json_string(d, t, dst, VIEW_ID_BYTES, NULL, &cut);
  if (cut) return VIEW_ERR_LIMIT;
  return view_id_valid(dst) ? VIEW_OK : VIEW_ERR_LIMIT;
}

static int get_enum(const JsonDoc *d, const JsonTok *t, const char *const *names, int n, int *out) {
  if (t == NULL || t->type != JSON_STRING) return VIEW_ERR_SCHEMA;
  for (int i = 0; i < n; i++) {
    if (json_str_eq(d, t, names[i])) {
      *out = i;
      return VIEW_OK;
    }
  }
  return VIEW_ERR_SCHEMA;
}

static int get_u32(const JsonDoc *d, const JsonTok *t, uint32_t min, uint32_t *out) {
  if (t == NULL || t->type != JSON_NUMBER) return VIEW_ERR_SCHEMA;
  uint64_t v;
  if (json_uint(d, t, &v) != 0 || v > 0xffffffffu || v < min) return VIEW_ERR_LIMIT;
  *out = (uint32_t)v;
  return VIEW_OK;
}

static int get_lines(const JsonDoc *d, const JsonTok *t, size_t min, size_t max, ViewText *dst, int *count) {
  if (t == NULL || t->type != JSON_ARRAY) return VIEW_ERR_SCHEMA;
  if (t->size > max || t->size < min) return VIEW_ERR_LIMIT;
  const JsonTok *e = json_first(d, t);
  for (size_t i = 0; i < t->size; i++, e = json_next(d, e)) TRY(get_text(d, e, dst[i]));
  *count = (int)t->size;
  return VIEW_OK;
}

static int parse_session(const JsonDoc *d, const JsonTok *o, SessionView *s) {
  if (o->type != JSON_OBJECT) return VIEW_ERR_SCHEMA;
  int v;
  TRY(get_id(d, json_get(d, o, "id"), s->id));
  TRY(get_enum(d, json_get(d, o, "kind"), KIND_NAMES, AGENT_COUNT, &v));
  s->kind = (AgentKind)v;
  TRY(get_text(d, json_get(d, o, "title"), s->title));
  TRY(get_text(d, json_get(d, o, "project"), s->project));
  TRY(get_text(d, json_get(d, o, "model"), s->model));
  TRY(get_enum(d, json_get(d, o, "state"), STATE_NAMES, STATE_COUNT, &v));
  s->state = (AgentState)v;
  TRY(get_text(d, json_get(d, o, "activity"), s->activity));
  // opcional: segundos en el estado actual (entero de 0 a 99 días; null no vale)
  s->has_since = 0;
  s->since_s = 0;
  const JsonTok *since = json_get(d, o, "sinceS");
  if (since != NULL) {
    TRY(get_u32(d, since, 0, &s->since_s));
    if (s->since_s > VIEW_MAX_SINCE_S) return VIEW_ERR_LIMIT;
    s->has_since = 1;
  }
  return VIEW_OK;
}

static int parse_option(const JsonDoc *d, const JsonTok *o, OptionView *x) {
  if (o->type != JSON_OBJECT) return VIEW_ERR_SCHEMA;
  TRY(get_text(d, json_get(d, o, "label"), x->label));
  TRY(get_lines(d, json_get(d, o, "desc"), 0, VIEW_MAX_OPTION_DESC, x->desc, &x->desc_count));
  const JsonTok *rec = json_get(d, o, "recommended");
  if (rec == NULL || (rec->type != JSON_TRUE && rec->type != JSON_FALSE)) return VIEW_ERR_SCHEMA;
  x->recommended = rec->type == JSON_TRUE;
  return VIEW_OK;
}

static int parse_question(const JsonDoc *d, const JsonTok *o, QuestionView *q) {
  if (o->type != JSON_OBJECT) return VIEW_ERR_SCHEMA;
  TRY(get_text(d, json_get(d, o, "header"), q->header));
  TRY(get_lines(d, json_get(d, o, "text"), 1, VIEW_MAX_QUESTION_LINES, q->text, &q->text_count));
  const JsonTok *multi = json_get(d, o, "multi");
  if (multi == NULL || (multi->type != JSON_TRUE && multi->type != JSON_FALSE)) return VIEW_ERR_SCHEMA;
  q->multi = multi->type == JSON_TRUE;
  const JsonTok *opts = json_get(d, o, "options");
  if (opts == NULL || opts->type != JSON_ARRAY) return VIEW_ERR_SCHEMA;
  if (opts->size < 2 || opts->size > VIEW_MAX_OPTIONS) return VIEW_ERR_LIMIT;
  const JsonTok *e = json_first(d, opts);
  for (size_t i = 0; i < opts->size; i++, e = json_next(d, e)) TRY(parse_option(d, e, &q->options[i]));
  q->option_count = (int)opts->size;
  return VIEW_OK;
}

static int parse_request(const JsonDoc *d, const JsonTok *o, RequestView *r) {
  if (o->type != JSON_OBJECT) return VIEW_ERR_SCHEMA;
  int v;
  TRY(get_id(d, json_get(d, o, "id"), r->id));
  TRY(get_id(d, json_get(d, o, "sessionId"), r->session_id));
  TRY(get_text(d, json_get(d, o, "title"), r->title));
  TRY(get_lines(d, json_get(d, o, "lines"), 0, VIEW_MAX_LINES, r->lines, &r->line_count));
  TRY(get_enum(d, json_get(d, o, "risk"), RISK_NAMES, 2, &v));
  r->risk = (Risk)v;
  TRY(get_u32(d, json_get(d, o, "expiresInS"), 0, &r->expires_in_s));
  TRY(get_u32(d, json_get(d, o, "position"), 1, &r->position));
  TRY(get_u32(d, json_get(d, o, "total"), 1, &r->total));
  // opcional: si falta, la tarjeta no ofrece la tercera opción; si está, es texto de 1 a 38 caracteres (como en zod)
  r->has_always = 0;
  r->always[0] = '\0';
  const JsonTok *al = json_get(d, o, "always");
  if (al != NULL) {
    TRY(get_text(d, al, r->always));
    if (r->always[0] == '\0') return VIEW_ERR_LIMIT;
    r->has_always = 1;
  }
  // opcional: `kind` (ausente = permiso). Las preguntas van solo con kind "question" y siempre con él (como el refine de zod)
  r->kind = REQ_PERMISSION;
  r->question_count = 0;
  const JsonTok *kind = json_get(d, o, "kind");
  if (kind != NULL) {
    TRY(get_enum(d, kind, REQUEST_KIND_NAMES, 3, &v));
    r->kind = (RequestKind)v;
  }
  const JsonTok *qs = json_get(d, o, "questions");
  if (r->kind == REQ_QUESTION) {
    if (qs == NULL || qs->type != JSON_ARRAY) return VIEW_ERR_SCHEMA;
    if (qs->size < 1 || qs->size > VIEW_MAX_QUESTIONS) return VIEW_ERR_LIMIT;
    const JsonTok *e = json_first(d, qs);
    for (size_t i = 0; i < qs->size; i++, e = json_next(d, e)) TRY(parse_question(d, e, &r->questions[i]));
    r->question_count = (int)qs->size;
  } else if (qs != NULL) {
    return VIEW_ERR_SCHEMA;
  }
  // opcional: `quick` solo con kind "instruction" (como el refine de zod); de 0 a 4 pares {label, text}
  r->quick_count = 0;
  const JsonTok *qk = json_get(d, o, "quick");
  if (qk != NULL) {
    if (r->kind != REQ_INSTRUCTION || qk->type != JSON_ARRAY) return VIEW_ERR_SCHEMA;
    if (qk->size > VIEW_MAX_QUICK) return VIEW_ERR_LIMIT;
    const JsonTok *e = json_first(d, qk);
    for (size_t i = 0; i < qk->size; i++, e = json_next(d, e)) {
      if (e->type != JSON_OBJECT) return VIEW_ERR_SCHEMA;
      TRY(get_text_max(d, json_get(d, e, "label"), r->quick[i].label, VIEW_QUICK_LABEL_BYTES, VIEW_MAX_QUICK_LABEL));
      TRY(get_text_max(d, json_get(d, e, "text"), r->quick[i].text, VIEW_QUICK_TEXT_BYTES, VIEW_MAX_QUICK_TEXT));
    }
    r->quick_count = (int)qk->size;
  }
  return VIEW_OK;
}

static int parse_face(const JsonDoc *d, const JsonTok *o, FaceView *f) {
  if (o->type != JSON_OBJECT) return VIEW_ERR_SCHEMA;
  int v;
  const JsonTok *k = json_get(d, o, "kind");
  if (k != NULL && k->type == JSON_NULL) {
    f->kind = AGENT_NONE;
  } else {
    TRY(get_enum(d, k, KIND_NAMES, AGENT_COUNT, &v));
    f->kind = (AgentKind)v;
  }
  TRY(get_enum(d, json_get(d, o, "mood"), STATE_NAMES, MOOD_COUNT, &v));
  f->mood = (Mood)v;
  TRY(get_lines(d, json_get(d, o, "lines"), 1, VIEW_MAX_FACE_LINES, f->lines, &f->line_count));
  return VIEW_OK;
}

static int parse_detail(const JsonDoc *d, const JsonTok *o, DetailView *x) {
  if (o->type != JSON_OBJECT) return VIEW_ERR_SCHEMA;
  TRY(get_id(d, json_get(d, o, "sessionId"), x->session_id));
  TRY(get_lines(d, json_get(d, o, "lastMessage"), 0, VIEW_MAX_DETAIL_LINES, x->last_message, &x->line_count));
  // opcional: ausente = sin pregunta; si está, de 1 a 3 líneas (como en zod; null no vale)
  x->question_count = 0;
  const JsonTok *q = json_get(d, o, "question");
  if (q != NULL) TRY(get_lines(d, q, 1, VIEW_MAX_QUESTION_LINES, x->question, &x->question_count));
  // opcional: modo de aviso de la sesión (null no vale)
  x->has_notify = 0;
  x->instr_count = 0;
  x->instr_first[0] = '\0';
  x->wait_for_me = 0;
  const JsonTok *nf = json_get(d, o, "notify");
  if (nf != NULL) {
    int v;
    TRY(get_enum(d, nf, NOTIFY_NAMES, NOTIFY_COUNT, &v));
    x->notify = (NotifyMode)v;
    x->has_notify = 1;
  }
  // opcional (paso 6): instrucciones en cola ({count: 1 a 5, first: texto}) y "Esperar mi respuesta" (booleano)
  const JsonTok *ins = json_get(d, o, "instructions");
  if (ins != NULL) {
    if (ins->type != JSON_OBJECT) return VIEW_ERR_SCHEMA;
    const JsonTok *cnt = json_get(d, ins, "count");
    if (cnt == NULL || cnt->type != JSON_NUMBER) return VIEW_ERR_SCHEMA;
    uint64_t n;
    if (json_uint(d, cnt, &n) != 0 || n < 1 || n > 5) return VIEW_ERR_LIMIT;
    TRY(get_text(d, json_get(d, ins, "first"), x->instr_first));
    x->instr_count = (int)n;
  }
  const JsonTok *wf = json_get(d, o, "waitForMe");
  if (wf != NULL) {
    if (wf->type != JSON_TRUE && wf->type != JSON_FALSE) return VIEW_ERR_SCHEMA;
    x->wait_for_me = wf->type == JSON_TRUE;
  }
  return VIEW_OK;
}

// opcional: ausente = sin tarjeta de aviso; si está, objeto con todos sus campos (como en zod; null no vale)
static int parse_notice(const JsonDoc *d, const JsonTok *o, NoticeView *n) {
  if (o->type != JSON_OBJECT) return VIEW_ERR_SCHEMA;
  int v;
  TRY(get_id(d, json_get(d, o, "id"), n->id));
  TRY(get_id(d, json_get(d, o, "sessionId"), n->session_id));
  TRY(get_enum(d, json_get(d, o, "kind"), NOTICE_NAMES, NOTICE_KIND_COUNT, &v));
  n->kind = (NoticeKind)v;
  TRY(get_text(d, json_get(d, o, "agent"), n->agent));
  TRY(get_text(d, json_get(d, o, "project"), n->project));
  TRY(get_text(d, json_get(d, o, "title"), n->title));
  TRY(get_lines(d, json_get(d, o, "lines"), 0, VIEW_MAX_NOTICE_LINES, n->lines, &n->line_count));
  TRY(get_u32(d, json_get(d, o, "position"), 1, &n->position));
  TRY(get_u32(d, json_get(d, o, "total"), 1, &n->total));
  return VIEW_OK;
}

static int parse_chime(const JsonDoc *d, const JsonTok *o, ChimeView *c) {
  if (o->type != JSON_OBJECT) return VIEW_ERR_SCHEMA;
  int v;
  TRY(get_enum(d, json_get(d, o, "kind"), CHIME_NAMES, CHIME_COUNT, &v));
  c->kind = (ChimeKind)v;
  TRY(get_u32(d, json_get(d, o, "seq"), 1, &c->seq));
  return VIEW_OK;
}

static int hex_val(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  return -1; // zod exige minúsculas
}

// opcional: ausente = no hay versión nueva; si está, {"version":"1.2.3","url":"http://a.b.c.d:puerto/archivo","size":N,"sha256":"<64 hex>"}
// (como zod: formato estricto). Si version o url vienen mal, la vista se rechaza; si falta `size`/`sha256` o no valen (puente viejo, tamaño fuera
// de rango), *offerable queda en 0: la vista se acepta pero no hay oferta, porque no se instala nada que no se pueda verificar.
static int parse_update(const JsonDoc *d, const JsonTok *o, UpdateView *u, int *offerable) {
  *offerable = 0;
  if (o->type != JSON_OBJECT) return VIEW_ERR_SCHEMA;
  const JsonTok *vt = json_get(d, o, "version");
  const JsonTok *ut = json_get(d, o, "url");
  if (vt == NULL || vt->type != JSON_STRING || ut == NULL || ut->type != JSON_STRING) return VIEW_ERR_SCHEMA;
  int cut = 0;
  json_string(d, vt, u->version, sizeof u->version, NULL, &cut);
  if (cut) return VIEW_ERR_LIMIT;
  // tres partes de 1 a 5 dígitos
  int part = 0, digits = 0;
  for (const char *p = u->version;; p++) {
    if (*p >= '0' && *p <= '9') {
      if (++digits > 5) return VIEW_ERR_LIMIT;
    } else if (*p == '.' || *p == '\0') {
      if (digits == 0) return VIEW_ERR_LIMIT;
      if (*p == '\0') break;
      digits = 0;
      part++;
    } else {
      return VIEW_ERR_LIMIT;
    }
  }
  if (part != 2) return VIEW_ERR_LIMIT;
  json_string(d, ut, u->url, sizeof u->url, NULL, &cut);
  if (cut) return VIEW_ERR_LIMIT;
  // http://<IPv4>:<puerto>/<archivo>: solo caracteres que no necesitan escape y el esquema http
  if (strncmp(u->url, "http://", 7) != 0) return VIEW_ERR_LIMIT;
  const char *p = u->url + 7;
  int host = 0;
  while ((*p >= '0' && *p <= '9') || *p == '.') {
    p++;
    host++;
  }
  if (host < 7 || host > 15 || *p != ':') return VIEW_ERR_LIMIT;
  p++;
  digits = 0;
  while (*p >= '0' && *p <= '9') {
    p++;
    digits++;
  }
  if (digits < 1 || digits > 5 || *p != '/') return VIEW_ERR_LIMIT;
  p++;
  int name = 0;
  while ((*p >= 'A' && *p <= 'Z') || (*p >= 'a' && *p <= 'z') || (*p >= '0' && *p <= '9') || *p == '_' || *p == '.' || *p == '-') {
    p++;
    name++;
  }
  if (name < 1 || name > 40 || *p != '\0') return VIEW_ERR_LIMIT;
  // tamaño y SHA-256 del .cia
  const JsonTok *st = json_get(d, o, "size");
  const JsonTok *ht = json_get(d, o, "sha256");
  if (st == NULL || st->type != JSON_NUMBER || ht == NULL || ht->type != JSON_STRING) return VIEW_OK;
  uint64_t size;
  if (json_uint(d, st, &size) != 0 || size < VIEW_UPDATE_SIZE_MIN || size > VIEW_UPDATE_SIZE_MAX) return VIEW_OK;
  char hex[VIEW_UPDATE_SHA_LEN * 2 + 1];
  json_string(d, ht, hex, sizeof hex, NULL, &cut);
  if (cut || strlen(hex) != VIEW_UPDATE_SHA_LEN * 2) return VIEW_OK;
  uint8_t sha[VIEW_UPDATE_SHA_LEN];
  for (size_t i = 0; i < VIEW_UPDATE_SHA_LEN; i++) {
    int hi = hex_val(hex[2 * i]), lo = hex_val(hex[2 * i + 1]);
    if (hi < 0 || lo < 0) return VIEW_OK;
    sha[i] = (uint8_t)(hi << 4 | lo);
  }
  u->size = (uint32_t)size;
  memcpy(u->sha256, sha, sizeof sha);
  *offerable = 1;
  return VIEW_OK;
}

// opcional: ausente = sin ajustes; si está, objeto con los tres campos (como en zod; null no vale)
static int parse_settings(const JsonDoc *d, const JsonTok *o, SettingsView *s) {
  if (o->type != JSON_OBJECT) return VIEW_ERR_SCHEMA;
  int v;
  TRY(get_enum(d, json_get(d, o, "notifyDefault"), NOTIFY_NAMES, NOTIFY_COUNT, &v));
  s->notify_default = (NotifyMode)v;
  const JsonTok *ack = json_get(d, o, "notifyAck");
  if (ack == NULL || (ack->type != JSON_TRUE && ack->type != JSON_FALSE)) return VIEW_ERR_SCHEMA;
  s->notify_ack = ack->type == JSON_TRUE;
  const JsonTok *snd = json_get(d, o, "sound"); // opcional: un puente anterior no lo manda y cuenta como activo
  s->sound = 1;
  if (snd != NULL) {
    if (snd->type != JSON_TRUE && snd->type != JSON_FALSE) return VIEW_ERR_SCHEMA;
    s->sound = snd->type == JSON_TRUE;
  }
  const JsonTok *qst = json_get(d, o, "questions"); // opcional: un puente anterior no lo manda y cuenta como activo
  s->questions = 1;
  if (qst != NULL) {
    if (qst->type != JSON_TRUE && qst->type != JSON_FALSE) return VIEW_ERR_SCHEMA;
    s->questions = qst->type == JSON_TRUE;
  }
  const JsonTok *rdf = json_get(d, o, "readerDefault"); // opcional: "full" o "summary"; un puente anterior no lo manda y cuenta como completo
  s->reader_default = 0;
  if (rdf != NULL) {
    if (rdf->type != JSON_STRING) return VIEW_ERR_SCHEMA;
    if (json_str_eq(d, rdf, "summary")) s->reader_default = 1;
    else if (!json_str_eq(d, rdf, "full")) return VIEW_ERR_SCHEMA;
  }
  const JsonTok *iw = json_get(d, o, "instructWaitMax"); // opcional (paso 6): 5, 10 o 30; un puente anterior no lo manda
  s->has_instruct_wait = 0;
  s->instruct_wait_max = 10;
  if (iw != NULL) {
    if (iw->type != JSON_NUMBER) return VIEW_ERR_SCHEMA;
    uint64_t n;
    if (json_uint(d, iw, &n) != 0 || (n != 5 && n != 10 && n != 30)) return VIEW_ERR_LIMIT;
    s->has_instruct_wait = 1;
    s->instruct_wait_max = (int)n;
  }
  const JsonTok *hid = json_get(d, o, "hiddenAgents");
  if (hid == NULL || hid->type != JSON_ARRAY) return VIEW_ERR_SCHEMA;
  if (hid->size > AGENT_COUNT) return VIEW_ERR_LIMIT;
  const JsonTok *e = json_first(d, hid);
  for (size_t i = 0; i < hid->size; i++, e = json_next(d, e)) {
    TRY(get_enum(d, e, KIND_NAMES, AGENT_COUNT, &v));
    s->hidden[i] = (AgentKind)v;
  }
  s->hidden_count = (int)hid->size;
  return VIEW_OK;
}

static int parse_view_object(const JsonDoc *d, const JsonTok *o, View *out) {
  if (o == NULL || o->type != JSON_OBJECT) return VIEW_ERR_SCHEMA;
  int v;

  const JsonTok *sessions = json_get(d, o, "sessions");
  if (sessions == NULL || sessions->type != JSON_ARRAY) return VIEW_ERR_SCHEMA;
  if (sessions->size > VIEW_MAX_SESSIONS) return VIEW_ERR_LIMIT;
  const JsonTok *e = json_first(d, sessions);
  for (size_t i = 0; i < sessions->size; i++, e = json_next(d, e)) {
    if (e == NULL) return VIEW_ERR_SCHEMA;
    TRY(parse_session(d, e, &out->sessions[i]));
  }
  out->session_count = (int)sessions->size;

  const JsonTok *req = json_get(d, o, "request");
  if (req == NULL) return VIEW_ERR_SCHEMA;
  if (req->type == JSON_NULL) {
    out->has_request = 0;
  } else {
    TRY(parse_request(d, req, &out->request));
    out->has_request = 1;
  }

  TRY(get_u32(d, json_get(d, o, "pendingCount"), 0, &out->pending_count));
  TRY(get_enum(d, json_get(d, o, "mode"), MODE_NAMES, 2, &v));
  out->mode = (PermMode)v;

  const JsonTok *face = json_get(d, o, "face");
  if (face == NULL) return VIEW_ERR_SCHEMA;
  TRY(parse_face(d, face, &out->face));

  const JsonTok *detail = json_get(d, o, "detail");
  if (detail == NULL) return VIEW_ERR_SCHEMA;
  if (detail->type == JSON_NULL) {
    out->has_detail = 0;
  } else {
    TRY(parse_detail(d, detail, &out->detail));
    out->has_detail = 1;
  }

  TRY(get_enum(d, json_get(d, o, "led"), LED_NAMES, VIEW_LED_COUNT, &v));
  out->led = (LedPattern)v;

  out->has_settings = 0;
  const JsonTok *st = json_get(d, o, "settings");
  if (st != NULL) {
    TRY(parse_settings(d, st, &out->settings));
    out->has_settings = 1;
  }

  out->has_notice = 0;
  const JsonTok *nt = json_get(d, o, "notice");
  if (nt != NULL) {
    TRY(parse_notice(d, nt, &out->notice));
    out->has_notice = 1;
  }
  out->has_update = 0;
  const JsonTok *up = json_get(d, o, "update");
  if (up != NULL) {
    int offerable;
    memset(&out->update, 0, sizeof out->update);
    TRY(parse_update(d, up, &out->update, &offerable));
    out->has_update = offerable;
  }
  out->has_chime = 0;
  const JsonTok *ch = json_get(d, o, "chime");
  if (ch != NULL) {
    TRY(parse_chime(d, ch, &out->chime));
    out->has_chime = 1;
  }
  return VIEW_OK;
}

int view_parse_doc(const JsonDoc *doc, View *out) {
  const JsonTok *root = json_root(doc);
  if (root == NULL || root->type != JSON_OBJECT) return VIEW_ERR_SCHEMA;
  const JsonTok *t = json_get(doc, root, "t");
  if (t == NULL || t->type != JSON_STRING) return VIEW_ERR_SCHEMA;

  if (json_str_eq(doc, t, "error")) {
    const JsonTok *code = json_get(doc, root, "code");
    if (code == NULL || code->type != JSON_STRING) return VIEW_ERR_SCHEMA;
    memset(out, 0, sizeof *out);
    json_string(doc, code, out->error_code, VIEW_ERROR_CODE_BYTES, NULL, NULL);
    return VIEW_BRIDGE_ERROR;
  }
  if (!json_str_eq(doc, t, "view")) return VIEW_ERR_SCHEMA;

  memset(out, 0, sizeof *out);
  const JsonTok *rev = json_get(doc, root, "rev");
  if (rev == NULL || rev->type != JSON_NUMBER) return VIEW_ERR_SCHEMA;
  if (json_uint(doc, rev, &out->rev) != 0) return VIEW_ERR_LIMIT;
  return parse_view_object(doc, json_get(doc, root, "view"), out);
}

int view_parse(const char *json, size_t len, View *out) {
  JsonDoc doc;
  if (json_parse(&doc, json, len) != JSON_OK) return VIEW_ERR_JSON;
  return view_parse_doc(&doc, out);
}

int view_countdown_s(const RequestView *r, uint64_t deadline_ms, uint64_t now_ms) {
  if (r->expires_in_s == 0) return -1;
  if (deadline_ms <= now_ms) return 0;
  return (int)((deadline_ms - now_ms + 999u) / 1000u);
}

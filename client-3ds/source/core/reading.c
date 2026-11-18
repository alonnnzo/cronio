#include "reading.h"

#include <string.h>

int reading_is_text(const JsonDoc *d) {
  const JsonTok *root = json_root(d);
  if (root == NULL || root->type != JSON_OBJECT) return 0;
  const JsonTok *t = json_get(d, root, "t");
  return t != NULL && t->type == JSON_STRING && json_str_eq(d, t, "text");
}

// Líneas de texto de hasta READING_MAX_TEXT (48) caracteres, más anchas que las del resto del protocolo; las vacías son válidas (separan párrafos).
static int read_lines(const JsonDoc *d, const JsonTok *t, size_t min, size_t max, ReadText *dst, int *count) {
  if (t == NULL || t->type != JSON_ARRAY) return READING_ERR_SCHEMA;
  if (t->size > max || t->size < min) return READING_ERR_LIMIT;
  const JsonTok *e = json_first(d, t);
  for (size_t i = 0; i < t->size; i++, e = json_next(d, e)) {
    if (e == NULL || e->type != JSON_STRING) return READING_ERR_SCHEMA;
    size_t chars = 0;
    json_string(d, e, dst[i], READING_TEXT_BYTES, &chars, NULL);
    if (chars > READING_MAX_TEXT) return READING_ERR_LIMIT;
  }
  *count = (int)t->size;
  return READING_OK;
}

int reading_parse_doc(const JsonDoc *d, ReadDoc *out) {
  const JsonTok *root = json_root(d);
  if (root == NULL || root->type != JSON_OBJECT || !reading_is_text(d)) return READING_ERR_SCHEMA;
  out->line_count = 0;
  out->truncated = 0;
  out->question_count = 0;

  const JsonTok *id = json_get(d, root, "sessionId");
  if (id == NULL || id->type != JSON_STRING) return READING_ERR_SCHEMA;
  int cut = 0;
  json_string(d, id, out->session_id, VIEW_ID_BYTES, NULL, &cut);
  if (cut || !view_id_valid(out->session_id)) return READING_ERR_LIMIT;

  int r = read_lines(d, json_get(d, root, "lines"), 0, READING_MAX_LINES, out->lines, &out->line_count);
  if (r != READING_OK) return r;

  const JsonTok *tr = json_get(d, root, "truncated");
  if (tr == NULL || (tr->type != JSON_TRUE && tr->type != JSON_FALSE)) return READING_ERR_SCHEMA;
  out->truncated = tr->type == JSON_TRUE;

  const JsonTok *mo = json_get(d, root, "mode"); // opcional: "full" o "summary" (un puente anterior no lo manda)
  out->mode = READ_MODE_FULL;
  if (mo != NULL) {
    if (mo->type != JSON_STRING) return READING_ERR_SCHEMA;
    if (json_str_eq(d, mo, "summary")) out->mode = READ_MODE_SUMMARY;
    else if (!json_str_eq(d, mo, "full")) return READING_ERR_SCHEMA;
  }
  const JsonTok *sh = json_get(d, root, "short"); // opcional: el resumen es el mensaje entero
  out->whole = 0;
  if (sh != NULL) {
    if (sh->type != JSON_TRUE && sh->type != JSON_FALSE) return READING_ERR_SCHEMA;
    out->whole = sh->type == JSON_TRUE;
  }

  const JsonTok *q = json_get(d, root, "question"); // opcional: de 1 a 3 líneas; null no vale
  if (q != NULL) {
    r = read_lines(d, q, 1, VIEW_MAX_QUESTION_LINES, out->question, &out->question_count);
    if (r != READING_OK) return r;
  }
  return READING_OK;
}

int reading_parse(const char *json, size_t len, ReadDoc *out) {
  JsonDoc doc;
  if (json_parse(&doc, json, len) != JSON_OK) return VIEW_ERR_JSON;
  return reading_parse_doc(&doc, out);
}

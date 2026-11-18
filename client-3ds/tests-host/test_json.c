#include "test.h"

#include "../source/core/json.h"

static Guard IN;   // entrada pegada a la guarda
static Guard OUT;  // salida pegada a la guarda
static JsonDoc doc;

// Analiza una copia del texto cuyo último byte está contra la página de guarda.
static int parse_n(const char *s, size_t len) {
  const char *p = (const char *)guard_copy(&IN, s, len);
  return json_parse(&doc, p, len);
}
static int parse(const char *s) { return parse_n(s, strlen(s)); }

// Decodifica la cadena (token raíz) a un búfer de exactamente cap bytes pegado a la guarda.
static size_t decode(const JsonTok *t, size_t cap, char **out, size_t *units, int *trunc) {
  *out = (char *)guard_at_end(&OUT, cap);
  return json_string(&doc, t, *out, cap, units, trunc);
}

static void check_string(const char *json, const char *want, size_t want_len, size_t want_units) {
  CHECK_EQ_INT(parse(json), JSON_OK);
  const JsonTok *r = json_root(&doc);
  CHECK(r != NULL && r->type == JSON_STRING);
  char buf[256];
  size_t units = 0;
  int cut = 7;
  size_t n = json_string(&doc, r, buf, sizeof buf, &units, &cut);
  CHECK_EQ_INT(n, want_len);
  CHECK_MEM(buf, want, want_len);
  CHECK_EQ_INT(buf[n], 0);
  CHECK_EQ_INT(units, want_units);
  CHECK_EQ_INT(cut, 0);
}

static void test_scalars(void) {
  CHECK_EQ_INT(parse("true"), JSON_OK);
  CHECK_EQ_INT(json_root(&doc)->type, JSON_TRUE);
  CHECK_EQ_INT(parse(" \t\r\nfalse \n"), JSON_OK);
  CHECK_EQ_INT(json_root(&doc)->type, JSON_FALSE);
  CHECK_EQ_INT(parse("null"), JSON_OK);
  CHECK_EQ_INT(json_root(&doc)->type, JSON_NULL);
  const char *nums[] = {"0", "-0", "7", "-7", "10", "1.5", "-1.5", "0.5", "1e5", "1E+5", "1e-5", "1.5e10", "123456789012345678901234567890"};
  for (size_t i = 0; i < sizeof nums / sizeof nums[0]; i++) {
    CHECK_MSG(parse(nums[i]) == JSON_OK, "número %s", nums[i]);
    CHECK_EQ_INT(json_root(&doc)->type, JSON_NUMBER);
  }
  const char *bad[] = {"01", "00", "-", "1.", ".5", "1e", "1e+", "1e-", "+1", "--1", "0x10", "NaN", "Infinity", "-Infinity", "1.e5", "- 1", "1 2"};
  for (size_t i = 0; i < sizeof bad / sizeof bad[0]; i++) CHECK_MSG(parse(bad[i]) < 0, "debe fallar: %s", bad[i]);
}

static void test_uint(void) {
  uint64_t v = 99;
  struct { const char *s; int ok; uint64_t v; } cases[] = {
      {"0", 1, 0},
      {"7", 1, 7},
      {"4294967295", 1, 4294967295ull},
      {"9007199254740991", 1, 9007199254740991ull},
      {"9007199254740992", 0, 0},
      {"99999999999999999", 0, 0},
      {"123456789012345678901234567890", 0, 0},
      {"-1", 0, 0},
      {"-0", 0, 0},
      {"1.0", 0, 0},
      {"1e2", 0, 0},
  };
  for (size_t i = 0; i < sizeof cases / sizeof cases[0]; i++) {
    CHECK_EQ_INT(parse(cases[i].s), JSON_OK);
    v = 99;
    int r = json_uint(&doc, json_root(&doc), &v);
    CHECK_MSG((r == 0) == cases[i].ok, "json_uint(%s)", cases[i].s);
    if (cases[i].ok) CHECK_EQ_INT(v, cases[i].v);
  }
  CHECK_EQ_INT(parse("\"7\""), JSON_OK);
  CHECK_EQ_INT(json_uint(&doc, json_root(&doc), &v), -1);
  CHECK_EQ_INT(json_uint(&doc, NULL, &v), -1);
}

static void test_string_escapes(void) {
  check_string("\"\"", "", 0, 0);
  check_string("\"hola\"", "hola", 4, 4);
  check_string("\"a\\\"b\\\\c\\/d\\be\\ff\\ng\\rh\\ti\"", "a\"b\\c/d\be\ff\ng\rh\ti", 17, 17);
  check_string("\"\\u0041\\u00e9\\u20AC\"", "A\xc3\xa9\xe2\x82\xac", 6, 3);
  check_string("\"\\u00E9\"", "\xc3\xa9", 2, 1);
  // par sustituto: un solo carácter de 4 bytes y 2 unidades UTF-16
  check_string("\"\\ud83d\\ude00\"", "\xf0\x9f\x98\x80", 4, 1);
  check_string("\"\\uD83D\\uDE00x\"", "\xf0\x9f\x98\x80x", 5, 2);
  check_string("\"\\udbff\\udfff\"", "\xf4\x8f\xbf\xbf", 4, 1);   // U+10FFFF
  check_string("\"\\ud800\\udc00\"", "\xf0\x90\x80\x80", 4, 1);   // U+10000
  // mitades sueltas -> U+FFFD (1 unidad)
  check_string("\"\\ud83d\"", "\xef\xbf\xbd", 3, 1);
  check_string("\"\\ude00\"", "\xef\xbf\xbd", 3, 1);
  check_string("\"\\ud83dx\"", "\xef\xbf\xbdx", 4, 2);
  check_string("\"\\ud83d\\u0041\"", "\xef\xbf\xbd" "A", 4, 2);
  check_string("\"\\ud83d\\ud83d\\ude00\"", "\xef\xbf\xbd\xf0\x9f\x98\x80", 7, 2);
  check_string("\"\\ude00\\ud83d\"", "\xef\xbf\xbd\xef\xbf\xbd", 6, 2);
  // NUL escapado -> U+FFFD (una cadena de C no puede llevarlo)
  check_string("\"a\\u0000b\"", "a\xef\xbf\xbd" "b", 5, 3);
  // UTF-8 directo
  check_string("\"\xc3\xa9\xe2\x82\xac\xf0\x9f\x98\x80\"", "\xc3\xa9\xe2\x82\xac\xf0\x9f\x98\x80", 9, 3);
  check_string("\"\x7f\"", "\x7f", 1, 1); // DEL no es de control para JSON
  check_string("\"\xf4\x8f\xbf\xbf\"", "\xf4\x8f\xbf\xbf", 4, 1);
  check_string("\"\xef\xbf\xbd\"", "\xef\xbf\xbd", 3, 1);
}

static void test_string_rejects(void) {
  CHECK_EQ_INT(parse("\"abc"), JSON_ERR_SYNTAX);
  CHECK_EQ_INT(parse("\""), JSON_ERR_SYNTAX);
  CHECK_EQ_INT(parse("\"abc\\"), JSON_ERR_SYNTAX);
  CHECK_EQ_INT(parse("\"abc\\\""), JSON_ERR_SYNTAX);        // la comilla queda escapada: sin cerrar
  CHECK_EQ_INT(parse("\"\\q\""), JSON_ERR_SYNTAX);
  CHECK_EQ_INT(parse("\"\\x41\""), JSON_ERR_SYNTAX);
  CHECK_EQ_INT(parse("\"\\u\""), JSON_ERR_SYNTAX);
  CHECK_EQ_INT(parse("\"\\u1\""), JSON_ERR_SYNTAX);
  CHECK_EQ_INT(parse("\"\\u12\""), JSON_ERR_SYNTAX);
  CHECK_EQ_INT(parse("\"\\u123\""), JSON_ERR_SYNTAX);
  CHECK_EQ_INT(parse("\"\\u123"), JSON_ERR_SYNTAX);
  CHECK_EQ_INT(parse("\"\\u12g4\""), JSON_ERR_SYNTAX);
  CHECK_EQ_INT(parse("\"\\u12 4\""), JSON_ERR_SYNTAX);
  CHECK_EQ_INT(parse("\"\\ud83d\\u12\""), JSON_ERR_SYNTAX);
  // caracteres de control sin escapar
  for (int c = 0; c < 0x20; c++) {
    char s[4] = {'"', (char)c, '"', 0};
    CHECK_MSG(parse_n(s, 3) == JSON_ERR_SYNTAX, "control 0x%02x", c);
  }
  // UTF-8 inválido
  const char *bad[] = {
      "\"\x80\"",                  // continuación suelta
      "\"\xbf\"",
      "\"\xc2\"",                  // truncada
      "\"\xe2\x82\"",
      "\"\xf0\x9f\x98\"",
      "\"\xc0\x80\"",              // sobrelarga
      "\"\xc1\xbf\"",
      "\"\xe0\x80\x80\"",
      "\"\xe0\x9f\xbf\"",
      "\"\xf0\x80\x80\x80\"",
      "\"\xf0\x8f\xbf\xbf\"",
      "\"\xed\xa0\x80\"",          // sustituto U+D800
      "\"\xed\xbf\xbf\"",
      "\"\xf4\x90\x80\x80\"",      // > U+10FFFF
      "\"\xf5\x80\x80\x80\"",
      "\"\xf8\x88\x80\x80\x80\"",
      "\"\xff\"",
      "\"\xfe\"",
      "\"\xe2\x28\xa1\"",
      "\"\xc3\x28\"",
  };
  for (size_t i = 0; i < sizeof bad / sizeof bad[0]; i++) {
    int r = parse(bad[i]);
    CHECK_MSG(r == JSON_ERR_UTF8 || r == JSON_ERR_SYNTAX, "UTF-8 inválido #%zu aceptado (%d)", i, r);
  }
  CHECK_EQ_INT(parse("\"\xe2\x82\""), JSON_ERR_UTF8);
}

static void test_structure(void) {
  const char *src = " { \"a\" : [ 1 , \"x\" , { \"b\" : null } , [ ] ] , \"c\" : { } , \"a\" : true , \"d\\u0065\" : false } ";
  CHECK_EQ_INT(parse(src), JSON_OK);
  const JsonTok *root = json_root(&doc);
  CHECK_EQ_INT(root->type, JSON_OBJECT);
  CHECK_EQ_INT(root->size, 4);
  // clave repetida: gana la última
  const JsonTok *a = json_get(&doc, root, "a");
  CHECK(a != NULL && a->type == JSON_TRUE);
  const JsonTok *c = json_get(&doc, root, "c");
  CHECK(c != NULL && c->type == JSON_OBJECT && c->size == 0);
  CHECK(json_first(&doc, c) == NULL);
  const JsonTok *de = json_get(&doc, root, "de"); // "d\u0065" es "de"
  CHECK(de != NULL && de->type == JSON_FALSE);
  CHECK(json_get(&doc, root, "zz") == NULL);
  CHECK(json_get(&doc, root, "") == NULL);
  CHECK(json_get(&doc, a, "x") == NULL);   // no es objeto
  CHECK(json_get(&doc, NULL, "x") == NULL);

  // la primera "a" (el arreglo) se recorre con first/next, y at
  const JsonTok *k = json_first(&doc, root);
  CHECK(json_str_eq(&doc, k, "a"));
  const JsonTok *arr = json_next(&doc, k);
  CHECK(arr != NULL && arr->type == JSON_ARRAY && arr->size == 4);
  CHECK_EQ_INT(json_at(&doc, arr, 0)->type, JSON_NUMBER);
  CHECK_EQ_INT(json_at(&doc, arr, 1)->type, JSON_STRING);
  const JsonTok *obj = json_at(&doc, arr, 2);
  CHECK_EQ_INT(obj->type, JSON_OBJECT);
  CHECK_EQ_INT(json_get(&doc, obj, "b")->type, JSON_NULL);
  const JsonTok *empty = json_at(&doc, arr, 3);
  CHECK(empty->type == JSON_ARRAY && empty->size == 0);
  CHECK(json_at(&doc, arr, 4) == NULL);
  CHECK(json_at(&doc, root, 0) == NULL);
  const JsonTok *e = json_first(&doc, arr);
  int n = 0;
  for (; n < 4; n++) e = json_next(&doc, e);
  CHECK(e != NULL); // el siguiente del arreglo es la clave "c"
  CHECK(json_str_eq(&doc, e, "c"));

  // json_str_eq
  CHECK_EQ_INT(parse("\"h\\u00e9\""), JSON_OK);
  CHECK(json_str_eq(&doc, json_root(&doc), "h\xc3\xa9"));
  CHECK(!json_str_eq(&doc, json_root(&doc), "h"));
  CHECK(!json_str_eq(&doc, json_root(&doc), "h\xc3\xa9x"));
  CHECK(!json_str_eq(&doc, NULL, "x"));
  CHECK_EQ_INT(parse("5"), JSON_OK);
  CHECK(!json_str_eq(&doc, json_root(&doc), "5"));
}

static void test_syntax_errors(void) {
  const char *bad[] = {
      "",         " ",       "\n",     "tru",      "truee",   "nul",      "nulll",   "True",    "falsy",
      "{",        "}",       "[",      "]",        "{\"a\"",  "{\"a\":",  "{\"a\":}", "{\"a\"}", "{1:2}",
      "{\"a\":1,}", "[1,]",  "[,1]",   "[1 2]",    "{\"a\":1 \"b\":2}", "{\"a\":1,,\"b\":2}", "[1,,2]",
      "{\"a\":1",   "[1",    "[1,",    "{\"a\":1,", "{'a':1}", "[1] x",   "{} {}",   "[][]",    "//x\n1",
      "/* */1",   "\"a\" \"b\"", "[\"a\" \"b\"]", ":",    ",",       "{\"a\":1}}", "[[]", "[]]",
  };
  for (size_t i = 0; i < sizeof bad / sizeof bad[0]; i++) CHECK_MSG(parse(bad[i]) < 0, "debe fallar: %s", bad[i]);
  // NUL embebido
  CHECK(parse_n("[1,\0 2]", 7) < 0);
  CHECK(parse_n("1\0", 2) < 0);
  CHECK(parse_n("{\"a\":\0}", 7) < 0);
  CHECK_EQ_INT(parse_n(NULL, 0), JSON_ERR_SYNTAX);
}

static void test_depth_and_tokens(void) {
  char buf[200];
  // 16 niveles de arreglos: el máximo; 17: error de profundidad
  for (int depth = 1; depth <= 20; depth++) {
    memset(buf, '[', (size_t)depth);
    memset(buf + depth, ']', (size_t)depth);
    int r = parse_n(buf, (size_t)depth * 2);
    CHECK_MSG((depth <= JSON_MAX_DEPTH) == (r == JSON_OK), "profundidad %d -> %d", depth, r);
    if (depth > JSON_MAX_DEPTH) CHECK_EQ_INT(r, JSON_ERR_DEPTH);
  }
  // objetos anidados: 16 niveles pasan, 17 no
  for (int levels = 15; levels <= 17; levels++) {
    size_t l = 0;
    for (int k = 0; k < levels; k++) {
      memcpy(buf + l, "{\"a\":", 5);
      l += 5;
    }
    buf[l++] = '1';
    for (int k = 0; k < levels; k++) buf[l++] = '}';
    CHECK_EQ_INT(parse_n(buf, l), levels <= JSON_MAX_DEPTH ? JSON_OK : JSON_ERR_DEPTH);
  }
  // apertura sin cierre, muy profunda: no debe desbordar la pila
  static char deep[60000];
  memset(deep, '[', sizeof deep);
  CHECK_EQ_INT(parse_n(deep, sizeof deep), JSON_ERR_DEPTH);
  memset(deep, '{', sizeof deep);
  CHECK(parse_n(deep, sizeof deep) < 0);
  static char deep2[60000];
  for (size_t i = 0; i + 5 < sizeof deep2; i += 5) memcpy(deep2 + i, "{\"a\":", 5);
  CHECK(parse_n(deep2, sizeof deep2 - 5) < 0);

  // tope de tokens: un arreglo con N enteros usa N+1
  static char arr[JSON_MAX_TOKENS * 2 + 8];
  for (int n = JSON_MAX_TOKENS - 3; n <= JSON_MAX_TOKENS + 2; n++) {
    size_t l = 0;
    arr[l++] = '[';
    for (int i = 0; i < n; i++) {
      if (i) arr[l++] = ',';
      arr[l++] = '0';
    }
    arr[l++] = ']';
    int r = parse_n(arr, l);
    if (n + 1 <= JSON_MAX_TOKENS) CHECK_EQ_INT(r, JSON_OK);
    else CHECK_EQ_INT(r, JSON_ERR_TOKENS);
  }
  // largo máximo de la entrada
  static char big[JSON_MAX_INPUT + 2];
  memset(big, 'a', sizeof big);
  big[0] = '"';
  big[JSON_MAX_INPUT - 1] = '"';
  CHECK_EQ_INT(parse_n(big, JSON_MAX_INPUT), JSON_OK);
  CHECK_EQ_INT(json_root(&doc)->end, JSON_MAX_INPUT - 1);
  big[JSON_MAX_INPUT] = ' ';
  CHECK_EQ_INT(parse_n(big, JSON_MAX_INPUT + 1), JSON_ERR_TOO_LONG);
}

static void test_prefixes(void) {
  // Todo prefijo propio de un documento válido es un error (nunca OK ni lectura fuera del búfer).
  const char *docs[] = {
      "{\"t\":\"view\",\"rev\":7,\"view\":{\"sessions\":[{\"id\":\"s1\",\"title\":\"caf\\u00e9 \\ud83d\\ude00\"}],\"request\":null,\"x\":[1.5e3,-2,true,false,null]}}",
      "[\"\\u00e9\\ud83d\\ude00\",{\"a\":[[],{}]}]",
      "{\"a\":\"\xc3\xa9\xe2\x82\xac\xf0\x9f\x98\x80\"}",
  };
  for (size_t d = 0; d < sizeof docs / sizeof docs[0]; d++) {
    size_t len = strlen(docs[d]);
    CHECK_EQ_INT(parse_n(docs[d], len), JSON_OK);
    for (size_t n = 0; n < len; n++) {
      int r = parse_n(docs[d], n);
      CHECK_MSG(r < 0, "el prefijo de %zu bytes del documento %zu se aceptó", n, d);
    }
  }
  // y un único byte cualquiera en cada posición: puede dar OK o error, pero sin salirse del búfer
  const char *base = docs[0];
  size_t len = strlen(base);
  char tmp[256];
  for (size_t i = 0; i < len; i++) {
    for (int v = 0; v < 256; v += 17) {
      memcpy(tmp, base, len);
      tmp[i] = (char)v;
      int r = parse_n(tmp, len);
      CHECK(r == JSON_OK || r < 0);
      if (r == JSON_OK) { // si se aceptó, recorrer lo que contiene también debe ser seguro
        char out[8];
        for (int t = 0; t < doc.count; t++) json_string(&doc, &doc.toks[t], out, sizeof out, NULL, NULL);
      }
    }
  }
}

static void test_decode_truncation(void) {
  // "aé€😀" : bytes 1,2,3,4 -> acumulado 1,3,6,10; unidades 1+1+1+2 = 5
  const char *json = "\"a\xc3\xa9\xe2\x82\xac\xf0\x9f\x98\x80\"";
  const char *full = "a\xc3\xa9\xe2\x82\xac\xf0\x9f\x98\x80";
  CHECK_EQ_INT(parse(json), JSON_OK);
  const JsonTok *t = json_root(&doc);
  for (size_t cap = 0; cap <= 14; cap++) {
    char *out;
    size_t units = 0;
    int cut = -1;
    size_t n = decode(t, cap, &out, &units, &cut);
    // cuántos caracteres enteros caben dejando sitio al NUL
    size_t sizes[4] = {1, 2, 3, 4}, used = 0, kept = 0;
    for (int i = 0; i < 4; i++) {
      if (cap > 0 && used + sizes[i] + 1 <= cap) {
        used += sizes[i];
        kept++;
      } else {
        break;
      }
    }
    CHECK_EQ_INT(n, used);
    CHECK_EQ_INT(units, 4);
    CHECK_EQ_INT(cut, kept < 4 ? 1 : 0);
    if (cap > 0) {
      CHECK_EQ_INT(out[n], 0);
      CHECK_MEM(out, full, n);
      // nunca queda a medias un carácter: el último byte escrito no es un inicio sin sus continuaciones
      if (n > 0) {
        size_t i = n;
        while (i > 0 && ((unsigned char)out[i - 1] & 0xc0) == 0x80) i--;
        unsigned char lead = (unsigned char)out[i - 1];
        size_t need = lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4;
        CHECK_EQ_INT(n - (i - 1), need);
      }
    }
  }
  // un carácter corto no se cuela después de uno largo que no cupo
  CHECK_EQ_INT(parse("\"\xf0\x9f\x98\x80z\""), JSON_OK);
  char *out;
  size_t units;
  int cut;
  size_t n = decode(json_root(&doc), 4, &out, &units, &cut); // el emoji no cabe en 3 bytes; la z no debe aparecer
  CHECK_EQ_INT(n, 0);
  CHECK_EQ_INT(cut, 1);
  CHECK_EQ_INT(units, 2);
  CHECK_EQ_INT(out[0], 0);

  // texto largo con escapes que expanden: se corta y cuenta todo
  static char longjson[6000];
  size_t l = 0;
  longjson[l++] = '"';
  for (int i = 0; i < 300; i++) {
    memcpy(longjson + l, "\\u20ac\\ud83d\\ude00", 18);
    l += 18;
  }
  longjson[l++] = '"';
  CHECK_EQ_INT(parse_n(longjson, l), JSON_OK);
  n = decode(json_root(&doc), 116, &out, &units, &cut);
  CHECK_EQ_INT(units, 600);
  CHECK_EQ_INT(cut, 1);
  CHECK_EQ_INT(n, 115); // 16 pares (7 bytes) + un euro; el emoji siguiente ya no cabe
  CHECK_EQ_INT(out[n], 0);

  // token que no es cadena: salida vacía
  CHECK_EQ_INT(parse("[1]"), JSON_OK);
  char buf[4] = {'x', 'x', 'x', 'x'};
  CHECK_EQ_INT(json_string(&doc, json_root(&doc), buf, sizeof buf, &units, &cut), 0);
  CHECK_EQ_INT(buf[0], 0);
  CHECK_EQ_INT(units, 0);
  CHECK_EQ_INT(json_string(&doc, NULL, buf, sizeof buf, NULL, NULL), 0);
}

int main(void) {
  TEST_BEGIN("json: lector, escapes, UTF-8, límites y entradas hostiles");
  guard_init(&IN, 70000);
  guard_init(&OUT, 4096);
  RUN(test_scalars);
  RUN(test_uint);
  RUN(test_string_escapes);
  RUN(test_string_rejects);
  RUN(test_structure);
  RUN(test_syntax_errors);
  RUN(test_depth_and_tokens);
  RUN(test_prefixes);
  RUN(test_decode_truncation);
  TEST_END();
}

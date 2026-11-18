#include "handshake.h"

#include <string.h>

#include "json.h"
#include "sha256.h"

static const char CROCKFORD[] = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

int pairing_code_normalize(const char *in, char out[HS_CODE_LEN + 1]) {
  size_t n = 0;
  for (; *in != '\0'; in++) {
    char c = *in;
    if (c == '-' || c == ' ') continue;
    if (c >= 'a' && c <= 'z') c = (char)(c - 'a' + 'A');
    if (c == '\0' || strchr(CROCKFORD, c) == NULL || n >= HS_CODE_LEN) return -1;
    out[n++] = c;
  }
  if (n != HS_CODE_LEN) return -1;
  out[n] = '\0';
  return 0;
}

int hs_derive_device_key(const char *code, const char *device_id, uint8_t key[HS_KEY_LEN]) {
  char norm[HS_CODE_LEN + 1];
  if (pairing_code_normalize(code, norm) != 0) return -1;
  size_t id_len = strlen(device_id);
  if (id_len < 1 || id_len > HS_DEVICE_ID_MAX) return -1;
  static const char SALT[] = "3dsac-pair-v1";
  int r = hkdf_sha256(SALT, sizeof SALT - 1, norm, HS_CODE_LEN, device_id, id_len, key, HS_KEY_LEN);
  memset(norm, 0, sizeof norm);
  return r;
}

static void mac_head(Hmac256 *h, const uint8_t k[HS_KEY_LEN], const char *label, const uint8_t a[HS_NONCE_LEN],
                     const uint8_t b[HS_NONCE_LEN]) {
  hmac256_init(h, k, HS_KEY_LEN);
  hmac256_update(h, label, strlen(label));
  hmac256_update(h, a, HS_NONCE_LEN);
  hmac256_update(h, b, HS_NONCE_LEN);
}

static void mac_lp(Hmac256 *h, const char *s) {
  size_t n = s != NULL ? strlen(s) : 0;
  uint8_t len = (uint8_t)(n > 255 ? 255 : n);
  hmac256_update(h, &len, 1);
  if (len > 0) hmac256_update(h, s, len);
}

void hs_hello_mac(const uint8_t k[HS_KEY_LEN], const uint8_t nonce_b[HS_NONCE_LEN], const uint8_t nonce_c[HS_NONCE_LEN],
                  const char *device_id, const char *app_version, int install, uint8_t out[HS_MAC_LEN]) {
  Hmac256 h;
  mac_head(&h, k, "hello2", nonce_b, nonce_c);
  uint8_t v = HS_PROTOCOL_VERSION;
  hmac256_update(&h, &v, 1);
  mac_lp(&h, device_id);
  mac_lp(&h, app_version);
  uint8_t inst = install == 1 ? 1 : install == 0 ? 2 : 0;
  hmac256_update(&h, &inst, 1);
  hmac256_final(&h, out);
}

static void mac_v2(const uint8_t k[HS_KEY_LEN], const char *label, const uint8_t a[HS_NONCE_LEN],
                   const uint8_t b[HS_NONCE_LEN], uint8_t out[SHA256_DIGEST_LEN]) {
  Hmac256 h;
  mac_head(&h, k, label, a, b);
  uint8_t v = HS_PROTOCOL_VERSION;
  hmac256_update(&h, &v, 1);
  hmac256_final(&h, out);
}

void hs_welcome_mac(const uint8_t k[HS_KEY_LEN], const uint8_t nonce_b[HS_NONCE_LEN],
                    const uint8_t nonce_c[HS_NONCE_LEN], uint8_t out[HS_MAC_LEN]) {
  mac_v2(k, "welcome2", nonce_c, nonce_b, out); // el orden de los nonces es el del puente: welcome usa (C, B)
}

void hs_session_key(const uint8_t k[HS_KEY_LEN], const uint8_t nonce_b[HS_NONCE_LEN],
                    const uint8_t nonce_c[HS_NONCE_LEN], uint8_t out[HS_KEY_LEN]) {
  mac_v2(k, "session2", nonce_b, nonce_c, out);
}

// ---- Hex ----

void hex_encode(const uint8_t *in, size_t len, char *out) {
  static const char D[] = "0123456789abcdef";
  for (size_t i = 0; i < len; i++) {
    out[i * 2] = D[in[i] >> 4];
    out[i * 2 + 1] = D[in[i] & 15];
  }
  out[len * 2] = '\0';
}

static int hex_digit(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

int hex_decode(const char *hex, size_t hex_len, uint8_t *out, size_t len) {
  if (hex_len != len * 2) return -1;
  for (size_t i = 0; i < len; i++) {
    int a = hex_digit(hex[i * 2]), b = hex_digit(hex[i * 2 + 1]);
    if (a < 0 || b < 0) return -1;
    out[i] = (uint8_t)((a << 4) | b);
  }
  return 0;
}

// ---- Mensajes ----

static int hex_field(const JsonDoc *d, const JsonTok *obj, const char *key, uint8_t *out, size_t len) {
  const JsonTok *t = json_get(d, obj, key);
  if (t == NULL || t->type != JSON_STRING) return -1;
  char buf[HS_MAC_LEN * 2 + 2];
  size_t chars = 0;
  int cut = 0;
  size_t n = json_string(d, t, buf, sizeof buf, &chars, &cut);
  if (cut || n != chars) return -1; // un hex válido es ASCII: bytes y caracteres coinciden
  return hex_decode(buf, n, out, len);
}

int hs_parse(const char *json, size_t len, HsMsg *out) {
  JsonDoc doc;
  if (json_parse(&doc, json, len) != JSON_OK) return -1;
  const JsonTok *root = json_root(&doc);
  if (root == NULL || root->type != JSON_OBJECT) return -1;
  const JsonTok *t = json_get(&doc, root, "t");
  if (t == NULL || t->type != JSON_STRING) return -1;
  memset(out, 0, sizeof *out);
  if (json_str_eq(&doc, t, "challenge")) {
    const JsonTok *v = json_get(&doc, root, "v");
    uint64_t ver;
    if (v != NULL && (json_uint(&doc, v, &ver) != 0 || ver != 1)) return -1;
    if (hex_field(&doc, root, "nonceB", out->nonce_b, HS_NONCE_LEN) != 0) return -1;
    out->kind = HS_MSG_CHALLENGE;
    return 0;
  }
  if (json_str_eq(&doc, t, "welcome")) {
    if (hex_field(&doc, root, "mac", out->mac, HS_MAC_LEN) != 0) return -1;
    out->kind = HS_MSG_WELCOME;
    return 0;
  }
  if (json_str_eq(&doc, t, "error")) {
    const JsonTok *c = json_get(&doc, root, "code");
    if (c == NULL || c->type != JSON_STRING) return -1;
    json_string(&doc, c, out->code, sizeof out->code, NULL, NULL);
    out->kind = HS_MSG_ERROR;
    return 0;
  }
  return -1;
}

static int version_text_ok(const char *v) {
  size_t n = strlen(v);
  if (n < 1 || n > 16) return 0;
  for (size_t i = 0; i < n; i++) {
    char c = v[i];
    if (!((c >= '0' && c <= '9') || c == '.' || (c == 'v' && i == 0))) return 0; // solo lo que cabe sin escapes en JSON
  }
  return 1;
}

int hs_build_hello_app(char *out, size_t cap, const char *device_id, const uint8_t nonce_c[HS_NONCE_LEN],
                       const uint8_t mac[HS_MAC_LEN], const char *app_version, int install) {
  size_t id_len = strlen(device_id);
  if (id_len < 1 || id_len > HS_DEVICE_ID_MAX) return -1;
  // mismo juego de caracteres que los ids de la vista, pero hasta 64 (el puente acepta 1 a 64)
  for (size_t i = 0; i < id_len; i++) {
    char c = device_id[i];
    int ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '.' ||
             c == ':' || c == '-';
    if (!ok) return -1;
  }
  if (app_version != NULL && !version_text_ok(app_version)) return -1;
  char nc[HS_NONCE_LEN * 2 + 1], mc[HS_MAC_LEN * 2 + 1];
  hex_encode(nonce_c, HS_NONCE_LEN, nc);
  hex_encode(mac, HS_MAC_LEN, mc);
  static const char P1[] = "{\"t\":\"hello\",\"v\":2,\"deviceId\":\"";
  static const char P2[] = "\",\"nonceC\":\"";
  static const char P3[] = "\",\"mac\":\"";
  static const char P4[] = "\"";
  static const char PV[] = ",\"appVersion\":\"";
  static const char PI[] = ",\"install\":\"";
  static const char P5[] = "}";
  const char *inst = install == 1 ? "cia" : install == 0 ? "3dsx" : NULL;
  size_t ver_len = app_version != NULL ? strlen(app_version) : 0;
  size_t total = (sizeof P1 - 1) + id_len + (sizeof P2 - 1) + 32 + (sizeof P3 - 1) + 64 + (sizeof P4 - 1) + (sizeof P5 - 1);
  if (app_version != NULL) total += (sizeof PV - 1) + ver_len + (sizeof P4 - 1);
  if (inst != NULL) total += (sizeof PI - 1) + strlen(inst) + (sizeof P4 - 1);
  if (cap < total + 1) return -1;
  size_t n = 0;
#define PUT(src, len) do { memcpy(out + n, (src), (len)); n += (len); } while (0)
  PUT(P1, sizeof P1 - 1);
  PUT(device_id, id_len);
  PUT(P2, sizeof P2 - 1);
  PUT(nc, 32);
  PUT(P3, sizeof P3 - 1);
  PUT(mc, 64);
  PUT(P4, sizeof P4 - 1);
  if (app_version != NULL) {
    PUT(PV, sizeof PV - 1);
    PUT(app_version, ver_len);
    PUT(P4, sizeof P4 - 1);
  }
  if (inst != NULL) {
    PUT(PI, sizeof PI - 1);
    PUT(inst, strlen(inst));
    PUT(P4, sizeof P4 - 1);
  }
  PUT(P5, sizeof P5 - 1);
#undef PUT
  out[n] = '\0';
  return (int)n;
}

int hs_build_hello(char *out, size_t cap, const char *device_id, const uint8_t nonce_c[HS_NONCE_LEN],
                   const uint8_t mac[HS_MAC_LEN]) {
  return hs_build_hello_app(out, cap, device_id, nonce_c, mac, NULL, -1);
}

#include "beacon.h"

#include "../core/json.h"

int beacon_parse(const char *data, size_t len, uint16_t *port) {
  static JsonDoc doc; // 4 KB: fuera de la pila
  if (data == NULL || len == 0 || len > JSON_MAX_INPUT) return -1;
  if (json_parse(&doc, data, len) != JSON_OK) return -1;
  const JsonTok *root = json_root(&doc);
  if (root == NULL || root->type != JSON_OBJECT) return -1;
  const JsonTok *service = json_get(&doc, root, "service");
  if (service == NULL || !json_str_eq(&doc, service, "3ds-agent-companion")) return -1;
  const JsonTok *v = json_get(&doc, root, "v");
  if (v != NULL) {
    uint64_t n;
    if (json_uint(&doc, v, &n) != 0 || n != 1) return -1;
  }
  const JsonTok *p = json_get(&doc, root, "port");
  uint64_t n;
  if (p == NULL || json_uint(&doc, p, &n) != 0 || n < 1 || n > 65535) return -1;
  if (port != NULL) *port = (uint16_t)n;
  return 0;
}

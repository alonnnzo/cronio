#include "approve.h"

#include <string.h>

// now - since con signo: el tiempo puede ir hacia atrás en las pruebas y no debe envolver.
static int64_t elapsed(uint64_t now, uint64_t since) { return (int64_t)now - (int64_t)since; }

static int can_approve(uint64_t now, uint64_t shown_since) { return elapsed(now, shown_since) >= APPROVE_GUARD_MS; }

static void copy_id(char dst[VIEW_ID_BYTES], const char *src) {
  size_t n = strlen(src);
  if (n > VIEW_MAX_ID) n = VIEW_MAX_ID;
  memcpy(dst, src, n);
  dst[n] = '\0';
}

void approve_init(Approve *a) { memset(a, 0, sizeof *a); }

void approve_request_key(const ApproveRequest *r, uint8_t key[SHA256_DIGEST_LEN]) {
  // Codificación sin ambigüedad: las cadenas no contienen NUL, así que cada una termina en uno; el riesgo y el
  // número de líneas van fijos.
  Sha256 h;
  sha256_init(&h);
  sha256_update(&h, r->id, strlen(r->id) + 1);
  uint8_t flags[5];
  flags[0] = r->high ? 1 : 0;
  uint32_t n = (uint32_t)r->line_count;
  flags[1] = (uint8_t)n;
  flags[2] = (uint8_t)(n >> 8);
  flags[3] = (uint8_t)(n >> 16);
  flags[4] = (uint8_t)(n >> 24);
  sha256_update(&h, flags, sizeof flags);
  const char *owner = r->owner != NULL ? r->owner : "";
  sha256_update(&h, owner, strlen(owner) + 1);
  for (int i = 0; i < r->line_count; i++) sha256_update(&h, r->lines[i], strlen(r->lines[i]) + 1);
  // solo si la ofrece: una tarjeta sin "siempre" conserva la misma llave que antes. Un 1 aparte evita que una línea
  // o un dueño se confundan con la etiqueta.
  if (r->always != NULL) {
    static const uint8_t mark = 1;
    sha256_update(&h, &mark, 1);
    sha256_update(&h, r->always, strlen(r->always) + 1);
  }
  sha256_final(&h, key);
}

static void kill_gesture(Approve *a) {
  if (a->has_gesture) a->g_dead = 1;
}

void approve_connection(Approve *a, int connected) {
  if (!connected) kill_gesture(a);
  a->connected = connected ? 1 : 0;
}

void approve_view(Approve *a, uint64_t now, const ApproveRequest *req) {
  if (req == NULL) {
    a->has_shown = 0;
    kill_gesture(a);
    return;
  }
  uint8_t key[SHA256_DIGEST_LEN];
  approve_request_key(req, key);
  if (a->has_shown && ct_equal(a->shown_key, key, sizeof key)) return; // misma solicitud: no reinicia nada
  a->has_shown = 1;
  memcpy(a->shown_key, key, sizeof key);
  copy_id(a->shown_id, req->id);
  a->shown_high = req->high ? 1 : 0;
  a->shown_always = req->always != NULL;
  a->shown_since = now;
  kill_gesture(a);
}

static int is_decided(const Approve *a, const char *id) { return a->has_decided && strcmp(a->decided_id, id) == 0; }

// Lo mostrado ahora coincide con lo que había al empezar el gesto.
static int same_shown(const Approve *a) {
  return a->connected && a->has_shown && a->g_has_shown && ct_equal(a->shown_key, a->g_key, sizeof a->g_key) &&
         !is_decided(a, a->g_id);
}

static void down(Approve *a, uint64_t now, ApproveSource src, int repeat, int always) {
  if (repeat || a->has_gesture) return;
  int ok = a->connected && a->has_shown && !is_decided(a, a->shown_id) && can_approve(now, a->shown_since) &&
           (!always || a->shown_always);
  a->has_gesture = 1;
  a->g_source = src;
  a->g_has_shown = a->has_shown;
  if (a->has_shown) {
    copy_id(a->g_id, a->shown_id);
    memcpy(a->g_key, a->shown_key, sizeof a->g_key);
    a->g_high = a->shown_high;
  } else {
    a->g_id[0] = '\0';
    memset(a->g_key, 0, sizeof a->g_key);
    a->g_high = 0;
  }
  a->g_always = always;
  a->g_started = now;
  a->g_dead = !ok;
  a->g_spent = 0;
}

void approve_down(Approve *a, uint64_t now, ApproveSource src, int repeat) { down(a, now, src, repeat, 0); }
void approve_down_always(Approve *a, uint64_t now, ApproveSource src, int repeat) { down(a, now, src, repeat, 1); }

// Aprobar no marca "decidido": lo hace quien envía, con approve_decided, solo si el envío salió (devolvió 0).
static void emit_allow(Approve *a, char out_id[VIEW_ID_BYTES]) {
  copy_id(out_id, a->g_id);
  a->last_always = a->g_always;
}

int approve_tick(Approve *a, uint64_t now, char out_id[VIEW_ID_BYTES]) {
  if (!a->has_gesture || a->g_dead || a->g_spent || !a->g_high) return 0;
  if (!same_shown(a)) {
    a->g_dead = 1;
    return 0;
  }
  if (elapsed(now, a->g_started) >= APPROVE_HOLD_MS) {
    emit_allow(a, out_id);
    a->g_spent = 1;
    return 1;
  }
  return 0;
}

static int up(Approve *a, ApproveSource src, int always, char out_id[VIEW_ID_BYTES]) {
  if (!a->has_gesture || a->g_source != src || a->g_always != always) return 0; // otro botón: ese gesto sigue en curso
  int dead = a->g_dead, spent = a->g_spent, high = a->g_high;
  int same = same_shown(a);
  a->has_gesture = 0;
  if (dead || spent || high) return 0; // en riesgo alto solo vale completar la retención
  if (!same) return 0;
  // el gesto ya se descartó arriba; g_id sigue intacto
  emit_allow(a, out_id);
  return 1;
}

int approve_up(Approve *a, uint64_t now, ApproveSource src, char out_id[VIEW_ID_BYTES]) {
  (void)now;
  return up(a, src, 0, out_id);
}

int approve_up_always(Approve *a, uint64_t now, ApproveSource src, char out_id[VIEW_ID_BYTES]) {
  (void)now;
  return up(a, src, 1, out_id);
}

int approve_emitted_always(const Approve *a) { return a->last_always; }

int approve_gesture_is_always(const Approve *a) { return a->has_gesture && a->g_always; }

void approve_cancel(Approve *a) { a->has_gesture = 0; }

void approve_uncovered(Approve *a, uint64_t now) {
  a->has_gesture = 0;
  if (a->has_shown) a->shown_since = now;
}

void approve_cancel_source(Approve *a, ApproveSource src) {
  if (a->has_gesture && a->g_source == src) a->has_gesture = 0;
}

void approve_reset(Approve *a) { memset(a, 0, sizeof *a); }

int approve_shown_key(const Approve *a, uint8_t key[SHA256_DIGEST_LEN]) {
  if (!a->has_shown) return 0;
  memcpy(key, a->shown_key, SHA256_DIGEST_LEN);
  return 1;
}

int approve_is_decided(const Approve *a, const char *id) { return is_decided(a, id); }

void approve_decided(Approve *a, const char *id) {
  a->has_decided = 1;
  copy_id(a->decided_id, id);
  kill_gesture(a);
}

int approve_ready(const Approve *a, uint64_t now) {
  return a->connected && a->has_shown && !is_decided(a, a->shown_id) && can_approve(now, a->shown_since);
}

float approve_hold_progress(const Approve *a, uint64_t now) {
  if (!a->has_gesture || a->g_dead || !a->g_high || a->g_spent) return 0.0f;
  int64_t e = elapsed(now, a->g_started);
  if (e <= 0) return 0.0f;
  if (e >= APPROVE_HOLD_MS) return 1.0f;
  return (float)e / (float)APPROVE_HOLD_MS;
}

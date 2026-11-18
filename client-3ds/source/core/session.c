#include "session.h"

#include <string.h>

#include "handshake.h"
#include "msg.h"
#include "sha256.h"

#define TX_MAX (FRAME_HEADER_LEN + 256 + FRAME_TAG_LEN)

static int fail(Session *s, SessionError e) {
  s->state = SESSION_FAILED;
  s->error = e;
  return -1;
}

static int device_id_ok(const char *id) {
  size_t n = strlen(id);
  if (n < 1 || n > HS_DEVICE_ID_MAX) return 0;
  for (size_t i = 0; i < n; i++) {
    char c = id[i];
    int ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '.' ||
             c == ':' || c == '-';
    if (!ok) return 0;
  }
  return 1;
}

void session_init(Session *s, const char *device_id, const uint8_t key[32], const uint8_t nonce_c[16]) {
  memset(s, 0, sizeof *s);
  s->state = SESSION_IDLE;
  s->install = -1;
  frame_decoder_init(&s->decoder);
  if (device_id == NULL || !device_id_ok(device_id)) {
    fail(s, SESSION_ERR_BAD_ARG);
    return;
  }
  strcpy(s->device_id, device_id);
  memcpy(s->key, key, sizeof s->key);
  memcpy(s->nonce_c, nonce_c, sizeof s->nonce_c);
}

void session_set_app(Session *s, const char *app_version, int install) {
  s->install = install == 1 ? 1 : install == 0 ? 0 : -1;
  s->app_version[0] = '\0';
  if (app_version != NULL && strlen(app_version) <= 16) strcpy(s->app_version, app_version);
}

void session_on_connected(Session *s, Transport t) {
  if (s->state != SESSION_IDLE) return;
  if (t.send == NULL) {
    fail(s, SESSION_ERR_BAD_ARG);
    return;
  }
  s->transport = t;
  s->state = SESSION_WAIT_CHALLENGE;
}

static int send_plain_json(Session *s, const char *json, size_t len) {
  uint8_t buf[FRAME_HEADER_LEN + 320];
  int n = frame_encode(FRAME_JSON, (const uint8_t *)json, len, buf, sizeof buf);
  if (n < 0) return fail(s, SESSION_ERR_PROTOCOL);
  if (s->transport.send(s->transport.ctx, buf, (size_t)n) != 0) return fail(s, SESSION_ERR_SEND);
  return 0;
}

// Saludo: JSON sin sellar.
static int handle_handshake(Session *s, const uint8_t *payload, size_t len) {
  HsMsg m;
  if (hs_parse((const char *)payload, len, &m) != 0) return fail(s, SESSION_ERR_PROTOCOL);
  if (m.kind == HS_MSG_ERROR) return fail(s, strcmp(m.code, "auth") == 0 ? SESSION_ERR_AUTH : SESSION_ERR_PROTOCOL);

  if (s->state == SESSION_WAIT_CHALLENGE && m.kind == HS_MSG_CHALLENGE) {
    memcpy(s->nonce_b, m.nonce_b, HS_NONCE_LEN);
    uint8_t mac[HS_MAC_LEN];
    const char *app = s->app_version[0] ? s->app_version : NULL;
    hs_hello_mac(s->key, s->nonce_b, s->nonce_c, s->device_id, app, s->install, mac); // cubre la versión, el id, appVersion e install
    char hello[320];
    int n = hs_build_hello_app(hello, sizeof hello, s->device_id, s->nonce_c, mac, app, s->install);
    if (n < 0) return fail(s, SESSION_ERR_BAD_ARG);
    if (send_plain_json(s, hello, (size_t)n) != 0) return -1;
    s->state = SESSION_WAIT_WELCOME;
    return 0;
  }

  if (s->state == SESSION_WAIT_WELCOME && m.kind == HS_MSG_WELCOME) {
    uint8_t want[HS_MAC_LEN];
    hs_welcome_mac(s->key, s->nonce_b, s->nonce_c, want);
    if (!ct_equal(want, m.mac, HS_MAC_LEN)) return fail(s, SESSION_ERR_AUTH);
    uint8_t ks[HS_KEY_LEN];
    hs_session_key(s->key, s->nonce_b, s->nonce_c, ks);
    frame_sealer_init(&s->sealer, ks, FRAME_DIR_CONSOLE_TO_BRIDGE);
    frame_opener_init(&s->opener, ks, FRAME_DIR_BRIDGE_TO_CONSOLE);
    memset(ks, 0, sizeof ks);
    s->state = SESSION_READY;
    return 0;
  }
  return fail(s, SESSION_ERR_PROTOCOL);
}

// Con el saludo hecho: todo va sellado.
static int handle_sealed(Session *s, uint8_t type, uint8_t *payload, size_t len) {
  int n = frame_open(&s->opener, type, payload, len);
  if (n < 0) return fail(s, SESSION_ERR_TAG);
  switch (type) {
    case FRAME_JSON: {
      JsonDoc doc;
      if (json_parse(&doc, (const char *)payload, (size_t)n) != JSON_OK) return fail(s, SESSION_ERR_VIEW);
      if (reading_is_text(&doc)) { // respuesta a `read`: va a su propio búfer, no toca la vista
        if (reading_parse_doc(&doc, &s->reading) != READING_OK) return fail(s, SESSION_ERR_VIEW);
        s->have_reading = 1;
        s->read_seq++;
        return 0;
      }
      int r = view_parse_doc(&doc, &s->staging);
      if (r == VIEW_BRIDGE_ERROR) {
        memcpy(s->bridge_error, s->staging.error_code, sizeof s->bridge_error);
        return 0;
      }
      if (r != VIEW_OK) return fail(s, SESSION_ERR_VIEW);
      if (!s->have_view || s->staging.rev > s->last_rev) {
        memcpy(&s->view, &s->staging, sizeof s->view);
        s->have_view = 1;
        s->last_rev = s->staging.rev;
        s->view_seq++;
      }
      return 0;
    }
    case FRAME_PONG:
    case FRAME_PING:
    case FRAME_AUDIO:
      return 0; // el puente no los usa con la consola; se aceptan (ya autenticados) y se ignoran
    default:
      return fail(s, SESSION_ERR_PROTOCOL);
  }
}

static int handle_frame(Session *s) {
  uint8_t type = s->decoder.type;
  uint8_t *payload = frame_decoder_payload(&s->decoder);
  size_t len = s->decoder.payload_len;
  if (s->state == SESSION_READY) return handle_sealed(s, type, payload, len);
  if (type != FRAME_JSON) return fail(s, SESSION_ERR_PROTOCOL); // antes del saludo solo hay JSON
  return handle_handshake(s, payload, len);
}

int session_on_data(Session *s, const uint8_t *data, size_t len) {
  if (s->state != SESSION_WAIT_CHALLENGE && s->state != SESSION_WAIT_WELCOME && s->state != SESSION_READY) return -1;
  while (len > 0) {
    size_t used = 0;
    int r = frame_decoder_feed(&s->decoder, data, len, &used);
    data += used;
    len -= used;
    if (r == FRAME_ERR_TOO_LONG) return fail(s, SESSION_ERR_FRAME);
    if (r == FRAME_COMPLETE && handle_frame(s) != 0) return -1;
    if (used == 0 && r != FRAME_COMPLETE) break; // no avanza: no debería pasar
  }
  return 0;
}

const View *session_view(const Session *s) { return (s->state == SESSION_READY && s->have_view) ? &s->view : NULL; }

uint32_t session_view_seq(const Session *s) { return s->view_seq; }

const ReadDoc *session_reading(const Session *s) { return (s->state == SESSION_READY && s->have_reading) ? &s->reading : NULL; }

uint32_t session_read_seq(const Session *s) { return s->read_seq; }

static int send_sealed(Session *s, uint8_t type, const char *json, size_t len) {
  if (s->state != SESSION_READY) return -1;
  uint8_t buf[TX_MAX];
  int n = frame_seal(&s->sealer, type, (const uint8_t *)json, len, buf, sizeof buf);
  if (n < 0) return -1;
  if (s->transport.send(s->transport.ctx, buf, (size_t)n) != 0) {
    fail(s, SESSION_ERR_SEND);
    return -1;
  }
  return 0;
}

static int send_msg(Session *s, int len, const char *msg) { return len < 0 ? -1 : send_sealed(s, FRAME_JSON, msg, (size_t)len); }

int session_send_decision(Session *s, const char *request_id, int allow) {
  char m[MSG_MAX_LEN];
  return send_msg(s, msg_decision(m, sizeof m, request_id, allow), m);
}

int session_send_focus(Session *s, const char *session_id) {
  char m[MSG_MAX_LEN];
  return send_msg(s, msg_focus(m, sizeof m, session_id), m);
}

int session_send_skip(Session *s) {
  char m[MSG_MAX_LEN];
  return send_msg(s, msg_skip(m, sizeof m), m);
}

int session_send_mode(Session *s, int manual) {
  char m[MSG_MAX_LEN];
  return send_msg(s, msg_mode(m, sizeof m, manual), m);
}

int session_send_read(Session *s, const char *session_id, int mode) {
  char m[MSG_MAX_LEN];
  return send_msg(s, msg_read(m, sizeof m, session_id, mode), m);
}

int session_send_setting_notify_default(Session *s, int notify) {
  char m[MSG_MAX_LEN];
  return send_msg(s, msg_setting_notify_default(m, sizeof m, notify), m);
}

int session_send_setting_notify_ack(Session *s, int ack) {
  char m[MSG_MAX_LEN];
  return send_msg(s, msg_setting_notify_ack(m, sizeof m, ack), m);
}

int session_send_setting_sound(Session *s, int on) {
  char m[MSG_MAX_LEN];
  return send_msg(s, msg_setting_sound(m, sizeof m, on), m);
}

int session_send_setting_questions(Session *s, int on) {
  char m[MSG_MAX_LEN];
  return send_msg(s, msg_setting_questions(m, sizeof m, on), m);
}

int session_send_setting_reader_default(Session *s, int mode) {
  char m[MSG_MAX_LEN];
  return send_msg(s, msg_setting_reader_default(m, sizeof m, mode), m);
}

int session_send_answer_pc(Session *s, const char *request_id) {
  char m[MSG_MAX_LEN];
  return send_msg(s, msg_answer_pc(m, sizeof m, request_id), m);
}

int session_send_hold(Session *s, int seconds) {
  char m[MSG_MAX_LEN];
  return send_msg(s, msg_hold(m, sizeof m, seconds), m);
}

// La respuesta con texto escrito es más larga que los demás mensajes (hasta MSG_ANSWER_MAX): su propio búfer, estático porque no cabe
// cómodo en la pila de la 3DS y el cliente es de un solo hilo.
int session_send_answer(Session *s, const char *request_id, const MsgAnswer *answers, int count) {
  static char m[MSG_ANSWER_MAX];
  static uint8_t buf[FRAME_HEADER_LEN + MSG_ANSWER_MAX + FRAME_TAG_LEN];
  int len = msg_answer(m, sizeof m, request_id, answers, count);
  if (len < 0 || s->state != SESSION_READY) return -1;
  int n = frame_seal(&s->sealer, FRAME_JSON, (const uint8_t *)m, (size_t)len, buf, sizeof buf);
  if (n < 0) return -1;
  if (s->transport.send(s->transport.ctx, buf, (size_t)n) != 0) {
    fail(s, SESSION_ERR_SEND);
    return -1;
  }
  return 0;
}

// Como la respuesta con texto: la instrucción es larga (hasta MSG_INSTRUCT_MAX), con su propio búfer estático.
int session_send_instruct(Session *s, const char *session_id, const char *text) {
  static char m[MSG_INSTRUCT_MAX];
  static uint8_t buf[FRAME_HEADER_LEN + MSG_INSTRUCT_MAX + FRAME_TAG_LEN];
  int len = msg_instruct(m, sizeof m, session_id, text);
  if (len < 0 || s->state != SESSION_READY) return -1;
  int n = frame_seal(&s->sealer, FRAME_JSON, (const uint8_t *)m, (size_t)len, buf, sizeof buf);
  if (n < 0) return -1;
  if (s->transport.send(s->transport.ctx, buf, (size_t)n) != 0) {
    fail(s, SESSION_ERR_SEND);
    return -1;
  }
  return 0;
}

int session_send_instruct_clear(Session *s, const char *session_id) {
  char m[MSG_MAX_LEN];
  return send_msg(s, msg_instruct_clear(m, sizeof m, session_id), m);
}

int session_send_release(Session *s, const char *request_id) {
  char m[MSG_MAX_LEN];
  return send_msg(s, msg_release(m, sizeof m, request_id), m);
}

int session_send_setting_session_wait(Session *s, const char *session_id, int on) {
  char m[MSG_MAX_LEN];
  return send_msg(s, msg_setting_session_wait(m, sizeof m, session_id, on), m);
}

int session_send_setting_instruct_wait(Session *s, int minutes) {
  char m[MSG_MAX_LEN];
  return send_msg(s, msg_setting_instruct_wait(m, sizeof m, minutes), m);
}

int session_send_setting_hidden_agents(Session *s, unsigned hidden_mask) {
  char m[MSG_MAX_LEN];
  return send_msg(s, msg_setting_hidden_agents(m, sizeof m, hidden_mask), m);
}

int session_send_ack(Session *s, const char *notice_id) {
  char m[MSG_MAX_LEN];
  return send_msg(s, msg_ack(m, sizeof m, notice_id), m);
}

int session_send_skip_notice(Session *s) {
  char m[MSG_MAX_LEN];
  return send_msg(s, msg_skip_notice(m, sizeof m), m);
}

int session_send_session_notify(Session *s, const char *session_id, int notify) {
  char m[MSG_MAX_LEN];
  return send_msg(s, msg_setting_session_notify(m, sizeof m, session_id, notify), m);
}

int session_send_ping(Session *s) { return send_sealed(s, FRAME_PING, "", 0); }

const char *session_error_name(SessionError e) {
  switch (e) {
    case SESSION_ERR_NONE: return "none";
    case SESSION_ERR_AUTH: return "auth";
    case SESSION_ERR_FRAME: return "frame";
    case SESSION_ERR_TAG: return "tag";
    case SESSION_ERR_PROTOCOL: return "protocol";
    case SESSION_ERR_VIEW: return "view";
    case SESSION_ERR_SEND: return "send";
    case SESSION_ERR_BAD_ARG: return "bad-arg";
  }
  return "?";
}

const char *session_state_name(SessionState s) {
  switch (s) {
    case SESSION_IDLE: return "IDLE";
    case SESSION_WAIT_CHALLENGE: return "WAIT_CHALLENGE";
    case SESSION_WAIT_WELCOME: return "WAIT_WELCOME";
    case SESSION_READY: return "READY";
    case SESSION_FAILED: return "FAILED";
  }
  return "?";
}

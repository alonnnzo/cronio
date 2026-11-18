#include "msg.h"

#include <string.h>

#include "view.h"

// Concatena lit en out[*n..] respetando cap (deja sitio para el NUL). 0 si cabe.
static int put(char *out, size_t cap, size_t *n, const char *s) {
  size_t l = strlen(s);
  if (cap == 0 || *n + l + 1 > cap) return -1;
  memcpy(out + *n, s, l);
  *n += l;
  out[*n] = '\0';
  return 0;
}

#define PUT(s)                          \
  do {                                  \
    if (put(out, cap, &n, (s)) != 0) {  \
      if (cap > 0) out[0] = '\0';       \
      return -1;                        \
    }                                   \
  } while (0)

int msg_decision(char *out, size_t cap, const char *request_id, int allow) {
  if (request_id == NULL || !view_id_valid(request_id)) return -1;
  size_t n = 0;
  if (cap > 0) out[0] = '\0';
  PUT("{\"t\":\"decision\",\"requestId\":\"");
  PUT(request_id);
  PUT(allow == 2 ? "\",\"decision\":\"allow_always\"}" : allow ? "\",\"decision\":\"allow\"}" : "\",\"decision\":\"deny\"}");
  return (int)n;
}

int msg_focus(char *out, size_t cap, const char *session_id) {
  size_t n = 0;
  if (cap > 0) out[0] = '\0';
  if (session_id == NULL) {
    PUT("{\"t\":\"focus\",\"sessionId\":null}");
    return (int)n;
  }
  if (!view_id_valid(session_id)) return -1;
  PUT("{\"t\":\"focus\",\"sessionId\":\"");
  PUT(session_id);
  PUT("\"}");
  return (int)n;
}

int msg_read(char *out, size_t cap, const char *session_id, int mode) {
  size_t n = 0;
  if (cap > 0) out[0] = '\0';
  if (session_id == NULL || !view_id_valid(session_id) || mode < 0 || mode > 1) return -1;
  PUT("{\"t\":\"read\",\"sessionId\":\"");
  PUT(session_id);
  PUT(mode == 1 ? "\",\"mode\":\"summary\"}" : "\"}");
  return (int)n;
}

static const char *const NOTIFY_VALUES[4] = {"all", "important", "end", "silent"};

int msg_setting_notify_default(char *out, size_t cap, int notify) {
  size_t n = 0;
  if (cap > 0) out[0] = '\0';
  if (notify < 0 || notify > 3) return -1;
  PUT("{\"t\":\"setting\",\"key\":\"notifyDefault\",\"value\":\"");
  PUT(NOTIFY_VALUES[notify]);
  PUT("\"}");
  return (int)n;
}

int msg_setting_notify_ack(char *out, size_t cap, int ack) {
  size_t n = 0;
  if (cap > 0) out[0] = '\0';
  PUT(ack ? "{\"t\":\"setting\",\"key\":\"notifyAck\",\"value\":true}" : "{\"t\":\"setting\",\"key\":\"notifyAck\",\"value\":false}");
  return (int)n;
}

int msg_setting_sound(char *out, size_t cap, int on) {
  size_t n = 0;
  if (cap > 0) out[0] = '\0';
  PUT(on ? "{\"t\":\"setting\",\"key\":\"sound\",\"value\":true}" : "{\"t\":\"setting\",\"key\":\"sound\",\"value\":false}");
  return (int)n;
}

int msg_setting_questions(char *out, size_t cap, int on) {
  size_t n = 0;
  if (cap > 0) out[0] = '\0';
  PUT(on ? "{\"t\":\"setting\",\"key\":\"questions\",\"value\":true}" : "{\"t\":\"setting\",\"key\":\"questions\",\"value\":false}");
  return (int)n;
}

int msg_setting_reader_default(char *out, size_t cap, int mode) {
  size_t n = 0;
  if (cap > 0) out[0] = '\0';
  if (mode < 0 || mode > 1) return -1;
  PUT(mode == 1 ? "{\"t\":\"setting\",\"key\":\"readerDefault\",\"value\":\"summary\"}" : "{\"t\":\"setting\",\"key\":\"readerDefault\",\"value\":\"full\"}");
  return (int)n;
}

int msg_hold(char *out, size_t cap, int seconds) {
  size_t n = 0;
  if (cap > 0) out[0] = '\0';
  if (seconds < 1 || seconds > 300) return -1;
  char num[8];
  int k = 0;
  char tmp[8];
  int t = seconds;
  while (t > 0) {
    tmp[k++] = (char)('0' + t % 10);
    t /= 10;
  }
  for (int i = 0; i < k; i++) num[i] = tmp[k - 1 - i];
  num[k] = '\0';
  PUT("{\"t\":\"hold\",\"seconds\":");
  PUT(num);
  PUT("}");
  return (int)n;
}

int msg_answer_pc(char *out, size_t cap, const char *request_id) {
  size_t n = 0;
  if (cap > 0) out[0] = '\0';
  if (request_id == NULL || !view_id_valid(request_id)) return -1;
  PUT("{\"t\":\"answer\",\"requestId\":\"");
  PUT(request_id);
  PUT("\",\"pc\":true}");
  return (int)n;
}

// Largo en caracteres de un texto UTF-8 válido (sin NUL, sin sustitutos ni sobrelargos ni más allá de U+10FFFF); -1 si no es válido.
static int utf8_chars(const char *s) {
  int chars = 0;
  const unsigned char *p = (const unsigned char *)s;
  while (*p) {
    unsigned c = *p;
    int extra = c < 0x80 ? 0 : (c >= 0xc2 && c <= 0xdf) ? 1 : (c >= 0xe0 && c <= 0xef) ? 2 : (c >= 0xf0 && c <= 0xf4) ? 3 : -1;
    if (extra < 0) return -1;
    unsigned cp = extra == 0 ? c : extra == 1 ? (c & 0x1f) : extra == 2 ? (c & 0x0f) : (c & 0x07);
    for (int i = 1; i <= extra; i++) {
      if ((p[i] & 0xc0) != 0x80) return -1;
      cp = (cp << 6) | (p[i] & 0x3f);
    }
    if ((extra == 2 && cp < 0x800) || (extra == 3 && cp < 0x10000) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return -1;
    p += extra + 1;
    chars++;
  }
  return chars;
}

// Añade el texto con los escapes de JSON (comillas, barra y controles); el resto de los bytes UTF-8 pasa tal cual. 0 si cabe.
static int put_escaped(char *out, size_t cap, size_t *n, const char *s) {
  static const char HEX[] = "0123456789abcdef";
  for (const unsigned char *p = (const unsigned char *)s; *p; p++) {
    char buf[8];
    if (*p == '"') strcpy(buf, "\\\"");
    else if (*p == '\\') strcpy(buf, "\\\\");
    else if (*p < 0x20) {
      buf[0] = '\\', buf[1] = 'u', buf[2] = '0', buf[3] = '0', buf[4] = HEX[*p >> 4], buf[5] = HEX[*p & 15], buf[6] = '\0';
    } else {
      buf[0] = (char)*p;
      buf[1] = '\0';
    }
    if (put(out, cap, n, buf) != 0) return -1;
  }
  return 0;
}

int msg_answer(char *out, size_t cap, const char *request_id, const MsgAnswer *answers, int count) {
  size_t n = 0;
  if (cap > 0) out[0] = '\0';
  if (request_id == NULL || !view_id_valid(request_id) || answers == NULL || count < 1 || count > MSG_MAX_QUESTIONS) return -1;
  for (int i = 0; i < count; i++) {
    if (answers[i].is_other) {
      int chars = utf8_chars(answers[i].other);
      if (chars < 1 || chars > MSG_OTHER_MAX_CHARS) return -1;
    } else if (answers[i].mask == 0 || (answers[i].mask & ~0xfu) != 0) {
      return -1;
    }
  }
  PUT("{\"t\":\"answer\",\"requestId\":\"");
  PUT(request_id);
  PUT("\",\"answers\":[");
  for (int i = 0; i < count; i++) {
    if (i > 0) PUT(",");
    if (answers[i].is_other) {
      PUT("{\"other\":\"");
      if (put_escaped(out, cap, &n, answers[i].other) != 0) {
        out[0] = '\0';
        return -1;
      }
      PUT("\"}");
    } else {
      PUT("{\"choose\":[");
      int first = 1;
      for (int b = 0; b < 4; b++) {
        if (!(answers[i].mask & (1u << b))) continue;
        if (!first) PUT(",");
        first = 0;
        char d[2] = {(char)('0' + b), '\0'};
        PUT(d);
      }
      PUT("]}");
    }
  }
  PUT("]}");
  return (int)n;
}

int msg_instruct(char *out, size_t cap, const char *session_id, const char *text) {
  size_t n = 0;
  if (cap > 0) out[0] = '\0';
  if (session_id == NULL || !view_id_valid(session_id) || text == NULL) return -1;
  int chars = utf8_chars(text);
  if (chars < 1 || chars > MSG_INSTRUCT_MAX_CHARS) return -1;
  int blank = 1;
  for (const unsigned char *p = (const unsigned char *)text; *p; p++) {
    if (*p < 0x20 || *p == 0x7f) return -1; // sin controles ni saltos de línea (el puente los rechaza)
    if (*p != ' ') blank = 0;
  }
  if (blank) return -1;
  PUT("{\"t\":\"instruct\",\"sessionId\":\"");
  PUT(session_id);
  PUT("\",\"text\":\"");
  if (put_escaped(out, cap, &n, text) != 0) {
    if (cap > 0) out[0] = '\0';
    return -1;
  }
  PUT("\"}");
  return (int)n;
}

int msg_instruct_clear(char *out, size_t cap, const char *session_id) {
  size_t n = 0;
  if (cap > 0) out[0] = '\0';
  if (session_id == NULL || !view_id_valid(session_id)) return -1;
  PUT("{\"t\":\"instructClear\",\"sessionId\":\"");
  PUT(session_id);
  PUT("\"}");
  return (int)n;
}

int msg_release(char *out, size_t cap, const char *request_id) {
  size_t n = 0;
  if (cap > 0) out[0] = '\0';
  if (request_id == NULL || !view_id_valid(request_id)) return -1;
  PUT("{\"t\":\"release\",\"requestId\":\"");
  PUT(request_id);
  PUT("\"}");
  return (int)n;
}

int msg_setting_session_wait(char *out, size_t cap, const char *session_id, int on) {
  size_t n = 0;
  if (cap > 0) out[0] = '\0';
  if (session_id == NULL || !view_id_valid(session_id)) return -1;
  PUT("{\"t\":\"setting\",\"key\":\"sessionWait\",\"sessionId\":\"");
  PUT(session_id);
  PUT(on ? "\",\"value\":true}" : "\",\"value\":false}");
  return (int)n;
}

int msg_setting_instruct_wait(char *out, size_t cap, int minutes) {
  size_t n = 0;
  if (cap > 0) out[0] = '\0';
  if (minutes != 5 && minutes != 10 && minutes != 30) return -1;
  PUT(minutes == 5 ? "{\"t\":\"setting\",\"key\":\"instructWaitMax\",\"value\":5}"
                   : minutes == 10 ? "{\"t\":\"setting\",\"key\":\"instructWaitMax\",\"value\":10}"
                                   : "{\"t\":\"setting\",\"key\":\"instructWaitMax\",\"value\":30}");
  return (int)n;
}

int msg_setting_hidden_agents(char *out, size_t cap, unsigned hidden) {
  size_t n = 0;
  if (cap > 0) out[0] = '\0';
  PUT("{\"t\":\"setting\",\"key\":\"hiddenAgents\",\"value\":[");
  int first = 1;
  for (int i = 0; i < AGENT_COUNT; i++) {
    if (!(hidden & (1u << i))) continue;
    if (!first) PUT(",");
    first = 0;
    PUT("\"");
    PUT(view_kind_name((AgentKind)i));
    PUT("\"");
  }
  PUT("]}");
  return (int)n;
}

int msg_ack(char *out, size_t cap, const char *notice_id) {
  size_t n = 0;
  if (cap > 0) out[0] = '\0';
  if (notice_id == NULL || !view_id_valid(notice_id)) return -1;
  PUT("{\"t\":\"ack\",\"id\":\"");
  PUT(notice_id);
  PUT("\"}");
  return (int)n;
}

int msg_skip_notice(char *out, size_t cap) {
  size_t n = 0;
  if (cap > 0) out[0] = '\0';
  PUT("{\"t\":\"skipNotice\"}");
  return (int)n;
}

int msg_setting_session_notify(char *out, size_t cap, const char *session_id, int notify) {
  size_t n = 0;
  if (cap > 0) out[0] = '\0';
  if (session_id == NULL || !view_id_valid(session_id) || notify < 0 || notify > 3) return -1;
  PUT("{\"t\":\"setting\",\"key\":\"sessionNotify\",\"sessionId\":\"");
  PUT(session_id);
  PUT("\",\"value\":\"");
  PUT(NOTIFY_VALUES[notify]);
  PUT("\"}");
  return (int)n;
}

int msg_skip(char *out, size_t cap) {
  size_t n = 0;
  if (cap > 0) out[0] = '\0';
  PUT("{\"t\":\"skip\"}");
  return (int)n;
}

int msg_mode(char *out, size_t cap, int manual) {
  size_t n = 0;
  if (cap > 0) out[0] = '\0';
  PUT(manual ? "{\"t\":\"mode\",\"mode\":\"manual\"}" : "{\"t\":\"mode\",\"mode\":\"queue\"}");
  return (int)n;
}

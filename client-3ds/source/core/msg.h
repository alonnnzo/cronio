// Mensajes de la consola al puente (packages/protocol messages.ts), escritos con el mismo orden de claves y sin
// espacios que JSON.stringify del puente. Cada función devuelve el largo escrito (sin NUL final), o -1 si el id no
// cumple el juego de caracteres permitido o no cabe en cap. El resultado siempre termina en NUL si cap > 0.
#ifndef CORE_MSG_H
#define CORE_MSG_H

#include <stddef.h>

#define MSG_MAX_LEN 160 // cota holgada de cualquiera de estos mensajes (el mayor ronda los 90 bytes), salvo msg_answer
// Respuesta a una solicitud de pregunta (AskUserQuestion). El texto escrito en "Otra…" tiene hasta 200 caracteres (4 bytes cada
// uno como máximo en UTF-8); con los escapes de JSON el mensaje más grande (4 preguntas) cabe en MSG_ANSWER_MAX.
#define MSG_MAX_QUESTIONS 4
#define MSG_OTHER_MAX_CHARS 200
#define MSG_OTHER_BYTES (MSG_OTHER_MAX_CHARS * 4 + 1)
#define MSG_ANSWER_MAX 6144
// Instrucción escrita en la consola (paso 6): de 1 a 400 caracteres (4 bytes cada uno como máximo en UTF-8; con los escapes de JSON
// cabe en MSG_INSTRUCT_MAX).
#define MSG_INSTRUCT_MAX_CHARS 400
#define MSG_INSTRUCT_BYTES (MSG_INSTRUCT_MAX_CHARS * 4 + 1)
#define MSG_INSTRUCT_MAX 4096
typedef struct {
  int is_other;                // 1: {"other": texto}; 0: {"choose": [...]}
  unsigned mask;               // is_other == 0: bit i = opción i elegida (al menos una, solo bits 0 a 3)
  char other[MSG_OTHER_BYTES]; // is_other == 1: texto UTF-8 de 1 a 200 caracteres
} MsgAnswer;

// allow: 0 rechazar, 1 aprobar, 2 aprobar y no volver a preguntar ("allow_always").
int msg_decision(char *out, size_t cap, const char *request_id, int allow);
// session_id NULL se envía como null (cerrar el detalle).
int msg_focus(char *out, size_t cap, const char *session_id);
int msg_skip(char *out, size_t cap);
int msg_mode(char *out, size_t cap, int manual);
// Pide el mensaje completo de la sesión (el puente responde `text`). -1 si el id no es válido.
// `mode`: READ_MODE_FULL (sin campo, como siempre) o READ_MODE_SUMMARY ("mode":"summary"); otro valor devuelve -1.
int msg_read(char *out, size_t cap, const char *session_id, int mode);
// Cambios de ajuste (menú de configuración): {"t":"setting","key":...,"value":...}. -1 si no cabe o el valor no es válido.
// notify: valor de NotifyMode (0 all, 1 important, 2 end, 3 silent).
int msg_setting_notify_default(char *out, size_t cap, int notify);
int msg_setting_notify_ack(char *out, size_t cap, int ack);
int msg_setting_sound(char *out, size_t cap, int on);
// hidden: máscara de bits, bit i = agente i (orden de AgentKind) oculto; se escriben en el orden de la cuadrícula.
int msg_setting_hidden_agents(char *out, size_t cap, unsigned hidden);
// "Visto": {"t":"ack","id":...} (retira la tarjeta de aviso; al agente no se le manda nada). -1 si el id no es válido o no cabe.
int msg_ack(char *out, size_t cap, const char *notice_id);
// Respuestas a una solicitud de pregunta: {"t":"answer","requestId":...,"answers":[{"choose":[0,2]},{"other":"texto"}]}, una entrada
// por pregunta y en orden. -1 si el id no es válido, no hay entre 1 y 4 respuestas, una elección es vacía o usa bits fuera de 0 a 3,
// el texto escrito está vacío, tiene más de 200 caracteres o no es UTF-8 válido, o no cabe en cap (usar MSG_ANSWER_MAX).
int msg_answer(char *out, size_t cap, const char *request_id, const MsgAnswer *answers, int count);
// "Responder en el PC": {"t":"answer","requestId":...,"pc":true} (la pregunta vuelve a Claude Code).
int msg_answer_pc(char *out, size_t cap, const char *request_id);
// Antes de abrir el teclado del sistema (congela la app): {"t":"hold","seconds":N}, N de 1 a 300. -1 si N está fuera de rango.
int msg_hold(char *out, size_t cap, int seconds);
int msg_setting_questions(char *out, size_t cap, int on);
// readerDefault: 0 completo, 1 resumen; otro valor devuelve -1.
int msg_setting_reader_default(char *out, size_t cap, int mode);
// Pasa a la siguiente tarjeta de aviso: {"t":"skipNotice"}.
int msg_skip_notice(char *out, size_t cap);
// Instrucciones por texto (paso 6). Instrucción para una sesión: {"t":"instruct","sessionId":...,"text":...}. -1 si el id no es válido, el texto
// no es UTF-8 válido, está vacío (o solo espacios), tiene más de 400 caracteres o algún carácter de control, o no cabe en cap.
int msg_instruct(char *out, size_t cap, const char *session_id, const char *text);
// Vacía la cola de instrucciones de la sesión: {"t":"instructClear","sessionId":...}.
int msg_instruct_clear(char *out, size_t cap, const char *session_id);
// "Seguir en el PC": {"t":"release","requestId":...} libera el fin de turno retenido sin instrucción.
int msg_release(char *out, size_t cap, const char *request_id);
// "Esperar mi respuesta" de una sesión: {"t":"setting","key":"sessionWait","sessionId":...,"value":true|false}.
int msg_setting_session_wait(char *out, size_t cap, const char *session_id, int on);
// Minutos que se espera la instrucción: {"t":"setting","key":"instructWaitMax","value":5|10|30}. -1 con otro valor.
int msg_setting_instruct_wait(char *out, size_t cap, int minutes);
// Modo de aviso de una sesión: {"t":"setting","key":"sessionNotify","sessionId":...,"value":...}. notify: NotifyMode.
int msg_setting_session_notify(char *out, size_t cap, const char *session_id, int notify);

#endif

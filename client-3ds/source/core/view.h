// Modelo de vista (docs/07, packages/protocol viewmodel.ts + messages.ts) en estructuras de tamaño fijo.
// view_parse valida lo mismo que los esquemas zod del protocolo y rechaza lo que no cumpla.
//
// Textos: el protocolo limita cada texto a 38 caracteres, y los esquemas zod 4 cuentan puntos de código (un emoji
// vale 1, aunque en UTF-16 sean 2 unidades). En UTF-8 un punto de código ocupa como máximo 4 bytes, así que
// 38 * 4 + 1 bytes bastan siempre. (El puente recorta a 38 unidades UTF-16, que es más estricto.)
#ifndef CORE_VIEW_H
#define CORE_VIEW_H

#include <stddef.h>
#include <stdint.h>

#include "json.h"

#define VIEW_MAX_TEXT 38
#define VIEW_TEXT_BYTES (VIEW_MAX_TEXT * 4 + 1)
#define VIEW_MAX_ID 48
#define VIEW_ID_BYTES (VIEW_MAX_ID + 1)
#define VIEW_MAX_SESSIONS 12
#define VIEW_MAX_SINCE_S (99u * 86400u) // tope de `sinceS`: 99 días (MAX_SINCE_S del protocolo)
#define VIEW_MAX_LINES 6
#define VIEW_MAX_FACE_LINES 4 // 1 o 2: globo normal; 3 o 4: título + la pregunta que espera respuesta
#define VIEW_MAX_DETAIL_LINES 4
#define VIEW_MAX_QUESTION_LINES 3
#define VIEW_MAX_NOTICE_LINES 4 // líneas de una tarjeta de aviso
// Modo del lector (paso 5): el mensaje entero o el resumen corto. Es el valor de `read.mode`, de `text.mode` y del ajuste readerDefault.
#define READ_MODE_FULL 0
#define READ_MODE_SUMMARY 1
#define VIEW_MAX_QUESTIONS 4    // preguntas de una solicitud de pregunta (AskUserQuestion)
#define VIEW_MAX_OPTIONS 4      // opciones por pregunta (mínimo 2)
#define VIEW_MAX_OPTION_DESC 2  // líneas de la descripción de una opción
#define VIEW_ERROR_CODE_BYTES 32
// Comandos rápidos de la tarjeta de instrucción (Fase 3): hasta 4; etiqueta de hasta 20 caracteres y texto de hasta 120 (un punto de código
// ocupa hasta 4 bytes en UTF-8). Los mismos topes que MAX_QUICK_* de packages/protocol/src/viewmodel.ts.
#define VIEW_MAX_QUICK 4
#define VIEW_MAX_QUICK_LABEL 20
#define VIEW_MAX_QUICK_TEXT 120
#define VIEW_QUICK_LABEL_BYTES (VIEW_MAX_QUICK_LABEL * 4 + 1)
#define VIEW_QUICK_TEXT_BYTES (VIEW_MAX_QUICK_TEXT * 4 + 1)

typedef char ViewText[VIEW_TEXT_BYTES];
typedef char ViewId[VIEW_ID_BYTES];

// El orden de los agentes es el de la cuadrícula de la pantalla inferior (nav.js KINDS).
typedef enum {
  AGENT_NONE = -1,
  AGENT_CLAUDE = 0,
  AGENT_GEMINI,
  AGENT_CODEX,
  AGENT_CURSOR,
  AGENT_HERMES,
  AGENT_COUNT
} AgentKind;
typedef enum { STATE_IDLE, STATE_WORKING, STATE_ASK, STATE_DONE, STATE_ERROR, STATE_COUNT } AgentState;
typedef enum { MOOD_IDLE, MOOD_WORKING, MOOD_ASK, MOOD_DONE, MOOD_ERROR, MOOD_COUNT } Mood;
// Prefijo VIEW_: libctru ya define LED_OFF y otros nombres parecidos.
typedef enum { VIEW_LED_OFF, VIEW_LED_WORKING, VIEW_LED_ASK, VIEW_LED_DONE, VIEW_LED_ERROR, VIEW_LED_COUNT } LedPattern;
typedef enum { MODE_QUEUE, MODE_MANUAL } PermMode;
// Modo de aviso: el de las sesiones nuevas (ajuste del puente) y el de cada sesión (Fase 2b, paso 3).
typedef enum { NOTIFY_ALL, NOTIFY_IMPORTANT, NOTIFY_END, NOTIFY_SILENT, NOTIFY_COUNT } NotifyMode;
// Qué pasó en una tarjeta de aviso, y el sonido que le corresponde (el sonido se reproduce desde el paso 3b).
typedef enum { NOTICE_DONE, NOTICE_ASK, NOTICE_ERROR, NOTICE_IDLE, NOTICE_KIND_COUNT } NoticeKind;
typedef enum { CHIME_DONE, CHIME_ASK, CHIME_ERROR, CHIME_PERMISSION, CHIME_COUNT } ChimeKind;
typedef enum { RISK_NORMAL, RISK_HIGH } Risk;
// Tipo de solicitud: un permiso (la tarjeta de siempre) o una pregunta con alternativas (AskUserQuestion, paso 4). Una pregunta
// nunca se aprueba ni se rechaza: se responde con `answer` (logic/question.c).
// El tercero (paso 6) es un fin de turno retenido: la sesión espera lo que le escribas; se responde con 'instruct' o 'release'
// (logic/instruct.c), nunca con una decisión.
typedef enum { REQ_PERMISSION, REQ_QUESTION, REQ_INSTRUCTION } RequestKind;

typedef struct {
  ViewId id;
  AgentKind kind;
  ViewText title, project, model;
  AgentState state;
  ViewText activity;
  int has_since;      // campo opcional `sinceS` (un puente anterior no lo manda)
  uint32_t since_s;   // segundos que llevaba en su estado actual cuando el puente armó la vista; válido si has_since (logic/elapsed.h)
} SessionView;

// Una opción de una pregunta: etiqueta (ya sin "(Recommended)"), descripción de 0 a 2 líneas y la estrella de recomendada.
typedef struct {
  ViewText label;
  int desc_count; // 0 a 2
  ViewText desc[VIEW_MAX_OPTION_DESC];
  int recommended;
} OptionView;

typedef struct {
  ViewText header;
  int text_count; // 1 a 3
  ViewText text[VIEW_MAX_QUESTION_LINES];
  int multi;      // se pueden marcar varias opciones
  int option_count; // 2 a 4
  OptionView options[VIEW_MAX_OPTIONS];
} QuestionView;

// Un atajo de la tarjeta de instrucción: lo que dice el botón y el texto que se manda como instrucción.
typedef struct {
  char label[VIEW_QUICK_LABEL_BYTES];
  char text[VIEW_QUICK_TEXT_BYTES];
} QuickCommand;

typedef struct {
  ViewId id;
  ViewId session_id;
  RequestKind kind;     // campo opcional `kind`: ausente = permiso
  ViewText title;
  int line_count;
  ViewText lines[VIEW_MAX_LINES];
  Risk risk;
  uint32_t expires_in_s;
  uint32_t position; // desde 1
  uint32_t total;
  int has_always;    // la solicitud ofrece "sí, no volver a preguntar" (campo opcional `always` del protocolo)
  ViewText always;   // etiqueta ya recortada de lo que quedaría permitido; válida si has_always
  int question_count; // solo con kind == REQ_QUESTION: de 1 a 4
  QuestionView questions[VIEW_MAX_QUESTIONS];
  int quick_count;    // solo con kind == REQ_INSTRUCTION: de 0 a 4 atajos (campo opcional `quick`)
  QuickCommand quick[VIEW_MAX_QUICK];
} RequestView;

typedef struct {
  AgentKind kind; // AGENT_NONE si es null
  Mood mood;
  int line_count; // 1 a 4
  ViewText lines[VIEW_MAX_FACE_LINES];
} FaceView;

typedef struct {
  ViewId session_id;
  int line_count; // 0 a 4
  ViewText last_message[VIEW_MAX_DETAIL_LINES];
  int question_count; // 0 = sin pregunta pendiente (campo opcional `question`); si no, 1 a 3
  ViewText question[VIEW_MAX_QUESTION_LINES];
  int has_notify;     // campo opcional `notify`: modo de aviso de esta sesión
  NotifyMode notify;  // válido si has_notify
  int instr_count;    // paso 6: instrucciones en cola para el próximo fin de turno (campo opcional `instructions`; 0 = ninguna, si no 1 a 5)
  ViewText instr_first; // comienzo de la primera, ya recortado; válido si instr_count > 0
  int wait_for_me;    // paso 6: "Esperar mi respuesta" de la sesión (campo opcional `waitForMe`; ausente = apagado)
} DetailView;

// Tarjeta de aviso con "Visto" (campo opcional `notice` de la vista). Nunca es una decisión: A solo la marca vista.
typedef struct {
  ViewId id;
  ViewId session_id;
  NoticeKind kind;
  ViewText agent, project, title;
  int line_count; // 0 a 4
  ViewText lines[VIEW_MAX_NOTICE_LINES];
  uint32_t position; // desde 1
  uint32_t total;
} NoticeView;

// Último aviso con sonido (campo opcional `chime`): seq sube de uno en uno; la consola suena una vez por seq nuevo.
typedef struct {
  ChimeKind kind;
  uint32_t seq;
} ChimeView;

// Hay una versión nueva de la app (campo opcional `update` de la vista): la versión ("0.3.0") y la dirección que se descarga
// ("http://192.168.0.20:33337/agent-companion.cia"), con el tamaño y el SHA-256 del .cia que el puente sirve: lo descargado se verifica
// contra ellos antes de tocar AM (el HTTP va en claro). El puente solo la manda a una consola con una versión menor.
// Sin `size` o sin `sha256` válidos (puente viejo), la vista se acepta pero NO hay oferta (has_update = 0): no se instala nada sin verificar.
#define VIEW_UPDATE_VERSION_MAX 16
#define VIEW_UPDATE_URL_MAX 120
#define VIEW_UPDATE_SIZE_MIN 8192u              // un .cia tiene al menos su cabecera, el certificado, el TMD y el ticket
#define VIEW_UPDATE_SIZE_MAX (8u * 1024u * 1024u) // el .cia entero cabe en memoria: pesa unos 370 KB
#define VIEW_UPDATE_SHA_LEN 32
typedef struct {
  char version[VIEW_UPDATE_VERSION_MAX + 1];
  char url[VIEW_UPDATE_URL_MAX + 1];
  uint32_t size;                         // bytes del .cia
  uint8_t sha256[VIEW_UPDATE_SHA_LEN];   // su SHA-256 (el campo llega en hex, 64 caracteres)
} UpdateView;

// Preferencias del puente que muestra el menú de configuración (campo opcional `settings` de la vista).
typedef struct {
  NotifyMode notify_default;
  int notify_ack;
  int sound;                        // sonido de los avisos (campo opcional `sound`; ausente = 1)
  int questions;                    // preguntas en la consola (campo opcional `questions`; ausente = 1)
  int reader_default;               // modo en que abre el lector: 0 completo, 1 resumen (campo opcional `readerDefault`; ausente = 0)
  int has_instruct_wait;            // el puente manda `instructWaitMax` (paso 6): sabe de instrucciones por texto; si no, la consola no las ofrece
  int instruct_wait_max;            // minutos que espera tu instrucción una sesión con "Esperar mi respuesta": 5, 10 o 30; válido si has_instruct_wait
  int hidden_count;                 // agentes ocultos en la lista y en la cara; sus permisos sí llegan
  AgentKind hidden[AGENT_COUNT];
} SettingsView;

typedef struct {
  uint64_t rev;
  int session_count;
  SessionView sessions[VIEW_MAX_SESSIONS];
  int has_request;
  RequestView request; // válido si has_request
  uint32_t pending_count;
  PermMode mode;
  FaceView face;
  int has_detail;
  DetailView detail; // válido si has_detail
  LedPattern led;
  int has_settings;
  SettingsView settings; // válido si has_settings (un puente anterior no lo manda)
  int has_notice;
  NoticeView notice; // válido si has_notice; el puente no la manda con un permiso pendiente (la consola tampoco la muestra)
  int has_chime;
  ChimeView chime;   // válido si has_chime
  int has_update;
  UpdateView update; // válido si has_update (hay una versión nueva de la app; logic/update.c decide si se muestra)
  char error_code[VIEW_ERROR_CODE_BYTES]; // solo tras VIEW_BRIDGE_ERROR
} View;

enum {
  VIEW_OK = 0,
  VIEW_BRIDGE_ERROR = 1, // era {"t":"error","code":...}: el código queda en out->error_code, el resto sin definir
  VIEW_ERR_JSON = -1,    // no es JSON válido (o excede los topes del lector)
  VIEW_ERR_SCHEMA = -2,  // falta un campo, tipo o valor de enumeración equivocado
  VIEW_ERR_LIMIT = -3    // demasiados elementos, texto o id demasiado largo, id con caracteres no permitidos, número fuera de rango
};

// Analiza un mensaje del puente {"t":"view","rev":N,"view":{...}} (o {"t":"error","code":"..."}).
// Con un error, *out queda en un estado intermedio: no se debe usar. La app conserva la última vista buena aparte.
// Usa unos 4 KB de pila para el lector de JSON.
int view_parse(const char *json, size_t len, View *out);
// Lo mismo sobre un JSON ya leído (la sesión lee una vez y decide si es vista, error o texto).
int view_parse_doc(const JsonDoc *doc, View *out);

// 1 a 48 caracteres de [A-Za-z0-9_.:-].
int view_id_valid(const char *id);

const SessionView *view_find_session(const View *v, const char *session_id);

// ¿Hay una tarjeta de aviso a la vista? Solo sin tarjeta de permiso: los permisos van siempre primero, aunque un puente
// con errores mandara las dos.
static inline int view_has_notice_card(const View *v) { return v != NULL && v->has_notice && !v->has_request; }

// ¿La solicitud a la vista es una pregunta con alternativas? Esa nunca se aprueba ni se rechaza (ver logic/question.c).
static inline int view_has_question_card(const View *v) {
  return v != NULL && v->has_request && v->request.kind == REQ_QUESTION && v->request.question_count > 0;
}
// ¿La solicitud a la vista es un fin de turno retenido (paso 6)? Tampoco se aprueba ni se rechaza: se escribe o se libera (logic/instruct.c).
static inline int view_has_instruction_card(const View *v) { return v != NULL && v->has_request && v->request.kind == REQ_INSTRUCTION; }
// ¿Es un permiso (la tarjeta con Aprobar y Rechazar)?
static inline int view_has_permission_card(const View *v) { return v != NULL && v->has_request && v->request.kind == REQ_PERMISSION; }

// 1 si el agente está oculto según los ajustes de la vista (0 sin ajustes).
int view_agent_hidden(const View *v, AgentKind kind);
// Agentes que se muestran en la lista, en el orden de la cuadrícula. Devuelve cuántos; out debe tener AGENT_COUNT lugares.
int view_visible_agents(const View *v, AgentKind out[AGENT_COUNT]);
const char *view_notify_name(NotifyMode m);
const char *view_notice_kind_name(NoticeKind k);
const char *view_chime_kind_name(ChimeKind k);

// Segundos que le quedan a la solicitud para mostrarlos, redondeados hacia arriba (0 cuando ya pasó el instante).
// expires_in_s == 0 significa "sin límite": devuelve -1 (sin cuenta atrás) y la solicitud nunca se trata como vencida.
// `deadline_ms` es el instante (reloj de la app) calculado al llegar la vista: now + expires_in_s * 1000.
int view_countdown_s(const RequestView *r, uint64_t deadline_ms, uint64_t now_ms);

const char *view_kind_name(AgentKind k);
const char *view_state_name(AgentState s);
const char *view_mood_name(Mood m);
const char *view_led_name(LedPattern l);
const char *view_mode_name(PermMode m);
const char *view_risk_name(Risk r);
const char *view_request_kind_name(RequestKind k);

#endif

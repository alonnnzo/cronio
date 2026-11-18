// Fusión y retiro de los hooks de Agent Companion en el settings.json de Claude Code.
// Lógica pura: no toca el disco. Quien la llama decide dónde leer y escribir.

/** Dirección a la que los hooks http avisan al puente. Así reconocemos nuestras entradas. */
export const HOOK_URL = "http://127.0.0.1:33335/hook/claude";
/** Nombre del script del hook de permisos; una entrada `command` que termina así es nuestra. */
export const HOOK_SCRIPT = "permission-hook.mjs";

export type Json = Record<string, unknown>;

export interface HookEvento {
  evento: string;
  /** Qué hace este evento, en palabras simples (se muestra antes de agregar). */
  descripcion: string;
}

/** Los eventos que agregamos, con una frase para cada uno. */
export const HOOK_EVENTOS: readonly HookEvento[] = [
  { evento: "PermissionRequest", descripcion: "Los permisos y las preguntas de Claude llegan a la 3DS para que las respondas desde ahí." },
  { evento: "SessionStart", descripcion: "Avisa a la 3DS cuando empieza una sesión de Claude Code." },
  { evento: "UserPromptSubmit", descripcion: "Avisa que Claude se puso a trabajar cuando le escribes algo." },
  { evento: "PreToolUse", descripcion: "Muestra en la 3DS qué herramienta va a usar Claude." },
  { evento: "PostToolUse", descripcion: "Avisa cuando Claude termina de usar una herramienta." },
  { evento: "PostToolUseFailure", descripcion: "Avisa si una herramienta falló." },
  { evento: "Notification", descripcion: "Pasa a la 3DS los avisos de Claude Code." },
  { evento: "Stop", descripcion: "Avisa que Claude terminó y permite mandarle instrucciones por texto desde la 3DS." },
  { evento: "SessionEnd", descripcion: "Avisa a la 3DS cuando la sesión termina." },
];

function http(timeout: number): Json {
  return { type: "http", url: HOOK_URL, timeout };
}
function comando(scriptPath: string, timeout: number): Json {
  return { type: "command", command: `node "${scriptPath}"`, timeout };
}

/** Las entradas que agregamos (iguales a packages/hooks/settings.example.json). `scriptPath` usa "/" como separador y va entre comillas (una ruta con espacios no se parte). */
export function entradasNuestras(scriptPath: string): Record<string, Json[]> {
  return {
    PermissionRequest: [{ matcher: "*", hooks: [comando(scriptPath, 86400)] }],
    SessionStart: [{ hooks: [http(2)] }],
    UserPromptSubmit: [{ hooks: [http(2)] }],
    PreToolUse: [{ matcher: "*", hooks: [http(2)] }],
    PostToolUse: [{ matcher: "*", hooks: [http(2)] }],
    PostToolUseFailure: [{ matcher: "*", hooks: [http(2)] }],
    Notification: [{ hooks: [http(2)] }],
    Stop: [{ hooks: [http(2), comando(scriptPath, 3600)] }],
    SessionEnd: [{ hooks: [http(2)] }],
  };
}

function esObjeto(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** ¿Este hook individual es de Agent Companion? */
export function esNuestro(hook: unknown): boolean {
  if (!esObjeto(hook)) return false;
  if (hook.url === HOOK_URL) return true;
  if (typeof hook.command === "string") {
    const cmd = hook.command.trim().replace(/^["']|["']$/g, "");
    return cmd.endsWith(HOOK_SCRIPT);
  }
  return false;
}

/** Quita nuestros hooks de la lista de grupos de un evento. Los grupos que quedan vacíos se descartan. */
function sinNuestros(grupos: unknown[]): unknown[] {
  const salida: unknown[] = [];
  for (const grupo of grupos) {
    if (!esObjeto(grupo) || !Array.isArray(grupo.hooks)) {
      salida.push(grupo);
      continue;
    }
    const resto = grupo.hooks.filter((h) => !esNuestro(h));
    if (resto.length === grupo.hooks.length) salida.push(grupo);
    else if (resto.length > 0) salida.push({ ...grupo, hooks: resto });
  }
  return salida;
}

function copia<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function limpiarEventos(hooks: Json): void {
  for (const evento of Object.keys(hooks)) {
    const grupos = hooks[evento];
    if (!Array.isArray(grupos)) continue;
    const resto = sinNuestros(grupos);
    if (resto.length > 0) hooks[evento] = resto;
    else delete hooks[evento];
  }
}

/** Devuelve el settings con nuestros hooks al día. No modifica el objeto recibido. Es idempotente. */
export function fusionarSettings(actual: Json, scriptPath: string): Json {
  const salida = copia(actual);
  const hooks: Json = esObjeto(salida.hooks) ? salida.hooks : {};
  // quita primero las nuestras de todos los eventos (también de eventos que ya no usamos)
  limpiarEventos(hooks);
  for (const [evento, grupos] of Object.entries(entradasNuestras(scriptPath))) {
    const previos = Array.isArray(hooks[evento]) ? (hooks[evento] as unknown[]) : [];
    hooks[evento] = [...previos, ...grupos];
  }
  salida.hooks = hooks;
  return salida;
}

/** Devuelve el settings sin nuestros hooks. Si `hooks` queda vacío, se quita esa clave. */
export function quitarDeSettings(actual: Json): Json {
  const salida = copia(actual);
  if (!esObjeto(salida.hooks)) return salida;
  limpiarEventos(salida.hooks);
  if (Object.keys(salida.hooks).length === 0) delete salida.hooks;
  return salida;
}

function hooksNuestros(actual: Json): { evento: string; hook: Json }[] {
  const lista: { evento: string; hook: Json }[] = [];
  if (!esObjeto(actual.hooks)) return lista;
  for (const [evento, grupos] of Object.entries(actual.hooks)) {
    if (!Array.isArray(grupos)) continue;
    for (const g of grupos) {
      if (!esObjeto(g) || !Array.isArray(g.hooks)) continue;
      for (const h of g.hooks) if (esObjeto(h) && esNuestro(h)) lista.push({ evento, hook: h });
    }
  }
  return lista;
}

export interface EstadoHooks {
  /** Eventos nuestros que ya están en el settings. */
  presentes: string[];
  /** Eventos que faltan. */
  faltan: string[];
  /** Rutas de scripts a las que apunta algún hook `command` nuestro. */
  scripts: string[];
  /** Scripts que no existen en el disco. */
  scriptsFaltantes: string[];
  /** Todo listo: están todos los eventos y los scripts existen. */
  ok: boolean;
}

/** De "node C:/ruta/permission-hook.mjs" saca la ruta del script. */
export function rutaDeComando(comandoTexto: string): string | undefined {
  const m = /^\s*node\s+(.+?)\s*$/.exec(comandoTexto);
  if (!m?.[1]) return undefined;
  return m[1].replace(/^["']|["']$/g, "");
}

/** Revisa el estado actual. `existe` dice si un archivo existe (se inyecta para poder probar). */
export function estadoHooks(actual: Json, existe: (ruta: string) => boolean): EstadoHooks {
  const nuestros = hooksNuestros(actual);
  const nombres = HOOK_EVENTOS.map((e) => e.evento);
  const presentes = nombres.filter((e) => nuestros.some((n) => n.evento === e));
  const faltan = nombres.filter((e) => !presentes.includes(e));
  const scripts = [
    ...new Set(
      nuestros
        .map((n) => (typeof n.hook.command === "string" ? rutaDeComando(n.hook.command) : undefined))
        .filter((r): r is string => r !== undefined),
    ),
  ];
  const scriptsFaltantes = scripts.filter((s) => !existe(s));
  return { presentes, faltan, scripts, scriptsFaltantes, ok: faltan.length === 0 && scripts.length > 0 && scriptsFaltantes.length === 0 };
}

/** Lee el texto de un settings.json. Vacío o ausente equivale a `{}`. Lanza un error claro si no es JSON de objeto. */
export function leerSettings(texto: string | undefined): Json {
  if (texto === undefined || texto.trim() === "") return {};
  let valor: unknown;
  try {
    valor = JSON.parse(texto);
  } catch {
    throw new Error("El settings.json de Claude Code no es un JSON válido. No se tocó nada: corrígelo o bórralo y vuelve a intentar.");
  }
  if (!esObjeto(valor)) throw new Error("El settings.json de Claude Code no tiene la forma esperada (debe ser un objeto { ... }). No se tocó nada.");
  return valor;
}

/** Escribe el settings con 2 espacios y un salto de línea al final. */
export function serializarSettings(settings: Json): string {
  return JSON.stringify(settings, null, 2) + "\n";
}

/** Nombre del respaldo: settings.json.bak-companion-AAAAMMDD-HHMMSS (hora local). */
export function nombreRespaldo(fecha: Date): string {
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  const dia = `${p(fecha.getFullYear(), 4)}${p(fecha.getMonth() + 1)}${p(fecha.getDate())}`;
  const hora = `${p(fecha.getHours())}${p(fecha.getMinutes())}${p(fecha.getSeconds())}`;
  return `settings.json.bak-companion-${dia}-${hora}`;
}

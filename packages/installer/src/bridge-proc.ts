// El puente como proceso hijo: lo arranca, lo detiene y consulta su estado por /health.
import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RegistroRotativo } from "./registro-rotativo.ts";
import { cabecerasApi } from "./token-api.ts";
import type { ComandoPuente } from "./paths.ts";
import { decidirPuenteExistente, evaluarCierrePid, parsearNetstat, parsearTasklist } from "./setup/puente-viejo.ts";
import { rutaPrograma } from "./setup/sistema.ts";

/**
 * Solo para pruebas del programa empaquetado sin tocar el puente real: `CRONIO_PUERTOS_PRUEBA=api,consola,udp,ws` (cuatro puertos propios).
 * Sin esa variable (el uso normal) son los de siempre.
 */
const FORMA_PUERTOS_PRUEBA = /^\d{2,5},\d{2,5},\d{2,5},\d{2,5}$/;
export const PUENTE_PUERTO = FORMA_PUERTOS_PRUEBA.test(process.env.CRONIO_PUERTOS_PRUEBA ?? "") ? Number(process.env.CRONIO_PUERTOS_PRUEBA!.split(",")[0]) : 33335;
export const PUENTE_API = `http://127.0.0.1:${PUENTE_PUERTO}`;
/** Cuánto se espera a que un puente al que se le pidió cerrarse suelte el puerto. */
const ESPERA_PUERTO_MS = 5000;
/** Cuánto se espera a que el puente propio salga solo tras /shutdown antes de matarlo. */
const ESPERA_CIERRE_PROPIO_MS = 3000;

export interface SaludPuente {
  ok: boolean;
  console: boolean;
  device: boolean;
  simulator: boolean;
  pending: number;
  /** El puente sirve el .cia por HTTP (`serving`), en qué puerto y qué versión. Ausente en un puente anterior. */
  cia?: { serving: boolean; port?: number; version?: string };
  /** Versión del paquete del puente, su PID y quién lo lanzó (`cronio` o `manual`). Ausentes en un puente anterior. */
  version?: string;
  pid?: number;
  startedBy?: string;
  /** Última IPv4 local por la que llegó una consola (aunque ya no esté conectada). Ausente si nunca llegó una o en un puente anterior. */
  consoleLocalIp?: string;
  /** Versión de la app de la última 3DS que se conectó. Ausente si no la dijo o en un puente anterior. */
  consoleVersion?: string;
}

/** Un puente corriendo que no es de la versión de esta app y que no se pudo cerrar solo. */
export interface PuenteViejo {
  pid?: number;
  version?: string;
}

export interface EstadoPuente {
  /** El puente responde en 127.0.0.1:33335. */
  activo: boolean;
  /** Lo lanzó esta app (si no, ya estaba corriendo por su cuenta). */
  propio: boolean;
  salud?: SaludPuente;
  error?: string;
  /** El registro `bridge.log` no se pudo escribir (el motivo). Ausente si se escribe bien. */
  errorLog?: string;
  /** Hay un puente de otra versión (o sin versión) que no lanzó esta app: el paso 3 avisa y ofrece detenerlo. */
  viejo?: PuenteViejo;
}

/** La versión del puente que trae esta app: `bridge/cli.version` (texto) empaquetada, o el package.json del puente en desarrollo. */
export function leerVersionBundle(ruta: string): string | undefined {
  try {
    const texto = readFileSync(ruta, "utf8");
    if (ruta.toLowerCase().endsWith(".json")) {
      const v = (JSON.parse(texto) as { version?: unknown }).version;
      return typeof v === "string" ? v : undefined;
    }
    return texto.trim() || undefined;
  } catch {
    return undefined;
  }
}

function ejecutarSimple(archivo: string, args: string[]): Promise<string> {
  return new Promise((ok) => {
    execFile(archivo, args, { windowsHide: true, timeout: 8000, encoding: "utf8" }, (err, stdout) => ok(err ? "" : stdout));
  });
}

/** PIDs que escuchan en 127.0.0.1:33335 (netstat -ano; solo Windows). */
export async function pidsEscuchando(puerto: number = PUENTE_PUERTO): Promise<number[]> {
  if (process.platform !== "win32") return [];
  return parsearNetstat(await ejecutarSimple(rutaPrograma("netstat"), ["-ano", "-p", "TCP"]), puerto);
}

/** Nombre del ejecutable de un PID (tasklist; solo Windows). */
export async function nombreDeProceso(pid: number): Promise<string | undefined> {
  if (process.platform !== "win32") return undefined;
  return parsearTasklist(await ejecutarSimple(rutaPrograma("tasklist"), ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]));
}

/** Pide a un puente que se cierre (POST /shutdown con la cabecera propia). false si no sabe hacerlo (uno viejo) o no respondió. */
export async function pedirCierrePuente(base: string = PUENTE_API): Promise<boolean> {
  try {
    const r = await fetch(`${base}/shutdown`, { method: "POST", headers: cabecerasApi({ "x-cronio": "shutdown" }), signal: AbortSignal.timeout(2500) });
    return r.status === 202;
  } catch {
    return false;
  }
}

/** Espera hasta `ms` a que nada responda en el puerto del puente. */
export async function esperarPuertoLibre(ms: number = ESPERA_PUERTO_MS, base: string = PUENTE_API): Promise<boolean> {
  const limite = Date.now() + ms;
  for (;;) {
    if (!(await consultarSalud(base))) return true;
    if (Date.now() >= limite) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * Cierra un puente suelto con taskkill /PID n /F, pero solo si ese PID sigue escuchando en el puerto del puente y es node.exe o
 * Cronio.exe. Devuelve si lo cerró y, si no, por qué.
 */
export async function detenerPuenteViejo(pid: number): Promise<{ ok: boolean; motivo?: string }> {
  if (process.platform !== "win32") return { ok: false, motivo: "Detener un puente por su PID solo está disponible en Windows." };
  const veredicto = evaluarCierrePid({ pid, escuchando: await pidsEscuchando(), nombre: await nombreDeProceso(pid), propio: process.pid });
  if (!veredicto.ok) return { ok: false, motivo: veredicto.motivo };
  await ejecutarSimple(rutaPrograma("taskkill"), ["/PID", String(pid), "/F"]);
  if (!(await esperarPuertoLibre())) return { ok: false, motivo: `Cerré el proceso ${pid} pero el puerto sigue ocupado.` };
  return { ok: true };
}

/** Consulta GET /health. Devuelve undefined si no responde. */
export async function consultarSalud(base: string = PUENTE_API): Promise<SaludPuente | undefined> {
  try {
    const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return undefined;
    return (await r.json()) as SaludPuente;
  } catch {
    return undefined;
  }
}

export class ProcesoPuente {
  private hijo: ChildProcess | undefined;
  private log: RegistroRotativo | undefined;
  private ultimoError: string | undefined;
  private pidCache: { pid: number | undefined; en: number } | undefined;

  constructor(
    private readonly comando: ComandoPuente,
    private readonly carpetaLogs: string,
    /** Versión del puente que trae esta app (la que debe tener el puente que se use). */
    private readonly versionBundle?: string,
    /** Dirección de la API local del puente (solo cambia en las pruebas, que no deben tocar el puente real del puerto 33335). */
    private readonly base: string = PUENTE_API,
  ) {}

  /** El puente está arrancando: desde que `iniciar()` empieza hasta que termina (responda o no). */
  arrancando = false;

  /** ¿Este /health es del hijo que lanzó esta app? (mismo PID; sin PID en /health no se puede afirmar). */
  esHijo(salud: SaludPuente | undefined): boolean {
    return this.propio && salud !== undefined && salud.pid !== undefined && salud.pid === this.hijo?.pid;
  }

  get propio(): boolean {
    return this.hijo !== undefined && this.hijo.exitCode === null;
  }

  async estado(): Promise<EstadoPuente> {
    const salud = await consultarSalud(this.base);
    const estado: EstadoPuente = { activo: salud !== undefined, propio: this.propio, salud, error: salud ? undefined : this.ultimoError };
    // si el registro no se puede escribir, se dice en vez de dejarlo en silencio
    const errorLog = this.log?.ultimoError;
    if (errorLog) estado.errorLog = errorLog;
    // un puente que no lanzó esta app y no es de esta versión: se avisa para que se detenga
    if (salud && !this.propio && decidirPuenteExistente({ puente: salud, versionBundle: this.versionBundle, cierreFallido: true }) === "avisar") {
      estado.viejo = { pid: salud.pid ?? (await this.pidQueEscucha()), version: salud.version };
    }
    return estado;
  }

  private async pidQueEscucha(): Promise<number | undefined> {
    if (this.pidCache && Date.now() - this.pidCache.en < 5000) return this.pidCache.pid;
    const pid = (await pidsEscuchando())[0];
    this.pidCache = { pid, en: Date.now() };
    return pid;
  }

  /**
   * Arranca el puente si no hay uno. Si ya hay uno de esta versión, lo usa (`ya-corria`). Si es de otra versión o sin versión, le
   * pide cerrarse por /shutdown y arranca el propio; si no se deja (`puente-viejo`), no toca nada: el paso 3 avisa al usuario.
   */
  async iniciar(): Promise<"iniciado" | "ya-corria" | "puente-viejo" | "error"> {
    this.arrancando = true;
    try {
      return await this.iniciarInterno();
    } finally {
      this.arrancando = false;
    }
  }

  /** Abre el registro (lo crea si hace falta) y deja una línea; se llama en cada arranque, también cuando no se lanza ningún puente. */
  private abrirRegistro(): RegistroRotativo {
    if (!this.log) {
      // rotación por tamaño: al pasar de 5 MB, bridge.log pasa a bridge.log.1 (reemplaza al anterior)
      this.log = new RegistroRotativo(join(this.carpetaLogs, "bridge.log"));
    }
    return this.log;
  }

  private async iniciarInterno(): Promise<"iniciado" | "ya-corria" | "puente-viejo" | "error"> {
    const log = this.abrirRegistro();
    const marca = new Date().toISOString();
    const salud = await consultarSalud(this.base);
    if (salud) {
      if (this.propio) return "iniciado";
      if (decidirPuenteExistente({ puente: salud, versionBundle: this.versionBundle }) === "usar") {
        // sin esta línea, «no hay arranque en el registro» no se distingue de «el registro no se escribe»
        log.write(`\n--- ${marca} Cronio no lanza otro puente: ya corre el de la versión ${salud.version ?? "?"} (PID ${salud.pid ?? "?"}, lo lanzó ${salud.startedBy ?? "?"}); su registro es el de quien lo lanzó ---\n`);
        return "ya-corria";
      }
      const cerro = (await pedirCierrePuente(this.base)) && (await esperarPuertoLibre(ESPERA_PUERTO_MS, this.base));
      if (!cerro) {
        log.write(`\n--- ${marca} hay un puente de otra versión (${salud.version ?? "sin versión"}) que no se dejó cerrar ---\n`);
        return "puente-viejo";
      }
    }
    if (this.propio) return "iniciado";
    this.ultimoError = undefined;
    log.write(`\n--- ${new Date().toISOString()} arranque desde Cronio ---\n`);
    // en desarrollo, el mismo comando que `npm run companion -- start`; empaquetado, el propio ejecutable como Node
    const c = this.comando;
    const hijo = spawn(c.archivo, c.args, {
      cwd: c.cwd,
      // COMPANION_PARENT_PID: si esta app muere de golpe, el puente se da cuenta y se cierra solo
      env: { ...process.env, ...c.env, COMPANION_STARTED_BY: "cronio", COMPANION_PARENT_PID: String(process.pid) },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.hijo = hijo;
    hijo.stdout?.on("data", (trozo: Buffer) => this.log?.write(trozo));
    hijo.stderr?.on("data", (trozo: Buffer) => this.log?.write(trozo));
    hijo.on("error", (err) => {
      this.ultimoError = `No se pudo lanzar el puente: ${err.message}`;
      this.log?.write(`${this.ultimoError}\n`);
    });
    hijo.on("exit", (codigo) => {
      if (this.hijo === hijo) {
        this.log?.write(`--- el puente terminó (código ${codigo}) ---\n`);
        if (codigo !== 0 && codigo !== null) this.ultimoError = `El puente se cerró con el código ${codigo}. Mira el registro para ver por qué.`;
        this.hijo = undefined;
      }
    });
    // espera a que responda (hasta ~10 s)
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (await consultarSalud(this.base)) return "iniciado";
      if (this.hijo === undefined) break;
    }
    return "error";
  }

  /**
   * Detiene el puente solo si lo lanzó esta app: primero POST /shutdown (cierre ordenado) y, si no sale en 3 s, kill.
   * Nunca toca un puente que no arrancó ella: el /shutdown solo se manda si el PID de /health es el del hijo.
   */
  async detenerOrdenado(): Promise<boolean> {
    const hijo = this.hijo;
    if (!hijo || hijo.exitCode !== null) return false;
    this.hijo = undefined;
    this.log?.write("--- deteniendo desde Cronio ---\n");
    const salio = new Promise<boolean>((ok) => {
      hijo.once("exit", () => ok(true));
      setTimeout(() => ok(false), ESPERA_CIERRE_PROPIO_MS);
    });
    const salud = await consultarSalud(this.base);
    if (salud?.pid === hijo.pid) await pedirCierrePuente(this.base);
    else hijo.kill();
    if (!(await salio) && hijo.exitCode === null) {
      this.log?.write("--- no salió solo en 3 s: kill ---\n");
      hijo.kill();
    }
    return true;
  }

  /** Último recurso, síncrono (al terminar el proceso de Electron): mata al hijo si todavía vive. */
  matarSiQueda(): void {
    const hijo = this.hijo;
    if (hijo && hijo.exitCode === null) hijo.kill();
    this.hijo = undefined;
  }

  rutaLog(): string {
    return join(this.carpetaLogs, "bridge.log");
  }
}

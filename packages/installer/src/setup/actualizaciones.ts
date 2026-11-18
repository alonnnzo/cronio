// Actualizaciones del programa del PC: lógica pura y probada (la parte de Electron está en src/actualizador.ts).
// Dos orígenes: una carpeta local con el `latest.yml` que genera electron-builder (se implementa a mano, porque
// electron-updater solo admite HTTP) y GitHub Releases (electron-updater, que solo se carga si el usuario lo activa).
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------- versiones ----------

interface VersionLeida {
  numeros: [number, number, number];
  /** Parte después del `-` (`beta.1`); vacía si es una versión final. */
  pre: string[];
}

function leerVersion(texto: unknown): VersionLeida | undefined {
  if (typeof texto !== "string") return undefined;
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(texto.trim());
  if (!m) return undefined;
  return { numeros: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] };
}

/**
 * Compara dos versiones `x.y.z` (con `-pre` opcional, como las de electron-builder): -1 si `a` es menor, 0 igual, 1 mayor;
 * `undefined` si alguna no se entiende. Una versión con `-pre` es menor que la final (`1.0.0-beta.1` < `1.0.0`).
 * No reusa `compareVersions` de `@companion/protocol`: esa no admite `-pre` ni este paquete lleva a protocol empaquetado.
 */
export function compararVersiones(a: unknown, b: unknown): -1 | 0 | 1 | undefined {
  const x = leerVersion(a);
  const y = leerVersion(b);
  if (!x || !y) return undefined;
  for (let i = 0; i < 3; i++) {
    if (x.numeros[i] !== y.numeros[i]) return x.numeros[i]! < y.numeros[i]! ? -1 : 1;
  }
  if (x.pre.length === 0 && y.pre.length === 0) return 0;
  if (x.pre.length === 0) return 1;
  if (y.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

// ---------- latest.yml ----------

export interface LatestYml {
  version: string;
  /** Nombre del instalador (solo el nombre de archivo, sin carpetas). */
  path: string;
  /** SHA-512 del instalador en base64, tal cual lo escribe electron-builder. */
  sha512: string;
}

export type LecturaLatest = { ok: true; latest: LatestYml } | { ok: false; error: string };

function sinComillas(v: string): string {
  const t = v.trim();
  const m = /^(['"])(.*)\1$/.exec(t);
  return m ? m[2]! : t;
}

/**
 * Lee `latest.yml`. El formato es simple: se leen solo las claves de primer nivel `version`, `path` y `sha512` (las de la
 * lista `files:` van con sangría y se ignoran). Sin dependencias.
 */
export function leerLatestYml(texto: string): LecturaLatest {
  const claves = new Map<string, string>();
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^([A-Za-z][A-Za-z0-9_]*):[ \t]*(.*)$/.exec(linea);
    if (m && !claves.has(m[1]!)) claves.set(m[1]!, sinComillas(m[2]!.replace(/[ \t]+#.*$/, "")));
  }
  const version = claves.get("version");
  const path = claves.get("path");
  const sha512 = claves.get("sha512");
  if (!version || !leerVersion(version)) return { ok: false, error: "latest.yml no trae una versión válida." };
  if (!path) return { ok: false, error: "latest.yml no trae el nombre del instalador (path)." };
  // el nombre sale de un archivo que no controlamos: solo un nombre de .exe, nunca una ruta
  if (!/^[^\\/:*?"<>|]+\.exe$/i.test(path) || path.includes("..")) return { ok: false, error: "latest.yml trae un nombre de instalador no válido." };
  if (!sha512 || !/^[A-Za-z0-9+/]{86}==$/.test(sha512)) return { ok: false, error: "latest.yml no trae un sha512 válido." };
  return { ok: true, latest: { version, path, sha512 } };
}

// ---------- decisión ----------

export type Oferta = { tipo: "al-dia" } | { tipo: "nueva"; version: string } | { tipo: "ilegible"; motivo: string };

/** ¿Hay algo que ofrecer? Solo si la versión publicada es mayor que la instalada. */
export function decidirOferta(instalada: string, publicada: string): Oferta {
  const c = compararVersiones(publicada, instalada);
  if (c === undefined) return { tipo: "ilegible", motivo: `No entiendo las versiones (instalada «${instalada}», publicada «${publicada}»).` };
  return c > 0 ? { tipo: "nueva", version: publicada } : { tipo: "al-dia" };
}

/** Solo se avisa con una notificación del sistema la primera vez que se ve cada versión nueva. */
export function debeNotificar(ultimaAvisada: string | undefined, nueva: string): boolean {
  return ultimaAvisada !== nueva;
}

// ---------- cuándo buscar ----------

export const CADA_LOCAL_MS = 60_000;
export const CADA_GITHUB_MS = 6 * 60 * 60 * 1000;
export const ENFOQUE_MIN_MS = 15_000;

/** Por qué se piensa buscar: al iniciar, por el reloj (que late seguido) o porque la ventana ganó el foco / salió de la bandeja. */
export type MotivoBusqueda = "inicio" | "intervalo" | "foco";

/**
 * ¿Toca buscar ahora? «ninguno» nunca. Al iniciar, siempre. Carpeta local: cada 60 s y, con el foco, si pasaron más de 15 s
 * desde la última búsqueda. GitHub: cada 6 h; el foco no cuenta, para no consultar internet de más.
 */
export function tocaBuscar(origen: "ninguno" | "local" | "github", ahora: number, ultima: number | undefined, motivo: MotivoBusqueda): boolean {
  if (origen === "ninguno") return false;
  if (motivo === "inicio") return true;
  const pasado = ultima === undefined ? Infinity : ahora - ultima;
  if (origen === "github") return motivo === "intervalo" && pasado >= CADA_GITHUB_MS;
  if (motivo === "foco") return pasado > ENFOQUE_MIN_MS;
  return pasado >= CADA_LOCAL_MS;
}

// ---------- sha512 y copia del instalador ----------

export function sha512Base64(ruta: string): Promise<string> {
  return new Promise((ok, mal) => {
    const h = createHash("sha512");
    createReadStream(ruta)
      .on("data", (d) => h.update(d))
      .on("error", mal)
      .on("end", () => ok(h.digest("base64")));
  });
}

export interface PreparacionLocal {
  carpeta: string;
  latest: LatestYml;
  /** Carpeta temporal base (por defecto la del sistema); dentro se crea una carpeta nueva por intento. */
  tmp?: string;
  /** Se llama justo antes de verificar el sha512 (la copia ya terminó): sirve para mostrar el paso. */
  alVerificar?: () => void;
}

export type InstaladorListo = { ok: true; ruta: string; carpetaTmp: string } | { ok: false; error: string };

/** Copia el instalador a una carpeta temporal y verifica su sha512 (base64). Si no coincide, borra la copia. */
export async function copiarYVerificar(p: PreparacionLocal): Promise<InstaladorListo> {
  const origen = join(p.carpeta, p.latest.path);
  const carpetaTmp = await mkdtemp(join(p.tmp ?? tmpdir(), "cronio-update-"));
  const ruta = join(carpetaTmp, p.latest.path);
  const fallo = async (error: string): Promise<InstaladorListo> => {
    await rm(carpetaTmp, { recursive: true, force: true });
    return { ok: false, error };
  };
  try {
    await copyFile(origen, ruta);
  } catch (err) {
    return fallo(`No pude copiar ${p.latest.path} desde la carpeta: ${err instanceof Error ? err.message : String(err)}`);
  }
  p.alVerificar?.();
  try {
    if ((await sha512Base64(ruta)) !== p.latest.sha512) {
      return fallo("El instalador no coincide con su sha512 de latest.yml (archivo dañado o cambiado). No lo ejecuté.");
    }
  } catch (err) {
    return fallo(`No pude verificar el instalador: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { ok: true, ruta, carpetaTmp };
}

// ---------- lanzar el instalador ----------

/**
 * Argumentos del instalador NSIS de un clic: `--updated` (le dice que es una actualización: espera a la app y no pregunta) y
 * **sin `/S`**, para que se vea su ventana con la barra de progreso. Tampoco hace falta `--force-run`: con `runAfterFinish` el
 * instalador de un clic abre la app al terminar siempre que no sea silencioso.
 */
export function argsInstalador(): string[] {
  return ["--updated"];
}

// ---------- GitHub ----------

export const OWNER_POR_DEFINIR = "POR_DEFINIR";

export type ConfigGithub = { estado: "definido"; owner: string; repo: string } | { estado: "por-definir" } | { estado: "ausente" };

/**
 * Mira `resources/app-update.yml` (lo deja electron-builder con la config `publish`): mientras el dueño sea `POR_DEFINIR` todavía no
 * hay versiones publicadas y no se consulta nada. Sin archivo (modo desarrollo) = `ausente`.
 */
export function leerConfigGithub(texto: string | undefined): ConfigGithub {
  if (texto === undefined) return { estado: "ausente" };
  const valor = (clave: string) => {
    const m = new RegExp(`^${clave}:[ \\t]*(.*)$`, "m").exec(texto);
    return m ? sinComillas(m[1]!) : undefined;
  };
  if (valor("provider") !== "github") return { estado: "ausente" };
  const owner = valor("owner");
  const repo = valor("repo");
  if (!owner || !repo || owner === OWNER_POR_DEFINIR) return { estado: "por-definir" };
  return { estado: "definido", owner, repo };
}

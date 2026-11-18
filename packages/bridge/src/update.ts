// Actualizar la app desde la consola (Fase 7): el puente sirve el .cia por HTTP y avisa a las consolas que tienen una versión menor.
//
// La ruta del .cia llega en COMPANION_CIA_PATH (la pone el programa del PC); la versión sale del archivo `.version` que está al
// lado (`agent-companion.cia` -> `agent-companion.version`, lo deja `make cia`). Sin ruta o sin archivo el puente no sirve nada.
//
// El .cia se lee ENTERO a memoria al cargar la fuente: de ahí salen el tamaño y el SHA-256 que van en `update` y también los bytes que se
// sirven, así no hay carrera entre el hash que se avisa y el archivo que se entrega. Si el archivo cambia en disco (mtime o tamaño) se recarga.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join, parse } from "node:path";
import { compareVersions, parseVersion, MAX_UPDATE_SIZE, MAX_VERSION_TEXT, type UpdateView } from "@companion/protocol";

export const CIA_PORT = 33337;
export const CIA_ROUTE = "/agent-companion.cia";

export interface CiaSource {
  /** Ruta del .cia que se sirve. */
  path: string;
  /** Versión del .cia ("0.3.0"); ausente si no se pudo leer el `.version`: se sirve igual, pero no se avisa a nadie. */
  version?: string;
}

/** Ruta del `.version` que acompaña a un .cia (mismo nombre, otra extensión). */
export function versionFileOf(ciaPath: string): string {
  const p = parse(ciaPath);
  return join(dirname(ciaPath), `${p.name}.version`);
}

/** Lee la versión del `.version`; `undefined` si falta o no es una versión. */
export function readCiaVersion(ciaPath: string): string | undefined {
  try {
    const text = readFileSync(versionFileOf(ciaPath), "utf8").trim();
    const v = parseVersion(text);
    // se normaliza a tres partes: es lo que la consola entiende en `update.version`
    return v && text.length <= MAX_VERSION_TEXT ? `${v.major}.${v.minor}.${v.micro}` : undefined;
  } catch {
    return undefined;
  }
}

/** El .cia que se sirve según el entorno (COMPANION_CIA_PATH), o `undefined` si el puente no lo conoce. */
export function ciaSourceFromEnv(env: NodeJS.ProcessEnv = process.env): CiaSource | undefined {
  const path = env.COMPANION_CIA_PATH;
  if (!path) return undefined;
  return { path, version: readCiaVersion(path) };
}

/** Lo que la consola recibe en `update`, o `undefined` si no hay nada que avisarle (sin versión, ya al día o versión suya desconocida). */
export function updateFor(source: CiaSource | undefined, consoleVersion: string | undefined, localIp: string | undefined, port: number = CIA_PORT): UpdateView | undefined {
  if (!source?.version || !consoleVersion || !localIp) return undefined;
  const file = loadCia(source.path);
  if (!file) return undefined; // sin el archivo no hay tamaño ni hash que avisar: no se ofrece nada
  // sin versión legible (consola anterior) compareVersions da undefined: no se le avisa
  if (compareVersions(consoleVersion, source.version) !== -1) return undefined;
  return { version: source.version, url: `http://${localIp}:${port}${CIA_ROUTE}`, size: file.size, sha256: file.sha256 };
}

/** Un .cia ya leído a memoria: lo que se avisa (`size`, `sha256`) y lo que se sirve (`bytes`) son lo mismo. */
export interface CiaFile {
  bytes: Buffer;
  size: number;
  sha256: string;
}

const ciaCache = new Map<string, { mtimeMs: number; size: number; file: CiaFile }>();

/**
 * El .cia en memoria, recargado si cambió en disco (mtime o tamaño). `undefined` si no existe, no se puede leer, está vacío o pasa de
 * 8 MiB (la consola lo baja entero a memoria y no acepta más).
 */
export function loadCia(path: string): CiaFile | undefined {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size < 1 || st.size > MAX_UPDATE_SIZE) return undefined;
    const prev = ciaCache.get(path);
    if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) return prev.file;
    const bytes = readFileSync(path);
    // el hash se calcula sobre los mismos bytes que se sirven
    if (bytes.length < 1 || bytes.length > MAX_UPDATE_SIZE) return undefined;
    const file: CiaFile = { bytes, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    ciaCache.set(path, { mtimeMs: st.mtimeMs, size: st.size, file });
    return file;
  } catch {
    return undefined;
  }
}

export interface CiaServer {
  port: number;
  close(): Promise<void>;
}

/**
 * Sirve solo `GET`/`HEAD` de /agent-companion.cia, con `Content-Length` (FBI y la consola lo necesitan), desde la memoria de `loadCia`. Todo lo demás es 404
 * (otra ruta) o 405 (otro método). `port` 0 elige uno libre (para pruebas).
 */
export function startCiaServer(source: CiaSource, port: number = CIA_PORT, host: string = "0.0.0.0", log: (msg: string) => void = () => {}): Promise<CiaServer> {
  const server: Server = createServer((req, res) => {
    const text = (status: number, body: string, extra: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...extra });
      res.end(body);
    };
    let route: string;
    try {
      route = new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      return text(400, "ruta inválida");
    }
    if (route !== CIA_ROUTE) return text(404, "No encontrado");
    if (req.method !== "GET" && req.method !== "HEAD") return text(405, "Método no permitido", { allow: "GET, HEAD" });
    const file = loadCia(source.path);
    if (!file) return text(404, "El archivo .cia no existe");
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": file.size });
    if (req.method === "HEAD") return void res.end();
    res.end(file.bytes);
    log(`.cia servido a ${req.socket.remoteAddress ?? "?"} (${file.size} bytes)`);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      server.on("error", (err) => log(`error del servidor del .cia: ${String(err)}`));
      const addr = server.address();
      resolve({
        port: typeof addr === "object" && addr ? addr.port : port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}

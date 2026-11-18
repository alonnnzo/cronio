import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { parseConsoleMessage } from "@companion/protocol";
import type { BridgeStore } from "./store.ts";
import { applyConsoleMessage, type ConsoleCounter, type ViewFeed } from "./feed.ts";
import { isLocalHostHeader } from "./local.ts";
import { tokenMatches } from "./api-token.ts";

export const WS_PATH = "/ws";

export interface WsServerOptions {
  store: BridgeStore;
  feed: ViewFeed;
  counter: ConsoleCounter;
  /** Puerto (0 = efímero). */
  port: number;
  /** Carpeta de archivos estáticos del simulador. Si no existe, se responde 404. */
  staticDir: string;
  /**
   * Token local (64 hex). El WebSocket exige `?token=` y las páginas `.html` que se sirven lo reciben inyectado en `window.COMPANION_API_TOKEN`.
   * Es lo que impide que una página web cualquiera (o un proceso que no conoce el token) decida permisos o mande instrucciones.
   */
  apiToken: string;
  log?: (msg: string) => void;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function plain(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(message);
}

/** El token entra en las páginas .html como primera cosa del `<head>` (o al comienzo si no hay): el simulador lo lee de `window.COMPANION_API_TOKEN`. */
export function injectToken(html: string, token: string): string {
  const tag = `<script>window.COMPANION_API_TOKEN=${JSON.stringify(token)};</script>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + tag) : tag + html;
}

async function serveStatic(root: string, req: IncomingMessage, res: ServerResponse, token: string): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") return plain(res, 405, "método no permitido");
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
  } catch {
    return plain(res, 400, "ruta inválida");
  }
  if (pathname.includes("\0") || pathname.split(/[\\/]+/).includes("..")) return plain(res, 403, "prohibido");
  let full = resolve(root, "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname));
  const rel = relative(root, full);
  if (rel.startsWith("..") || isAbsolute(rel)) return plain(res, 403, "prohibido");
  try {
    let info = await stat(full);
    if (info.isDirectory()) {
      full = resolve(full, "index.html");
      info = await stat(full);
    }
    if (!info.isFile()) return plain(res, 404, "no encontrado");
    if (extname(full).toLowerCase() === ".html") {
      const html = Buffer.from(injectToken(await readFile(full, "utf8"), token), "utf8");
      res.writeHead(200, { "content-type": MIME[".html"]!, "content-length": html.length, "cache-control": "no-store" });
      return void res.end(req.method === "HEAD" ? undefined : html);
    }
    res.writeHead(200, {
      "content-type": MIME[extname(full).toLowerCase()] ?? "application/octet-stream",
      "content-length": info.size,
      "cache-control": "no-cache",
    });
    if (req.method === "HEAD") return void res.end();
    createReadStream(full).on("error", () => res.destroy()).pipe(res);
  } catch {
    plain(res, 404, "no encontrado");
  }
}

export async function startWsServer(options: WsServerOptions): Promise<{ port: number; close(): Promise<void> }> {
  const { store, feed, counter } = options;
  const staticRoot = resolve(options.staticDir);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  const server: Server = createServer((req, res) => {
    if (!isLocalHostHeader(req.headers.host)) return plain(res, 403, "prohibido");
    serveStatic(staticRoot, req, res, options.apiToken).catch(() => plain(res, 500, "error interno"));
  });

  const reject = (socket: import("node:stream").Duplex, code: number, text: string) => {
    socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };

  server.on("upgrade", (req, socket, head) => {
    const port = (server.address() as { port: number } | null)?.port;
    const origin = req.headers.origin;
    const allowed = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== WS_PATH) return reject(socket, 404, "Not Found");
    if (!isLocalHostHeader(req.headers.host)) return reject(socket, 403, "Forbidden");
    // un navegador siempre envía Origin: una página ajena no puede aprobar permisos.
    // Los clientes que no son navegadores (scripts, pruebas) no lo envían.
    if (origin !== undefined && !allowed.includes(origin)) return reject(socket, 403, "Forbidden");
    // además, el token local: sin él (o con uno malo) no hay WebSocket, venga o no con Origin
    if (!tokenMatches(options.apiToken, url.searchParams.get("token") ?? undefined)) return reject(socket, 401, "Unauthorized");
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws));
  });

  function onConnection(ws: WebSocket): void {
    const release = counter.acquire("simulator");
    const send = (msg: unknown) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    const unsubscribe = feed.subscribe(send);
    send(feed.snapshot());
    ws.on("message", (data, isBinary) => {
      if (isBinary) return ws.close(1003, "solo texto");
      try {
        const reply = applyConsoleMessage(store, parseConsoleMessage(JSON.parse(data.toString())), options.log);
        if (reply) send(reply);
      } catch {
        ws.close(1008, "mensaje inválido");
      }
    });
    ws.on("error", () => {});
    ws.on("close", () => {
      unsubscribe();
      release();
    });
  }

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  return {
    port: (server.address() as { port: number }).port,
    close: () =>
      new Promise<void>((resolveClose) => {
        for (const c of wss.clients) c.terminate();
        wss.close();
        server.close(() => resolveClose());
        server.closeAllConnections();
      }),
  };
}

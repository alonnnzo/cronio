// Puente simulado para la prueba 0.8. Desechable: solo sirve para confirmar el flujo del hook.
//
// Recibe la solicitud de permiso del hook, la retiene hasta que alguien decide
// (la "consola") o hasta que vence el plazo, y entonces responde.
//
// Variables de entorno:
//   PORT            puerto local (33335)
//   CONSOLE=0       simula que no hay consola conectada: responde "ask" de inmediato
//   AUTO=allow|deny decide solo tras AUTO_DELAY ms (para pruebas automáticas)
//   BRIDGE_TIMEOUT  ms que espera una decisión antes de devolver "ask" (45000)
//
// Decidir a mano: teclas a / b en esta terminal, o GET /decide?d=allow|deny
import http from 'node:http';

const PORT = +(process.env.PORT ?? 33335);
const CONSOLE_CONNECTED = process.env.CONSOLE !== '0';
const AUTO = process.env.AUTO ?? null;
const AUTO_DELAY = +(process.env.AUTO_DELAY ?? 200);
const BRIDGE_TIMEOUT = +(process.env.BRIDGE_TIMEOUT ?? 45000);

let nextId = 1;
const pending = new Map(); // id -> { resolve, summary }

function decideOldest(decision, source) {
  const first = pending.entries().next().value;
  if (!first) return false;
  const [id, req] = first;
  pending.delete(id);
  console.log(`[puente] #${id} ${decision} (${source})`);
  req.resolve({ id, decision, source });
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

  if (req.method === 'POST' && url.pathname === '/permission') {
    let body;
    try { body = await readBody(req); } catch { return json(400, { error: 'json inválido' }); }
    const id = nextId++;
    const summary = `${body.tool_name ?? '?'} ${JSON.stringify(body.tool_input ?? {}).slice(0, 80)}`;

    if (!CONSOLE_CONNECTED) {
      console.log(`[puente] #${id} sin consola -> ask | ${summary}`);
      return json(200, { id, decision: 'ask', source: 'sin-consola' });
    }

    console.log(`[puente] #${id} pendiente | ${summary}`);
    const result = await new Promise(resolve => {
      pending.set(id, { resolve, summary });
      const timer = setTimeout(() => {
        if (pending.delete(id)) { console.log(`[puente] #${id} plazo vencido -> ask`); resolve({ id, decision: 'ask', source: 'plazo' }); }
      }, BRIDGE_TIMEOUT);
      // Si el hook corta la conexión (por ejemplo, el usuario respondió en el terminal), se retira la solicitud.
      res.on('close', () => { if (pending.delete(id)) { clearTimeout(timer); console.log(`[puente] #${id} retirada (el hook cerró)`); } });
      if (AUTO) setTimeout(() => decideOldest(AUTO, 'auto'), AUTO_DELAY);
    });
    return json(200, result);
  }

  if (url.pathname === '/decide') {
    const d = url.searchParams.get('d');
    if (d !== 'allow' && d !== 'deny') return json(400, { error: 'd debe ser allow o deny' });
    return json(200, { applied: decideOldest(d, 'http') });
  }

  if (url.pathname === '/health') return json(200, { ok: true, console: CONSOLE_CONNECTED, pending: pending.size });
  json(404, { error: 'no existe' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[puente] escuchando en 127.0.0.1:${PORT} | consola=${CONSOLE_CONNECTED} auto=${AUTO ?? '-'} plazo=${BRIDGE_TIMEOUT}ms`);
  if (process.stdin.isTTY) {
    console.log('[puente] teclas: a = aprobar, b = rechazar, q = salir');
    process.stdin.setRawMode(true);
    process.stdin.on('data', k => {
      const c = k.toString();
      if (c === 'a') decideOldest('allow', 'tecla') || console.log('[puente] nada pendiente');
      if (c === 'b') decideOldest('deny', 'tecla') || console.log('[puente] nada pendiente');
      if (c === 'q' || c === '\u0003') process.exit(0);
    });
  }
});

#!/usr/bin/env node
// Hook PermissionRequest de Claude Code (prueba 0.8).
//
// Lee la solicitud por stdin, la envía al puente local y espera la decisión.
// Regla única: ante cualquier duda (puente apagado, sin consola, plazo vencido, respuesta rara)
// no imprime nada y sale con 0, para que Claude Code muestre su diálogo normal en el terminal.
//
// Variables de entorno:
//   BRIDGE_URL     http://127.0.0.1:33335
//   HOOK_DEADLINE  ms máximos que espera al puente (50000). Debe ser menor que el "timeout" del hook en settings.

const BRIDGE_URL = process.env.BRIDGE_URL ?? 'http://127.0.0.1:33335';
const HOOK_DEADLINE = +(process.env.HOOK_DEADLINE ?? 50000);

function readStdin() {
  return new Promise(resolve => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => (data += c));
    process.stdin.on('end', () => resolve(data));
  });
}

function emit(decision) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }));
}

try {
  const input = JSON.parse(await readStdin());
  const res = await fetch(`${BRIDGE_URL}/permission`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      session_id: input.session_id,
      cwd: input.cwd,
      tool_name: input.tool_name,
      tool_input: input.tool_input,
    }),
    signal: AbortSignal.timeout(HOOK_DEADLINE),
  });
  if (res.ok) {
    const { decision } = await res.json();
    if (decision === 'allow') emit({ behavior: 'allow' });
    else if (decision === 'deny') emit({ behavior: 'deny', message: 'Rechazado desde la 3DS' });
    // "ask" o cualquier otra cosa: sin salida, decide el terminal.
  }
} catch {
  // Puente apagado, plazo vencido o entrada inválida: sin salida, decide el terminal.
}
process.exit(0);

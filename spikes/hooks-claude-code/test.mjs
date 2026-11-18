// Prueba automática del hook contra el puente simulado. Ejecutar: node spikes/hooks-claude-code/test.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = JSON.stringify({
  session_id: 'prueba', cwd: 'C:/proyecto', permission_mode: 'default', hook_event_name: 'PermissionRequest',
  tool_name: 'Bash', tool_input: { command: 'npm install sharp' },
});

async function startBridge(port, env) {
  const p = spawn(process.execPath, [path.join(dir, 'mock-bridge.mjs')], { env: { ...process.env, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  let log = '';
  p.stdout.on('data', d => (log += d));
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  return { stop: () => p.kill(), log: () => log };
}

function runHook(port, env = {}) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [path.join(dir, 'permission-hook.mjs')], { env: { ...process.env, BRIDGE_URL: `http://127.0.0.1:${port}`, ...env } });
    let out = '';
    p.stdout.on('data', d => (out += d));
    p.on('close', code => resolve({ code, out, ms: Date.now() - t0 }));
    p.stdin.end(SAMPLE);
  });
}

const behavior = out => (out ? JSON.parse(out).hookSpecificOutput.decision.behavior : null);
const CASES = [
  { name: 'aprobado en la consola',        bridge: { AUTO: 'allow' },            expect: 'allow' },
  { name: 'rechazado en la consola',       bridge: { AUTO: 'deny' },             expect: 'deny' },
  { name: 'sin consola conectada',         bridge: { CONSOLE: '0' },             expect: null, maxMs: 1500 },
  { name: 'puente apagado',                bridge: null,                         expect: null, maxMs: 3000 },
  { name: 'nadie responde (plazo puente)', bridge: { BRIDGE_TIMEOUT: '300' },    expect: null, maxMs: 2500 },
  { name: 'nadie responde (plazo hook)',   bridge: {}, hook: { HOOK_DEADLINE: '300' }, expect: null, maxMs: 2500, logHas: 'retirada' },
];

let failed = 0, port = 33400;
for (const c of CASES) {
  port++;
  const bridge = c.bridge ? await startBridge(port, c.bridge) : null;
  const r = await runHook(port, c.hook);
  await new Promise(res => setTimeout(res, 150));
  const got = behavior(r.out);
  const problems = [];
  if (r.code !== 0) problems.push(`código de salida ${r.code}`);
  if (got !== c.expect) problems.push(`decisión ${got}, se esperaba ${c.expect}`);
  if (c.maxMs && r.ms > c.maxMs) problems.push(`tardó ${r.ms} ms (máximo ${c.maxMs})`);
  if (c.logHas && !bridge.log().includes(c.logHas)) problems.push(`el puente no registró "${c.logHas}"`);
  bridge?.stop();
  if (problems.length) failed++;
  console.log(`${problems.length ? 'FALLA' : 'OK   '} ${c.name.padEnd(32)} ${String(r.ms).padStart(5)} ms  ${got ?? 'sin salida (decide el terminal)'}${problems.length ? '  <- ' + problems.join('; ') : ''}`);
}
console.log(failed ? `\n${failed} caso(s) fallaron` : '\nTodos los casos pasaron');
process.exit(failed ? 1 : 0);

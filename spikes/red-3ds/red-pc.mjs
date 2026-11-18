// Lado PC de las pruebas 0.3 a 0.6. Uso: node red-pc.mjs <IP de la consola> [segundos]
//
//   - Se conecta a la consola (TCP 33334), envía pings y mide el tiempo de ida y vuelta.
//   - Se reconecta solo y registra cuánto duró cada corte (prueba de reposo).
//   - Emite avisos UDP por difusión cada 2 s (puerto 33333) desde la interfaz de la Wi-Fi.
//   - Escucha en TCP 33336 la conexión inversa (consola -> PC).
//   - Guarda el audio del micrófono como WAV.
import net from 'node:net';
import dgram from 'node:dgram';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.argv[2];
const SECONDS = +(process.argv[3] ?? 300);
if (!HOST) { console.error('Falta la IP de la consola'); process.exit(2); }
const T0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
const F = { TEXT: 1, AUDIO: 2, PING: 3, PONG: 4 };
const MIC_RATE = 16364;

// Interfaz del PC que comparte red con la consola
const prefix = HOST.split('.').slice(0, 3).join('.');
const local = Object.values(os.networkInterfaces()).flat().find(i => i.family === 'IPv4' && i.address.startsWith(prefix + '.'));
log(`consola ${HOST} | interfaz local ${local?.address ?? 'no encontrada'}`);

// ---- avisos UDP ----
const udp = dgram.createSocket('udp4');
udp.bind(0, local?.address, () => {
  udp.setBroadcast(true);
  const beacon = Buffer.from(JSON.stringify({ service: '3ds-agent-companion', port: 33334 }));
  setInterval(() => { udp.send(beacon, 33333, `${prefix}.255`); udp.send(beacon, 33333, '255.255.255.255'); }, 2000);
});

// ---- conexión inversa ----
const inbound = net.createServer(s => {
  log(`CONEXION INVERSA recibida desde ${s.remoteAddress}`);
  s.on('data', d => log(`  texto inverso: ${d.subarray(3).toString()}`));
  s.on('error', () => {});
});
inbound.on('error', e => log(`no se pudo escuchar en 33336: ${e.message}`));
inbound.listen(33336, '0.0.0.0', () => log('escuchando conexión inversa en 33336'));

// ---- conexión principal PC -> consola ----
let sock = null, rx = Buffer.alloc(0), rtts = [], audio = [], recN = 0, lostAt = null, everConnected = false, pingTimer = null;
const frame = (type, payload) => { const h = Buffer.alloc(3); h[0] = type; h.writeUInt16LE(payload.length, 1); return Buffer.concat([h, payload]); };

function saveWav() {
  const pcm = Buffer.concat(audio); audio = [];
  if (!pcm.length) return log('micrófono: no llegó audio');
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(MIC_RATE, 24); h.writeUInt32LE(MIC_RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  const file = path.join(dir, `grabacion-${++recN}.wav`);
  fs.writeFileSync(file, Buffer.concat([h, pcm]));
  let peak = 0; for (let i = 0; i + 1 < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
  log(`MICROFONO: ${pcm.length} bytes = ${(pcm.length / 2 / MIC_RATE).toFixed(2)} s, pico ${(peak / 327.68).toFixed(0)}% -> ${path.basename(file)}`);
}

function onFrame(type, payload) {
  if (type === F.PONG) {
    const ms = Number(process.hrtime.bigint() - payload.readBigUInt64LE(0)) / 1e6;
    rtts.push(ms);
    if (rtts.length % 20 === 0) {
      const last = rtts.slice(-20);
      log(`pings ${rtts.length}: últimos 20 -> mín ${Math.min(...last).toFixed(1)} ms, medio ${(last.reduce((a, b) => a + b) / 20).toFixed(1)} ms, máx ${Math.max(...last).toFixed(1)} ms`);
    }
  } else if (type === F.AUDIO) audio.push(Buffer.from(payload));
  else if (type === F.TEXT) { const t = payload.toString(); if (t.startsWith('mic_end')) { log(`fin de grabación (${t})`); saveWav(); } else log(`texto: ${t}`); }
}

function connect() {
  const s = net.connect({ host: HOST, port: 33334, timeout: 3000 });
  s.setNoDelay(true);
  s.on('connect', () => {
    s.setTimeout(0); sock = s; rx = Buffer.alloc(0);
    if (lostAt) log(`RECONECTADO tras ${((Date.now() - lostAt) / 1000).toFixed(1)} s sin conexión`); else log('CONECTADO a la consola');
    lostAt = null; everConnected = true;
    s.write(frame(F.TEXT, Buffer.from('hola desde el PC')));
    pingTimer = setInterval(() => { const p = Buffer.alloc(8); p.writeBigUInt64LE(process.hrtime.bigint()); s.write(frame(F.PING, p)); }, 500);
  });
  s.on('data', d => {
    rx = Buffer.concat([rx, d]);
    while (rx.length >= 3) { const len = rx.readUInt16LE(1); if (rx.length < 3 + len) break; onFrame(rx[0], rx.subarray(3, 3 + len)); rx = rx.subarray(3 + len); }
  });
  const down = why => {
    clearInterval(pingTimer); s.destroy();
    if (sock === s) { sock = null; lostAt = Date.now(); log(`CONEXION PERDIDA (${why})`); }
    setTimeout(connect, 1000);
  };
  let done = false; const once = why => { if (!done) { done = true; down(why); } };
  s.on('timeout', () => once('sin respuesta'));
  s.on('error', e => once(e.code ?? e.message));
  s.on('close', () => once('cerrada'));
}
connect();

// Si los pongs dejan de llegar 3 s (por ejemplo, la consola entró en reposo), se corta y se reintenta.
let lastCount = 0, stale = 0;
setInterval(() => { if (!sock) { stale = 0; return; } if (rtts.length === lastCount) { if (++stale >= 3) { stale = 0; sock.destroy(new Error('SIN_PONGS')); } } else stale = 0; lastCount = rtts.length; }, 1000);

setTimeout(() => {
  const r = rtts;
  log(r.length ? `RESUMEN: ${r.length} pings, mín ${Math.min(...r).toFixed(1)} ms, medio ${(r.reduce((a, b) => a + b) / r.length).toFixed(1)} ms, máx ${Math.max(...r).toFixed(1)} ms` : `RESUMEN: sin pings (${everConnected ? 'hubo conexión' : 'nunca conectó'})`);
  process.exit(0);
}, SECONDS * 1000);

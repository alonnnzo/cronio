// Genera assets/cronio.ico (16, 24, 32, 48, 64, 128 y 256 px) con el mismo dibujo del ícono de la bandeja.
// Uso, desde la raíz del repo:  node packages/installer/scripts/gen-ico.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crearIconoPng } from "../src/icon.ts";

const TAMANOS = [16, 24, 32, 48, 64, 128, 256];
const frames = TAMANOS.map((t) => ({ t, png: crearIconoPng(t) }));

const cabecera = Buffer.alloc(6);
cabecera.writeUInt16LE(1, 2); // tipo: ícono
cabecera.writeUInt16LE(frames.length, 4);
const entradas = Buffer.alloc(16 * frames.length);
let desplazamiento = cabecera.length + entradas.length;
frames.forEach(({ t, png }, i) => {
  const e = i * 16;
  entradas[e] = t === 256 ? 0 : t; // 0 significa 256
  entradas[e + 1] = t === 256 ? 0 : t;
  entradas.writeUInt16LE(1, e + 4); // planos
  entradas.writeUInt16LE(32, e + 6); // bits por píxel
  entradas.writeUInt32LE(png.length, e + 8);
  entradas.writeUInt32LE(desplazamiento, e + 12);
  desplazamiento += png.length;
});

const destino = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "cronio.ico");
mkdirSync(dirname(destino), { recursive: true });
writeFileSync(destino, Buffer.concat([cabecera, entradas, ...frames.map((f) => f.png)]));
console.log("escrito", destino, `(${TAMANOS.join(", ")})`);

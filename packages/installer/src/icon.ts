// Ícono de la bandeja, la ventana y el .ico (marca Cronio, docs/11-marca-cronio.md): el cuadrado naranja lleno, de
// borde a borde, con los dos ojos tinta y su brillo. Sin margen, sin borde claro y sin círculo.
// Se arma como PNG RGBA sin dependencias, con sobremuestreo para que quede nítido a 16 y 32 px.
import { deflateSync } from "node:zlib";

const NARANJA = [0xee, 0x74, 0x46] as const;
const TINTA = [0x12, 0x13, 0x1a] as const;
const BLANCO = [0xff, 0xff, 0xff] as const;
// variantes de la bandeja: gris (puente detenido) y el punto de «hay una versión nueva»
const GRIS = [0x9b, 0x9d, 0xa5] as const;
const GRIS_TINTA = [0x5a, 0x5c, 0x66] as const;
const PUNTO = [0x1f, 0x8e, 0xf1] as const;

export interface OpcionesIcono {
  /** Atenuado y en gris: el puente está detenido. */
  apagado?: boolean;
  /** Un punto pequeño arriba a la derecha: hay una versión nueva. */
  punto?: boolean;
}

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(datos: Buffer): number {
  let c = 0xffffffff;
  for (const b of datos) c = TABLA_CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function trozo(tipo: string, datos: Buffer): Buffer {
  const cabecera = Buffer.alloc(8);
  cabecera.writeUInt32BE(datos.length, 0);
  cabecera.write(tipo, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([cabecera.subarray(4), datos])), 0);
  return Buffer.concat([cabecera, datos, crc]);
}

type Color = readonly [number, number, number];

function mezclar(a: Color, b: Color, t: number): Color {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function enElipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean {
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
}

/** Color de un punto del ícono, con coordenadas en 0..100: naranja lleno, dos ojos tinta y un brillo blanco al 85 %. */
function muestra(x: number, y: number, o: OpcionesIcono): Color {
  const fondo = o.apagado ? GRIS : NARANJA;
  const tinta = o.apagado ? GRIS_TINTA : TINTA;
  let c: Color = fondo;
  if (enElipse(x, y, 34, 50, 11, 17) || enElipse(x, y, 66, 50, 11, 17)) {
    c = tinta;
    if (enElipse(x, y, 30, 43, 4, 4) || enElipse(x, y, 62, 43, 4, 4)) c = mezclar(tinta, BLANCO, 0.85);
  }
  if (o.punto) {
    // punto azul con un aro blanco para que se lea sobre el naranja y sobre el gris
    if (enElipse(x, y, 75, 25, 17, 17)) c = PUNTO;
    else if (enElipse(x, y, 75, 25, 22, 22)) c = BLANCO;
  }
  return c;
}

/** PNG de `tam`×`tam` píxeles: el ícono de Cronio a borde completo (con `opciones`, las variantes de la bandeja). */
export function crearIconoPng(tam: number, opciones: OpcionesIcono = {}): Buffer {
  const filas: Buffer[] = [];
  const sub = 4; // suavizado por sobremuestreo
  for (let py = 0; py < tam; py++) {
    const fila = Buffer.alloc(1 + tam * 4); // primer byte: filtro 0
    for (let px = 0; px < tam; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < sub; sy++) {
        for (let sx = 0; sx < sub; sx++) {
          const c = muestra(((px + (sx + 0.5) / sub) / tam) * 100, ((py + (sy + 0.5) / sub) / tam) * 100, opciones);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = sub * sub;
      const i = 1 + px * 4;
      fila[i] = Math.round(r / n);
      fila[i + 1] = Math.round(g / n);
      fila[i + 2] = Math.round(b / n);
      fila[i + 3] = 255;
    }
    filas.push(fila);
  }
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(tam, 0);
  cabecera.writeUInt32BE(tam, 4);
  cabecera[8] = 8; // bits por canal
  cabecera[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", cabecera),
    trozo("IDAT", deflateSync(Buffer.concat(filas))),
    trozo("IEND", Buffer.alloc(0)),
  ]);
}

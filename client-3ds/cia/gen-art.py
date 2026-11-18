#!/usr/bin/env python3
"""Genera el arte del menú HOME: icon.png (48x48), banner.png (256x128) y banner.wav (aviso corto).

Marca Cronio (docs/11-marca-cronio.md, opción 1 "La palabra es la cara"):
  - icon.png: el cuadrado naranja lleno, de borde a borde, con los dos ojos tinta y su brillo. Sin letras.
  - banner.png: el logo completo (CRONIO en Dela Gothic One, las dos O son los ojos). La letra no está disponible en
    Python puro, así que lo dibuja Electron (cia/banner.html + cia/gen-banner.cjs) desde node_modules del repo.
Solo usa la biblioteca estándar. Regenerar:  python cia/gen-art.py   (desde client-3ds)
"""
import math
import os
import struct
import subprocess
import wave
import zlib

AQUI = os.path.dirname(os.path.abspath(__file__))
NARANJA = (0xEE, 0x74, 0x46)
TINTA = (0x12, 0x13, 0x1A)
BLANCO = (0xFF, 0xFF, 0xFF)
SS = 8  # supersampling por eje para suavizar bordes


def mezclar(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def en_elipse(x, y, cx, cy, rx, ry):
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1


def pixel(x, y):
    """Color de un punto del ícono, con coordenadas 0..100: naranja lleno, dos ojos tinta y brillo blanco al 85 %."""
    col = NARANJA
    if en_elipse(x, y, 34, 50, 11, 17) or en_elipse(x, y, 66, 50, 11, 17):
        col = TINTA
        if en_elipse(x, y, 30, 43, 4, 4) or en_elipse(x, y, 62, 43, 4, 4):
            col = mezclar(TINTA, BLANCO, 0.85)
    return col


def render_icono(n):
    filas = []
    for j in range(n):
        fila = bytearray([0])  # filtro PNG: ninguno
        for i in range(n):
            acc = [0.0, 0.0, 0.0]
            for sj in range(SS):
                for si in range(SS):
                    c = pixel((i + (si + 0.5) / SS) / n * 100, (j + (sj + 0.5) / SS) / n * 100)
                    for k in range(3):
                        acc[k] += c[k]
            fila += bytes(int(round(v / (SS * SS))) for v in acc)
        filas.append(bytes(fila))
    return b"".join(filas)


def png(ruta, w, h, datos):
    def trozo(tipo, cuerpo):
        c = struct.pack(">I", len(cuerpo)) + tipo + cuerpo
        return c + struct.pack(">I", zlib.crc32(tipo + cuerpo) & 0xFFFFFFFF)

    cab = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    with open(ruta, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + trozo(b"IHDR", cab) + trozo(b"IDAT", zlib.compress(datos, 9)) + trozo(b"IEND", b""))


def banner():
    """Pide a Electron que dibuje banner.html (con Dela Gothic One) y guarde banner.png."""
    raiz = os.path.dirname(os.path.dirname(AQUI))
    electron = os.path.join(raiz, "node_modules", "electron", "dist", "electron.exe" if os.name == "nt" else "electron")
    if not os.path.exists(electron):
        print("AVISO: no hay Electron (npm install); banner.png queda como estaba")
        return
    subprocess.run([electron, os.path.join(AQUI, "gen-banner.cjs")], check=True)


def aviso(ruta):
    """Dos notas suaves (~1,3 s), mono, 16 bits, 32 kHz."""
    fs = 32000
    notas = [(659.25, 0.00, 0.55), (880.0, 0.22, 0.80)]  # mi5, la5
    n = int(fs * 1.3)
    out = []
    for i in range(n):
        t = i / fs
        v = 0.0
        for f, ini, dur in notas:
            u = t - ini
            if 0 <= u < dur:
                env = min(1.0, u / 0.01) * math.exp(-u * 4.5)
                v += env * (math.sin(2 * math.pi * f * u) + 0.25 * math.sin(4 * math.pi * f * u))
        out.append(int(max(-1.0, min(1.0, v * 0.35)) * 32767))
    with wave.open(ruta, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(fs)
        w.writeframes(struct.pack("<%dh" % len(out), *out))


if __name__ == "__main__":
    png(os.path.join(AQUI, "icon.png"), 48, 48, render_icono(48))
    banner()
    aviso(os.path.join(AQUI, "banner.wav"))
    print("arte generado en", AQUI)

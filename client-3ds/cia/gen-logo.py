"""Genera el logo de arranque de Cronio: cia/logo/cronio_logo-padded.lz11 (makerom -logo).

Es la pantalla que muestra el menú HOME al abrir la app (hoy, la de "Homebrew"). Pasos, como buildlogo.sh de
yellows8/ctr-logobuilder:
  1. Electron dibuja las texturas (logo.html + gen-logo.cjs): blanco con transparencia, una por pantalla.
  2. Se convierten a BCLIM A4 (el único formato que usa este logo; misma conversión que yellows8/ctr-gputextool).
  3. ctr-logobuilder escribe el diseño y la animación, darctool arma el darc, se le agrega el HMAC-SHA256,
     bannertool lo comprime (LZ11) y se rellena a 8 KB.

El HMAC usa una clave del menú HOME que no está en el repo. Si existe ~/.3ds/logo_hmackey_text (64 hex) se usa; si
no, va una clave de ceros y la consola puede rechazar el logo (la app no abriría desde HOME).

Herramientas en C:/devkitPro/tools/logo (o LOGO_TOOLS=<carpeta>): ctr-logobuilder/ctr-logobuilder.exe y
darctool/darctool.exe compilados con el gcc de devkitPro (darctool con shim/iconv.h). Uso, desde la raíz del repo:
    python client-3ds/cia/gen-logo.py
"""
import hashlib
import hmac
import os
import shutil
import struct
import subprocess
import sys

from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(AQUI, "..", ".."))
SALIDA = os.path.join(AQUI, "logo")
HERR = os.environ.get("LOGO_TOOLS", "C:/devkitPro/tools/logo")
BANNERTOOL = os.environ.get("BANNERTOOL", "C:/devkitPro/tools/bin/bannertool.exe")

# ancho, alto, x, y, z de cada textura en su pantalla (las del logo de Homebrew: abajo "128,64,0,-120,0")
COORD_ABAJO = "128,64,0,-120,0"
COORD_ARRIBA = "128,64,0,0,0"

ORDEN = [0, 1, 8, 9, 2, 3, 10, 11, 16, 17, 24, 25, 18, 19, 26, 27,
         4, 5, 12, 13, 6, 7, 14, 15, 20, 21, 28, 29, 22, 23, 30, 31,
         32, 33, 40, 41, 34, 35, 42, 43, 48, 49, 56, 57, 50, 51, 58, 59,
         36, 37, 44, 45, 38, 39, 46, 47, 52, 53, 60, 61, 54, 55, 62, 63]


def bclim_a4(png, destino):
    im = Image.open(png).convert("RGBA")
    w, h = im.size
    assert w % 8 == 0 and h % 8 == 0, "el ancho y el alto deben ser múltiplos de 8"
    a = im.getchannel("A").load()
    datos = bytearray(w * h // 2)
    pos = 0
    for y in range(0, h, 8):
        for x in range(0, w, 8):
            for i, t in enumerate(ORDEN):
                v = a[x + (t & 7), y + (t >> 3)] >> 4
                datos[pos] |= v << (4 * (i & 1))
                if i & 1:
                    pos += 1
    total = len(datos) + 0x28
    clim = struct.pack("<4sHHIIII", b"CLIM", 0xFEFF, 0x14, 0x2020000, total, 1, 0)[:0x14]
    imag = struct.pack("<4sIHHII", b"imag", 0x10, w, h, 0xD, len(datos))
    with open(destino, "wb") as f:
        f.write(bytes(datos) + clim + imag)


def clave():
    ruta = os.path.join(os.path.expanduser("~"), ".3ds", "logo_hmackey_text")
    if os.path.exists(ruta):
        with open(ruta, encoding="ascii") as f:
            return bytes.fromhex(f.read().strip())
    print("AVISO: sin ~/.3ds/logo_hmackey_text; el HMAC va con clave de ceros (la consola puede rechazarlo)")
    return bytes(32)


def main():
    electron = os.path.join(RAIZ, "node_modules", "electron", "dist", "electron.exe")
    subprocess.run([electron, os.path.join(AQUI, "gen-logo.cjs")], check=True)

    darc = os.path.join(SALIDA, "darc")
    shutil.rmtree(darc, ignore_errors=True)
    for d in ("anim", "blyt", "timg"):
        os.makedirs(os.path.join(darc, d))
    bclim_a4(os.path.join(SALIDA, "abajo.png"), os.path.join(darc, "timg", "hblogo_bottom.bclim"))
    bclim_a4(os.path.join(SALIDA, "arriba.png"), os.path.join(darc, "timg", "hblogo_top.bclim"))

    subprocess.run([os.path.join(HERR, "ctr-logobuilder", "ctr-logobuilder.exe"), f"--dirpath={darc}",
                    "--bottomtex=hblogo_bottom.bclim", "--toptex=hblogo_top.bclim",
                    f"--bottomtexcoords={COORD_ABAJO}", f"--toptexcoords={COORD_ARRIBA}"], check=True)
    binario = os.path.join(SALIDA, "cronio_logo.bin")
    subprocess.run([os.path.join(HERR, "darctool", "darctool.exe"), "--build", binario, darc], check=True)
    with open(binario, "rb") as f:
        cuerpo = f.read()
    with open(binario, "wb") as f:
        f.write(cuerpo + hmac.new(clave(), cuerpo, hashlib.sha256).digest())

    lz = os.path.join(SALIDA, "cronio_logo.lz11")
    subprocess.run([BANNERTOOL, "lz11", "-i", binario, "-o", lz], check=True)
    with open(lz, "rb") as f:
        comprimido = f.read()
    if len(comprimido) > 0x2000:
        sys.exit(f"el logo comprimido pesa {len(comprimido)} bytes; el máximo es 8192")
    with open(os.path.join(SALIDA, "cronio_logo-padded.lz11"), "wb") as f:
        f.write(comprimido + bytes(0x2000 - len(comprimido)))
    print(f"logo listo: {len(comprimido)} bytes comprimidos (máximo 8192)")


if __name__ == "__main__":
    main()

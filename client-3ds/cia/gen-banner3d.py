"""Genera el banner 3D del menú HOME: cia/banner3d/banner.cgfx (lo usa `make cia` con bannertool -ci).

Pasos:
  1. Electron dibuja las texturas (banner3d.html + gen-banner3d.cjs) -> cia/banner3d/*.png + medidas.json.
  2. Este script arma una escena glTF con capas a distinta profundidad, que es lo que la 3DS muestra en 3D:
       fondo plateado con rayitas   z = -6   (detrás de la pantalla)
       sombra naranja oscura        z = -0.8 (relieve de la placa)
       placa naranja con «CR NI»    z =  0   (en la pantalla)
       los dos ojos                 z = +2.5 (salen hacia afuera)
     Animación de nodos rígidos (sin piel/huesos, que congela el menú HOME en la consola real): la placa flota
     despacio y los ojos parpadean cada 4 s.
  3. pycgfx (skyfloogle/pycgfx, MIT) lo convierte a CGFX. Se le cambia el sombreado para que los colores salgan
     planos, sin luz ni brillo: la marca usa colores exactos.

Requiere: Python 3.11+, `pip install gltflib pillow`, pycgfx en C:/devkitPro/tools/pycgfx (o PYCGFX=<carpeta>) e
internet para la letra Dela Gothic One. Uso, desde la raíz del repo:  python client-3ds/cia/gen-banner3d.py
"""
import base64
import json
import math
import os
import struct
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(AQUI, "..", ".."))
SALIDA = os.path.join(AQUI, "banner3d")
PYCGFX = os.environ.get("PYCGFX", "C:/devkitPro/tools/pycgfx")

# Cámara del banner (pycgfx/banner-camera.gltf): en (0, 1, 44.786), fov vertical 30°, 400x240. En z = 0 se ven
# 40 x 24 unidades: 1 unidad = 10 px de la pantalla de arriba.
CAM_Z = 44.786
CAM_Y = 1.0

Z_FONDO, Z_SOMBRA, Z_PLACA, Z_OJOS = -6.0, -0.8, 0.0, 2.5
ANCHO_PLACA = 30.0      # unidades (300 px de 400)
Y_PLACA = 1.3           # centro de la placa
SOMBRA_DY = -0.55       # la sombra asoma por abajo
FLOTA = 0.35            # cuánto sube la placa al flotar
CICLO = 4.0             # segundos del ciclo (flotar y parpadear)


def texturas():
    electron = os.path.join(RAIZ, "node_modules", "electron", "dist", "electron.exe")
    if not os.path.exists(electron):
        electron = os.path.join(RAIZ, "node_modules", ".bin", "electron")
    subprocess.run([electron, os.path.join(AQUI, "gen-banner3d.cjs")], check=True)
    with open(os.path.join(SALIDA, "medidas.json"), encoding="utf-8") as f:
        return json.load(f)


class Gltf:
    def __init__(self):
        self.bin = bytearray()
        self.d = {"asset": {"version": "2.0", "generator": "Cronio gen-banner3d.py"}, "scene": 0,
                  "scenes": [{"nodes": []}], "nodes": [], "meshes": [], "materials": [], "textures": [],
                  "images": [], "samplers": [{"magFilter": 9729, "minFilter": 9729, "wrapS": 33071, "wrapT": 33071}],
                  "accessors": [], "bufferViews": [], "buffers": [], "animations": []}

    def _vista(self, datos, objetivo=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        vista = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(datos)}
        if objetivo:
            vista["target"] = objetivo
        self.bin += datos
        self.d["bufferViews"].append(vista)
        return len(self.d["bufferViews"]) - 1

    def acc(self, valores, tipo, comp=5126, objetivo=None, minmax=False):
        n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[tipo]
        fmt = {5126: "f", 5123: "H"}[comp]
        plano = [v for fila in valores for v in (fila if isinstance(fila, (list, tuple)) else [fila])]
        a = {"bufferView": self._vista(struct.pack("<%d%s" % (len(plano), fmt), *plano), objetivo),
             "componentType": comp, "count": len(plano) // n, "type": tipo}
        if minmax:
            filas = [plano[i:i + n] for i in range(0, len(plano), n)]
            a["min"] = [min(c) for c in zip(*filas)]
            a["max"] = [max(c) for c in zip(*filas)]
        self.d["accessors"].append(a)
        return len(self.d["accessors"]) - 1

    def material(self, nombre, png, mezcla):
        with open(os.path.join(SALIDA, png), "rb") as f:
            datos = f.read()
        self.d["images"].append({"name": nombre, "mimeType": "image/png", "bufferView": self._vista(datos)})
        self.d["textures"].append({"sampler": 0, "source": len(self.d["images"]) - 1})
        self.d["materials"].append({"name": nombre, "alphaMode": "BLEND" if mezcla else "OPAQUE",
                                    "pbrMetallicRoughness": {"baseColorTexture": {"index": len(self.d["textures"]) - 1},
                                                             "metallicFactor": 0, "roughnessFactor": 1}})
        return len(self.d["materials"]) - 1

    def cuadro(self, nombre, ancho, alto, material):
        """Rectángulo centrado en el origen del nodo, mirando a la cámara (+z)."""
        w, h = ancho / 2, alto / 2
        pos = self.acc([(-w, -h, 0), (w, -h, 0), (w, h, 0), (-w, h, 0)], "VEC3", objetivo=34962, minmax=True)
        nor = self.acc([(0, 0, 1)] * 4, "VEC3", objetivo=34962)
        uv = self.acc([(0, 1), (1, 1), (1, 0), (0, 0)], "VEC2", objetivo=34962)
        ind = self.acc([0, 1, 2, 0, 2, 3], "SCALAR", comp=5123, objetivo=34963)
        self.d["meshes"].append({"name": nombre, "primitives": [
            {"attributes": {"POSITION": pos, "NORMAL": nor, "TEXCOORD_0": uv}, "indices": ind, "material": material}]})
        return len(self.d["meshes"]) - 1

    def nodo(self, nombre, malla=None, t=(0, 0, 0), hijos=None, raiz=False):
        n = {"name": nombre, "translation": list(t)}
        if malla is not None:
            n["mesh"] = malla
        if hijos:
            n["children"] = hijos
        self.d["nodes"].append(n)
        i = len(self.d["nodes"]) - 1
        if raiz:
            self.d["scenes"][0]["nodes"].append(i)
        return i

    def animar(self, nodo, ruta, tiempos, valores, tipo):
        entrada = self.acc(tiempos, "SCALAR", minmax=True)
        salida = self.acc(valores, tipo)
        if not self.d["animations"]:
            self.d["animations"].append({"name": "COMMON", "samplers": [], "channels": []})
        a = self.d["animations"][0]
        a["samplers"].append({"input": entrada, "output": salida, "interpolation": "LINEAR"})
        a["channels"].append({"sampler": len(a["samplers"]) - 1, "target": {"node": nodo, "path": ruta}})

    def guardar(self, ruta):
        self.d["buffers"] = [{"byteLength": len(self.bin),
                              "uri": "data:application/octet-stream;base64," + base64.b64encode(bytes(self.bin)).decode()}]
        with open(ruta, "w", encoding="utf-8") as f:
            json.dump(self.d, f)


def escena(m):
    g = Gltf()
    esc = ANCHO_PLACA / m["W"]                     # unidades por px de la textura de trabajo
    alto_placa = m["H"] * esc

    # Lo que está más cerca de la cámara se ve más grande: los ojos se achican para calzar con los huecos de la placa.
    k = (CAM_Z - Z_OJOS) / CAM_Z
    ojo_w, ojo_h = m["ojoW"] * esc * k, m["ojoH"] * esc * k

    def x_placa(px):
        return (px - m["W"] / 2) * esc

    y_ojos_placa = (m["H"] / 2 - m["yMedio"]) * esc  # respecto al centro de la placa

    fondo = g.nodo("fondo", g.cuadro("fondo", 48, 29, g.material("fondo", "fondo.png", False)),
                   t=(0, CAM_Y, Z_FONDO), raiz=True)
    sombra = g.nodo("sombra", g.cuadro("sombra", ANCHO_PLACA, alto_placa, g.material("sombra", "sombra.png", True)),
                    t=(0, SOMBRA_DY, Z_SOMBRA - Z_PLACA))
    placa = g.nodo("placa", g.cuadro("placa", ANCHO_PLACA, alto_placa, g.material("placa", "placa.png", True)))
    mat_ojo = g.material("ojo", "ojo.png", True)
    malla_ojo = g.cuadro("ojo", ojo_w, ojo_h, mat_ojo)
    ojos = []
    for nombre, px in (("ojo_izq", m["ojo1"]), ("ojo_der", m["ojo2"])):
        # posición vista desde la cámara: se acerca al eje para que el ojo caiga en su hueco
        x = x_placa(px) * k
        y = (Y_PLACA + y_ojos_placa - CAM_Y) * k + CAM_Y - Y_PLACA
        ojos.append(g.nodo(nombre, malla_ojo, t=(x, y, Z_OJOS - Z_PLACA)))
    logo = g.nodo("logo", t=(0, Y_PLACA, Z_PLACA), hijos=[sombra, placa] + ojos, raiz=True)

    # flotar: sube y baja con una curva suave (muestreada)
    pasos = 16
    tiempos = [CICLO * i / pasos for i in range(pasos + 1)]
    g.animar(logo, "translation", tiempos,
             [(0, Y_PLACA + FLOTA * (1 - math.cos(2 * math.pi * t / CICLO)) / 2, Z_PLACA) for t in tiempos], "VEC3")
    # parpadeo: los ojos se aplastan un instante al final del ciclo
    tp = [0, 3.30, 3.42, 3.54, CICLO]
    for o in ojos:
        g.animar(o, "scale", tp, [(1, 1, 1), (1, 1, 1), (1, 0.1, 1), (1, 1, 1), (1, 1, 1)], "VEC3")

    ruta = os.path.join(SALIDA, "banner.gltf")
    g.guardar(ruta)
    return ruta


def a_cgfx(gltf, cgfx):
    """Corre pycgfx con los colores planos (sin multiplicar por la luz ni sumar brillo)."""
    with open(os.path.join(PYCGFX, "main.py"), encoding="utf-8") as f:
        fuente = f.read()
    cambios = [
        ("texture_combiners[1].src_rgb = 0x0F1", "texture_combiners[1].src_rgb = 0x00F"),
        ("texture_combiners[1].combine_rgb = 1", "texture_combiners[1].combine_rgb = 0"),
        ("texture_combiners[2].src_rgb = 0xFE2", "texture_combiners[2].src_rgb = 0x00F"),
        ("texture_combiners[2].combine_rgb = 8", "texture_combiners[2].combine_rgb = 0"),
    ]
    for viejo, nuevo in cambios:
        if viejo not in fuente:
            sys.exit(f"pycgfx cambió: no encuentro «{viejo}». Revisa a_cgfx() en gen-banner3d.py.")
        fuente = fuente.replace(viejo, nuevo)
    sys.path.insert(0, PYCGFX)
    sys.argv = ["pycgfx", gltf, cgfx]
    espacio = {"__name__": "__main__", "__file__": os.path.join(PYCGFX, "main.py")}
    exec(compile(fuente, "pycgfx/main.py (colores planos)", "exec"), espacio)
    tam = os.path.getsize(cgfx)
    print(f"banner.cgfx: {tam // 1024} KB (máximo de la 3DS: 512 KB)")
    if tam > 512 * 1024:
        sys.exit("banner.cgfx pasa de 512 KB")


if __name__ == "__main__":
    medidas = texturas()
    a_cgfx(escena(medidas), os.path.join(SALIDA, "banner.cgfx"))

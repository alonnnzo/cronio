"""Banners 3D de prueba para el menú HOME (v2): genera el .cgfx de las variantes B, C, D y E del logo de Cronio.

Diseño: SOLO el rectángulo del logo (la placa naranja redondeada con «CR NI» y las dos O como ojos), sin fondo: lo que no es
logo no se dibuja, así que se ve el fondo propio del menú HOME.

Contexto: el banner de gen-banner3d.py congeló el menú HOME de una New 3DS XL. El reporte público
https://github.com/skyfloogle/pycgfx/issues/2 describe la causa más probable y los arreglos, que aplica este script
SIN modificar el clon de pycgfx (se carga el main.py, se le parchan los combinadores y se le cambian clases en memoria):

  1. Alineación a 128 bytes. pycgfx alinea el bloque IMAG a 16. Aquí el contenido de IMAG y cada textura empiezan en
     múltiplos de 128 (StringTable128 reemplaza a StringTable). Al terminar se LEE el .cgfx y se imprime el offset % 128
     de cada textura; el script falla si alguno no es 0.
  2. Billboard. Todos los huesos (menos el raíz) con modo ScreenViewpoint (4) y las banderas IsLocalMatrixCalculate
     (0x80) e IsWorldMatrixCalculate (0x100); cada malla es hija directa de la raíz (jerarquía plana).
  3. Sin alfa. Ninguna textura lleva canal alfa (RGBA4 sale con bandas): las esquinas redondeadas de la placa y los óvalos
     de los ojos están en la GEOMETRÍA (abanicos de triángulos: esquinas de 8 segmentos, ojos de 24 lados) y las texturas
     son RGB8 opacas. Los bordes salen nítidos y el naranja limpio.
  4. Colores planos (sin luz ni brillo), como en gen-banner3d.py.

Variantes (la A es el banner plano de siempre y no pasa por aquí):
  b  solo la placa con el logo completo en UNA textura (letras y ojos), estática, centrada, 77,5 % del ancho visible.
  c  el logo en capas: sombra (z -0,8), placa con las letras (z 0) y dos ojos con brillo (z +2,5); sin animación.
     Vértices en espacio de escena, huesos en el origen, sin transformación (la regla del reporte).
  d  como c, con animación rígida SOLO de escala: parpadeo de los ojos (escala Y, ~4 s) y «respirar» de la placa
     (1 -> 1,03 -> 1). Como la escala pivota en el origen del hueso, el logo se coloca de modo que los ojos queden en
     y = 0 y la escala Y no los mueva.
  e  como d más lo que el reporte marca como riesgoso: cada pieza con su hueso trasladado a su propio centro (pivote
     propio, malla definida alrededor del centro), un saltito de la placa entera (traslación Y, cada 6 s) y los ojos
     mirando a un lado y al otro (traslación X). Ciclo de 12 s. Si en la consola gira o se deforma, hay que quedarse con D.

Uso:  python gen-banner3d-v2.py <b|c|d|e> <salida.cgfx>   (deja también <salida>.png: vista previa de frente)
Las texturas salen de cia/banner3d/*.png (hechas por gen-banner3d.cjs); con --texturas se redibujan antes con Electron.
Requiere Python 3.11+, `pip install gltflib pillow numpy` y pycgfx en C:/devkitPro/tools/pycgfx (o PYCGFX=<carpeta>).
"""
import base64
import importlib.util
import json
import math
import os
import struct
import subprocess
import sys
import tempfile

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(AQUI, "..", ".."))
TEXTURAS = os.path.join(AQUI, "banner3d")
PYCGFX = os.environ.get("PYCGFX", "C:/devkitPro/tools/pycgfx")

# Cámara del banner (pycgfx/banner-camera.gltf): en (0, 1, 44.786), fov vertical 30°, 400x240. En z = 0 se ven
# 40 x 24 unidades (1 unidad = 10 px de la pantalla de arriba).
CAM_Z, CAM_Y = 44.786, 1.0
Z_SOMBRA, Z_PLACA, Z_OJOS = -0.8, 0.0, 2.5
ANCHO_PLACA = 31.0     # 77,5 % de los 40 que se ven en z = 0
SOMBRA_DY = -0.55
SEG_ESQUINA = 8        # segmentos por esquina redondeada de la placa
LADOS_OJO = 24
RESPIRO = 0.03         # la placa crece 3 % a mitad del ciclo (D y E)
BORDE_TEXTURA = 27.0   # radio de las esquinas de la placa en el espacio de trabajo de banner3d.html (0,27 · cuerpo 100)

# Todas las texturas RGB8 (sin alfa). RGBA8 no: «roto en el menú HOME» según pycgfx. RGBA4 sale con bandas.
FORMATOS = {"logo": "RGB8", "placa": "RGB8", "sombra": "RGB8", "ojo": "RGB8"}
INTA = (18, 19, 26)    # #12131a, el color de tinta de la marca
SOMBRA_RGB = (168, 72, 31)  # #a8481f


# ----------------------------------------------------------------------------------------------------- texturas
def preparar_texturas(carpeta):
    """Aplana los .png con alfa de banner3d/ a RGB opaco (lo transparente lo recorta la geometría) y compone el logo
    completo (placa + ojos) para B. Deja logo.png, placa.png, sombra.png y ojo.png en `carpeta`. Devuelve las medidas."""
    from PIL import Image
    with open(os.path.join(TEXTURAS, "medidas.json"), encoding="utf-8") as f:
        m = json.load(f)

    def extender_filas(im):
        """RGBA -> RGB: lo no opaco de cada fila toma el color del píxel opaco más cercano de esa fila."""
        px = im.convert("RGBA").load()
        w, h = im.size
        sal = Image.new("RGB", (w, h))
        so = sal.load()
        for y in range(h):
            opacos = [x for x in range(w) if px[x, y][3] == 255]
            for x in range(w):
                if px[x, y][3] == 255:
                    so[x, y] = px[x, y][:3]
                else:
                    cerca = min(opacos, key=lambda o: abs(o - x))
                    so[x, y] = px[cerca, y][:3]
        return sal

    placa = extender_filas(Image.open(os.path.join(TEXTURAS, "placa.png")))
    placa.save(os.path.join(carpeta, "placa.png"))
    ojo_rgba = Image.open(os.path.join(TEXTURAS, "ojo.png")).convert("RGBA")
    ojo = Image.alpha_composite(Image.new("RGBA", ojo_rgba.size, INTA + (255,)), ojo_rgba).convert("RGB")
    ojo.save(os.path.join(carpeta, "ojo.png"))
    Image.new("RGB", (8, 8), SOMBRA_RGB).save(os.path.join(carpeta, "sombra.png"))

    # logo completo: los dos ojos pegados en la placa (el mismo cálculo de posiciones que usa la escena en capas)
    logo = placa.copy().convert("RGBA")
    ew, eh = round(m["ojoW"] * 256 / m["W"]), round(m["ojoH"] * 128 / m["H"])
    chico = ojo_rgba.resize((ew, eh), Image.LANCZOS)
    for px_ojo in (m["ojo1"], m["ojo2"]):
        cx, cy = px_ojo * 256 / m["W"], m["yMedio"] * 128 / m["H"]
        logo.alpha_composite(chico, (round(cx - ew / 2), round(cy - eh / 2)))
    logo.convert("RGB").save(os.path.join(carpeta, "logo.png"))
    return m


# ----------------------------------------------------------------------------------------------------- glTF
def contorno_redondeado(w, h, r, seg):
    """Puntos (antihorario) del contorno de un rectángulo w x h con esquinas de radio r, centrado en el origen."""
    pts = []
    for (cx, cy, a0) in ((w / 2 - r, h / 2 - r, 0), (-(w / 2 - r), h / 2 - r, 90),
                         (-(w / 2 - r), -(h / 2 - r), 180), (w / 2 - r, -(h / 2 - r), 270)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def contorno_ovalo(w, h, lados):
    return [(w / 2 * math.cos(2 * math.pi * i / lados), h / 2 * math.sin(2 * math.pi * i / lados)) for i in range(lados)]


class Gltf:
    def __init__(self):
        self.bin = bytearray()
        self.d = {"asset": {"version": "2.0", "generator": "Cronio gen-banner3d-v2.py"}, "scene": 0,
                  "scenes": [{"nodes": []}], "nodes": [], "meshes": [], "materials": [], "textures": [],
                  "images": [], "samplers": [{"magFilter": 9729, "minFilter": 9729, "wrapS": 33071, "wrapT": 33071}],
                  "accessors": [], "bufferViews": [], "buffers": [], "animations": []}
        self.materiales = {}

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
        n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}[tipo]
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

    def material(self, nombre, ruta_png):
        """Material opaco (sin mezcla ni alfa) con su textura; el nombre del material es el de la textura."""
        if nombre in self.materiales:
            return self.materiales[nombre]
        with open(ruta_png, "rb") as f:
            datos = f.read()
        self.d["images"].append({"name": nombre, "mimeType": "image/png", "bufferView": self._vista(datos)})
        self.d["textures"].append({"sampler": 0, "source": len(self.d["images"]) - 1})
        self.d["materials"].append({"name": nombre, "alphaMode": "OPAQUE",
                                    "pbrMetallicRoughness": {"baseColorTexture": {"index": len(self.d["textures"]) - 1},
                                                             "metallicFactor": 0, "roughnessFactor": 1}})
        self.materiales[nombre] = len(self.d["materials"]) - 1
        return self.materiales[nombre]

    def pieza(self, nombre, contorno, ancho, alto, centro, material, local):
        """Abanico de triángulos sobre `contorno` (relativo al centro), con UV de la caja ancho x alto. Es un nodo hijo
        directo de la raíz. local=False: sin transformación y vértices en espacio de escena (la regla del reporte).
        local=True: el hueso se traslada a `centro` y la malla queda definida alrededor de su centro (variante E)."""
        cx, cy, cz = centro
        base = (0, 0, 0) if local else (cx, cy, cz)
        pts = [(0.0, 0.0)] + list(contorno)
        pos = [(p[0] + base[0], p[1] + base[1], base[2]) for p in pts]
        uv = [(p[0] / ancho + 0.5, 0.5 - p[1] / alto) for p in pts]
        n = len(contorno)
        ind = [v for i in range(n) for v in (0, 1 + i, 1 + (i + 1) % n)]
        a_pos = self.acc(pos, "VEC3", objetivo=34962, minmax=True)
        a_nor = self.acc([(0, 0, 1)] * len(pts), "VEC3", objetivo=34962)
        a_uv = self.acc(uv, "VEC2", objetivo=34962)
        a_ind = self.acc(ind, "SCALAR", comp=5123, objetivo=34963)
        self.d["meshes"].append({"name": nombre, "primitives": [
            {"attributes": {"POSITION": a_pos, "NORMAL": a_nor, "TEXCOORD_0": a_uv}, "indices": a_ind, "material": material}]})
        nodo = {"name": nombre, "mesh": len(self.d["meshes"]) - 1}
        if local:
            nodo["translation"] = [cx, cy, cz]
        self.d["nodes"].append(nodo)
        self.d["scenes"][0]["nodes"].append(len(self.d["nodes"]) - 1)
        return len(self.d["nodes"]) - 1

    def animar(self, nodo, ruta, tiempos, valores):
        entrada = self.acc(tiempos, "SCALAR", minmax=True)
        salida = self.acc(valores, "VEC3")
        if not self.d["animations"]:
            self.d["animations"].append({"name": "COMMON", "samplers": [], "channels": []})
        a = self.d["animations"][0]
        a["samplers"].append({"input": entrada, "output": salida, "interpolation": "LINEAR"})
        a["channels"].append({"sampler": len(a["samplers"]) - 1, "target": {"node": nodo, "path": ruta}})

    def guardar(self, ruta):
        self.d["buffers"] = [{"byteLength": len(self.bin),
                              "uri": "data:application/octet-stream;base64," + base64.b64encode(bytes(self.bin)).decode()}]
        if not self.d["animations"]:
            del self.d["animations"]
        with open(ruta, "w", encoding="utf-8") as f:
            json.dump(self.d, f)


def escena(variante, ruta, carpeta, m):
    """Arma el glTF de la variante. Unidades de la escena = 1/10 de pixel de la pantalla de arriba."""
    g = Gltf()

    def png(n):
        return os.path.join(carpeta, n + ".png")

    esc = ANCHO_PLACA / m["W"]                       # unidades por px del espacio de trabajo
    alto_placa = m["H"] * esc
    radio = BORDE_TEXTURA * esc
    k = (CAM_Z - Z_OJOS) / CAM_Z                     # lo cercano se ve más grande: los ojos se achican para calzar
    ojo_w, ojo_h = m["ojoW"] * esc * k, m["ojoH"] * esc * k
    y_ojos_placa = (m["H"] / 2 - m["yMedio"]) * esc  # respecto al centro de la placa
    placa_contorno = contorno_redondeado(ANCHO_PLACA, alto_placa, radio, SEG_ESQUINA)
    info = {"capas": []}

    if variante == "b":
        # una sola pieza, centrada en el centro visible
        g.pieza("logo", placa_contorno, ANCHO_PLACA, alto_placa, (0, CAM_Y, 0), g.material("logo", png("logo")), False)
        info["capas"] = ["logo"]
        return g, info

    # y de la placa: D (y C, que es D sin animar) con los ojos en y = 0 en la escena, para que escalar en Y alrededor del
    # origen del hueso no los mueva. E (pivote propio en cada pieza) y B quedan centrados en el centro visible (y = CAM_Y).
    # Ojo visto a y_ojo_hueco en el plano de la placa se ve a y_escena = (y_hueco - CAM_Y)*k + CAM_Y desde la cámara.
    y_placa = CAM_Y if variante == "e" else (0 - CAM_Y) / k + CAM_Y - y_ojos_placa
    y_ojos = (y_placa + y_ojos_placa - CAM_Y) * k + CAM_Y
    local = variante == "e"

    sombra = g.pieza("sombra", placa_contorno, ANCHO_PLACA, alto_placa, (0, y_placa + SOMBRA_DY, Z_SOMBRA),
                     g.material("sombra", png("sombra")), local)
    placa = g.pieza("placa", placa_contorno, ANCHO_PLACA, alto_placa, (0, y_placa, Z_PLACA),
                    g.material("placa", png("placa")), local)
    mat_ojo = g.material("ojo", png("ojo"))
    ovalo = contorno_ovalo(ojo_w, ojo_h, LADOS_OJO)
    ojos, ojo_pos = [], []
    for nombre, px in (("ojo_izq", m["ojo1"]), ("ojo_der", m["ojo2"])):
        x = (px - m["W"] / 2) * esc * k
        ojos.append(g.pieza(nombre, ovalo, ojo_w, ojo_h, (x, y_ojos, Z_OJOS), mat_ojo, local))
        ojo_pos.append((x, y_ojos, Z_OJOS))
    info["capas"] = ["sombra", "placa", "ojo_izq", "ojo_der"]
    info["y_ojos"] = y_ojos
    info["y_placa"] = y_placa

    if variante == "d":
        ciclo, s = 4.0, 1 + RESPIRO
        for n in (placa, sombra):                      # respirar: escala uniforme alrededor del origen
            g.animar(n, "scale", [0, ciclo / 2, ciclo], [(1, 1, 1), (s, s, 1), (1, 1, 1)])
        for n in ojos:                                 # parpadeo: escala Y; los ojos están en y = 0 y no se desplazan
            g.animar(n, "scale", [0, 3.30, 3.42, 3.54, ciclo], [(1, 1, 1), (1, 1, 1), (1, 0.1, 1), (1, 1, 1), (1, 1, 1)])
        info["ciclo"] = ciclo
    elif variante == "e":
        ciclo, s = 12.0, 1 + RESPIRO
        # respirar: tres veces por ciclo (cada 4 s), escala alrededor del centro de la pieza
        resp_t = [0, 2, 4, 6, 8, 10, 12]
        resp_v = [(1, 1, 1), (s, s, 1)] * 3 + [(1, 1, 1)]
        for n in (placa, sombra):
            g.animar(n, "scale", resp_t, resp_v)
        # parpadeo a los 3,3 s, 7,3 s y 11,3 s
        pt, pv = [0], [(1, 1, 1)]
        for t0 in (3.30, 7.30, 11.30):
            pt += [t0, t0 + 0.12, t0 + 0.24]
            pv += [(1, 1, 1), (1, 0.1, 1), (1, 1, 1)]
        pt.append(ciclo)
        pv.append((1, 1, 1))
        for n in ojos:
            g.animar(n, "scale", pt, pv)
        # saltito de la placa entera (y de los ojos con ella): +0,5 unidades (5 px) en Y a los 5,5 s y a los 11,5 s
        salto = {0: 0, 5.5: 0, 5.75: 0.5, 6.0: 0, 11.5: 0, 11.75: 0.5, 12.0: 0}
        # mirada: a la izquierda (1,0–2,0 s) y a la derecha (2,3–3,0 s), 0,4 unidades (4 px)
        mira = {0: 0, 1.0: 0, 1.3: -0.4, 2.0: -0.4, 2.3: 0.4, 3.0: 0.4, 3.2: 0}
        for n, centro in ((placa, (0, y_placa, Z_PLACA)), (sombra, (0, y_placa + SOMBRA_DY, Z_SOMBRA))):
            tt = sorted(salto)
            g.animar(n, "translation", tt, [(centro[0], centro[1] + salto[t], centro[2]) for t in tt])
        tt = sorted(set(salto) | set(mira))

        def interp(tab, t):
            ks = sorted(tab)
            for a, b in zip(ks, ks[1:]):
                if a <= t <= b:
                    return tab[a] + (tab[b] - tab[a]) * ((t - a) / (b - a) if b > a else 0)
            return tab[ks[-1]]
        for n, (x, y, z) in zip(ojos, ojo_pos):
            g.animar(n, "translation", tt, [(x + interp(mira, t), y + interp(salto, t), z) for t in tt])
        info["ciclo"] = ciclo
    return g, info


# ----------------------------------------------------------------------------------------------------- pycgfx
def cargar_pycgfx():
    """Carga pycgfx/main.py como módulo, con los combinadores en «color plano» y la alineación de 128 bytes."""
    with open(os.path.join(PYCGFX, "main.py"), encoding="utf-8") as f:
        fuente = f.read()
    cambios = [  # colores planos: sin multiplicar por la luz ni sumar brillo
        ("texture_combiners[1].src_rgb = 0x0F1", "texture_combiners[1].src_rgb = 0x00F"),
        ("texture_combiners[1].combine_rgb = 1", "texture_combiners[1].combine_rgb = 0"),
        ("texture_combiners[2].src_rgb = 0xFE2", "texture_combiners[2].src_rgb = 0x00F"),
        ("texture_combiners[2].combine_rgb = 8", "texture_combiners[2].combine_rgb = 0"),
    ]
    for viejo, nuevo in cambios:
        if viejo not in fuente:
            sys.exit(f"pycgfx cambió: no encuentro «{viejo}». Revisa cargar_pycgfx() en gen-banner3d-v2.py.")
        fuente = fuente.replace(viejo, nuevo)
    sys.path.insert(0, PYCGFX)
    mod = type(sys)("pycgfx_main")
    mod.__file__ = os.path.join(PYCGFX, "main.py")
    exec(compile(fuente, "pycgfx/main.py (colores planos)", "exec"), mod.__dict__)
    return mod


ALINEACION = 128


class StringTable128:
    """Reemplazo de cgfx.shared.StringTable para la tabla de IMAG: cada blob (textura o vértices) se rellena a 128."""
    @staticmethod
    def correct(s):
        if isinstance(s, str):
            return s.encode() + b"\0"
        return s + b"\0" * (-len(s) % ALINEACION)


def parchar_alineacion(mod):
    """Subclases de StringTable (la tabla de cadenas del CGFX y la de IMAG) con la alineación a 128; se cambian en el
    módulo main de pycgfx, que es donde write() las crea. El clon de pycgfx queda intacto."""
    base = mod.StringTable

    class Cadenas(base):
        """Tabla de cadenas: el relleno final hace que el contenido de IMAG (que viene 8 bytes después, tras su cabecera
        «IMAG» + tamaño) empiece en un múltiplo de 128."""
        def prepare(self, offset):
            self.offset = offset
            self.padding = -(offset + self.total + 8) % ALINEACION
            self.total += self.padding
            return offset + self.total

    class Imag(base):
        correct = staticmethod(StringTable128.correct)

        def prepare(self, offset):
            self.offset = offset                    # el contenido ya empieza alineado (lo logró Cadenas)
            assert offset % ALINEACION == 0, f"IMAG empieza en {offset}, no múltiplo de {ALINEACION}"
            self.padding = 8                        # igual que pycgfx: cola tras los datos
            self.total += self.padding
            return offset + self.total

    def write(cgfx):
        strings, imag = Cadenas(), Imag()
        offset = cgfx.prepare(0, strings, imag)
        offset = strings.prepare(offset)
        cgfx.data.section_size = offset - cgfx.data.offset
        if not imag.empty():
            cgfx.header.nr_blocks = 2
            offset += 8                              # cabecera de IMAG
        offset = imag.prepare(offset)
        cgfx.header.file_size = offset
        data = cgfx.write(strings, imag)
        data += strings.write()
        if not imag.empty():
            data += b"IMAG" + imag.size().to_bytes(4, "little") + imag.write()
        return data

    mod.write = write


def parchar_formatos(mod):
    """RGB8 por nombre de textura (pycgfx usa RGBA4 para todo, y con bandas)."""
    swz = sys.modules["cgfx.swizzler"]
    formato = swz.TextureFormat
    original = swz.to_txob

    def to_txob(im, format=formato.RGBA4, mipmaps=1):
        return original(im, format, mipmaps)

    swz.to_txob = to_txob

    pedir = mod.gltf_get_texture

    def gltf_get_texture(cgfx, gltf, image_id, normal=False):
        nombre = gltf.model.images[image_id].name
        quiero = getattr(formato, FORMATOS.get(nombre, "RGB8"))
        swz.to_txob = lambda im, format=formato.RGBA4, mipmaps=1: original(im, quiero, mipmaps)
        try:
            return pedir(cgfx, gltf, image_id, normal)
        finally:
            swz.to_txob = to_txob

    mod.gltf_get_texture = gltf_get_texture


def billboard(mod, cgfx):
    """ScreenViewpoint (4) + Local/World matrix calculate en todos los huesos salvo el raíz."""
    bones = cgfx.data.models["COMMON"].skeleton.bones
    raiz = cgfx.data.models["COMMON"].skeleton.root_bone
    n = 0
    for nombre in bones:
        b = bones[nombre]
        if b is raiz:
            continue
        b.billboard_mode = mod.BillboardMode.ScreenViewpoint
        b.flags |= mod.BoneFlag.IsLocalMatrixCalculate | mod.BoneFlag.IsWorldMatrixCalculate
        n += 1
    return n


def importar_gltflib():
    """Desde la shell de devkitPro (make) no existe %APPDATA%/%USERNAME% y Python no ve los paquetes instalados con --user:
    se buscan a mano en C:/Users/<usuario>/AppData/Roaming/Python/*/site-packages."""
    try:
        import gltflib
        return gltflib
    except ModuleNotFoundError:
        import glob
        import re
        casa = re.match(r"[A-Za-z]:[/\\]Users[/\\][^/\\]+", AQUI)  # el usuario sale de la ruta del script
        for d in glob.glob(f"{casa.group(0)}/AppData/Roaming/Python/Python3*/site-packages") if casa else []:
            sys.path.append(d)
        import gltflib
        return gltflib


def convertir(gltf_ruta, cgfx_ruta):
    gltflib = importar_gltflib()
    mod = cargar_pycgfx()
    parchar_alineacion(mod)
    parchar_formatos(mod)
    cgfx = mod.convert_gltf(gltflib.GLTF.load(gltf_ruta, load_file_resources=True))
    n = billboard(mod, cgfx)
    with open(cgfx_ruta, "wb") as f:
        f.write(mod.write(cgfx))
    return n, cgfx


# ----------------------------------------------------------------------------------------------------- main
def importar_numpy():
    try:
        import numpy  # noqa: F401
    except ModuleNotFoundError:  # mismo problema de --user que con gltflib
        importar_gltflib()
        import numpy  # noqa: F401


def main():
    args = sys.argv[1:]
    if "--texturas" in args:
        args.remove("--texturas")
        electron = os.path.join(RAIZ, "node_modules", "electron", "dist", "electron.exe")
        subprocess.run([electron, os.path.join(AQUI, "gen-banner3d.cjs")], check=True)
    if len(args) != 2 or args[0] not in ("b", "c", "d", "e"):
        sys.exit(__doc__)
    variante, salida = args
    salida = os.path.abspath(salida)
    os.makedirs(os.path.dirname(salida), exist_ok=True)
    importar_gltflib()
    with tempfile.TemporaryDirectory() as tmp:
        m = preparar_texturas(tmp)
        g, info = escena(variante, os.path.join(tmp, "x.gltf"), tmp, m)
        gltf = os.path.join(tmp, f"banner-{variante}.gltf")
        g.guardar(gltf)
        huesos, cgfx = convertir(gltf, salida)
        print(f"variante {variante}: piezas {info['capas']}, {huesos} huesos en billboard"
              + (f", ojos en y = {info['y_ojos']:.2f}, placa en y = {info['y_placa']:.2f}" if "y_ojos" in info else ""))
        # vista previa de frente, dibujada con lo que quedó en el CGFX (vértices e índices ya convertidos)
        try:
            importar_numpy()
            spec = importlib.util.spec_from_file_location("vista_previa", os.path.join(AQUI, "vista-previa-banner.py"))
            vp = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(vp)
            nombre = {"b": "B", "c": "C", "d": "D", "e": "E"}[variante]
            cuadro = vp.renderizar(cgfx, tmp, os.path.splitext(salida)[0] + ".png",
                                   f"Banner {nombre}: vista de frente (400x240, sin fondo; damero = transparente)")
            ancho = (cuadro[2] - cuadro[0]) / 40 * 10 if cuadro else 0
            print(f"vista previa: {os.path.splitext(salida)[0]}.png (el logo ocupa {cuadro[2] - cuadro[0]:.0f} de 400 px "
                  f"de ancho = {(cuadro[2] - cuadro[0]) / 4:.0f} %, de x {cuadro[0]:.0f} a {cuadro[2]:.0f}, y {cuadro[1]:.0f} a {cuadro[3]:.0f})")
        except ModuleNotFoundError as e:
            print(f"AVISO: sin vista previa ({e}); instala numpy")

    # Verificación: se lee el .cgfx resultante (sin fiarse de lo que se quiso escribir)
    spec = importlib.util.spec_from_file_location("verificar_banner", os.path.join(AQUI, "verificar-banner.py"))
    ver = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ver)
    datos = open(salida, "rb").read()
    r = ver.analizar_cgfx(datos)
    ver.imprimir(r, salida)
    malos = [t["nombre"] for t in r["texturas"] if t["offset"] % 128] + ([] if r["imag_contenido"] % 128 == 0 else ["IMAG"])
    if malos:
        sys.exit(f"ERROR: hay offsets que no son múltiplo de 128: {malos}")
    if len(datos) > 512 * 1024:
        sys.exit("ERROR: el .cgfx pasa de 512 KB")
    for t in r["texturas"]:
        if t["w"] > 256 or t["h"] > 256 or t["w"] & (t["w"] - 1) or t["h"] & (t["h"] - 1):
            sys.exit(f"ERROR: la textura {t['nombre']} mide {t['w']}x{t['h']} (potencias de 2, máximo 256)")
        if t["formato"] != "RGB8":
            sys.exit(f"ERROR: la textura {t['nombre']} es {t['formato']} y debía ser RGB8 (sin alfa)")


if __name__ == "__main__":
    main()

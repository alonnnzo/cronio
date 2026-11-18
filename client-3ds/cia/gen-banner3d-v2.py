"""Banners 3D de prueba para el menú HOME (v2): genera el .cgfx de las variantes B, C y D.

Contexto: el banner de gen-banner3d.py congeló el menú HOME de una New 3DS XL. El reporte público
https://github.com/skyfloogle/pycgfx/issues/2 describe la causa más probable y los arreglos, que aplica este script
SIN modificar el clon de pycgfx (se carga el main.py, se le parchan los combinadores y se le cambian clases en memoria):

  1. Alineación a 128 bytes. pycgfx alinea el bloque IMAG a 16. Aquí el contenido de IMAG y cada textura empiezan en
     múltiplos de 128 (StringTable128 reemplaza a StringTable). Al terminar se LEE el .cgfx y se imprime el offset % 128
     de cada textura; el script falla si alguno no es 0.
  2. Billboard. Todos los huesos (menos el raíz) con modo ScreenViewpoint (4) y las banderas IsLocalMatrixCalculate
     (0x80) e IsWorldMatrixCalculate (0x100); cada malla es hija directa de la raíz, sin transformación, con los
     vértices ya en espacio de escena (el menú HOME hace girar todo banner 3D; así no gira).
  3. Texturas: RGB8 donde no hace falta alfa (fondo, logo completo), RGBA4 donde sí (sombra, placa, ojos).
  4. Colores planos (sin luz ni brillo), como en gen-banner3d.py.

Variantes (la A es el banner plano de siempre y no pasa por aquí):
  b  un solo plano con el logo completo (cia/banner.png), sin animación.
  c  capas a distinta Z (fondo -6, sombra, placa 0, ojos +2.5), sin animación.
  d  como c, con animación rígida solo de escala: parpadeo de los ojos y «respirar» leve de la placa.

Como los huesos quedan en el origen (ahí pivota la escala), la placa se baja a Y_PLACA para que los ojos queden casi
sobre y = 0: así el parpadeo (escala en Y) apenas los mueve. Es 1 cm menos de altura que en gen-banner3d.py.

Uso:  python gen-banner3d-v2.py <b|c|d> <salida.cgfx>      (las texturas salen de cia/banner3d/*.png)
      python gen-banner3d-v2.py --texturas ...               (las regenera antes con Electron; pide internet para la letra)
Requiere Python 3.11+, `pip install gltflib pillow` y pycgfx en C:/devkitPro/tools/pycgfx (o PYCGFX=<carpeta>).
"""
import base64
import importlib.util
import json
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
# 40 x 24 unidades.
CAM_Z, CAM_Y = 44.786, 1.0
Z_FONDO, Z_SOMBRA, Z_PLACA, Z_OJOS = -6.0, -0.8, 0.0, 2.5
ANCHO_PLACA = 30.0
Y_PLACA = 0.3          # centro de la placa (ver la nota de arriba sobre el pivote)
SOMBRA_DY = -0.55
CICLO = 4.0            # segundos del ciclo de animación (D)
RESPIRO = 0.02         # la placa crece 2 % a mitad del ciclo (D)

# Formato por nombre de textura (nombre de imagen en el glTF). RGBA8 no: «roto en el menú HOME» según pycgfx.
FORMATOS = {"logo": "RGB8", "fondo": "RGB8", "sombra": "RGBA4", "placa": "RGBA4", "ojo": "RGBA4"}


# ----------------------------------------------------------------------------------------------------- glTF
class Gltf:
    def __init__(self):
        self.bin = bytearray()
        self.d = {"asset": {"version": "2.0", "generator": "Cronio gen-banner3d-v2.py"}, "scene": 0,
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

    def material(self, nombre, ruta_png, mezcla):
        with open(ruta_png, "rb") as f:
            datos = f.read()
        self.d["images"].append({"name": nombre, "mimeType": "image/png", "bufferView": self._vista(datos)})
        self.d["textures"].append({"sampler": 0, "source": len(self.d["images"]) - 1})
        self.d["materials"].append({"name": nombre, "alphaMode": "BLEND" if mezcla else "OPAQUE",
                                    "pbrMetallicRoughness": {"baseColorTexture": {"index": len(self.d["textures"]) - 1},
                                                             "metallicFactor": 0, "roughnessFactor": 1}})
        return len(self.d["materials"]) - 1

    def plano(self, nombre, ancho, alto, cx, cy, cz, material):
        """Nodo-hijo-de-la-raíz sin transformación con un rectángulo ya en espacio de escena, mirando a +z."""
        w, h = ancho / 2, alto / 2
        pos = self.acc([(cx - w, cy - h, cz), (cx + w, cy - h, cz), (cx + w, cy + h, cz), (cx - w, cy + h, cz)],
                       "VEC3", objetivo=34962, minmax=True)
        nor = self.acc([(0, 0, 1)] * 4, "VEC3", objetivo=34962)
        uv = self.acc([(0, 1), (1, 1), (1, 0), (0, 0)], "VEC2", objetivo=34962)
        ind = self.acc([0, 1, 2, 0, 2, 3], "SCALAR", comp=5123, objetivo=34963)
        self.d["meshes"].append({"name": nombre, "primitives": [
            {"attributes": {"POSITION": pos, "NORMAL": nor, "TEXCOORD_0": uv}, "indices": ind, "material": material}]})
        self.d["nodes"].append({"name": nombre, "mesh": len(self.d["meshes"]) - 1})
        i = len(self.d["nodes"]) - 1
        self.d["scenes"][0]["nodes"].append(i)
        return i

    def animar_escala(self, nodo, tiempos, valores):
        entrada = self.acc(tiempos, "SCALAR", minmax=True)
        salida = self.acc(valores, "VEC3")
        if not self.d["animations"]:
            self.d["animations"].append({"name": "COMMON", "samplers": [], "channels": []})
        a = self.d["animations"][0]
        a["samplers"].append({"input": entrada, "output": salida, "interpolation": "LINEAR"})
        a["channels"].append({"sampler": len(a["samplers"]) - 1, "target": {"node": nodo, "path": "scale"}})

    def guardar(self, ruta):
        self.d["buffers"] = [{"byteLength": len(self.bin),
                              "uri": "data:application/octet-stream;base64," + base64.b64encode(bytes(self.bin)).decode()}]
        if not self.d["animations"]:
            del self.d["animations"]
        with open(ruta, "w", encoding="utf-8") as f:
            json.dump(self.d, f)


def escena_b(ruta):
    """Un solo plano con el logo completo. 50 x 25 cubre los 40 x 24 que se ven en z = 0."""
    g = Gltf()
    g.plano("logo", 50, 25, 0, CAM_Y, 0, g.material("logo", os.path.join(AQUI, "banner.png"), False))
    g.guardar(ruta)
    return {"capas": ["logo"]}


def escena_capas(ruta, animar):
    with open(os.path.join(TEXTURAS, "medidas.json"), encoding="utf-8") as f:
        m = json.load(f)
    g = Gltf()
    esc = ANCHO_PLACA / m["W"]                     # unidades por px de la textura de trabajo
    alto_placa = m["H"] * esc
    k = (CAM_Z - Z_OJOS) / CAM_Z                   # lo cercano se ve más grande: los ojos se achican para calzar
    ojo_w, ojo_h = m["ojoW"] * esc * k, m["ojoH"] * esc * k
    y_ojos_placa = (m["H"] / 2 - m["yMedio"]) * esc
    y_ojos = (Y_PLACA + y_ojos_placa - CAM_Y) * k + CAM_Y

    def png(n):
        return os.path.join(TEXTURAS, n + ".png")

    g.plano("fondo", 48, 29, 0, CAM_Y, Z_FONDO, g.material("fondo", png("fondo"), False))
    sombra = g.plano("sombra", ANCHO_PLACA, alto_placa, 0, Y_PLACA + SOMBRA_DY, Z_SOMBRA,
                     g.material("sombra", png("sombra"), True))
    placa = g.plano("placa", ANCHO_PLACA, alto_placa, 0, Y_PLACA, Z_PLACA, g.material("placa", png("placa"), True))
    mat_ojo = g.material("ojo", png("ojo"), True)
    ojos = []
    for nombre, px in (("ojo_izq", m["ojo1"]), ("ojo_der", m["ojo2"])):
        x = (px - m["W"] / 2) * esc * k
        ojos.append(g.plano(nombre, ojo_w, ojo_h, x, y_ojos, Z_OJOS, mat_ojo))

    if animar:
        # «respirar»: la placa y su sombra crecen y vuelven (escala uniforme alrededor del origen)
        s = 1 + RESPIRO
        for n in (placa, sombra):
            g.animar_escala(n, [0, CICLO / 2, CICLO], [(1, 1, 1), (s, s, 1), (1, 1, 1)])
        # parpadeo: los ojos se aplastan en Y un instante al final del ciclo
        tp = [0, 3.30, 3.42, 3.54, CICLO]
        for o in ojos:
            g.animar_escala(o, tp, [(1, 1, 1), (1, 1, 1), (1, 0.1, 1), (1, 1, 1), (1, 1, 1)])
    g.guardar(ruta)
    return {"capas": ["fondo", "sombra", "placa", "ojo_izq", "ojo_der"], "y_ojos": y_ojos}


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
    """RGB8 / RGBA4 por nombre de textura (pycgfx usa RGBA4 para todo)."""
    swz = sys.modules["cgfx.swizzler"]
    formato = swz.TextureFormat
    original = swz.to_txob

    def to_txob(im, format=formato.RGBA4, mipmaps=1):
        return original(im, format, mipmaps)

    swz.to_txob = to_txob

    pedir = mod.gltf_get_texture

    def gltf_get_texture(cgfx, gltf, image_id, normal=False):
        nombre = gltf.model.images[image_id].name
        quiero = getattr(formato, FORMATOS.get(nombre, "RGBA4"))
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
    return n


# ----------------------------------------------------------------------------------------------------- main
def main():
    args = sys.argv[1:]
    if "--texturas" in args:
        args.remove("--texturas")
        electron = os.path.join(RAIZ, "node_modules", "electron", "dist", "electron.exe")
        subprocess.run([electron, os.path.join(AQUI, "gen-banner3d.cjs")], check=True)
    if len(args) != 2 or args[0] not in ("b", "c", "d"):
        sys.exit(__doc__)
    variante, salida = args
    salida = os.path.abspath(salida)
    os.makedirs(os.path.dirname(salida), exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        gltf = os.path.join(tmp, f"banner-{variante}.gltf")
        info = escena_b(gltf) if variante == "b" else escena_capas(gltf, animar=(variante == "d"))
        huesos = convertir(gltf, salida)
    print(f"variante {variante}: {len(info['capas'])} capas {info['capas']}, {huesos} huesos en billboard"
          + (f", ojos en y = {info['y_ojos']:.2f}" if "y_ojos" in info else ""))

    # Verificación: se lee el .cgfx resultante (sin fiarse de lo que se quiso escribir)
    spec = importlib.util.spec_from_file_location("verificar_banner", os.path.join(AQUI, "verificar-banner.py"))
    ver = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ver)
    r = ver.analizar_cgfx(open(salida, "rb").read())
    ver.imprimir(r, salida)
    malos = [t for t in r["texturas"] if t["offset"] % 128] + ([] if r["imag_contenido"] % 128 == 0 else ["IMAG"])
    if malos:
        sys.exit(f"ERROR: hay offsets que no son múltiplo de 128: {malos}")
    if len(open(salida, 'rb').read()) > 512 * 1024:
        sys.exit("ERROR: el .cgfx pasa de 512 KB")
    for t in r["texturas"]:
        if t["w"] > 256 or t["h"] > 256 or t["w"] & (t["w"] - 1) or t["h"] & (t["h"] - 1):
            sys.exit(f"ERROR: la textura {t['nombre']} mide {t['w']}x{t['h']} (potencias de 2, máximo 256)")


if __name__ == "__main__":
    main()

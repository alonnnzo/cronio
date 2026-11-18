"""Verificador estático de banners de la 3DS: lee un .bnr (CBMD) o un .cgfx y describe lo que importa para el menú HOME.

Imprime: tamaño; texturas (formato, dimensiones, offset y offset % 128, tanto dentro del CGFX como, si es un .bnr,
dentro del archivo); bloque IMAG; huesos con su modo billboard y banderas; animaciones y de qué tipo.
Sale con código 1 si algún offset de textura (o el contenido de IMAG) no es múltiplo de 128: es la comprobación del
reporte https://github.com/skyfloogle/pycgfx/issues/2 (la 3DS real congelaba el menú con texturas en 48 o 112 mod 128).

Uso:  python verificar-banner.py <archivo.bnr|archivo.cgfx> [...]
Solo lee; no depende de pycgfx.
"""
import os
import struct
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

FORMATOS = ["RGBA8", "RGB8", "RGBA5551", "RGB565", "RGBA4", "LA8", "HILO8", "L8", "A8", "LA4", "L4", "A4", "ETC1", "ETC1A4"]
BILLBOARD = ["Off", "World", "WorldViewpoint", "Screen", "ScreenViewpoint", "YAxial", "YAxialViewpoint"]
BANDERAS_HUESO = [(1, "Identity"), (2, "TranslateZero"), (4, "RotateZero"), (8, "ScaleOne"), (16, "UniformScale"),
                  (32, "SegmentScaleCompensate"), (64, "NeedRendering"), (128, "LocalMatrixCalculate"),
                  (256, "WorldMatrixCalculate"), (512, "HasSkinningMatrix")]
CMDL_FORMATO = "<i4siiiiiiixxxxiifffffffff" + "f" * 24 + "i" * 11 + "i"  # CMDLWithSkeleton de pycgfx
DICTS = ["models", "textures", "lookup_tables", "materials", "shaders", "cameras", "lights", "fogs", "scenes",
         "skeletal_animations", "material_animations", "visibility_animations", "camera_animations",
         "light_animations", "emitters"]


def u32(b, o):
    return struct.unpack_from("<I", b, o)[0]


def i32(b, o):
    return struct.unpack_from("<i", b, o)[0]


def cadena(b, o):
    fin = b.index(b"\0", o)
    return b[o:fin].decode("utf-8", "replace")


def diccionario(b, pos):
    """DictInfo en `pos` (cuenta, offset relativo) -> lista de (nombre, offset absoluto del contenido)."""
    n, rel = i32(b, pos), i32(b, pos + 4)
    if n == 0 or rel == 0:
        return []
    d = pos + 4 + rel
    if b[d:d + 4] != b"DICT":
        raise ValueError(f"DICT esperado en {d}")
    salida = []
    for j in range(1, n + 1):
        nodo = d + 12 + 16 * j
        nombre = cadena(b, nodo + 8 + i32(b, nodo + 8))
        salida.append((nombre, nodo + 12 + i32(b, nodo + 12)))
    return salida


def animados(flags):
    """Qué canales de una CANMBoneTransform varían (ni ignorados ni constantes)."""
    grupos = {"escala": (0x40, 0x10000), "rotación": (0x200, 0x80000), "posición": (0x2000, 0x800000)}
    res = []
    for nombre, (const, ign) in grupos.items():
        for k in range(3):
            if not (flags & (ign << k)) and not (flags & (const << k)):
                res.append(nombre)
                break
    return res


def analizar_cgfx(b):
    if b[:4] != b"CGFX":
        raise ValueError("no es un CGFX")
    r = {"tam": len(b), "texturas": [], "huesos": [], "animaciones": [], "diccionarios": {}}
    r["tam_cabecera"] = u32(b, 12)
    r["bloques"] = u32(b, 16)
    data = 0x14
    if b[data:data + 4] != b"DATA":
        raise ValueError("falta DATA")
    r["archivo_declarado"] = u32(b, 12)
    for i, nombre in enumerate(DICTS):
        r["diccionarios"][nombre] = i32(b, data + 8 + 8 * i)
    # IMAG viene justo tras el DATA (que incluye la tabla de cadenas)
    imag = data + u32(b, data + 4)
    if b[imag:imag + 4] == b"IMAG":
        r["imag_cabecera"] = imag
        r["imag_contenido"] = imag + 8
        r["imag_tam"] = u32(b, imag + 4)
    else:
        r["imag_cabecera"], r["imag_contenido"], r["imag_tam"] = None, 0, 0

    for nombre, t in diccionario(b, data + 8 + 8 * 1):
        w, h = i32(b, t + 28), i32(b, t + 24)
        # h y w: pycgfx guarda (alto, ancho); el nombre de arriba coincide con el de PixelBasedImage
        fmt = i32(b, t + 52)
        pb = t + 56 + i32(b, t + 56)
        alto, ancho = i32(b, pb), i32(b, pb + 4)
        largo = i32(b, pb + 8)
        offset = pb + 12 + i32(b, pb + 12)
        r["texturas"].append({"nombre": nombre, "formato": FORMATOS[fmt] if 0 <= fmt < len(FORMATOS) else str(fmt),
                              "w": ancho, "h": alto, "bytes": largo, "offset": offset, "mipmaps": i32(b, t + 40)})

    modelos = diccionario(b, data + 8)
    r["modelos"] = len(modelos)
    for nombre, c in modelos:
        sk_pos = c + struct.calcsize(CMDL_FORMATO) - 4
        if i32(b, sk_pos) == 0:
            continue
        sk = sk_pos + i32(b, sk_pos)
        raiz = sk + 32 + i32(b, sk + 32)  # Reference(root_bone) en +32
        for nb, bo in diccionario(b, sk + 24):
            flags = i32(b, bo + 4)
            r["huesos"].append({"nombre": nb, "flags": flags, "padre": i32(b, bo + 12), "billboard": i32(b, bo + 212),
                                "raiz": bo == raiz})

    for nombre, c in diccionario(b, data + 8 + 8 * 9):
        miembros = diccionario(b, c + 24)
        anim = {"nombre": nombre, "frames": struct.unpack_from("<f", b, c + 20)[0], "huesos": []}
        for nm, m in miembros:
            tipo = i32(b, m + 16)
            if tipo == 5:  # Transform
                anim["huesos"].append((nm, animados(u32(b, m)), "transform"))
            else:
                anim["huesos"].append((nm, [], f"tipo {tipo}"))
        r["animaciones"].append(anim)
    return r


def banderas(n):
    return "+".join(nombre for bit, nombre in BANDERAS_HUESO if n & bit) or "-"


def imprimir(r, ruta, base=0):
    """base: offset del CGFX dentro del .bnr (0 si es un .cgfx suelto); se imprime también el offset % 128 absoluto."""
    print(f"== {ruta}")
    print(f"  CGFX: {r['tam']} bytes ({r['tam'] / 1024:.1f} KB; máximo del menú HOME: 512 KB){'  ¡PASA DE 512 KB!' if r['tam'] > 512 * 1024 else ''}")
    abs_ = f" (en el .bnr: {base + r['imag_contenido']}, %128 = {(base + r['imag_contenido']) % 128})" if base else ""
    print(f"  bloque IMAG: contenido en {r['imag_contenido']}, %128 = {r['imag_contenido'] % 128}{abs_}, {r['imag_tam']} bytes")
    print(f"  texturas: {len(r['texturas'])}")
    for t in r["texturas"]:
        abs_ = f"  [en el .bnr: {base + t['offset']}, %128 = {(base + t['offset']) % 128}]" if base else ""
        pot = "" if (t["w"] <= 256 and t["h"] <= 256 and not t["w"] & (t["w"] - 1) and not t["h"] & (t["h"] - 1)) else "  ¡no es potencia de 2 / pasa de 256!"
        print(f"    {t['nombre']}: {t['formato']} {t['w']}x{t['h']}, {t['bytes']} bytes, offset {t['offset']}, "
              f"%128 = {t['offset'] % 128}{'  ¡NO ALINEADA!' if t['offset'] % 128 else ''}{abs_}{pot}")
    hijos = [h for h in r["huesos"] if not h["raiz"]]
    print(f"  huesos: {len(r['huesos'])} ({len(hijos)} sin contar la raíz)")
    for h in r["huesos"]:
        modo = BILLBOARD[h["billboard"]] if 0 <= h["billboard"] < len(BILLBOARD) else str(h["billboard"])
        print(f"    {h['nombre']}{' (raíz)' if h['raiz'] else ''}: billboard {modo} ({h['billboard']}), "
              f"padre {h['padre']}, banderas 0x{h['flags']:x} [{banderas(h['flags'])}]")
    if any(h["flags"] & 512 for h in r["huesos"]):
        print("  AVISO: hay huesos con matriz de piel (HasSkinningMatrix): la animación con piel congeló otra consola.")
    d = r["diccionarios"]
    print(f"  animaciones: esqueléticas {d['skeletal_animations']}, de material {d['material_animations']}, "
          f"de visibilidad {d['visibility_animations']}")
    for a in r["animaciones"]:
        print(f"    {a['nombre']}: {a['frames']:.0f} cuadros ({a['frames'] / 60:.2f} s), animación rígida de nodos")
        for nm, canales, tipo in a["huesos"]:
            print(f"      {nm}: {', '.join(canales) if canales else 'sin curvas'} ({tipo})")
    return r


def lz11(b):
    """Descomprime LZ11 (cabecera 0x11 + tamaño de 24 o 32 bits): así guarda bannertool el CGFX dentro del .bnr."""
    tam = b[1] | b[2] << 8 | b[3] << 16
    pos = 4
    if tam == 0:
        tam, pos = u32(b, 4), 8
    out = bytearray()
    while len(out) < tam:
        flags = b[pos]
        pos += 1
        for bit in range(7, -1, -1):
            if len(out) >= tam:
                break
            if not (flags >> bit) & 1:
                out.append(b[pos])
                pos += 1
                continue
            b0 = b[pos]
            ind = b0 >> 4
            if ind == 0:
                largo = ((b0 & 15) << 4 | b[pos + 1] >> 4) + 0x11
                desp = ((b[pos + 1] & 15) << 8 | b[pos + 2]) + 1
                pos += 3
            elif ind == 1:
                largo = ((b0 & 15) << 12 | b[pos + 1] << 4 | b[pos + 2] >> 4) + 0x111
                desp = ((b[pos + 2] & 15) << 8 | b[pos + 3]) + 1
                pos += 4
            else:
                largo = ind + 1
                desp = ((b0 & 15) << 8 | b[pos + 1]) + 1
                pos += 2
            for _ in range(largo):
                out.append(out[-desp])
    return bytes(out[:tam])


def cgfx_de_bnr(b):
    """CBMD: cabecera «CBMD», reservado, offsets: el CGFX común en 0x08 (comprimido con LZ11); el CWAV en 0x84."""
    if b[:4] != b"CBMD":
        raise ValueError("no es un CBMD")
    comun = u32(b, 8)
    cwav = u32(b, 0x84)
    crudo = b[comun:(cwav if cwav > comun else len(b))]
    if crudo[:1] == b"":
        return lz11(crudo), comun, cwav, len(crudo)
    return crudo, comun, cwav, len(crudo)


def verificar(ruta):
    with open(ruta, "rb") as f:
        b = f.read()
    if b[:4] == b"CBMD":
        b, comun, cwav, comprimido = cgfx_de_bnr(b)
        print(f"== {ruta}: banner CBMD; CGFX en {comun} (LZ11: {comprimido} bytes comprimidos -> {len(b)} descomprimidos); "
              f"CWAV en {cwav or 'no hay'}")
        print("  (los offsets de abajo son dentro del CGFX descomprimido, que es lo que el menú HOME tiene en memoria)")
    r = analizar_cgfx(b)
    imprimir(r, ruta)
    malos = [t["nombre"] for t in r["texturas"] if t["offset"] % 128]
    if r["imag_contenido"] and r["imag_contenido"] % 128:
        malos.append("IMAG")
    return r, malos


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    mal = 0
    for ruta in sys.argv[1:]:
        _, malos = verificar(ruta)
        if malos:
            mal = 1
            print(f"  RESULTADO: sin alinear a 128: {', '.join(malos)}")
        else:
            print("  RESULTADO: offsets de textura e IMAG múltiplos de 128")
    sys.exit(mal)

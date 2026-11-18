"""Vista previa de frente de un banner 3D: un proyector simple (cámara del banner, perspectiva, z-buffer) en Python.

Se alimenta del objeto CGFX que armó pycgfx, NO del glTF de entrada: lee de cada forma los vértices (posición y UV) y los
índices tal como se escribirán en el archivo, y la posición de su hueso. Así sirve de comprobación del orden y del número
de vértices. Las texturas se toman del .png con el nombre del material (ya en RGB, como las recibe pycgfx).

Cámara (pycgfx/banner-camera.gltf): en (0, 1, 44.786), fov vertical 30°, imagen de 400 x 240 (se dibuja al doble).
Fondo: un damero gris claro, para que se note lo transparente (el menú HOME pondrá el suyo). Requiere numpy y pillow.
"""
import math
import os
import struct

import numpy as np
from PIL import Image, ImageDraw

CAM = (0.0, 1.0, 44.786)
FOV = math.radians(30)


def _leer_malla(cmdl, mesh):
    shape = cmdl.shapes.data.contents[mesh.shape_index]
    ps = shape.primitive_sets.data.contents[0]
    hueso = cmdl.skeleton.bones[ps.related_bones.data.contents[0]]
    idx = ps.primitives.data.contents[0].index_streams.data.contents[0]
    datos = idx.face_data
    formato = {0x1401: "B", 0x1403: "H", 5123: "H", 5121: "B"}[int(idx.data_type)]
    n = len(datos) // struct.calcsize(formato)
    indices = struct.unpack("<%d%s" % (n, formato), datos)
    pos = uv = None
    for vs in shape.vertex_attributes.data.contents:
        comp = vs.components_count
        valores = struct.unpack("<%df" % (len(vs.vertex_stream_data) // 4), vs.vertex_stream_data)
        filas = [valores[i:i + comp] for i in range(0, len(valores), comp)]
        if int(vs.usage) == 0:
            pos = filas
        elif int(vs.usage) == 4:
            uv = filas
    off = (hueso.position.x, hueso.position.y, hueso.position.z)
    return pos, uv, indices, off


def renderizar(cgfx, carpeta_texturas, ruta_png, titulo="", escala=2, ss=3):
    """Dibuja el CGFX de frente en ruta_png. Devuelve el cuadro [x0, y0, x1, y1] (px de 400x240) que ocupa lo dibujado."""
    cmdl = cgfx.data.models["COMMON"]
    ancho, alto = 400 * escala * ss, 240 * escala * ss
    foco = (alto / 2) / math.tan(FOV / 2)
    color = np.zeros((alto, ancho, 3), np.float32)
    cubierto = np.zeros((alto, ancho), bool)
    zbuf = np.full((alto, ancho), np.inf, np.float32)
    texcache = {}

    for mesh in cmdl.meshes.data.contents:
        mat = cmdl.materials[mesh.material_index]
        if mat.name not in texcache:
            im = Image.open(os.path.join(carpeta_texturas, mat.name + ".png")).convert("RGB")
            texcache[mat.name] = np.asarray(im, np.float32)
        tex = texcache[mat.name]
        th, tw = tex.shape[:2]
        pos, uv, indices, off = _leer_malla(cmdl, mesh)
        v3 = [(p[0] + off[0], p[1] + off[1], p[2] + off[2]) for p in pos]
        for t in range(0, len(indices), 3):
            ps = [v3[i] for i in indices[t:t + 3]]
            us = [uv[i] for i in indices[t:t + 3]]
            prof = [CAM[2] - p[2] for p in ps]
            sx = [ancho / 2 + p[0] / d * foco for p, d in zip(ps, prof)]
            sy = [alto / 2 - (p[1] - CAM[1]) / d * foco for p, d in zip(ps, prof)]
            x0, x1 = max(int(min(sx)), 0), min(int(max(sx)) + 1, ancho)
            y0, y1 = max(int(min(sy)), 0), min(int(max(sy)) + 1, alto)
            if x0 >= x1 or y0 >= y1:
                continue
            den = (sy[1] - sy[2]) * (sx[0] - sx[2]) + (sx[2] - sx[1]) * (sy[0] - sy[2])
            if abs(den) < 1e-9:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
            l0 = ((sy[1] - sy[2]) * (gx - sx[2]) + (sx[2] - sx[1]) * (gy - sy[2])) / den
            l1 = ((sy[2] - sy[0]) * (gx - sx[2]) + (sx[0] - sx[2]) * (gy - sy[2])) / den
            l2 = 1 - l0 - l1
            dentro = (l0 >= -1e-6) & (l1 >= -1e-6) & (l2 >= -1e-6)
            if not dentro.any():
                continue
            inv = l0 / prof[0] + l1 / prof[1] + l2 / prof[2]           # 1/profundidad interpolada
            z = 1 / inv
            u = (l0 * us[0][0] / prof[0] + l1 * us[1][0] / prof[1] + l2 * us[2][0] / prof[2]) * z
            v = (l0 * us[0][1] / prof[0] + l1 * us[1][1] / prof[1] + l2 * us[2][1] / prof[2]) * z
            ti = np.clip((u * tw).astype(int), 0, tw - 1)
            tj = np.clip((v * th).astype(int), 0, th - 1)
            zsub = zbuf[y0:y1, x0:x1]
            gana = dentro & (z < zsub)
            zsub[gana] = z[gana]
            color[y0:y1, x0:x1][gana] = tex[tj, ti][gana]
            cubierto[y0:y1, x0:x1] |= gana

    # fondo damero (se ve lo transparente)
    yy, xx = np.mgrid[0:alto, 0:ancho]
    celda = 10 * escala * ss
    damero = (((xx // celda) + (yy // celda)) % 2).astype(bool)
    fondo = np.where(damero[..., None], np.float32([222, 227, 236]), np.float32([234, 238, 245]))
    final = np.where(cubierto[..., None], color, fondo)
    img = Image.fromarray(np.clip(final, 0, 255).astype(np.uint8)).resize((400 * escala, 240 * escala), Image.LANCZOS)
    cuadro = None
    if cubierto.any():
        ys, xs = np.where(cubierto)
        cuadro = [xs.min() / (ss * escala), ys.min() / (ss * escala), (xs.max() + 1) / (ss * escala), (ys.max() + 1) / (ss * escala)]
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 400 * escala - 1, 240 * escala - 1], outline=(120, 130, 150))
    if titulo:
        d.text((8, 6), titulo, fill=(90, 100, 120))
    img.save(ruta_png)
    return cuadro

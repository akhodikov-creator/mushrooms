# -*- coding: utf-8 -*-
"""Достаёт меши из .blend и складывает их в один .glb.

Blender-файл — внутренний формат, его не читает ни один браузерный
загрузчик, а Blender для экспорта здесь не установлен. Зато формат
разбирается: blender-asset-tracer даёт доступ к блокам и их DNA,
дальше остаётся вытащить вершины, полигоны и развёртку и записать
минимальный glTF.
"""
import json
import math
import pathlib
import struct
import sys

from blender_asset_tracer import blendfile

SRC = pathlib.Path(sys.argv[1])
DST = pathlib.Path(sys.argv[2])
TEX = sys.argv[3] if len(sys.argv) > 3 else None
TARGET_LEN = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0   # длина по большей оси, м


def read_array(block, count, item_size, fmt):
    """Сырые байты блока -> список кортежей по формату fmt."""
    bf = getattr(block, "bfile", None) or block.file
    bf.fileobj.seek(block.file_offset)
    raw = bf.fileobj.read(item_size * count)
    return [struct.unpack_from(fmt, raw, i * item_size) for i in range(count)]


def main():
    bf = blendfile.open_cached(SRC)

    verts, uvs, idx = [], [], []

    for ob in bf.blocks:
        if ob.dna_type_name != "Object" or ob[b"type"] != 1:
            continue
        me = ob.get_pointer(b"data")
        if me is None or me.dna_type_name != "Mesh":
            continue
        nv, npoly, nloop = me[b"totvert"], me[b"totpoly"], me[b"totloop"]
        if not nv or not npoly:
            continue

        mvert = me.get_pointer(b"mvert")
        mpoly = me.get_pointer(b"mpoly")
        mloop = me.get_pointer(b"mloop")
        mluv = me.get_pointer(b"mloopuv")
        assert mvert.dna_type.size == 20, mvert.dna_type.size
        assert mpoly.dna_type.size == 12, mpoly.dna_type.size
        assert mloop.dna_type.size == 8, mloop.dna_type.size

        co = read_array(mvert, nv, 20, "<3f")
        polys = read_array(mpoly, npoly, 12, "<2i")        # loopstart, totloop
        loops = read_array(mloop, nloop, 8, "<i")          # v
        # У MLoopUV кроме самих uv есть ещё flag, и шаг структуры не 8,
        # а 12 байт. Берём размер из DNA, а не на глаз.
        uvl = None
        if mluv is not None:
            uvl = read_array(mluv, nloop, mluv.dna_type.size, "<2f")
        print("  %-28s вершин %5d, UV %s" % (
            me.id_name.decode("utf-8", "replace")[2:], nv, "есть" if uvl else "НЕТ"))

        # obmat лежит по столбцам, как в OpenGL
        m = list(ob[b"obmat"])
        if m and hasattr(m[0], "__len__"):
            m = [v for col in m for v in col]

        def xform(p, m=m):
            x, y, z = p
            wx = m[0] * x + m[4] * y + m[8] * z + m[12]
            wy = m[1] * x + m[5] * y + m[9] * z + m[13]
            wz = m[2] * x + m[6] * y + m[10] * z + m[14]
            return (wx, wz, -wy)          # Blender Z-вверх -> glTF Y-вверх

        # Вершины дублируются на каждый луп: развёртка задана по лупам,
        # а не по вершинам, и общая вершина двух полигонов может иметь
        # два разных UV.
        for loopstart, totloop in polys:
            first = len(verts)
            for k in range(totloop):
                li = loopstart + k
                verts.append(xform(co[loops[li][0]]))
                uvs.append((uvl[li][0], 1.0 - uvl[li][1]) if uvl else (0.0, 0.0))
            for k in range(1, totloop - 1):
                idx.extend((first, first + k, first + k + 1))

    # Сварка: каждый луп дал свою вершину, и соседние полигоны с общим
    # краем и общим UV держат по копии. Их больше половины.
    key_to_new = {}
    remap = [0] * len(verts)
    wv, wu = [], []
    for i, v in enumerate(verts):
        key = (round(v[0], 5), round(v[1], 5), round(v[2], 5),
               round(uvs[i][0], 5), round(uvs[i][1], 5))
        j = key_to_new.get(key)
        if j is None:
            j = len(wv)
            key_to_new[key] = j
            wv.append(v)
            wu.append(uvs[i])
        remap[i] = j
    print("сварка: %d -> %d вершин" % (len(verts), len(wv)))
    verts, uvs = wv, wu
    idx = [remap[i] for i in idx]

    n = len(verts)
    print("вершин %d, треугольников %d" % (n, len(idx) // 3))

    # нормали по площади смежных граней
    norms = [[0.0, 0.0, 0.0] for _ in range(n)]
    for t in range(0, len(idx), 3):
        a, b, c = idx[t], idx[t + 1], idx[t + 2]
        ax, ay, az = verts[a]
        bx, by, bz = verts[b]
        cx, cy, cz = verts[c]
        ux, uy, uz = bx - ax, by - ay, bz - az
        vx, vy, vz = cx - ax, cy - ay, cz - az
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        for i in (a, b, c):
            norms[i][0] += nx
            norms[i][1] += ny
            norms[i][2] += nz
    for v in norms:
        L = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2) or 1.0
        v[0] /= L
        v[1] /= L
        v[2] /= L

    # в метры и на землю: центр по X/Z, подошва колёс на нуле
    xs = [v[0] for v in verts]
    ys = [v[1] for v in verts]
    zs = [v[2] for v in verts]
    size = (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    print("габарит исходника:", [round(s, 3) for s in size])
    k = (TARGET_LEN / max(size)) if TARGET_LEN else 1.0
    cx = (max(xs) + min(xs)) / 2
    cz = (max(zs) + min(zs)) / 2
    my = min(ys)
    verts = [((v[0] - cx) * k, (v[1] - my) * k, (v[2] - cz) * k) for v in verts]
    xs = [v[0] for v in verts]
    ys = [v[1] for v in verts]
    zs = [v[2] for v in verts]
    print("габарит в игре, м:", [round(max(a) - min(a), 3) for a in (xs, ys, zs)])

    # ---- сборка glb ----
    def pack(fmt, seq):
        out = bytearray()
        for v in seq:
            out += struct.pack(fmt, *v) if isinstance(v, (tuple, list)) else struct.pack(fmt, v)
        while len(out) % 4:
            out += b"\0"
        return bytes(out)

    b_pos = pack("<3f", verts)
    b_nrm = pack("<3f", [tuple(v) for v in norms])
    b_uv = pack("<2f", uvs)
    b_idx = pack("<I", idx)
    bin_blob = b_pos + b_nrm + b_uv + b_idx

    pmin = [min(v[i] for v in verts) for i in range(3)]
    pmax = [max(v[i] for v in verts) for i in range(3)]

    views = []
    off = 0

    def add(data, target):
        nonlocal off
        view = {"buffer": 0, "byteOffset": off, "byteLength": len(data), "target": target}
        views.append(view)
        off += len(data)
        return len(views) - 1

    v_pos = add(b_pos, 34962)
    v_nrm = add(b_nrm, 34962)
    v_uv = add(b_uv, 34962)
    v_idx = add(b_idx, 34963)

    accs = [
        {"bufferView": v_pos, "componentType": 5126, "count": n, "type": "VEC3",
         "min": pmin, "max": pmax},
        {"bufferView": v_nrm, "componentType": 5126, "count": n, "type": "VEC3"},
        {"bufferView": v_uv, "componentType": 5126, "count": n, "type": "VEC2"},
        {"bufferView": v_idx, "componentType": 5125, "count": len(idx), "type": "SCALAR"},
    ]

    gltf = {
        "asset": {"version": "2.0", "generator": "gribnik blend2glb"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": DST.stem}],
        "meshes": [{"name": DST.stem, "primitives": [{
            "attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2},
            "indices": 3, "material": 0}]}],
        "materials": [{"name": "body", "doubleSided": True, "pbrMetallicRoughness": {
            "baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0.05, "roughnessFactor": 0.85}}],
        "accessors": accs,
        "bufferViews": views,
        "buffers": [{"byteLength": len(bin_blob)}],
    }
    if TEX:
        gltf["images"] = [{"uri": TEX}]
        gltf["samplers"] = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}]
        gltf["textures"] = [{"sampler": 0, "source": 0}]
        gltf["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"] = {"index": 0}

    js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    while len(js) % 4:
        js += b" "

    total = 12 + 8 + len(js) + 8 + len(bin_blob)
    glb = b"glTF" + struct.pack("<II", 2, total)
    glb += struct.pack("<I", len(js)) + b"JSON" + js
    glb += struct.pack("<I", len(bin_blob)) + b"BIN\0" + bin_blob
    DST.write_bytes(glb)
    print("записано %s, %d КБ" % (DST, len(glb) // 1024))


main()

# -*- coding: utf-8 -*-
# Запуск: python tools/plants-geo.py <исходный .gltf> <папка вывода>  (после plants-atlas.py)
"""Геометрия кита -> компактный GLB.

   У каждого растения два меша: «__bark» (кора, своя замощённая текстура)
   и «__leaf» (вся листва, развёртка пересчитана в ячейку атласа).
   Материалов в файле нет вовсе — их назначает игра по имени меша.

   Опора: у дерева — ось ствола, у остальных — середина габарита,
   низ у всех приведён к нулю, чтобы ставить прямо на рельеф.
"""
import json, base64, struct, sys, os
import numpy as np

src, outdir = sys.argv[1], sys.argv[2]
d = json.load(open(src, encoding='utf-8'))
BLOB = base64.b64decode(d['buffers'][0]['uri'].split(',', 1)[1])
UV = json.load(open(os.path.join(outdir, 'atlas_uv.json'), encoding='utf-8'))

CT = {5120:'i1', 5121:'u1', 5122:'i2', 5123:'u2', 5125:'u4', 5126:'f4'}
NC = {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4}

def acc(i):
    a = d['accessors'][i]
    v = d['bufferViews'][a['bufferView']]
    off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = a['count'] * NC[a['type']]
    arr = np.frombuffer(BLOB, dtype=np.dtype('<' + CT[a['componentType']]), count=n, offset=off)
    return arr.reshape(a['count'], NC[a['type']]).astype(np.float32 if a['componentType'] == 5126 else np.uint32)

imgs = [im.get('name', '?') for im in d['images']]
texs = [t.get('source') for t in d['textures']]
def tex_of(mi):
    bc = d['materials'][mi].get('pbrMetallicRoughness', {}).get('baseColorTexture')
    return imgs[texs[bc['index']]] if bc else None

def node_matrix(n):
    if 'matrix' in n:
        return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
    M = np.eye(4)
    if 'scale' in n:  M = np.diag(list(n['scale']) + [1.0]) @ M
    if 'rotation' in n:
        x, y, z, w = n['rotation']
        R = np.array([
            [1-2*(y*y+z*z), 2*(x*y-z*w),   2*(x*z+y*w)],
            [2*(x*y+z*w),   1-2*(x*x+z*z), 2*(y*z-x*w)],
            [2*(x*z-y*w),   2*(y*z+x*w),   1-2*(x*x+y*y)]])
        T = np.eye(4); T[:3, :3] = R; M = T @ M
    if 'translation' in n:
        T = np.eye(4); T[:3, 3] = n['translation']; M = T @ M
    return M

plants = {}
for n in d['nodes']:
    if 'mesh' not in n: continue
    M = node_matrix(n)
    N3 = np.linalg.inv(M[:3, :3]).T          # нормали идут через обратную транспонированную
    bark, leaf = [], []
    for pr in d['meshes'][n['mesh']]['primitives']:
        tex = tex_of(pr['material']) if 'material' in pr else None
        P = acc(pr['attributes']['POSITION']).astype(np.float64)
        NR = acc(pr['attributes']['NORMAL']).astype(np.float64)
        T = acc(pr['attributes']['TEXCOORD_0']).astype(np.float64)
        I = acc(pr['indices']).astype(np.uint32).ravel()
        P = (P @ M[:3, :3].T) + M[:3, 3]
        NR = NR @ N3.T
        NR /= np.maximum(np.linalg.norm(NR, axis=1, keepdims=True), 1e-9)
        if tex == 'bark':
            bark.append((P, NR, T, I))
        else:
            ox, oy, sw, sh = UV[tex]
            # v в glTF считается сверху, ячейка задана снизу — отсюда 1-v
            u = ox + T[:, 0] * sw
            v = oy + (1.0 - T[:, 1]) * sh
            leaf.append((P, NR, np.stack([u, 1.0 - v], 1), I))
    plants[n['name']] = {'bark': bark, 'leaf': leaf}

def merge(parts):
    if not parts: return None
    Ps, Ns, Ts, Is, base = [], [], [], [], 0
    for P, NR, T, I in parts:
        Ps.append(P); Ns.append(NR); Ts.append(T); Is.append(I + base); base += len(P)
    return (np.concatenate(Ps), np.concatenate(Ns), np.concatenate(Ts), np.concatenate(Is))

# --- сборка glb ---
bin_parts, bviews, accessors, meshes, nodes = [], [], [], [], []
cursor = 0
def push(arr, target):
    global cursor
    b = arr.tobytes()
    pad = (-len(b)) % 4
    bviews.append({'buffer': 0, 'byteOffset': cursor, 'byteLength': len(b), 'target': target})
    bin_parts.append(b + b'\x00' * pad)
    cursor += len(b) + pad
    return len(bviews) - 1

def add_acc(arr, ctype, atype, target, minmax=False):
    bv = push(arr, target)
    a = {'bufferView': bv, 'componentType': ctype, 'count': len(arr), 'type': atype}
    if minmax:
        a['min'] = [float(x) for x in arr.min(0)]
        a['max'] = [float(x) for x in arr.max(0)]
    accessors.append(a)
    return len(accessors) - 1

report = []
for name in sorted(plants):
    pb, pl = merge(plants[name]['bark']), merge(plants[name]['leaf'])
    allP = np.concatenate([p[0] for p in (pb, pl) if p])
    # опора: ствол, если он есть, иначе середина габарита
    piv = (pb[0] if pb else allP)
    cx = (piv[:, 0].min() + piv[:, 0].max()) / 2
    cz = (piv[:, 2].min() + piv[:, 2].max()) / 2
    y0 = allP[:, 1].min()
    shift = np.array([cx, y0, cz])
    tri = 0
    for tag, part in (('bark', pb), ('leaf', pl)):
        if not part: continue
        P, NR, T, I = part
        P = (P - shift).astype(np.float32)
        prim = {'attributes': {
                    'POSITION':   add_acc(P, 5126, 'VEC3', 34962, True),
                    'NORMAL':     add_acc(NR.astype(np.float32), 5126, 'VEC3', 34962),
                    'TEXCOORD_0': add_acc(T.astype(np.float32), 5126, 'VEC2', 34962)},
                'indices': add_acc(I.astype(np.uint16), 5123, 'SCALAR', 34963),
                'mode': 4}
        meshes.append({'name': name + '__' + tag, 'primitives': [prim]})
        nodes.append({'name': name + '__' + tag, 'mesh': len(meshes) - 1})
        tri += len(I) // 3
    h = allP[:, 1].max() - y0
    report.append((name, h, tri))

gltf = {'asset': {'version': '2.0', 'generator': 'gribnik plants pack'},
        'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}],
        'nodes': nodes, 'meshes': meshes, 'accessors': accessors,
        'bufferViews': bviews, 'buffers': [{'byteLength': cursor}]}

BIN = b''.join(bin_parts)
JS = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
JS += b' ' * ((-len(JS)) % 4)
glb = (struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(JS) + 8 + len(BIN))
       + struct.pack('<II', len(JS), 0x4E4F534A) + JS
       + struct.pack('<II', len(BIN), 0x004E4942) + BIN)
out = os.path.join(outdir, 'plants.glb')
open(out, 'wb').write(glb)

print('%-14s %6s %7s' % ('растение', 'выс, м', 'тр'))
for nm, h, t in sorted(report, key=lambda r: -r[1]):
    print('%-14s %6.2f %7d' % (nm, h, t))
print('\nвсего треугольников:', sum(r[2] for r in report))
print('plants.glb: %.0f КБ, мешей %d' % (len(glb)/1024, len(meshes)))

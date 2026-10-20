"""Rebuild the lane network from the road class raster data/cls_src.png -> data/roads.json + data/cls.png.

The original skeleton (geo.json "roads") broke every lane into 2-3 point fragments: the map's
road-name text punched holes down the middle of lanes, so the skeleton split into parallel
zig-zag tracks (e.g. Railway Colony Rd). This version:
  1. takes cls == 1 (road) minus Mother Teresa Rd (modelled separately from GEO.main),
  2. closes text holes and fills small gaps,
  3. skeletonises, traces node-to-node polylines, prunes short spurs,
  4. simplifies (Douglas-Peucker) and smooths, and measures width from the distance transform.
Optionally names roads from an OpenStreetMap Overpass export (ODbL) if one is given.

usage: python pipeline/roads.py [osm.json]
"""
import base64, io, json, math, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage.morphology import skeletonize, binary_closing, disk, remove_small_holes, remove_small_objects

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = json.load(open(os.path.join(ROOT, 'data', 'geo.json')))
X0, X1, Y0, Y1 = G['bounds']; RES = G['res']
cls = np.array(Image.open(os.path.join(ROOT, 'data', 'cls_src.png')))  # traced raster (the one geo.json used to embed)
H, W = cls.shape
to_xy = lambda j, i: (X0 + (i + 0.5) * RES, Y1 - (j + 0.5) * RES)

# ---- 1. road mask without the main road ----
road = cls == 1
main = np.zeros_like(road)
jj, ii = np.mgrid[0:H, 0:W]
M = G['main']
for k in range(len(M) - 1):  # rasterise a buffer around the main-road centreline
    a, b = M[k], M[k + 1]
    hw = max(a[2], b[2]) / 2 + 1.5
    xa, ya, xb, yb = a[0], a[1], b[0], b[1]
    i0, i1 = int((min(xa, xb) - hw - X0) / RES) - 1, int((max(xa, xb) + hw - X0) / RES) + 2
    j0, j1 = int((Y1 - max(ya, yb) - hw) / RES) - 1, int((Y1 - min(ya, yb) + hw) / RES) + 2
    i0, j0 = max(i0, 0), max(j0, 0)
    sub_x = X0 + (ii[j0:j1, i0:i1] + 0.5) * RES; sub_y = Y1 - (jj[j0:j1, i0:i1] + 0.5) * RES
    dx, dy = xb - xa, yb - ya; L2 = dx * dx + dy * dy or 1
    t = np.clip(((sub_x - xa) * dx + (sub_y - ya) * dy) / L2, 0, 1)
    d = np.hypot(sub_x - xa - dx * t, sub_y - ya - dy * t)
    main[j0:j1, i0:i1] |= d < hw
lanes = road & ~main

# ---- 1b. map label text drawn on parks/fields/yards was classified as road (e.g. the park's name inside
# LDB Children's Park). Text is small blobs NOT connected to the road network: drop them before closing,
# and give their pixels back to the class that surrounds them.
lab, n = ndi.label(road)
sizes = ndi.sum(road, lab, range(1, n + 1))
edt = ndi.distance_transform_edt(road)
thick = ndi.maximum(edt, lab, range(1, n + 1))
# keep the connected network (>= 625 m2) and detached pieces that are lane-thick (>= 3 m wide) and >= 60 m2;
# label text strokes are only 1-2 px thick and POI icons are tiny
keep = (sizes >= 2500) | ((thick >= 3.0) & (sizes >= 250))
net = np.isin(lab, 1 + np.nonzero(keep)[0])
text = road & ~net
cls = cls.copy()
tl, tn = ndi.label(ndi.binary_dilation(text, iterations=2))
for k in range(1, tn + 1):
    m = tl == k
    ring = ndi.binary_dilation(m, iterations=3) & ~m & ~road
    vals = cls[ring]
    if vals.size: cls[m & text] = np.bincount(vals, minlength=10).argmax()
# label text inside the park and the field is lane-thick in places: nothing in there is a road
from matplotlib.path import Path as _Path
for key, cid in (('parkPoly', 4), ('fieldPoly', 5)):
    poly = _Path(G[key])
    xs = X0 + (np.arange(W) + 0.5) * RES; ys = Y1 - (np.arange(H) + 0.5) * RES
    bx = [p[0] for p in G[key]]; by = [p[1] for p in G[key]]
    ia, ib = np.searchsorted(xs, min(bx)), np.searchsorted(xs, max(bx)); ja, jb = np.searchsorted(-ys, -max(by)), np.searchsorted(-ys, -min(by))
    gx, gy = np.meshgrid(xs[ia:ib], ys[ja:jb])
    inside = poly.contains_points(np.c_[gx.ravel(), gy.ravel()]).reshape(gx.shape)
    sub = np.zeros_like(road); sub[ja:jb, ia:ib] = inside
    sub = ndi.binary_erosion(sub, iterations=2)  # keep the real roads running along the outline
    cls[sub & road] = cid; net &= ~sub
lanes &= net
print('removed', int(text.sum()), 'text/noise road pixels in', int(tn), 'blobs')

# ---- 2. close label-text holes, drop specks ----
lanes = binary_closing(lanes, disk(3))
lanes = remove_small_holes(lanes, 400)
lanes = remove_small_objects(lanes, 300)
# reconnect lanes to the main road: grow back 2 m into the main-road buffer so junction ends reach it
lanes_full = lanes | (ndi.binary_dilation(lanes, iterations=6) & road & main)
dist = ndi.distance_transform_edt(lanes_full) * RES  # metres to the nearest non-road pixel

# ---- 3. skeleton graph ----
sk = skeletonize(lanes_full)
nb = ndi.convolve(sk.astype(np.uint8), np.ones((3, 3), np.uint8), mode='constant') - 1
nb[~sk] = 0
nodes = sk & (nb != 2)
OFF = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
def nbrs(j, i):
    for dj, di in OFF:
        y, x = j + dj, i + di
        if 0 <= y < H and 0 <= x < W and sk[y, x]: yield y, x
visited = set(); paths = []
node_list = list(zip(*np.nonzero(nodes)))
for n in node_list:
    for q in nbrs(*n):
        e = (n, q) if n < q else (q, n)
        if e in visited: continue
        path = [n, q]; visited.add(e); prev, cur = n, q
        while not nodes[cur]:
            nxt = [p for p in nbrs(*cur) if p != prev and ((cur, p) if cur < p else (p, cur)) not in visited]
            if not nxt: break
            p = nxt[0]; visited.add((cur, p) if cur < p else (p, cur)); prev, cur = cur, p; path.append(cur)
        paths.append(path)
# pure loops without nodes
deg = {}
for p in paths:
    for end in (p[0], p[-1]): deg[end] = deg.get(end, 0) + 1

def length(p): return sum(math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]) for k in range(1, len(p))) * RES

# ---- prune short dead-end spurs (skeleton whiskers) ----
for _ in range(3):
    keep = []
    deg = {}
    for p in paths:
        for end in (p[0], p[-1]): deg[end] = deg.get(end, 0) + 1
    for p in paths:
        dead = deg[p[0]] == 1 or deg[p[-1]] == 1
        wmax = max(dist[j, i] for j, i in p)
        if dead and length(p) < max(6.0, 2.2 * wmax): continue
        keep.append(p)
    paths = keep

# ---- 4. merge through degree-2 nodes, simplify, smooth, widths ----
deg = {}
for p in paths:
    for end in (p[0], p[-1]): deg.setdefault(end, []).append(p)
merged, used = [], set()
for p in paths:
    if id(p) in used: continue
    used.add(id(p)); chain = list(p)
    for side in (0, 1):
        while True:
            end = chain[-1] if side == 0 else chain[0]
            cand = [q for q in deg.get(end, []) if id(q) not in used]
            if len(deg.get(end, [])) != 2 or not cand: break
            q = cand[0]; used.add(id(q)); q = q if q[0] == end else q[::-1]
            if side == 0: chain += q[1:]
            else: chain = q[::-1][:-1] + chain
    merged.append(chain)

def dp(pts, eps):
    if len(pts) < 3: return pts
    a, b = np.array(pts[0]), np.array(pts[-1]); ab = b - a; L = np.hypot(*ab) or 1e-9
    d = [abs(np.cross(ab, np.array(p) - a)) / L for p in pts[1:-1]]
    k = int(np.argmax(d)) + 1
    if d[k - 1] > eps: return dp(pts[:k + 1], eps)[:-1] + dp(pts[k:], eps)
    return [pts[0], pts[-1]]
def chaikin(pts, n=2):
    for _ in range(n):
        if len(pts) < 3: return pts
        out = [pts[0]]
        for a, b in zip(pts[:-1], pts[1:]):
            out += [(0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]), (0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1])]
        out.append(pts[-1]); pts = out
    return pts

roads = []
for c in merged:
    if length(c) < 4: continue
    ws = np.array([dist[j, i] for j, i in c]) * 2
    w = float(np.clip(np.median(ws), 3.0, 10.0))
    xy = [to_xy(j, i) for j, i in c]
    xy = chaikin(dp(xy, 0.6), 2)
    roads.append({'p': [[round(x, 1), round(y, 1)] for x, y in xy], 'w': round(w, 1)})

# ---- optional: names from OpenStreetMap (ODbL) ----
if len(sys.argv) > 1:
    osm = json.load(open(sys.argv[1]))
    named = []
    for wy in osm['elements']:
        n = wy.get('tags', {}).get('name')
        if not n or 'geometry' not in wy: continue
        named.append((n, [((g['lon'] - 91.79) * 99910, (g['lat'] - 26.1735) * 110800) for g in wy['geometry']]))
    def segd(x, y, pl):
        best = 1e9
        for a, b in zip(pl[:-1], pl[1:]):
            dx, dy = b[0] - a[0], b[1] - a[1]; L2 = dx * dx + dy * dy or 1
            t = max(0, min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)); best = min(best, math.hypot(x - a[0] - dx * t, y - a[1] - dy * t))
        return best
    for r in roads:
        pts = r['p'][::max(1, len(r['p']) // 6)]
        for n, pl in named:
            if all(segd(x, y, pl) < 6 for x, y in pts): r['name'] = n; break

# patched class raster: label-text holes inside lanes become road (so ground paint, grass and trees respect them)
cls_fixed = cls.copy()
cls_fixed[lanes_full & (cls == 0)] = 1
Image.fromarray(cls_fixed.astype(np.uint8), 'L').save(os.path.join(ROOT, 'data', 'cls.png'), 'PNG', optimize=True)  # served as its own file, decoded natively by geo.js
print('class raster: filled', int((lanes_full & (cls == 0)).sum()), 'hole pixels')

out = {'_about': 'Lane centrelines rebuilt from the road class raster by pipeline/roads.py (Mother Teresa Rd excluded; see GEO.main). w = carriageway width in metres from the distance transform. Names, where present, from OpenStreetMap (ODbL).',
       'roads': roads}
json.dump(out, open(os.path.join(ROOT, 'data', 'roads.json'), 'w'), separators=(',', ':'))
ls = sorted(length([(0, 0)]) for _ in [0])
print(f'{len(roads)} roads (was {len(G["roads"])}), total {sum(math.hypot(b[0]-a[0], b[1]-a[1]) for r in roads for a, b in zip(r["p"][:-1], r["p"][1:])):.0f} m, '
      f'median w {np.median([r["w"] for r in roads]):.1f} m, named {sum("name" in r for r in roads)}')

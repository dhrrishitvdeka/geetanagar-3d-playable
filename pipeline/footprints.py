"""Footprint fixes for data/geo.json buildings -> data/footprint_fixes.json.

The footprints were traced from Google Maps, so neighbouring houses are often one blob, and a few
traced shapes are walls or hedges. This script never edits geo.json. It writes a patch that
src/core/geo.js applies at load:
  replace: {"<index>": {p, a, c, k, d, src, note}}   new shape for an existing index (a split's part 0)
  append:  [{p, a, c, k, d, from, src, note}]         extra parts, added at the END of the array
  skip:    {"<index>": "note"}                        not a building; geo.js empties its polygon
Existing indices are never moved or removed, so data/buildings_overrides.json stays valid.

Part 1 is the explicit list below (checked on Street View and the class raster). Part 2 is a
conservative generic split of other big blobs where the raster shows a clear neck.

usage: python pipeline/footprints.py [--preview DIR]   (also writes a PNG of every change into DIR)
"""
import base64, io, json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from matplotlib.path import Path as MPath
from skimage.measure import find_contours, approximate_polygon
from skimage.morphology import h_maxima, disk
from skimage.segmentation import watershed

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = json.load(open(os.path.join(ROOT, 'data', 'geo.json')))
OV = json.load(open(os.path.join(ROOT, 'data', 'buildings_overrides.json')))
B = G['buildings']; N0 = len(B)
X0, X1, Y0, Y1 = G['bounds']; RES = G['res']
cls = np.array(Image.open(os.path.join(ROOT, 'data', 'cls_src.png')))  # traced raster (geo.json no longer embeds it)
H, W = cls.shape
road_dist = ndi.distance_transform_edt(cls != 1) * RES  # metres to the nearest road pixel

MIN_PART = 25.0       # m2, smallest part we keep
GEN_MIN_AREA = 600.0  # generic splitting only looks at blobs bigger than this
GEN_PART = 150.0      # every generic part must be at least this big
GEN_NECK = 0.55       # neck half-width must be under this share of the smaller peak's radius


def px(x, y): return int((x - X0) / RES), int((Y1 - y) / RES)
def area(p): return abs(sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p)))) / 2


def poly_mask(poly, pad=3):
    """rasterise a polygon on the class grid; returns (mask, i0, j0)"""
    xs = [q[0] for q in poly]; ys = [q[1] for q in poly]
    i0, j1 = px(min(xs), min(ys)); i1, j0 = px(max(xs), max(ys))
    i0, j0, i1, j1 = max(i0 - pad, 0), max(j0 - pad, 0), min(i1 + pad + 1, W), min(j1 + pad + 1, H)
    gi, gj = np.meshgrid(np.arange(i0, i1), np.arange(j0, j1))
    gx = X0 + (gi + 0.5) * RES; gy = Y1 - (gj + 0.5) * RES
    m = MPath(poly).contains_points(np.c_[gx.ravel(), gy.ravel()]).reshape(gx.shape)
    return m, i0, j0


def grid_xy(shape, i0, j0):
    gi, gj = np.meshgrid(np.arange(i0, i0 + shape[1]), np.arange(j0, j0 + shape[0]))
    return X0 + (gi + 0.5) * RES, Y1 - (gj + 0.5) * RES


def mask_to_poly(m, i0, j0, tol=0.4):
    """largest connected piece of a mask -> simplified CCW ring in local metres (or None)"""
    lab, n = ndi.label(m)
    if n == 0: return None
    keep = lab == (1 + int(np.argmax(ndi.sum(m, lab, range(1, n + 1)))))
    keep = ndi.binary_fill_holes(keep)
    f = ndi.gaussian_filter(np.pad(keep, 2).astype(float), 0.6)
    cs = find_contours(f, 0.5)
    if not cs: return None
    c = approximate_polygon(max(cs, key=len), tol / RES)[:-1]
    ring = [[round(X0 + (i0 - 2 + col + 0.5) * RES, 1), round(Y1 - (j0 - 2 + row + 0.5) * RES, 1)] for row, col in c]
    if len(ring) < 3: return None
    s = sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring)))
    return ring if s > 0 else ring[::-1]  # buildings.js expects CCW


def road_at(x, y):
    i, j = px(x, y); return float(road_dist[min(max(j, 0), H - 1), min(max(i, 0), W - 1)])


def describe(parent, ring, src, note, frm=None):
    """a/c/k/d for a new ring. d follows the parent: its change in distance to the nearest road pixel."""
    cx = sum(q[0] for q in ring) / len(ring); cy = sum(q[1] for q in ring) / len(ring)
    m, i0, j0 = poly_mask(ring, 0)
    share = float((cls[j0:j0 + m.shape[0], i0:i0 + m.shape[1]][m] == 3).mean()) if m.any() else 0.0
    pc = B[parent]['c']
    d = round(max(0.0, B[parent]['d'] + road_at(cx, cy) - road_at(pc[0], pc[1])), 1)
    out = {'p': ring, 'a': round(area(ring), 1), 'c': [round(float(cx), 1), round(float(cy), 1)], 'k': 1 if share > 0.5 else 0, 'd': d, 'src': src, 'note': note}
    if frm is not None: out['from'] = frm
    return out


# ---------- part 1: the explicit list ----------
# each part is (region test on x, y, src, note). Part 0 replaces the index, the rest are appended.
def X(lo, hi): return lambda x, y: (x >= lo) & (x < hi)
def box(x0, x1, y0, y1): return lambda x, y: (x >= x0) & (x < x1) & (y >= y0) & (y < y1)

EXPLICIT = {
    909: [  # Street View: the yellow 6-storey block ends near x -460; at x -449 there is a walled garden with a small hut
        (X(-500, -460), 'streetview', 'yellow 6-storey apartment only (x -484..-460); the traced blob ran on 25 m too far'),
        (box(-452.5, -446, -102, -92.5), 'estimated', 'small single-storey building in the garden compound at x -449 (green gate); position from Street View, size guessed'),
    ],
    912: [  # two cream apartment blocks: the long west one (x -296 S) and the east one (x -266 S); a small block sits between
        (X(-310, -289.5), 'satellite+cls', 'west cream apartment block, the long strip at x -302..-289; keeps the 912 override'),
        (X(-276.5, -250), 'satellite+cls', 'east cream apartment block (x -276..-256), the other half of the merged 912 blob'),
        (X(-289.5, -276.5), 'satellite+cls', 'square block between the two apartments, shop class on the raster; height not seen'),
    ],
    889: [  # pink coaching centre, middle house, yellow house: three lobes with necks at x ~6.5 and x ~25
        (X(-30, 6.5), 'satellite+cls', 'west lobe: pink 3-storey coaching centre (x -4 S); keeps the 889 override'),
        (box(6.5, 25, -130, -80), 'satellite+cls', 'middle lobe between the coaching centre and the yellow house'),
        (box(25, 60, -130, -80), 'satellite+cls', 'east lobe: probably the yellow 2-storey house (x 27 S)'),
    ],
    775: [  # 996 m2 blob: west house, main body, and a south lobe that looks like the yellow Assam house west of 783
        (box(-280, -257.5, -31.5, 0), 'satellite+cls', 'west house (x -273..-258)'),
        (box(-257.5, -220, -31.5, 0), 'satellite+cls', 'main body, east part of the blob'),
        (box(-254, -231, -45, -31.5), 'satellite+cls', 'south lobe at (-243,-35): most likely the yellow single-storey tin-roof Assam house seen west of 783 on Street View'),
    ],
}
SKIP = {
    803: 'vegetated earth slope with a brick retaining wall on Street View (x 21..30), not a house',
    835: 'a 28 m long, 3 m wide strip: a boundary wall / hoarding, Street View shows only vegetation there',
}


def split_explicit(i, parts):
    m, i0, j0 = poly_mask(B[i]['p'])
    m = ndi.binary_opening(m, structure=np.ones((3, 3)))  # drop 1 px spikes in the traced outline
    gx, gy = grid_xy(m.shape, i0, j0)
    rings = []
    for reg, src, note in parts:
        r = mask_to_poly(m & reg(gx, gy), i0, j0)
        if r is None or area(r) < MIN_PART: sys.exit('explicit split %d: part "%s" came out empty' % (i, note))
        rings.append((r, src, note))
    return rings


# ---------- part 2: generic neck splitting ----------
def lm_blobs():
    """buildings we never split: the ones near a landmark label (school, temple, bank, namghar). src/world/landmarks.js
    picks the building nearest such a label by centroid, so a new part must not steal that match."""
    out = set()
    for L in G['labels'] + [{'k': 'lm', 'x': 49.5, 'y': -33.5}]:  # the mandir gate label is added in geo.js
        if L.get('k') != 'lm': continue
        for i, b in enumerate(B):
            if min(math.hypot(q[0] - L['x'], q[1] - L['y']) for q in b['p']) < 40: out.add(i)
    return out


def generic(i):
    """watershed on the distance transform; (masks, i0, j0) when every cut is a clear neck, else None"""
    m, i0, j0 = poly_mask(B[i]['p'])
    m = ndi.binary_opening(m, structure=disk(1))
    dt = ndi.gaussian_filter(ndi.distance_transform_edt(np.pad(m, 1))[1:-1, 1:-1] * RES, 0.8)
    mk, n = ndi.label(h_maxima(dt, 0.8) & (dt >= 2.5))  # peak radius >= 2.5 m: a building at least 5 m wide
    if n < 2: return None
    ws = watershed(-dt, mk, mask=m)
    # merge the neighbour pair with the weakest neck (or a too-small side) until only clear necks are left
    while True:
        ids = [k for k in np.unique(ws) if k]
        if len(ids) < 2: return None
        pk = {k: dt[ws == k].max() for k in ids}
        worst = None
        for a in ids:
            for b in ids:
                if a >= b: continue
                touch = ndi.binary_dilation(ws == a, np.ones((3, 3))) & (ws == b)
                if not touch.any(): continue
                ratio = dt[touch].max() / min(pk[a], pk[b])
                small = min((ws == a).sum(), (ws == b).sum()) * RES * RES < GEN_PART
                if ratio > GEN_NECK or small:
                    score = ratio + (1 if small else 0)
                    if worst is None or score > worst[0]: worst = (score, a, b)
        if worst is None: break
        ws[ws == worst[2]] = worst[1]
    ids = [k for k in np.unique(ws) if k]
    if len(ids) < 2: return None
    ids.sort(key=lambda k: -(ws == k).sum())
    return [ws == k for k in ids], i0, j0


def preview(pdir, changed):
    os.makedirs(pdir, exist_ok=True)
    pal = {0: (235, 230, 215), 1: (120, 120, 120), 2: (200, 120, 90), 3: (230, 170, 60), 4: (120, 190, 120), 5: (190, 220, 140)}
    cols = [(0, 0, 255), (220, 0, 0), (0, 150, 0), (150, 0, 150)]
    for i, rings in changed.items():
        xs = [q[0] for q in B[i]['p']]; ys = [q[1] for q in B[i]['p']]
        a0, b1 = px(min(xs) - 8, min(ys) - 8); a1, b0 = px(max(xs) + 8, max(ys) + 8)
        a0, b0 = max(a0, 0), max(b0, 0)
        sub = cls[b0:b1, a0:a1]; im = np.zeros(sub.shape + (3,), np.uint8)
        for k, c in pal.items(): im[sub == k] = c
        sc = 6; img = Image.fromarray(im).resize((im.shape[1] * sc, im.shape[0] * sc), Image.NEAREST); d = ImageDraw.Draw(img)
        f = lambda x, y: ((x - X0) / RES * sc - a0 * sc, (Y1 - y) / RES * sc - b0 * sc)
        d.line([f(*q) for q in B[i]['p'] + [B[i]['p'][0]]], fill=(0, 0, 0), width=1)
        for n, r in enumerate(rings): d.line([f(*q) for q in r + [r[0]]], fill=cols[n % 4], width=2)
        img.save(os.path.join(pdir, 'fix_%d.png' % i))


def main():
    fixes = {'_about': 'Footprint patch for GEO.buildings, written by pipeline/footprints.py and applied in src/core/geo.js. '
             '"replace" gives a new shape to an existing index (part 0 of a split). "append" parts are added at the END of the array, '
             'so no existing index moves. "skip" marks indices that are not buildings (their polygon is emptied). '
             'src: streetview | satellite+cls | estimated.', 'replace': {}, 'append': [], 'skip': {}}
    changed = {}
    for i, parts in EXPLICIT.items():
        rings = split_explicit(i, parts)
        fixes['replace'][str(i)] = describe(i, *rings[0])
        for r, src, note in rings[1:]: fixes['append'].append(describe(i, r, src, note, i))
        changed[i] = [r for r, _, _ in rings]
    for i, note in SKIP.items(): fixes['skip'][str(i)] = note
    gen = []
    protect = set(EXPLICIT) | set(SKIP) | {int(k) for k in OV if k.isdigit()} | lm_blobs()
    for i, b in enumerate(B):
        if b['a'] < GEN_MIN_AREA or i in protect: continue
        g = generic(i)
        if not g: continue
        masks, i0, j0 = g
        rings = [mask_to_poly(mm, i0, j0) for mm in masks]
        if any(r is None or area(r) < GEN_PART for r in rings): continue
        fixes['replace'][str(i)] = describe(i, rings[0], 'satellite+cls', 'generic split at a narrow neck in the class raster, part 0 of %d' % len(rings))
        for r in rings[1:]: fixes['append'].append(describe(i, r, 'satellite+cls', 'generic split at a narrow neck in the class raster', i))
        changed[i] = rings; gen.append(i)
    out = os.path.join(ROOT, 'data', 'footprint_fixes.json')
    json.dump(fixes, open(out, 'w'), separators=(',', ':'))
    print('explicit', sorted(EXPLICIT), 'skip', sorted(SKIP), 'generic', gen)
    print('replace', len(fixes['replace']), 'append', len(fixes['append']), 'skip', len(fixes['skip']), '->', out)
    for k, v in enumerate(fixes['append']): print('  new index', N0 + k, 'from', v['from'], 'area', v['a'], 'c', v['c'], 'k', v['k'], 'd', v['d'], v['src'])
    for i in fixes['replace']: print('  replace', i, 'area', fixes['replace'][i]['a'], 'was', B[int(i)]['a'])
    if '--preview' in sys.argv: preview(sys.argv[sys.argv.index('--preview') + 1], changed)


if __name__ == '__main__': main()

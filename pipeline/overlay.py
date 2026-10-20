"""Overlay data/geo.json on a Google Maps screenshot to check alignment.

usage: python pipeline/overlay.py <screenshot> <lat> <lon> <view_height_m> <out.png> [--no-buildings] [--new-roads]

The screenshot must show the map centred on <lat>,<lon>; <view_height_m> is the "NNNm" value in the
Maps URL (visible height of the viewport in metres), so metres-per-pixel = view_height_m / image_height.
Red = lane centrelines (GEO.roads), yellow = Mother Teresa Rd edges (GEO.main), cyan = footprints,
magenta = labels, green = field/park outlines.
"""
import json, os, sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAT0, LON0, MLAT, MLON = 26.1735, 91.79, 110800.0, 99910.0

def main(a):
    src, lat, lon, vh, out = a[0], float(a[1]), float(a[2]), float(a[3]), a[4]
    G = json.load(open(os.path.join(ROOT, 'data', 'geo.json')))
    im = Image.open(src).convert('RGB'); W, H = im.size
    mpp = vh / H
    cx, cy = (lon - LON0) * MLON, (lat - LAT0) * MLAT
    px = lambda x, y: (W / 2 + (x - cx) / mpp, H / 2 - (y - cy) / mpp)
    ov = Image.new('RGBA', im.size, (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    if '--no-buildings' not in a:
        for b in G['buildings']:
            d.polygon([px(*p) for p in b['p']], outline=(0, 255, 255, 200))
    roads = json.load(open(os.path.join(ROOT, 'data', 'roads.json')))['roads'] if '--new-roads' in a else G['roads']
    for r in roads:
        d.line([px(*p[:2]) for p in r['p']], fill=(255, 40, 40, 230), width=2)
        if '--new-roads' in a:  # carriageway edges
            import math as _m
            for s_ in (1, -1):
                q = r['p']; e = []
                for k, pt in enumerate(q):
                    u, v = q[max(0, k - 1)], q[min(len(q) - 1, k + 1)]; dx, dy = v[0] - u[0], v[1] - u[1]; L = _m.hypot(dx, dy) or 1
                    e.append(px(pt[0] - dy / L * s_ * r['w'] / 2, pt[1] + dx / L * s_ * r['w'] / 2))
                d.line(e, fill=(255, 150, 0, 160), width=1)
    import math
    M = G['main']
    for s in (1, -1):
        pts = []
        for i, p in enumerate(M):
            q, r = M[max(0, i - 1)], M[min(len(M) - 1, i + 1)]
            dx, dy = r[0] - q[0], r[1] - q[1]; L = math.hypot(dx, dy) or 1
            pts.append(px(p[0] - dy / L * s * p[2] / 2, p[1] + dx / L * s * p[2] / 2))
        d.line(pts, fill=(255, 230, 0, 230), width=2)
    for k in ('fieldPoly', 'parkPoly'):
        d.polygon([px(*p) for p in G[k]], outline=(60, 255, 60, 255))
    for L in G['labels']:
        x, y = px(L['x'], L['y']); d.ellipse([x - 4, y - 4, x + 4, y + 4], fill=(255, 0, 255, 255)); d.text((x + 6, y - 6), L['t'], fill=(255, 0, 255, 255))
    Image.alpha_composite(im.convert('RGBA'), ov).convert('RGB').save(out)
    print('saved', out, f'{mpp:.3f} m/px, centre local ({cx:.1f}, {cy:.1f})')

if __name__ == '__main__':
    main(sys.argv[1:])

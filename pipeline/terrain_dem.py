"""Real terrain for Geetanagar from Copernicus GLO-30 (DSM, 1 arc-second).

usage (run isolated, the tile is a downloaded file):
    python -I pipeline/terrain_dem.py <Copernicus_DSM_COG_10_N26_00_E091_00_DEM.tif> data/geo.json data/terrain.json

Source tile (ESA Copernicus DEM GLO-30, AWS open data):
    https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N26_00_E091_00_DEM/Copernicus_DSM_COG_10_N26_00_E091_00_DEM.tif

Output (data/terrain.json):
    hgrid: same grid as geo.json's hgrid (x0, y0, step 5 m, nx, ny) but b64 of uint16 LE decimetres (enc field), so hills above 63.75 m fit.
           Heights are metres above Mother Teresa Rd; the road corridor and Geetanagar Field are flattened to 0.
    outer: a 60 m grid over +-4.5 km for the hills around the city (world/outer.js), b64 of uint16 LE = (metres + 50) * 10.
    meta:  datum and calibration numbers.

Steps: decode the needed COG tiles (DEFLATE + floating-point predictor, decoded here so only numpy/scipy/tifffile are needed),
grey-opening to strip buildings and isolated trees from the surface model, bilinear resample to the local grid
(x = (lon - 91.79) * 99910, y = (lat - 26.1735) * 110800), subtract the road profile, soft-flatten the plain, scale the
ridge so the View point sits ~38 m above the road (the DSM includes the forest canopy), flatten road and field.
"""
import base64
import json
import sys
import zlib

import numpy as np
import tifffile
from scipy import ndimage

LAT0, LON0, KX, KY = 26.1735, 91.79, 99910.0, 110800.0
VP_TARGET = 38.0


def read_window(path, lat_min, lat_max, lon_min, lon_max):
    """Return (array, lat_top, lon_left, dlat, dlon) for the pixels covering the window."""
    with tifffile.TiffFile(path) as tf:
        p = tf.pages[0]
        sx, sy = p.tags['ModelPixelScaleTag'].value[:2]
        tp = p.tags['ModelTiepointTag'].value
        lon_left, lat_top = tp[3], tp[4]
        # raster type: 1 = PixelIsArea (tiepoint at pixel corner), 2 = PixelIsPoint (tiepoint at pixel centre)
        keys = p.tags['GeoKeyDirectoryTag'].value if 'GeoKeyDirectoryTag' in p.tags else ()
        raster_type = 1
        for k in range(4, len(keys), 4):
            if keys[k] == 1025:
                raster_type = keys[k + 3]
        if raster_type == 1:  # move the reference to the centre of pixel (0, 0)
            lon_left += sx / 2
            lat_top -= sy / 2
        W, H = p.imagewidth, p.imagelength
        tw, th = p.tilewidth, p.tilelength
        c0 = max(0, int((lon_min - lon_left) / sx) - 2); c1 = min(W - 1, int((lon_max - lon_left) / sx) + 2)
        r0 = max(0, int((lat_top - lat_max) / sy) - 2); r1 = min(H - 1, int((lat_top - lat_min) / sy) + 2)
        out = np.zeros((r1 - r0 + 1, c1 - c0 + 1), np.float32)
        ntx = (W + tw - 1) // tw
        fh = tf.filehandle
        assert p.compression == 8 and p.predictor == 3, (p.compression, p.predictor)
        for ty in range(r0 // th, r1 // th + 1):
            for tx in range(c0 // tw, c1 // tw + 1):
                i = ty * ntx + tx
                fh.seek(p.dataoffsets[i]); raw = zlib.decompress(fh.read(p.databytecounts[i]))
                b = np.frombuffer(raw, np.uint8).reshape(th, 4 * tw).astype(np.int64)
                b = np.cumsum(b, axis=1) % 256                     # undo the horizontal byte differencing
                b = b.astype(np.uint8).reshape(th, 4, tw).transpose(0, 2, 1)  # byte planes, most significant first
                tile = b.copy().view('>f4').reshape(th, tw).astype(np.float32)
                ys, xs = ty * th, tx * tw
                a0, a1 = max(r0, ys), min(r1, ys + th - 1); b0, b1 = max(c0, xs), min(c1, xs + tw - 1)
                out[a0 - r0:a1 - r0 + 1, b0 - c0:b1 - c0 + 1] = tile[a0 - ys:a1 - ys + 1, b0 - xs:b1 - xs + 1]
        return out, lat_top - r0 * sy, lon_left + c0 * sx, sy, sx


def sampler(dem, lat_top, lon_left, dlat, dlon):
    def f(x, y):
        lat = LAT0 + y / KY; lon = LON0 + x / KX
        r = (lat_top - lat) / dlat; c = (lon - lon_left) / dlon
        return ndimage.map_coordinates(dem, [np.atleast_1d(r), np.atleast_1d(c)], order=1, mode='nearest')
    return f


def point_in_poly(x, y, poly):
    inside = np.zeros(x.shape, bool)
    n = len(poly)
    for i in range(n):
        (ax, ay), (bx, by) = poly[i], poly[i - 1]
        cond = ((ay > y) != (by > y)) & (x < (bx - ax) * (y - ay) / (by - ay + 1e-9) + ax)
        inside ^= cond
    return inside


def main():
    tif, geo_path, out_path = sys.argv[1:4]
    geo = json.load(open(geo_path))
    HG = geo['hgrid']
    R = 4600
    lat_min, lat_max = LAT0 - R / KY, LAT0 + R / KY
    lon_min, lon_max = LON0 - R / KX, LON0 + R / KX
    dem, lat_top, lon_left, dlat, dlon = read_window(tif, lat_min, lat_max, lon_min, lon_max)
    print('window', dem.shape, 'raw min/max %.1f %.1f' % (dem.min(), dem.max()))
    # bare-earth approximation: grey opening (erode then dilate) over ~90 m removes houses and isolated trees,
    # then a light Gaussian removes the 30 m stair-stepping
    ground = ndimage.grey_opening(dem, size=(3, 3))
    ground = ndimage.gaussian_filter(ground, 0.8)
    S = sampler(ground, lat_top, lon_left, dlat, dlon)

    # road datum: the opened surface along Mother Teresa Rd, smoothed along the road (~150 m window)
    main_pts = np.array([[p[0], p[1]] for p in geo['main']])
    road_raw = S(main_pts[:, 0], main_pts[:, 1])
    road = ndimage.uniform_filter1d(road_raw, size=31, mode='nearest')
    print('road level asl: %.1f .. %.1f (mean %.1f)' % (road.min(), road.max(), road.mean()))

    def road_level(x, y):
        # nearest road sample, by distance (vectorised over a flat array of points)
        d2 = (x[:, None] - main_pts[None, :, 0]) ** 2 + (y[:, None] - main_pts[None, :, 1]) ** 2
        return road[np.argmin(d2, axis=1)], np.sqrt(d2.min(axis=1))

    nx, ny, st, x0, y0 = HG['nx'], HG['ny'], HG['step'], HG['x0'], HG['y0']
    gx, gy = np.meshgrid(x0 + np.arange(nx) * st, y0 + np.arange(ny) * st)
    fx, fy = gx.ravel(), gy.ravel()
    rl = np.empty_like(fx); dist = np.empty_like(fx)
    for k in range(0, fx.size, 4000):
        rl[k:k + 4000], dist[k:k + 4000] = road_level(fx[k:k + 4000], fy[k:k + 4000])
    rel = S(fx, fy) - rl
    # soft-flatten the plain: residual relief under ~2 m is surface noise (walls, sheds, canopy edges) in a DSM
    soft = np.where(rel > 4, rel - 2, np.maximum(rel, 0) ** 2 / 8)
    vp = geo['viewpoint']
    vi = int(round((vp[1] - y0) / st)) * nx + int(round((vp[0] - x0) / st))
    vp_raw = float(soft[vi])
    scale = VP_TARGET / vp_raw if vp_raw > 1 else 1.0
    h = soft * scale
    print('View point raw %.1f m above road -> scale %.3f' % (vp_raw, scale))
    # flatten the road corridor and Geetanagar Field, blending over 12 m
    widths = np.array([p[2] for p in geo['main']])
    wnear = np.empty_like(fx)
    for k in range(0, fx.size, 4000):
        d2 = (fx[k:k + 4000, None] - main_pts[None, :, 0]) ** 2 + (fy[k:k + 4000, None] - main_pts[None, :, 1]) ** 2
        wnear[k:k + 4000] = widths[np.argmin(d2, axis=1)] / 2
    t = np.clip((dist - (wnear + 4)) / 12, 0, 1)
    h *= t * t * (3 - 2 * t)
    fp = geo['fieldPoly']
    inf = point_in_poly(fx, fy, fp)
    fmask = inf.reshape(ny, nx).astype(float)
    fdist = ndimage.distance_transform_edt(1 - fmask) * st
    tf_ = np.clip((fdist.ravel() - 3) / 12, 0, 1)
    h *= tf_ * tf_ * (3 - 2 * tf_)
    h = np.clip(h, 0, 6000)
    q = np.round(h * 10).astype('<u2').reshape(ny, nx)
    print('local grid: max %.1f m, mean %.2f m, field max %.2f, road max %.2f' % (h.max(), h.mean(), h[inf].max() if inf.any() else 0, h[dist < 4].max()))

    # outer ring: 60 m grid +-4.5 km, metres relative to the mean road level, not flattened
    OS, ON = 60.0, 151
    ox0 = -OS * (ON - 1) / 2
    ogx, ogy = np.meshgrid(ox0 + np.arange(ON) * OS, ox0 + np.arange(ON) * OS)
    G2 = sampler(ndimage.gaussian_filter(ndimage.grey_opening(dem, size=(3, 3)), 1.2), lat_top, lon_left, dlat, dlon)
    oh = (G2(ogx.ravel(), ogy.ravel()) - road.mean()) * scale
    oq = np.round((np.clip(oh, -50, 6000) + 50) * 10).astype('<u2').reshape(ON, ON)
    print('outer: min %.1f max %.1f m' % (oh.min(), oh.max()))

    out = {
        'source': 'Copernicus DEM GLO-30 (DSM), tile Copernicus_DSM_COG_10_N26_00_E091_00_DEM; (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA; all rights reserved. Processed by pipeline/terrain_dem.py.',
        'hgrid': {'x0': x0, 'y0': y0, 'step': st, 'nx': nx, 'ny': ny, 'b64': base64.b64encode(q.tobytes()).decode(), 'enc': 'uint16le decimetres'},
        'outer': {'x0': ox0, 'y0': ox0, 'step': OS, 'nx': ON, 'ny': ON, 'b64': base64.b64encode(oq.tobytes()).decode(), 'enc': 'uint16le (m + 50) * 10'},
        'meta': {'roadDatumAsl': round(float(road.mean()), 2), 'roadAslMin': round(float(road.min()), 2), 'roadAslMax': round(float(road.max()), 2),
                 'viewpointRawAboveRoad': round(vp_raw, 2), 'ridgeScale': round(scale, 4), 'opening': '3x3 px grey opening + gaussian 0.8 px'},
    }
    json.dump(out, open(out_path, 'w'))
    print('wrote', out_path)


if __name__ == '__main__':
    main()

# Credits

Only assets that allow free use (CC0 / MIT) belong in this project. Items marked **verify** came in with the prototype without a recorded source; confirm them before any public release.

## Libraries

| Library | Licence | Use |
|---|---|---|
| [three.js](https://github.com/mrdoob/three.js) r186 | MIT | Rendering, loaders, OrbitControls |
| [Vite](https://vitejs.dev) | MIT | Dev server and build |
| [EZ-Tree](https://github.com/dgreenheck/ez-tree) by Daniel Greenheck | MIT | Procedural trees, baked to `public/assets/trees.glb` by the prototype's generator |

## Assets (`public/assets/`)

| File | Source | Licence |
|---|---|---|
| `trees.glb` | Baked from EZ-Tree presets (THREE.GLTFExporter r167) | MIT (generator) |
| `oak_color_1k.jpg`, `oak_normal_1k.jpg`, `birch_color_1k.jpg` | Bark textures shipped with EZ-Tree, originally Poly Haven | CC0 (**verify** exact Poly Haven pages) |
| `oak_color.png`, `ash_color.png`, `aspen_color.png` | Leaf cards shipped with EZ-Tree | **verify** (EZ-Tree repo is MIT; upstream origin unrecorded) |
| `flower_white.glb`, `flower_yellow.glb` | Same filenames as EZ-Tree's demo assets (Blender glTF exporter 4.2) | **verify** |
| `grass.jpg`, `dirt_color.jpg`, `dirt_normal.jpg` | Same filenames as EZ-Tree's demo assets | **verify** |
| `env.exr` | Poly Haven HDRI (512×256, DWAB) | CC0 (**verify** which HDRI) |
| `chars/male.glb`, `chars/female.glb`, `chars/hair.glb` | Universal Base Characters (Standard) by Quaternius, https://quaternius.itch.io/universal-base-characters. Bodies, eyes, eyebrows and hairstyles, textures downscaled and repacked by `pipeline/chars_build.mjs` | CC0 |
| `chars/anims.glb` | Universal Animation Library (Standard) by Quaternius, https://quaternius.itch.io/universal-animation-library. 16 of its 43 clips, trimmed by `pipeline/chars_build.mjs` | CC0 |

## Data

| Data | Source |
|---|---|
| Building footprints, roads, class raster, field/park outlines, labels | Traced from Google Maps screenshots (z18) and satellite view. Used here as a private reference model; Google Maps content is not openly licensed, so check Google's terms before publishing a build that contains derived data. |
| Road names (31 lanes in data/roads.json) | © OpenStreetMap contributors, ODbL 1.0 (openstreetmap.org/copyright). Only names are used; the geometry comes from our own raster. |
| Terrain heights (`data/terrain.json`) | Copernicus GLO-30 DEM via `pipeline/terrain_dem.py`, with the road and field flattened and hills scaled so the View point is 38 m (attribution below). The old hillshade `hgrid` is kept only as a fallback. |
| Street-level details | Visual reference from Google Street View (Mar 2026) |

Copernicus GLO-30 DEM: © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA; all rights reserved. Free to use with attribution.

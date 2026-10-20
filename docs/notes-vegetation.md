# Ground, vegetation and terrain notes

Files: `src/world/terrain.js`, `src/world/outer.js`, `src/veg/{assets,trees,grass}.js`, new `src/veg/{noise,wind,zones,impostor,palms,devshot}.js`, `pipeline/terrain_dem.py`, `data/terrain.json`, and the height-grid loading part of `src/core/geo.js`.
Apart from the Copernicus tile below, no new assets were downloaded. Everything else is generated at load: canvas textures, procedural geometry, and impostor atlases rendered from the existing EZ-Tree GLB. `grass.glb` is no longer loaded (the near grass is procedural). `trees.glb`, the leaf/bark PNG/JPGs, `grass.jpg` and `dirt_*.jpg` are still used.

## M2 accuracy pass: real terrain and tree cover

### Terrain from Copernicus GLO-30
- **Source:** Copernicus DEM GLO-30 (a surface model at 1 arc-second, about 30 m), tile `Copernicus_DSM_COG_10_N26_00_E091_00_DEM`, AWS open data:
  `https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N26_00_E091_00_DEM/Copernicus_DSM_COG_10_N26_00_E091_00_DEM.tif` (45.2 MB, downloaded 2026-10-15 to a scratch folder, not committed).
- **Licence / attribution:** free for any use with attribution. The notice (also stored in `data/terrain.json` under `source`; see CREDITS.md): "(c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved".
- **Pipeline:** `python -I pipeline/terrain_dem.py <tile.tif> data/geo.json data/terrain.json`. It needs only numpy, scipy and tifffile; the tile's DEFLATE + floating-point predictor is decoded in the script, so imagecodecs isn't needed. Steps:
  1. Read the +-4.6 km window around the origin.
  2. Apply a 3x3 px (about 90 m) grey opening plus a light blur. This strips houses and isolated trees from the surface model.
  3. Resample bilinearly to the local 5 m grid (x = (lon - 91.79) * 99910, y = (lat - 26.1735) * 110800).
  4. Subtract the road level, taken as the nearest Mother Teresa Rd sample, smoothed over about 150 m along the road. The road measures **54.5-66.3 m above sea level, mean 59.5 m**.
  5. Soft-flatten residual relief under about 2-4 m on the plain.
  6. Scale the hills by **0.817** so the View point (77.6, 202) sits 38 m above the road. The raw surface gives 46.5 m there, which includes forest canopy.
  7. Flatten the road corridor (half-width + 4 m, blended over 12 m) and Geetanagar Field (blended over 12 m) to 0.
- **Output:** `data/terrain.json`
  - `hgrid`: the same 5 m grid as before, encoded as uint16 decimetres. The old uint8 quarter-metres would clip the NE hilltop at 63.75 m; the real top in the grid is 85 m.
  - `outer`: a 60 m grid over +-4.5 km of the real surrounding hills, used by `world/outer.js` and blended into the local grid over 250 m.
- **Code changes:**
  - `core/geo.js`: only the height-grid loading. It reads `data/terrain.json` (falling back to the old `geo.json` hgrid) and decodes heights into a float array `HV`. `hAt` and `hAtBase` keep their signatures. `TERRAIN` and `HV` are also exported.
  - `world/outer.js` uses the real outer grid. The procedural ring is kept only as a fallback.
- **Approximations:**
  - The model is a surface model, not bare earth. The opening removes most buildings and isolated trees, but continuous forest canopy remains, which is why the ridge is scaled by 0.817 to match the 38 m View point. Ridge shapes are real; absolute heights on forested slopes may be off by a few metres.
  - The 12 m rise of the road from west to east is removed. The road is treated as level, as the rest of the scene assumes.
  - At 30 m resolution, terraces, retaining walls and cuttings narrower than about 60 m aren't resolved.

### Tree cover checked against Google satellite
- Checked against `screenshots/audit/ridge.png` and `screenshots/audit/field.png` (Google Maps satellite, captured by the lead). They show near-continuous canopy on the ridge north and north-east of the field, broken only by school campuses, the View point terrace and the hill road. Geetanagar High School's buildings sit among trees. The SE (Hengerabari edge) is also wooded.
- **Changes:**
  - The forest zone is now driven by the real terrain (yard or untraced pixels more than 4 m above the road), plus the existing `FOREST_POLY`. With real heights this also picks up the wooded SE rise.
  - Forest density raised from 0.3 to 0.5 per sample, with clearance cut from 2.5 m to 1.8 m.
  - The View point sightline wedge no longer removes trees. Trees there are shortened to sit under the sightline, keeping their crown width so the canopy stays closed seen from above. Only spots with less than 3 m of headroom stay clear. This was the cause of the large bare clearings in the merged aerial.
- **Not verified:** individual roadside trees. Placement there is still statistical (rain tree and mango within 20 m of the road).
- **Remaining gap:** with the real terrain, `buildings.js` drops 41 of 178 buildings in the sightline wedge (`allowed < 1`), and their footprints show as bare patches NE of the field. Reported to the buildings session, with a suggested fix of clamping to at least one floor.

## M2 graphics pass (earlier)

### Ground (`world/terrain.js`)
- **Field earth.** `dirt_color.jpg` averages sRGB (73, 57, 49), which rendered almost black. `regrade()` makes a canvas copy with its mean pulled to sRGB (170, 123, 93) by per-channel gain. `M.earth` gets that copy, a 1.75x colour multiplier (the scene renders flat ground at about half its albedo) and a world-space shader with two rotated scales, light/dark zones, dusty patches and compacted spots. Measured in daylight on the field shot: **sRGB about (150-164, 104-112, 76-83)**.
- **Terrain.** `paintGround()` paints a macro tint plus a mask: R = bare-earth propensity, G = leaf litter, B = concrete. The shader mixes:
  - grass (`grass.jpg` at two rotated scales, normalised by its mean);
  - dusty red-brown bare patches, thresholded against shared noise;
  - leaf litter on the forest floor;
  - concrete aprons beside buildings.
  - Under building footprints the ground is painted like a yard, so a missing building doesn't leave a scar.
- The park lawn gets the same anti-tiling. All of this uses one tileable 256x256 noise texture (`veg/noise.js`), which the CPU also samples, so grass placement agrees with the painted bare patches.

### Trees (`veg/trees.js`, `veg/impostor.js`, `veg/wind.js`)
- **Species**, built from the EZ-Tree models with instance tint and non-uniform scale:
  - rain tree: EZ "ash", wide and flat, pale green;
  - mango: EZ "oak", dense, dark green;
  - jackfruit / mixed broadleaf: EZ "oak", mid green;
  - pink flowering trees on the median and in the park.
  - Mixes per zone: ridge forest, road edge (rain tree and mango), house yards (areca, banana, coconut, mango, jack, bamboo), untraced area.
- **Impostors.** Each EZ model is rendered at load into an 8-azimuth x 3-elevation atlas: albedo and model-space normal, 256 px cells, half-float, mipmapped. Far trees are camera-facing quads that blend the nearest views, are lit by the scene and cast shadows. The matrices are static.
- **Near models and crossfade.** Full models are drawn within about 92 m on High and 70 m on Medium; Low uses impostors only. The handover is a dithered crossfade. `screenshots/veg/ridge_imp.png` vs `ridge.png` compares the two.
- **Wind:** sway that grows with height squared, slow gusts and leaf flutter (an `onBeforeCompile` patch shared with the depth materials). Impostors sway in step.
- **Procedural yard plants** (`veg/palms.js`), with near and far LODs:
  - areca (slender ringed trunk, green crownshaft, arching pinnate fronds);
  - coconut (curved trunk, drooping fronds, nuts);
  - banana clumps (torn leaves, suckers);
  - bamboo clumps (arching culms, leaf sprays).
- The outer-ring trees are capped at 12k for load time.

### Grass (`veg/grass.js`)
- Procedural blade clumps with wind, colour variation and dry patches.
- Not grown on roads, the field, concrete aprons, bare patches, the mandir stair, the deck, wall segments or Railway Colony Rd (`veg/zones.js` `NO_VEG`, which covers asphalt the class raster misses).
- High: 0.42 m grid, 38 m radius. Medium: 0.55 m / 30 m. Low: 0.9 m / 18 m.

### Outer ring (`world/outer.js`)
- Neighbourhood blobs of 1-7 floor buildings with varied roofs, tree groves between them (impostors), and canopy-textured ground and hills. The hills now come from the real DEM.

## Performance (headless Edge, 1600x900, High pixel ratio 1.5, before the terrain pass)
| GPU / preset | yard | View point | field | aerial | vegetation share |
|---|---|---|---|---|---|
| RTX 4060 Laptop / High | 11.7 ms | 14.7 ms | 10.4 ms | 12.6 ms | 4-9 ms, mostly near EZ models |
| Intel UHD (iGPU) / Low | ~42 ms | ~45 ms | ~40 ms | ~55 ms | ~6-15 ms; the scene without vegetation is already 26-45 ms here |

## Approximations and guesses (for NOTES.md)
- Species placement is statistical; no individual real tree is reproduced. Rain tree, mango and jackfruit are restyled temperate EZ-Tree models.
- Bare-earth, leaf-litter and concrete patches are procedural noise, not mapped from imagery.
- The outer ring's buildings and groves are procedural; only its terrain is real.

## Testing tips
- With the preview browser pane hidden, page timers freeze and main.js stalls at "Laying out...". Driving a headless Edge over the DevTools protocol works (`--force_high_performance_gpu` selects the RTX).
- `src/veg/devshot.js` (dev only, never imported by the app): `const { vshot } = await import('/src/veg/devshot.js'); await vshot('field', 'field_test')`. It disables OrbitControls damping for the capture.

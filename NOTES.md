# Notes: accuracy log and open questions

## Approximate or unverified (inherited from the prototype)

Everything below exists in the model but can't be verified from the material in this folder. Each item needs a Street View or Maps check, or your answer.

| Item | Where in code | Status |
|---|---|---|
| Building heights and wall colours | `world/buildings.js` | 36 buildings along Mother Teresa Rd (x −505..92) are Street View-checked in `data/buildings_overrides.json`. All others are still seeded guesses from footprint area and distance to the road. |
| Terrain | `data/terrain.json` | Copernicus GLO-30 DEM (`pipeline/terrain_dem.py`). Road and field are flattened; hills are scaled ×0.817 so the View point is 38 m above the road (the raw DEM includes the tree canopy). The old hillshade `hgrid` is only a fallback. |
| Mandir gate dimensions (stair 3.6 m, 15 steps, 8.2 m wide, pillars 4.8 m) | `core/geo.js` `MANDIR`, `world/mandir.js` | Rebuilt from Street View (pano BM6Py18oPteseCItvX7l6g): three shikharas, lions, ~20 steps with a central divider. Exact dimensions are estimated. |
| **Shrine at the top of the mandir path** (box hall + 6 m shikhara at y ≈ 13) | `world/mandir.js` | **Unverified.** Not visible on Street View or Maps. Keep or remove? (question for the owner) |
| View point | `world/deck.js` | **Fixed 2026-10-15.** It is a ground-level tiled terrace with a black railing and gold spear finials (visitor photos on its Maps page). The invented raised deck, pavilion and plaque are gone. Centre moved to the Maps pin (78.0, 199.1). Terrace size is estimated. |
| Field goalposts | `world/streets.js` `buildField` | Assumed. |
| Children's Park | `world/park.js` | **Rebuilt 2026-10-15** from the z20 satellite and two Street View panos. Verified: the outline, the white picket fence on a dark plinth, the open grass, a round bed at (−129.5, −94.2), two red-roofed sheds by the north fence, edge trees and the dusty forecourt with stalls. The invented playground and flower beds are removed. Approximate: shed sizes, gate position, the water-tank tower's exact spot. Bus shelter position is still estimated by the streets session; the Maps pin "Geetanagar Bus Stand" is at (−57, −74). |
| Kiosks at x = −44, −37, 24, 31 with names "PAN & TEA", "STORE", "SNACKS", "FRUITS" | `world/shops.js` | Positions approximate, names generic. Forecourt stalls by the park and the carts are in `data/road_features.json` (verified/estimated per entry). |
| Hatigarh stall layout (7 north, 4 south), parked scooters, e-rickshaws | `world/streetlife.js` | Rebuilt from Street View: traffic island with ad pillar, 9 tin-roof stalls on Railway Colony Rd, signals, kiosk, cabinet. Positions in `data/road_features.json`, marked verified or estimated. |
| Median U-turn gaps every 200 m | `world/mainroad.js` | **Fixed.** No U-turn gaps were seen on Street View from x −470 to 110, so none are modelled. The median starts at x −470 (verified). |
| Street lights every ~35 m, transformers on every 6th pole | `world/mainroad.js`, `world/streetlife.js` | Surveyed lights and signals are in `data/road_features.json`; the remaining spacing (lights ~41 m, poles ~35 m, transformers every 7th) is estimated. |
| Forest polygon on the ridge | `veg/trees.js` `FOREST_POLY` | Forest now follows the real terrain (> 4 m) at density 0.5. Trees under the View point sightline are shortened, not removed. Checked against satellite. |
| Landmark styling (shikhara on the building nearest each Mandir/Namghar label) | `world/landmarks.js` | Heuristic. The building match may be wrong. |
| Outer city ring and horizon hills | `world/outer.js` | The ring's terrain is the real 60 m DEM grid over ±4.5 km; its buildings and groves are still procedural. |

## Missing inputs (blocking parts of M2 and M3)

The folder contained only the published single-file build (`legacy/current_build.html`) and base64 asset files. These were **not** present:

- `src/` modules (the prototype was one inline module; it is now split into `src/`)
- `pipeline/process.py`, `pipeline/tiles/r*c*.jpg`, `pipeline/gen.html`, `pipeline/gen.js`
- `pipeline/ref_*.jpg|png` (Street View and z19 satellite references)
- `rock1.glb` (the prototype requested it and it was always missing, so there are no hill rocks)

`data/geo.json` was recovered intact from the inline build: 1,449 buildings, 837 lanes, 307 main-road samples, 39 labels, cls raster, hgrid, field/park polygons.

## Milestone log

### M1: Vite port (done)
- Vite 8 + three r186, ES modules, `npm run dev`.
- The behaviour matches the legacy build. Both were loaded at the same Field spawn and the frames were checked side by side.
- r186 removed `PCFSoftShadowMap`, so the port uses `PCFShadowMap`.
- Captures are in `screenshots/m1/`.

### Accuracy audit against Google Maps (2026-10-15)
- **Method:** `pipeline/overlay.py` draws geo.json (lanes red, main-road edges yellow, footprints cyan, labels magenta) over georeferenced Google Maps satellite screenshots. The Maps URL's `NNNm` value gives the viewport height in metres. Results are in `screenshots/audit/`.
- **Hatigarh, field and ridge windows:** lanes, the hill road to Faculty School, the View point spur, the field outline and footprints all line up within about 1–3 m. Mother Teresa Rd's north edge is drawn ~5 m too wide near the field. Large footprints are often several houses merged together (M2 task).
- **Landmarks:** POI coordinates harvested from Maps searches (temple, mandir, namghar, school, college, bank, park, mosque, hospital, petrol) over the whole extent. The existing labels are within ~5 m of their Maps pins. Twelve missing ones were added in `data/landmarks.json`, which is loaded in `core/geo.js`. No mosque, church, hospital or petrol pump is listed inside the extent.
- **Mandir gate by the field:** it has no name on Maps or on the gate itself. A large central shikhara, a smaller shikhara over each pillar, orange lions and a ~20-step stair with a central divider were passed to the streets session.
- **Road layout:** from Street View, there is no median at Hatigarh Chariali. A dual carriageway with a black median railing runs at least from x ≈ −245 to past the field. Details are in `docs/REFERENCE_STREETVIEW.md`; the streets session is tracing the exact extents into `data/road_features.json`.
- **Lane network rebuilt (2026-10-15):** the original skeleton split lanes into hundreds of 2–3-point fragments, and on Railway Colony Rd the map's label text produced two parallel zig-zag tracks with poles standing in the road. `pipeline/roads.py` now closes the text holes in the road raster, re-skeletonises it, prunes spurs, merges, smooths and measures widths. The result is 470 roads (median 6.1 m) in `data/roads.json`, with 31 names from OpenStreetMap (ODbL attribution in CREDITS.md). It also writes a class raster with the holes filled. The overlay check (`screenshots/audit/hatigarh_newroads.png`) matches the satellite image. Widths come from Google's map rendering, so they may run ~1 m wide on narrow lanes.
- **Map text was traced as roads (2026-10-15):** Google prints place names in dark text, and the colour classifier read it as road. The park's name made two fake lanes through the Children's Park. `pipeline/roads.py` now drops detached text-like blobs (strokes under 3 m wide, or anything inside the park and field outlines) and gives their pixels back to the surrounding class. A check of every original trace confirmed that no real lane was lost (only a boundary sliver at x ≈ 447).
- **Street View coordinate offset (2026-10-15):** between x −500 and −300, the Street View camera positions sit 8–13 m north of `GEO.main`. Satellite overlays (`screenshots/audit/main_x400.png`, `hatigarh_newroads.png`) show that `GEO.main` matches the real road band, so the pano coordinates are what's off. Positions are fitted to satellite and data, never to raw pano lat/lon.

### M2 (in progress): merged state, 2026-10-15
- Captures are in `screenshots/m2/` (viewpoint, field, mandir, hatigarh, aerial, park).
- **Merged:** 36 Street View-checked buildings in `data/buildings_overrides.json` (buildings session); surveyed road features in `data/road_features.json` (streets session); the clean lane network (`data/roads.json`); Maps-verified landmarks; the View point terrace; the rebuilt park.
- Footprint fixes and splitting (909, 912, 889, 775, missing houses, 803/835): in progress.
- Compound walls and gates along Mother Teresa Rd: in progress.
- Park forecourt: **done** (edge kind `forecourt`).
- Real DEM terrain: **done**.
- Ridge tree cover vs satellite: **done**.
- 41 buildings below the View point were dropped by the sightline rule; they are now capped at one storey: **done**.

### Performance pass (2026-10-16)
Measured with single-frame `renderer.info`, viewport 1600×900, on an RTX 4060 laptop GPU. Draw calls are per frame and include the shadow pass.

| Preset | View | Before: calls / triangles | After: calls / triangles | GPU ms after |
|---|---|---|---|---|
| Low | aerial | 1921 / 3.1 M | 413 / 1.6 M | 18 |
| Low | Hatigarh | 597 / 3.0 M | 176 / 1.3 M | 4 |
| Low | View point | 1594 / 3.4 M | 314 / 1.6 M | 6 |
| High | aerial | 3873 / 8.0 M | 1035 / 7.8 M | 12 (was 33) |
| High | View point | 3263 / 26 M | 903 / 26 M | 11 (was 24) |

- JS heap: 405 MB → about 145–158 MB.
- Load: about 10 s → 6.5–10 s. The first load after a server start is slower because modules are compiled then.
- `src/render/quality.js`: a single preset decided before load. Order: `?q=low|medium|high`, then the saved choice, then auto-detect (phones, ≤ 4 GB RAM, ≤ 4 cores, or a mobile GPU → Low; Intel or AMD integrated → Medium).
- `src/render/post.js`: Low renders directly (no composer, no shadows, 0.85× resolution, 3.5 km view distance). Every preset has dynamic resolution (0.6–1.0×) that drops when the frame rate falls under 30 fps.
- `src/render/staticmerge.js`: small static meshes are merged per material signature per 120 m cell (993 → 427 meshes).
- Vegetation (Low / Medium): tree caps of 6 k / 14 k inside the traced area, outer ring kept at 30 / 60 %, no grass on Low, half the grass on Medium. Low draws trees as cards only.
- Textures on Low: half-resolution ground paint, 512 px facade sets, half-size road textures, no normal or bump maps, anisotropy 4.
- Not yet measured on a real low-end device. Next candidates if Low is still slow there: merge the remaining ~150 single-member meshes by baking vertex colours, and lower the impostor count.

# Streets, Hatigarh and field edge: notes (streets session, 2026-10-15)

Scope: `src/world/mainroad.js`, `streets.js`, `streetlife.js`, `geom.js`, `materials.js`, `mandir.js` (unchanged), and the new `src/world/road/`
(`textures.js`, `fieldedge.js`, `props.js`, `vehicles.js`). No external assets: every texture is drawn procedurally on canvas, every model is built in code.

## What changed

**Road layout (mainroad.js).** The cross-section now varies along the road instead of being a uniform median + 2.3 m paver footpath.
- Undivided ~11.5 m asphalt at Hatigarh Chariali and everywhere west of it (slight flare at the junction), dusty earth shoulders, no kerbs or railings.
- The median starts with a rounded nose at **x ≈ −470**, about 25 m east of the junction, and runs east. It's ~2.4 m wide with small trees for the first ~130 m (to x ≈ −340), then narrows to ~1.4 m. It has kerbs painted in black-and-white blocks, a black railing (vertical bars between a bottom and a top rail; no yellow or maroon), and clumps of shrubs with pink bougainvillea.
- Road edges: a narrow raised kerb (0.4 m, black and white) with a black railing, then a dusty earth shoulder. They break where side lanes join. The edge is a plain shoulder with no kerb west of x = −474, at x −395…−330 on the north side, and at junctions.
- Twin-arm steel street lights on the median every ~35 m. Single-arm lights on the concrete poles of the undivided stretch.

**Field frontage (road/fieldedge.js).** North side, x −58…18: earth shoulder, a concrete footing slab, a black iron railing (1.1 m, posts every 1.8 m, vertical bars, one square terracotta-motif panel per bay), and a red brick wall (1.25 m) with coping and piers behind it. There's a gate with brick pillars and black iron leaves. The old wall and railing in `streets.js buildField` were removed. Red and blue hand-carts stand on the shoulder next to the existing kiosks.

**Hatigarh Chariali (streetlife.js, road/props.js).**
- A traffic island at the junction centre: a round plinth with black-and-white stripes, a yellow pipe railing, a pillar wrapped in a dark-blue banner (generic text), and a canopy disc on top.
- Nine tin-roof stalls with purple, yellow and blue painted counters along the east side of Railway Colony Rd.
- On the NW corner: a kiosk with a yellow front, a grey electrical cabinet, and signals on yellow poles (NW and NE corners, plus one on the median nose).
- Two-wheelers parked nose-in on the dusty shoulders. Totos and an auto wait on the south side. There are cycle-rickshaws and a small blue truck.

**Vehicles (road/vehicles.js).** New models: hatchback, sedan, SUV (separate glass greenhouse, roof, pillars, bumpers, lights, rimmed wheels), toto (e-rickshaw), auto-rickshaw, scooter, motorbike, mid-size bus, small cargo truck, and cycle-rickshaw. Each kind is baked once into one geometry per material and drawn as `InstancedMesh` with per-instance paint colour, so ~40 draw calls cover all vehicles. Traffic keeps to the left.

**Poles and wires (streetlife.js).** Square-section tapering concrete poles with galvanised cross-arms (two on the main road) and white pin insulators. Transformers sit on H-frames (second pole, channel beams, finned tank, bushings, fuse box). There are thick sagging cable bundles and coils on the main road, plus the existing thin wires. Lane poles closer than 14 m are merged, which removes the pole "forest" on Railway Colony Rd. A high-mast light (18 m, ring of 6 lamps) stands near the field.

**Materials (materials.js, road/textures.js).** Asphalt is 1024 px per 8 m and has colour, roughness and bump maps: aggregate, irregular repair patches, hairline cracks, oil stains, and dust. A separate alpha band drifts dust along the asphalt edges and the median kerb. Also added:
- shoulder earth with pebbles (colour, roughness, bump)
- worn black-and-white kerb paint with chips and mud splash
- concrete with water streaks and mould
- irregular brick with recessed mortar
- an alpha-tested railing-bar infill and the ornamental field panel

New `M` keys: `dust`, `shoulder`, `concrete`, `poleConcrete`, `railInfill`, `fieldPanel`. All existing exports (`M`, `MAT`, `std`, `box`, `place`, `canvasTex`, `TEX`, `speckle`) keep their names. `M.median` is now a soil texture.

`geom.railing()` gained `post` (post size) and `infill` (material key for a vertical-bar panel). `flushRailings()` now clears its queue after flushing.

## Approximate / estimated (please check)

| Item | Value used | Basis |
|---|---|---|
| Median nose | x = −470 | Street View pano at ~(−485, −62) heading 95 shows the nose ~15 m ahead, with a signal and shrubs. |
| Wide median (2.4 m, with trees) | x −470…−340, tapering to 1.4 m by x −300 | Pano at x ≈ −410 (heading 200) shows a wider planted median. Width not measured. |
| Median east of x ≈ 20 to the end of the data (x 447) | continuous 1.4 m median | **Not checked on Street View.** |
| U-turn gaps | **none modelled** | None seen on the panos checked (−485, −440, −410, −380, −290, −24). There probably are some (e.g. at Geeta Nagar Rd, x ≈ 75). |
| North-edge plain shoulder (no kerb/railing) | x −395…−330 | Pano at x ≈ −380 shows gates and walls right on the shoulder. |
| North edge at x ≈ −440 | modelled as kerb + black railing | The pano actually shows a short painted-concrete culvert railing there. |
| Field railing / wall offsets | railing hw + 2.95 m, wall hw + 3.95 m from the centreline | Fits the existing kiosks (shops.js puts them at hw + 1.6). The lead's satellite check shows geo.json's road edges are correct and the Street View camera coordinates are offset ~8–13 m north, so lateral positions are fitted to the data and satellite, and anything placed from pano bearings is shifted south by that offset. |
| Field gate | x = −20, 3.6 m wide | Not visible on the pano (a puja-pandal scaffold was in front). |
| Hand-carts | x −29.5 (red), −52 (blue with canopy), −12 (red) | Only one red cart was seen. The rest stand in for "carts and stalls along the railing". |
| High-mast light | x = 14, north shoulder | Position guessed. The README/brief only says "near the field". |
| Hatigarh island | (−497, centreline) | From the pano direction (heading 180, slightly right). |
| Stall row | 9 stalls, x = −489.6, y −60…−40, facing west | The pano says 8–10 stalls on the east side of Railway Colony Rd. |
| NW kiosk / cabinet / signal | (−498.9, −61.4) / (−499.6, −64.0) / (−497.4, −63.2) | Squeezed between the building footprint (which reaches the road in geo.json) and Railway Colony Rd. |
| Street-light and pole spacing, transformer every ~7th pole | — | Guessed. |
| Parked vehicles, traffic mix | seeded random | Representative only. |

## Known issues / hand-over
- **Testing quirk:** with the Browser pane hidden, `img.decode()` in `core/geo.js` and `requestAnimationFrame` stall, so `__geet.shot()` never resolves. I captured shots with a console helper that calls `stepWalk`, `updateNearTrees`, `updateGrass` and `renderFrame` directly. I also ran my server with `NO_HMR=1` so other sessions' edits didn't keep reloading the page.
- Grass from `veg/grass.js` grows on Railway Colony Rd's asphalt near Hatigarh (veg session's area).
- The old 'field' viewpoint (controls.js, not mine) looks into the field, away from the road. The pano-matching view is at (−24, −54) yaw 0.55: `screenshots/streets/field.png`.

## Screenshots (`screenshots/streets/`)
- `hatigarh.png`: the standard Hatigarh spawn, looking west at the island, signals, kiosk and cabinet.
- `hatigarh_from_pano.png`: from the Street View pano position, looking south (compare pano heading 180).
- `hatigarh_stalls.png`: the stall row on Railway Colony Rd, corner signals, kiosk.
- `field.png`: from the field pano position, looking north-west at the frontage (compare pano heading 330).
- `field_west.png`, `median_nose.png`, `midsegment.png` (x ≈ −245), `vehicles.png`, `mandir.png`.
- `before_hatigarh.png`, `before_field.png`: the state before this pass.

## Pass 2: survey data instead of procedural spacing (2026-10-15, later)

The priority is now accuracy. I walked Street View along Mother Teresa Rd from Hatigarh (x −499) to past the mandir (x 110), checking 17 panos. Everything I recorded is in **`data/road_features.json`**, and each entry is marked `verified` or `estimated`. `mainroad.js`, `streetlife.js` and `streets.js` now read their positions from it.

Read from the file:
- **Median:** nose at x −470 (verified), wide section, end of the data.
- **U-turn gaps:** none. I saw none from x −470 to 110, and checked across the median opposite Geeta Nagar Rd specifically.
- **Junctions:** side-lane ends taken from roads.json; the two at Hatigarh are verified.
- **Edge kinds per side, as x ranges:** `open`, `kerb`, `culvert` (painted concrete culvert railing at x −430…−400), `field`, and `mandir` (paved footpath with a black railing that opens at the stairs, and a striped kerb).
- **Street lights:**
  - single-arm poles at x −455 and −270, north side (verified)
  - twin-arm median lights at x −55 and −14 (verified)
  - more median lights at ~41 m spacing (estimated)
- **Signals:** the Hatigarh CCTV/signal gantry on the west corner of Railway Colony Rd, the NE signal, and the median nose.
- **Stalls and carts:** the stall row, the NW kiosk and cabinet, a red umbrella stall at x −440 north, the red cart at x −29.5, and two yellow carts at x 36 and 39.5 by the mandir stairs.
- **Bus stop:** only the park shelter (estimated). I saw no other stops.
- **High mast:** x 14 (estimated). **It was not visible on any pano I checked**, so the position is a guess that follows the brief.

Still procedural, marked estimated: concrete pole spacing (~35 m), transformers on every 7th pole, and parked and moving vehicles.

**Lanes (streets.js buildLanes).**
- Pale, dusty asphalt (`M.laneAsphalt`) whose last ~0.75 m fades into reddish dust.
- Reddish-brown earth verges 1.2–1.8 m wide (`M.verge`).
- An open concrete drain strip only where a building stands right at the lane edge (from the class raster).
- End caps only where a lane end meets another road or the main road.
- Railway Colony Rd (the roads named "Railway Colony Road", plus the unnamed pieces at x −515…−480, y −70…125) has 7 m asphalt.

**Mandir (mandir.js).**
- A smaller shikhara on each side pillar.
- Orange lions on the lintel either side of the central pavilion.
- 20 steps with a central divider and a steel handrail.
- A paved apron at the stair foot.
- The scalloped wall runs west of the stairs only; a lower plain wall continues east.
- The shrine at the top of the path is **unverified**: it isn't visible on Street View or Maps.

New shots: `screenshots/streets/railway_colony.png`, `hatigarh.png`, `mandir.png`, `field.png`, `median_nose.png`.

## Pass 3: park front and bus stand
- **Park forecourt.** South edge, x −170…−66, is a new edge kind `forecourt`: bare dusty earth from the carriageway edge to about hw + 2.5 m, with no footpath or railing. This follows the lead's check of panos 3_qRnWZanWudTCw74Lodrw and kEM0kEBZ4oUXOCakZBgK1g.
- **On the forecourt** (all in road_features.json):
  - a tin-roofed tea stall at x −121 (verified)
  - two small blue kiosks at x −116.5 and −113.5 (verified)
  - hand-carts at x −110 (verified) and −126 (estimated)
  - four parked cars and four big trees (estimated)
- **Geetanagar Bus Stand** is at x −57, south side, from the Google Maps pin. The shelter (tiled roof on pillars, bench) is built by `streetlife.js` from `bus_stops`, and the kerb railing is open for ±4 m in front of it.
  - The pin's y (−74) is in Google's frame, so I placed the shelter by side and offset rather than at that absolute y.
  - The shelter's appearance is estimated.
- **Ownership:** the Children's Park (`buildPark`, `park.js`) now belongs to the lead. Until `buildPark` is replaced, the old shelter code there also reads `bus_stops[0]` and draws a second shelter at the same spot. Drop it from park.js.
- **Mandir edge offsets:** the south-side kerb at the mandir (x −66…800) and the remaining stretches are still marked estimated.

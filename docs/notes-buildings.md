# Buildings: notes (M2 facade pass)

Files: `src/world/buildings.js`, `src/world/shops.js` (shopfronts section), `src/world/bldg/{tex,facades,mesh}.js`. `landmarks.js` is unchanged.
No external assets were used: every texture is generated on a canvas at load (about 0.9 s), so there is nothing to add to CREDITS.md.

## What changed
- **Facade textures** (`bldg/facades.js`): four 1024² sets, each covering 2 bays × 2 floors (512 px per 3.2 m × 3.1 m cell), so a wall shows four different windows before it repeats.
  - `rcc`: steel casements behind painted safety grills, with sills, plaster reveals and curtains or dark rooms behind the glass.
  - `slide`: aluminium sliding windows, some with white box grills.
  - `assam`: lime-wash walls with a painted dado, timber posts and wall plate, small barred windows with wooden shutters (open or closed), a plank door and a ventilator.
  - `blank`: side walls with slab lines, a drain pipe, cracks, patch repairs and a toilet ventilator.
  - Each set has a colour map, a normal map (generated from a height layer) and a mask (R = paintable plaster, G = roughness). Paint comes from vertex colours, so only plaster is tinted.
  - Shader patch (`patchFacade`): dusty large-scale colour variation, faint rain-wash streaks, a damp/moss band at the foot of each wall (height from the `aH` attribute) and red-brown splash dust. Dark water streaks under sills and ledges are painted into the textures.
- **Geometry** (all merged per material: 4 facade meshes, trim, rail, roof, tin, plus 2 instanced meshes for tanks and stands):
  - Floor-slab ledges on every storey, and chajjas projecting 0.42–0.58 m over every window row.
  - Balconies on road-facing walls of 2+ storey houses: grey/black/green/white alpha-tested railings, or solid parapets with a coping.
  - Roof parapets with a concrete coping, and mumties with a door on flat roofs of 2+ storey houses.
  - Water tanks on stands, some on top of the mumty.
  - About 12% of houses have an unfinished top floor: stub columns with rusty rebar and no parapet.
  - AC outdoor units on about 30% of RCC houses.
  - Tin hipped roofs now have corrugated, rust-streaked texture and an overhang.
- **Footprints** are simplified with Douglas-Peucker (0.85 m tolerance; the traced blobs averaged 22 vertices, now about 11) so walls are straight and bays line up. Floor counts, the `inViewWedge`/`sightTop` limit and the landmark rules are unchanged. Mumties and stub columns are skipped inside the View point wedge.
- **Which walls get windows**: road-facing walls and each house's longest wall always do. A wall stays blank when the class raster shows another building 3.0 m *and* 4.2 m outward (a party wall). Otherwise about 90% of walls get windows.
- **Shops** (`shops.js`): RCC pillars between bays, a raised concrete step, and per-bay rolling shutters (open about 50%, half down about 30%, closed about 20%) over painted one-point-perspective interiors (grocery, clothes, pharmacy, sweets/hardware). The shutter roll housing and bottom bar are geometry.
  - Signs: one 0.9–1.15 m flex signboard per frontage in a steel frame, from a 32-entry atlas of generic names with taglines. "STATE BANK OF INDIA" is used only on the building matched to the SBI label in the data.
  - Awnings over about 70% of bays: blue/green/red/yellow tarp or striped canvas, with a valance and struts.
  - The kiosks are untouched.
- **Palette**: beige, cream, pale yellow, greys, a few muted pastels; lime-wash whites for Assam-type houses. Flat roofs are lighter grey with some stained ones and a few white/red coated ones.

## Budget
At load: facade walls about 170 k vertices, trim about 0.7–0.8 M, rail about 12 k, and about 1.0 M across all building and shop meshes (13 draw calls plus 2 instanced). I couldn't measure FPS here because the preview pane was hidden, which pauses requestAnimationFrame. Measure on the RTX 4060. If it's short:
- Drop the slab-ledge boxes (`trim.box(... 'f' ...)` per storey). They're the biggest share.
- Or skip chajjas on buildings more than about 250 m from the walk area.

## Approximate / invented (for NOTES.md)
- Facade style per building (rcc / slide / assam), paint colour, balcony type, which walls are blank, AC units, unfinished top floors and mumty position are all seeded guesses, not per-building data.
- The ground floor starts at the highest terrain point under the footprint. On sloping plots the downhill side shows a tall blank plinth instead of a ground-floor row.
- Shop names (except SBI), shutter states, interiors and awning colours are generic placeholders.
- A shop frontage is a main-road-facing wall of a building with `d < 26` (same rule as before), now on the simplified footprint.

## Requests for files I don't own
- None are blocking.
- `main.js`/the lead: `[buildings]` logs one `console.info` line in dev with vertex counts. Remove it if it's noise.
- Testing tip for other sessions: with the preview pane hidden, `__geet.shot()` hangs because it waits on requestAnimationFrame. Driving `VIEWS[name]()`, then `stepWalk`/`orbit.update`, then `renderFrame()` directly works.

---

# Accuracy pass: Mother Teresa Rd, Hatigarh Chariali (x ≈ −500) to past the mandir (x ≈ +90)

**Source:** Google Street View (Mar 2026 imagery, viewed 2026-10-15). I looked north and south from 21 panos spaced about 30 m apart along the road, plus a few diagonal views.

**Results:** `data/buildings_overrides.json` (keyed by index in `GEO.buildings`). 36 buildings have Street View-checked floors, wall colour and shops. Each entry has a `conf` field:
- **high (9):** unambiguous match between pano and footprint.
- **medium (20):** facade clearly seen, but the match to the footprint index is by position.
- **low (7):** partly hidden by trees, or the index is a best guess.

**How `buildings.js` uses it:**
- `floors`, `wall`, `shops`, `roof`, `roofCol`, `style` and `unfinished` override the seeded guesses.
- The View point sightline cap still applies after the override.
- `_survey` (x −505..92) turns off the old "every road-facing building within 26 m gets shopfronts" rule for this stretch. Street View shows the road is almost entirely walled residential compounds with gates, so shopfronts appear only where an override says `shops: true`:
  - 905, 916 and 909 at Hatigarh
  - 889, the pink coaching-centre building
  - 879, the single-storey shop row at x ≈ 27
  - 887, the blue building at x ≈ 55

## Verified vs guessed
- **Verified (looked at):** every entry in the JSON. The verified part is the facade colour, the visible floor count and whether the ground floor is shops.
  - Floor counts of tall blocks (909, 912, 917, 791) are lower bounds where the top was cropped.
  - Apartments with stilt parking count the stilt as a floor.
- **Not verified, still seeded:**
  - Every building outside x −505..92.
  - Second-row buildings in this stretch, except 791, 771, 802 and 789, which are visible over compound walls.
  - Roof details, balconies and window style.
- **Shop names** remain generic placeholders. I deliberately didn't copy real business names (apartment names, a handloom shop, a coaching centre and others are visible on Street View).

## Footprint problems (for the data/pipeline owner)
| Where | Index | Problem |
|---|---|---|
| (−484..−445, −96) | 909 | Too long. The yellow 6-storey apartment covers only about x −484..−460; at x −449 Street View shows a garden compound with a green gate and a small single-storey building. |
| (−302..−255, −122) | 912 | **Merged:** two separate cream apartment blocks (5–7 storeys) in one blob. |
| (−15..44, −95) | 889 | **Merged:** pink 3-storey coaching centre, a yellow 2-storey house and others in one 898 m² blob. |
| (−249, −23) | 775 | 996 m² blob, probably several houses. |
| ≈ (−247, −40) | none | **Missing:** a yellow single-storey Assam-type house with a tin roof on the north side, just west of 783 (pano x −236, heading 0). |
| ≈ (−338, −42) | none | **Missing (or part of 781):** a 3-storey cream shop building with a big signboard on the north side (pano x −325, heading 0). |
| (21..30, −31) | 803 | Not visible from the road. Street View shows a vegetated earth slope with a brick retaining wall there. Possibly extra, or hidden in the trees. |
| (68..95, −37) | 835 | Long thin 28 m footprint. Street View at x 88 north shows only vegetation, a brick wall and a hoarding. Probably a wall traced as a building. |
| (−461..−431, −52) | 851, 856 | Small structures at the apartment gate; likely gatehouse or wall. Kept as single storey. |

## For other sessions (not my files)
- **Road centreline:** resolved by the lead using satellite overlays: `GEO.main` and the footprints are correct, and the Street View camera coordinates are 8–13 m too far north between x −500 and −300. Overrides were matched by east–west position along the road and by which side of the road the building is on, so the offset doesn't change any match.
- **Compound walls:** nearly every plot on this stretch is behind a 1.5–2 m boundary wall (white, grey, blue-grey, red or brick) with a steel gate, and often a small gatehouse. They aren't modelled yet and would change the street look more than any facade detail.
- **Field:** a blue single-storey hut with a tin roof stands inside the field near (0, −25), and food carts and stalls line the field railing (pano x −4, heading 0).

# Footprint fixes

`pipeline/footprints.py` writes `data/footprint_fixes.json`, and `src/core/geo.js` applies it right after `geo.json` loads. `geo.json` itself is untouched.
- **Index stability:** nothing moves. A split puts part 0 on the original index and appends the other parts at the END of `GEO.buildings` (new indices 1449 and up, in the order the script prints). A skipped building keeps its slot with `p: []`, which `buildings.js` already ignores.
- **Count:** 1449 buildings become 1509 (44 replaced, 60 appended, 2 skipped).
- **Source of each fix:** every entry has `src`: `streetview`, `satellite+cls` or `estimated`. Part shapes come from the class raster (cut line, then contour, simplified to 0.4 m), not from the old ring.

| Index | Outcome |
|---|---|
| 909 | Cut at x −460. The apartment keeps 909 (408 m², override untouched). A small single-storey building in the garden at x −449 is index 1449 (52 m², `estimated` size); the strip between is dropped. |
| 912 | 3 parts: the long west block keeps 912 (503 m²); the east block is 1450 (280 m²); a square block between them, shop class on the raster and height not seen, is 1451 (245 m²). The 912 facts (6 floors, cream) are copied to 1450 in the overrides. |
| 889 | 3 lobes, cut at the necks at x 6.5 and x 25. The west lobe (pink coaching centre) keeps 889 and its override (397 m²); the middle lobe is 1452 (260 m²); the east lobe is 1453 (201 m²), given a low-confidence yellow 2-storey override. |
| 775 | 3 parts: west house keeps 775 (250 m²); main body is 1454 (579 m²); the south lobe is 1455 (147 m²). |
| yellow Assam house west of 783 | Not added separately. The raster shows it as the south lobe of 775 at about (−243, −36), so 1455 is that house. It has no override yet; the seeded floors cap a 147 m² blob at 1 to 2 storeys, and it should get `roof: 'tin'`, `style: 'assam'`. |
| cream shop near (−338, −42) | Not added. The raster there is a lane (class 1) with a few commercial specks. The nearest real building is the shop strip at the south end of 781 (x −365..−352), so it is probably that. 781 is unchanged. |
| 803 | Skipped. Besides being a slope, it was the nearest building to the "Mandir gate" label, so `landmarks.js` gave it a temple style and a spire. That stray spire is gone now (the mandir itself is `mandir.js`). |
| 835 | Skipped (a 3 m wide wall). |

Generic splitting also ran. For blobs over 600 m² that carry no override and sit 40 m or more from a landmark label, it cuts a watershed of the distance transform where the neck is under 55 percent of the smaller peak's radius and every part stays over 150 m². It split 40 blobs into 2 to 4 parts each. I checked the outlines against the raster, but not on Street View. To switch it off, empty the loop in `main()` or raise `GEN_MIN_AREA`.

- **Not verified:** the exact cut lines of 912 and 775, the identity of 1451 and 1452, and every generic split. Parts on a shared cut line touch exactly, so the walls between them are coincident faces.
- **New parts and `a`/`k`/`d`:** `a` is the part's area, `k` is 1 when most of it is class 3, and `d` is the parent's `d` shifted by the part's change in distance to the nearest road pixel (the original `d` is not exactly reproducible from the raster).

# Small details on walls and roofs (`src/world/details.js`)

Runs after `buildCompoundWalls` in both `src/main.js` and `src/game/main.js`. `compound.js` records every wall piece (`WALL_FACES`:
centreline, road-facing normals, height, thickness) and gate (`GATE_POSTS`); `buildings.js` records the finished flat roofs that are
not landmarks and are clear of the View point sightline (`ROOFS`). Everything is seeded per piece, gate or roof, so it is the same on
every visit. None of it has a collider.

- **Walls:** paper posters at eye level, alone, overlapping in twos and threes, or the same one pasted in a row (tuition, coaching,
  a Rongali Bihu poster, a blood donation camp, a homeo clinic, a yoga class); painted ads on long plain stretches (a mustard-oil and
  a cement brand, both invented) and STICK NO BILLS; now and then a Bihu flex banner; NO PARKING or TO-LET beside some gates. Posters
  span lane segments only where the wall runs straight under them. About one wall piece in nine has a row of pots on its coping
  (terracotta, the odd paint bucket; leafy clumps or snake plants, some in flower).
- **Gates:** about half have a name plate on a pillar: Assamese house names (Kalita Niwas, Shanti Kutir, Matri Chhaya...) on black
  granite or white marble, or a house number on blue enamel.
- **Roofs:** a DTH dish (about 60 cm offset dish, LNB arm off the lower rim) on the most south-facing parapet, or on the stair room;
  bigger roofs sometimes have two. About a third of roofs over 40 m2 have a washing line along the longest edge, clear of the stair
  room and tanks: gamosa, saris, a mekhela, sheets, towels, shirts, trousers and a child's frock, swaying in the town's wind
  (`VEG_U` from veg/wind.js).
- Counts on the current map: about 760 posters and ads, 290 name plates, 490 pots, 470 dishes, 57 washing lines; built in ~50 ms.
- All of this is generic Guwahati street detail, invented and placed by seed. None of it is surveyed per plot.


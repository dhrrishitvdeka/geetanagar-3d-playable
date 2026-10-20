# Street View observations (Google Street View, imagery Mar 2026, viewed 2026-10-15)

Local coordinates: x = east, y = north (metres), origin 26.1735 N, 91.7900 E. lat = 26.1735 + y/110800, lon = 91.79 + x/99910.
Open a pano in a browser: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=<lat>,<lon>&heading=<deg>&pitch=0&fov=90`

## Overall look
- Light: hazy pre-monsoon sky, pale blue-white, never deep blue. Distant objects fade quickly into a warm grey haze.
- Colours are muted and dusty: beige, cream, pale yellow, grey concrete, some pastel pink/green. Everything has grime: dark water streaks under slabs, mould at the base of walls, dust on lower walls.
- Buildings: 2–5 storey RCC. Exposed concrete-frame look: visible floor slabs projecting as thin ledges (chajjas) over each window row, balconies with grey railings or solid parapets, some unfinished top floors with exposed columns and rebar, black plastic water tanks, staircase head rooms on roofs. Ground floors on the main road are shops with rolling shutters, colourful flex signboards and awnings.
- Many large trees line the road (rain trees, mango, coconut, areca, banana), so the canopy often overhangs the road.
- Overhead wires are everywhere, on concrete poles with cross-arms and transformers. There are streetlights on poles, and a high-mast light near the field.

## Hatigarh Chariali (pano at 26.172939, 91.785002; local ≈ (−500, −62))
- **Undivided** two-way Mother Teresa Rd here: about 10–12 m of asphalt with **no median**, no raised paver footpath and no road railings. Dusty earth shoulders, with parked scooters and motorbikes along the edges. The median starts somewhere east of the junction (it is present at x ≈ −245, see below); exact start not yet traced.
- In the middle of the junction is a **traffic island**: a round plinth (~2.5 m diameter) painted with black-and-white vertical stripes and a yellow pipe railing on top. A tall cylindrical pillar rises from it, wrapped in a dark-blue advertising banner, with a round flat canopy disc above (a traffic-police umbrella) and wires above that.
- Railway Colony Rd runs north. Its east side has a row of ~8–10 small stalls with tin roofs on bamboo/wood posts and painted counters (purple, yellow, blue), fruit and vegetables on display. On the west corner are a small kiosk with a yellow front, a grey electrical cabinet and a traffic signal on a yellow pole. Plastic tubs and tarps are around.
- South side: cycle-rickshaws and a blue mini-truck parked, a mobile tower on a roof, 3–4 storey concrete shop buildings with signboards (e.g. a "… CORNER" sweet shop).
- Looking west: 3–5 storey apartment blocks with balconies, mature trees, single-arm streetlights on concrete poles.

## Geetanagar Field (pano at 26.173052, 91.789757; local ≈ (−24, −49))
- Mother Teresa Rd here **is** a dual carriageway. The median is about 1.2–1.5 m wide, with a raised kerb painted in black-and-white blocks, a **black** low railing (≈1 m, simple verticals with a top rail; **not** yellow/maroon) and pink bougainvillea and small shrubs. Each carriageway is about 7–8 m of asphalt, worn and dusty at the edges, with no lane markings.
- North edge, the field side: a dusty earth shoulder about 2–3 m wide, then a concrete footing slab, then a **black iron railing (~1.1 m) with square ornamental panels (~0.35 m, terracotta/brown motif) set between the posts**. Behind it is a **red brick wall (~1–1.3 m)** with irregular brickwork. Behind the wall there was a bamboo-pole scaffold with green net (a temporary Durga Puja pandal, so leave it out), then trees and the forested hill.
- A red hand-cart and food stalls are parked along the field railing to the west. Concrete electric poles stand on the north shoulder.
- Across the road (south): the median, the other carriageway, and a striped kerb with a black railing. Then an open paved area with parked trucks, then 3–6 storey buildings including a yellow 6-storey apartment block.

## Mid-segment (pano at 26.172910, 91.787544; local ≈ (−245, −65))
- Dual carriageway. Median: kerb painted black and dark green (or black-white), black railing, low shrubs.
- North side: a narrow raised kerb strip (black-white) with a black railing, then old brick boundary walls and trees. No wide paver footpath here.

## Second pass (Street View, imagery Mar 2026, viewed 2026-10-20)
- **Hatigarh island** (pano 9Yn0U7qxM9dqWNLUej2-3g): the plinth is ~0.85 m with a step block on the west side; the yellow pipe ring encloses potted red flowers; the pillar is slim and banded black-and-white (not a banner column), topped by a white disc and a navy advertising drum. Rebuilt in `road/props.js`.
- **Hatigarh corners:** SW (building 905) is a grey 3-storey shop building with a lattice mobile tower on the roof, not yellow; NW (832) is a tan 3-storey house set back behind a big corner tree; there are two grey cabinets by the kiosk.
- **x ≈ −347 north:** the striped kerb and railing start here (west of it is open shoulder with a guard hut), so the open/kerb boundary moved from −330 to −348.
- **Median west of the field** (x −145, −245): kerb painted black and green; railing posts are maroon (also maroon at the field, x −27). East of the field the kerb stays black and white.
- **Field, Baikuntha Rd side** (pano O7OpOyLpLLFmj4JrMQhC-g): ~0.9 m brick wall painted terracotta red at the road edge, chain-link above, a black side gate, bare earth and trees inside; the small footprint inside (787) is a single-storey shed.
- **Sky:** washed-out blue-grey in every pano; the sky shader is now desaturated ~45% and street haze is thicker.
- **Mandir front** (pano PB8GuiPzx4PQ7Ock14zMVQ): beside the stairs the bank is a scrubby slope of dry grass, not a vertical earth face; modelled as sloped banks with scrub (`world/mandir.js`). The median railing here has tan-yellow bars on maroon posts (not changed yet: the game keeps black bars).
- **Median shrubs:** low trimmed clumps, not big bushes; the instanced shrubs are now smaller and smoother.
- **Side lanes** (Narikalbari 3rd Bye Ln, pano JPgmyrPGWZ-f8WgnYNl_WA, May 2023): ~4 m lanes between 1.6-2.1 m plot walls, bare brick about as often as plaster, a gate per plot, open drains. `buildLaneWalls` in `world/compound.js` now walls the lanes inside x −560..170, y −340..340 with the main-road skip rules (houses or shops at the edge, lane mouths, open land). The layout is seeded, not surveyed per plot; every lane gate is left open so yards stay reachable.
- **Railway Colony Rd** (panos QeJJjseHoN4HNDhn6_ERhQ, TM0yGJz9JxTDqlgqGfI_bQ Mar 2026; n6dev6yxA3mnQbD9EJ-sAw May 2023): walled both sides (yellow wall with green net west, tall peach railway-quarters wall east) under big rain trees; at the fork (y ≈ 30) a green tin kiosk, bamboo and a yellow Assam-type house on the bank (building 641, was a seeded 5-storey). North of y ≈ 55 it is a sunken lane between ~3 m mossy old walls under a closed canopy: lane walls there are taller and moss-grey, with six canopy trees added.
- **Baikuntha Rd** (pano 9bR5q_sunpOe0opddsgylw): ~4.5 m lane, tall white apartments behind low railed walls on the north, houses at the edge on the south. The game was already close; no change.
- **Hill road to Faculty School:** no Street View; satellite shows pale cast concrete winding up through forest, so lane surfaces above y 70 in x 40..175 are now concrete. The cleared brown band below the View point (the sightline) is a deliberate choice and stays.
- **View point** (visitor photo, Jul 2023): matches the terrace already built; the game's pair of floor-sitters there was swapped for two people standing at the railing.

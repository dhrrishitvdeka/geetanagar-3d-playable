# Geetanagar 3D: the game

A walk-around 3D game set in Geetanagar, a neighbourhood of Guwahati, Assam. Walk Mother Teresa Rd from Hatigarh Chariali to the
mandir, drink lal sah at Bina Baideu's stall, kick a ball about with the kids on the field, and dance the Rongali Bihu in the
evening. Built with three.js and Vite; everything you see (buildings, people, vehicles, sounds) is made in code or from free CC0 assets.

## Run it

You need [Node.js](https://nodejs.org) 20 or newer.

On Windows, double-click `run.bat`: it installs dependencies on the first run and opens the game in its own browser window on the
laptop's dedicated GPU. Or by hand:

```
npm install
npm run dev        # then open http://localhost:5173/game.html
npm run build      # static build in dist/
```

Add `?autostart` to the address to skip the title menu, or `?fps` for a frame-rate readout that names the GPU in use.
`http://localhost:5173/` is the free-roam explorer of the same map.

## What's in it

- **The neighbourhood.** About 1,500 buildings from the real footprints, with shopfronts, compound walls and gates, posters and
  painted ads, potted plants on the walls, DTH dishes and washing on the roofs, the field, the Children's Park, the mandir and
  the View point on the hill.
- **People who live there.** Shopkeepers behind their counters, hawkers calling out, regulars who leave their gates in the morning
  to catch the bus, go to school or do the shopping, and come home in the evening. Elders sit at the namghar for the evening
  kirtan. Walkers keep to the footpath, wait for a gap in the traffic, stop to watch the football and remember if you bump them.
- **Friendships.** Talk to people every day, help them and bring them things they like: they greet you by name, give you a
  discount and the odd present. The journal keeps track of everyone you have met.
- **Quests.** Dadu's morning tea, a lost ball and a football match, flowers for the puja, a dog called Pori, a photo walk,
  parcel runs, a hunt for gamosas, and the Rongali Bihu chapter (wear a mekhela sador or a dhoti and kurta and join the dance).
- **Traffic.** Hatchbacks, sedans, SUVs, Activa- and Splendor-style two-wheelers with their riders, CNG autos, totos, city buses
  that stop at the bus stand, Tata Aces and cycle-rickshaws.
- **Sound.** Synthesised in the browser: temple bells, conch shells at dawn and dusk, pressure cookers at lunchtime, school
  bells, kirtan, the tea stall, horns and the dhol.
- **A day.** The clock runs from 6:30 am to 6 pm, and the town changes with it: the morning rush, the quiet midday heat, the
  busy evening.

## Controls

| Keys | Action |
|---|---|
| `W` `A` `S` `D` / arrows | Move, relative to the camera |
| Mouse (click the view first) | Look; the wheel zooms |
| `Shift` | Sprint (uses stamina) |
| `C` / `Ctrl` | Crouch |
| `Space` | Jump |
| `E` / `F` | Talk, interact, get off a vehicle |
| `V` | First person on or off |
| `M` `J` `I` / `Tab` | Map, journal, inventory |
| `P` | Photo |
| `H` | Help |
| `Esc` | Pause |

On a touch screen the joystick moves and dragging the view looks around.

## Layout

| Path | What it is |
|---|---|
| `game.html`, `src/game/` | The game: player, people (`npc/`), animals, traffic, quests and content, friendships, HUD, map, sound |
| `index.html`, `src/main.js` | The free-roam explorer |
| `src/core/` | Renderer, scene and camera; map data and terrain height |
| `src/world/` | Terrain, buildings and shopfronts, roads, walls, the field and park, props, vehicles, sky |
| `src/veg/` | Trees, palms, grass and flowers |
| `src/render/`, `src/ui/` | Quality presets and batching; walk controls, labels, minimap |
| `data/` | Map data: footprints, roads, terrain, labels |
| `public/assets/` | Textures, character and tree models, HDRI |

Coordinates are local metres (x east, y north); three.js is y-up, so a map point `(x, y)` at height `h` is `Vector3(x, h, -y)`.

## Credits

Libraries and assets, with their licences, are listed in [CREDITS.md](CREDITS.md). Map footprints were traced for this project
from map imagery; road names are © OpenStreetMap contributors (ODbL); terrain is from the Copernicus GLO-30 DEM.

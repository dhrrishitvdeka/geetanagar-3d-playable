# Geetanagar 3D

A walkable 3D replica of Geetanagar, Guwahati (Assam), built with three.js and Vite.

On Windows, double-click `run.bat`: it installs dependencies the first time and opens the app in your browser. Or by hand:

```
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/
```

## Layout

| Path | What it is |
|---|---|
| `index.html`, `src/style.css` | Page shell and HUD |
| `src/main.js` | Boot, UI wiring, render loop |
| `src/core/` | `context.js` (renderer, scene, camera), `geo.js` (loads `data/geo.json`, terrain height `hAt`, class raster `clsAt`) |
| `src/world/` | Terrain, buildings, Mother Teresa Rd (`mainroad.js`), lanes/field/park (`streets.js`), View point deck, sky, lighting, outer ring, mandir gate, kiosks and shopfronts, landmarks, Hatigarh stalls/traffic/poles (`streetlife.js`) |
| `src/veg/` | Asset loading, EZ-Tree trees with near/far LOD, grass and flowers |
| `src/ui/` | Walk/aerial controls, labels, minimap |
| `src/dev/shots.js` | Dev-only: fixed comparison viewpoints, saved through the `/__shot` endpoint |
| `data/geo.json` | Footprints, roads, class raster, terrain grid, field/park polygons, labels (local metres, x = east, y = north, origin 26.1735 N, 91.7900 E) |
| `public/assets/` | Textures, GLB models, HDRI |
| `pipeline/` | Offline data tools (Python); runtime never imports from here |
| `legacy/` | The original single-file prototype and its base64 assets, kept for reference |
| `screenshots/<milestone>/` | Comparison captures from the five standard viewpoints |

## Game

A third-person game on the same map lives at `game.html` (`http://localhost:5173/game.html` while the dev server runs; `run.bat` opens it directly, and the explorer's title card links to it). Add `?autostart` to the address to skip the title menu.

| Keys | Action |
|---|---|
| `W` `A` `S` `D` / arrows | Move, relative to the camera |
| Mouse (click the view first) | Look; wheel zooms the camera |
| `Shift` | Sprint (uses stamina) |
| `C` / `Ctrl` | Crouch on or off (slower and quieter; sprint or jump stands you up) |
| `Space` | Jump |
| `E` / `F` | Interact; get off a vehicle |
| `V` | First person on or off |
| `M` `J` `I` / `Tab` | Map, journal, inventory |
| `P` | Photo |
| `H` | Help |
| `Esc` | Pause |

On a touch screen the joystick moves and dragging the view looks around.

Code is in `src/game/`; the module contract (coordinates, events, exports) is `docs/game.md`.

| Path | What it is |
|---|---|
| `src/game/main.js` | Boot, title backdrop, pause, saving, frame loop |
| `src/game/player.js`, `input.js` | Character controller, camera, vehicles; keys, touch and the joystick as one action map |
| `src/game/core/` | `state.js` (money, inventory, clock, save slot), `bus.js` (events) |
| `src/game/npc/`, `animals.js`, `traffic.js` | People, animals and moving traffic |
| `src/game/hud.js`, `map.js`, `audio.js` | Menus and HUD, full map, procedural sound |
| `src/game/quests.js`, `content/`, `interact.js`, `items.js`, `worldobjects.js` | Quests, places, things to do |

## Comparison screenshots

With `npm run dev` running and the page open, run this in the browser console:

```js
await __geet.shots('m1')   // writes screenshots/m1/{viewpoint,field,mandir,hatigarh,aerial}.png
```

## Coordinates

World space is three.js y-up: a map point `(x, y)` at height `h` sits at `new Vector3(x, h, -y)` (helper `P` in `core/geo.js`).

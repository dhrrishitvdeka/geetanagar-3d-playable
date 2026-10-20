# Audit: Geetanagar 3D (2026-10-19)

Scope: the explorer as it stood before the game was added (`index.html`, `src/`, `data/`, `public/`, `pipeline/`,
`legacy/`, `screenshots/`), checked by reading the code, a production build, and loading it in Firefox 158 and the
desktop app's Chromium preview. The game built on top of it is covered at the end.

## Summary

The explorer is in good shape: a clean module split, each world builder isolated so one failure can't take down the
boot, quality presets with dynamic resolution, static mesh merging, and an honest accuracy log in `NOTES.md`. The build
is clean (Vite 8.3.4, three 0.186.1, no warnings) and the page loads in about 9 s with no console errors. The real risks
are around the project rather than in the code: no version control, a 220 MB screenshot folder, unverified asset
licences, and map data derived from Google Maps that can't be published as is.

## Findings, most important first

| # | Severity | Finding | Suggested fix |
|---|---|---|---|
| 1 | High | **No version control.** The folder is not a git repository, so there is no history or rollback while several people (or sessions) edit at once. | `git init`, keep `screenshots/` and `legacy/` out of the repo (or in LFS), commit the current state as a baseline. |
| 2 | High (if published) | **Licensing.** Ten asset rows in `CREDITS.md` are still marked *verify* (bark and leaf textures, grass and flower models, ground textures, the HDRI). Building footprints and roads are traced from Google Maps, which is not openly licensed. | Keep builds private until the assets are confirmed (or swapped for known CC0 ones) and Google's terms are checked; OSM-derived names already carry ODbL attribution. |
| 3 | Medium | **Project weight.** 232 MB on disk excluding `node_modules`; `screenshots/` is 220 MB (95%) of comparison PNGs. `legacy/` (5.8 MB) holds 9 byte-identical copies of `public/assets` images and 5 base64 copies of the models and HDRI. | Move screenshots to an archive or LFS; `legacy/` can be dropped once nobody needs the original single-file build. |
| 4 | Medium | **Street-level frame time.** At High in a 1024x768 Chromium view: aerial 61 fps, but walking at Hatigarh, the field and the View point all sit at ~31 fps (frames just over 16.7 ms, so vsync halves them). Boot is ~9 s, ~2 s of it in `buildAll` (facade textures 1.25 s). | Profile the walk view (grass + near trees + shadows + GTAO); consider Medium as the default for integrated GPUs (it already is) and caching the facade atlas. |
| 5 | Medium | **Payload.** Largest JS chunk 926 kB (261 kB gzipped); data JSON 1.5 MB (`geo.json` 910 kB, 341 kB gzipped). | Fine on broadband; for phones, split the facade/texture generators into their own chunk and serve the JSON pre-compressed. |
| 6 | Medium | **Parked vehicles have no collision.** In walk mode you can walk straight through every parked car, toto and bus. | The game now turns them into colliders (`src/game/traffic.js`); the explorer could do the same. |
| 7 | Low | **Frozen traffic.** Vehicles placed in the driving lanes are static, so the main road looks like a paused video at street level. | The game replaces them with moving traffic (`buildTraffic({ lanes: false })`). |
| 8 | Low | **Label clutter.** In the aerial view labels overlap around the field and school cluster (no collision handling). | Hide the lower-priority label when two overlap, or fade by distance. |
| 9 | Low | **Dev screenshot endpoint.** `/__shot` accepts any HTTP method and an unbounded body and writes a PNG to disk. Names are sanitised (no path traversal) and it only exists on the dev server, which listens on localhost by default. | Accept POST only and cap the body size, in case someone runs `vite --host` on a shared network. |
| 10 | Low | **WebGL context loss** is only logged; after a GPU reset the canvas stays black. | Show the existing "can't draw 3D" panel with a reload button on `webglcontextlost`. |
| 11 | Low | **External fonts.** Pages load Google Fonts; offline or blocked, they fall back to system fonts (works, looks different). | Self-host the three font files if offline use matters. |
| 12 | Info | **Unverified content** listed in `NOTES.md`: the shrine at the top of the mandir path, most building heights and colours, goalposts, kiosk names. | Owner decisions; nothing to fix in code. |

## Checks that came back clean

- `npm run build`: passes, no warnings, two pages (explorer and game).
- Code hygiene in `src/` (explorer): no `console.log`, `TODO`, `FIXME`, `debugger`, `eval` or `innerHTML`; two
  `console.error` calls, both deliberate (boot isolation and context loss).
- Firefox 158 load: ready in ~9 s, no errors; one harmless D3D shader-compiler precision warning (X4122).
- Note for testing: when the Firefox window is minimised or covered, the page is `hidden` and renders 0 fps, which looks
  like a black canvas in screenshots. That is the browser pausing a hidden tab, not a bug.

## The game (`game.html`)

Built on the same map with every world builder unchanged; about 5,500 lines in `src/game/` (contract in `docs/game.md`).

**Cost.** Measured over every render pass at High: the explorer at the field draws 1,910 calls / 37.4 M triangles, the
game at the same spot 1,964 / 36.3 M, so the whole game layer (96 people, 26 vehicles, 24 animals, props, markers)
adds about 54 draw calls. The crowd is 14 instanced draws; traffic 18; animals 10.

**Played through in the browser:** title menu, new game and Continue after a reload (money, position, quest step
restored); walking, sprinting, jumping, collisions; the full tutorial (Dadu, buying lal sah from Bina Baideu, hand-in
and reward); renting and riding a scooter; the kiosk shop; feeding Pori and having her follow; the temple bell;
binoculars spotting all three targets; photos; bus travel; place discovery; the full map; cinematic subtitles.

**Fixed during integration:** animal shader didn't compile on three r186 (`vColor` is a vec4); benches seated the
player half a metre in the air; the priest stood on top of the bell's prompt; a raw NUL byte in `hud.js`; the player
froze if a teleport or knockback left them inside a collider (now steps out after 0.3 s); tutorial text pointed at the
wrong side of the screen. Floating place labels are off in the game (names live on the full map).

**Not verified:** phones and touch controls, Firefox rendering of the game (its window was hidden during testing),
the late quests end to end (football match, photo walk, scooter errand, parcel timing, all 24 gamosas), a real traffic
hit (cars brake for a player standing in the lane; hits were tested in a Node harness), the day rollover at 6 pm, sound
levels, and Low quality on a weak GPU.

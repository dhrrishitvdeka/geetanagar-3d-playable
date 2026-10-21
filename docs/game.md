# Geetanagar: the game

A third-person, walk-around game played in the browser on the same map as the explorer (`index.html`). It reuses every
world builder in `src/world/`, `src/veg/` and `src/render/` unchanged and adds characters, traffic, animals, quests and
interactions on top. Page: `game.html`, entry `src/game/main.js`.

This file is the contract between the game modules. Each module is owned by one person at a time; stick to the exports
listed here so the others can rely on them. If you need something that is not listed, add it to your own module and
note it in your report rather than reaching into someone else's file.

## Ground rules

- No new npm dependencies and no downloaded assets: geometry, textures and sound are procedural (three.js primitives,
  canvas textures, WebAudio). The existing `public/assets/` models may be reused.
- Do not edit files you don't own. The few allowed edits to existing explorer files are listed per unit below, and the
  explorer (`index.html`, `src/main.js`) must keep working exactly as before.
- Match the existing style: compact lines, `// ---------- section ----------` headers, short comments that say why.
  Plain human voice in comments and docs.
- Everything dynamic sets `userData.noMerge = true` on its meshes. `mergeStatic()` runs before any game module's
  `init*()`, so nothing of ours gets baked into the static batches, but the flag keeps it safe if the order changes.
- Hot loops (`update*`) must not allocate: reuse vectors, matrices and arrays. Budget for the whole game layer is
  about 4 ms CPU per frame on a laptop and under 60 extra draw calls (shadow pass not counted).
- Every `init*()` must tolerate the others failing (main.js wraps each in try/catch); `update*()` must never throw on a
  missing optional system.

## Coordinates and world helpers

- Map space: metres, `x` east, `y` north. three.js space is y-up: map `(x, y)` at height `h` is
  `new THREE.Vector3(x, h, -y)` (`P(x, y, h)` in `src/core/geo.js`).
- Heading `a` (radians) is a map angle: direction `(cos a, sin a)`, so east = 0, north = pi/2. Models are built facing
  local `+x` and placed with `obj.rotation.y = a` (the vehicles in `world/road/vehicles.js` already work this way).
- The explorer's `player.yaw` (in `ui/controls.js`) is a camera angle with 0 = north and forward `(-sin yaw, cos yaw)`;
  the matching heading is `yaw + pi/2`.
- Ground height for anything that walks: `groundAt(x, y)` from `world/deck.js` (terrain plus the View point terrace).
  Raw terrain: `hAt(x, y)` from `core/geo.js`.
- Can a person stand here: `walkable(x, y)` from `ui/controls.js` (class raster: 2 = building and 3 = shop are blocked,
  plus wall/railing colliders, plus the map bounds). `findOpen(x, y)` nudges a point off buildings.
  Slope rule used by the explorer: a step is refused when `dh / dist >= 1.2`. `deckBlocked(x, y, h0)` from
  `world/deck.js` keeps you on the terrace.
- Colliders: `addCollider([x0, y0], [x1, y1])` and `blockedBySeg(x, y, r)` from `world/geom.js`. Anything added with
  `addCollider` also blocks `walkable`.
- Class raster: `clsAt(x, y)` from `core/geo.js`: 0 yard, 1 road, 2 building, 3 shop, 4 park, 5 field, 9 outside.
- Mother Teresa Rd: `MAINP` (samples every 2.5 m, `[x, y, width]`), `NRM` (unit normal pointing north),
  `asphHalf(i)` (half asphalt width), `medHalf(x)` (median half width, 0 where there is none), `hw(i)` (half
  right-of-way), `nearestOnMain(x, y) -> [dist, index]`, `HAT` (Hatigarh junction centre), `RF` (surveyed features from
  `data/road_features.json`), all from `world/mainroad.js`. Traffic drives on the left: eastbound on the north half.
  `beside(x, side, offset) -> [x, y, i]` from `world/streetlife.js` gives a point `offset` metres off the centreline
  (`side` +1 north, -1 south).
- Lanes: `GEO.roads` = `[{ p: [[x, y], ...], w, name? }]` (470 clean centrelines, median width 6 m). `resample(pts,
  step)` and `normalsOf(pts)` from `world/geom.js`.
- Labels: `GEO.labels` = `[{ t, x, y, k }]`, `k` is `main`, `road`, `lm` (landmark) or `pin`.
- Field: `GEO.field` = `[x0, y0, x1, y1]`, `GEO.fieldPoly`; goals sit on the polygon's long (PCA) axis 5 m in from
  each end, 7.32 m wide, 2.44 m high (see `buildField` in `world/streets.js`). Field frontage: `FIELD_X0`, `FIELD_X1`,
  `GATE_X` from `world/road/fieldedge.js`.
- Children's Park: `GEO.parkPoly`; `SHEDS`, `ROUND`, `GATE`, `TANK` from `world/park.js`. Bus stand: `RF.bus_stops[0]`
  at (-57, -74). Park forecourt stalls: `RF.stalls` kinds `tea_stall` (x -121), `kiosk_blue`, `handcart`; they sit at
  `beside(x, -1, asphHalf(i) + 3.4..3.6)`.
- Field-side kiosks (`world/shops.js buildKiosks`): PAN & TEA x 24, STORE x 31, SNACKS x -44, FRUITS x -37, each at
  `hw(i) + 1.6` off the centreline on the side where `NRM[i][1] > 0` (north), `i = nearestOnMain(kx, -50)[1]`.
- Hatigarh: stall row `RF.stalls[0]` (9 stalls from (-489.3, -60.2), 2.45 m apart going north, facing west), kiosk
  (-501, -61.6), totos waiting on the south side from x -468 eastwards.
- Mandir gate: `MANDIR` from `core/geo.js` (stairs centred on x 49.5 from y -41.3 up to -34.4, platform 3.6 m up).
- View point terrace: `DECK` from `world/deck.js` (centre (78, 199.1), 10 x 7 m, `DECK.top` is the floor height).
- Other places worth using: SBI Branch Gitanagar (168.9, -172.2), SBI ATM (-340, -78), Geetanagar High School
  (-45, 24.4), Kanya Mahavidyalaya (-78.9, 83.6), Faculty Senior Secondary School (119.2, 241.2), Sarbojonin Namghar
  (-100, 115), Rajohua Namghar (239.2, 83.6), Geetanagar LP School (-68, 16).

## Boot order (src/game/main.js)

Performance checks: `game.html?fps` shows fps, the slowest recent frame, the GPU the browser gave WebGL (on a two-GPU laptop:
integrated or dedicated), the preset and the dynamic resolution. `(await import('/src/dev/gpubench.js')).bench()` in the dev
console times the scene and shadow passes on the GPU at three fixed spots and counts what each draws.

1. Same world build as the explorer (`src/main.js`), then `mergeStatic(scene)`.
2. `enterWalk('field')` from `ui/controls.js`: puts the shared modules (grass, labels, terrace) in walking mode. From
   then on `player` from `ui/controls.js` is kept in sync by `player.js` (`x`, `y` = character, `yaw`/`pitch` = camera).
3. `initInput`, `initAudio`, `initHUD` (before the world loads), then `initMap`, `initPlayer`, `initTraffic` (turns
   parked vehicles into colliders, so it runs before the NPC walk graph is built), `initAnimals`, `initNPCs`,
   `initWorldObjects`, `initLoose`, `initQuests` (in this order; each in try/catch).
4. Title menu. On `ui:start` the game loads or starts a save and the loop starts updating the game systems.
5. Each frame while playing: `advanceClock`, `updatePlayer`, `updateNPCs`, `updateAnimals`, `updateTraffic`,
   `updateWorldObjects`, `updateLoose`, `updateQuests`, `updateInteract`; always: shadows, vegetation LOD, sky, `renderFrame`,
   `updateLabels`, `updateMap`, `updateHUD`, `endFrame`.

## Events (src/game/core/bus.js)

`on(type, fn) -> unsubscribe`, `once`, `off`, `emit(type, payload)`. Handlers run synchronously; errors are caught and
logged.

| Event | Payload | Emitted by |
|---|---|---|
| `ui:start` | `{ newGame }` | hud (title menu) |
| `ui:resume` | `{}` | hud (pause menu) |
| `ui:settings` | `{ settings }` | hud, after `state.settings` changed |
| `ui:look` | `{ look }` | hud (title "your look" picker), after `state.look` changed |
| `input:action` | `{ action, down }` | hud touch buttons; input.js treats it like a key |
| `game:start` | `{ newGame }` | main |
| `game:pause` / `game:resume` | `{}` | main |
| `money:changed` | `{ money, delta, reason }` | state |
| `money:short` | `{ need, have }` | state |
| `inv:changed` | `{ id, qty, delta }` | state |
| `collectible:found` | `{ id, count, total }` | worldobjects |
| `place:discovered` | `{ id, name }` | state (`discover`), called by quests |
| `npc:talk` | `{ id, name }` | agents (player talked to an NPC) |
| `npc:bumped` | `{ id }` | agents |
| `player:hit` | `{ dx, dy, speed, kind }` | traffic (unit push direction in map space) |
| `vehicle:mount` / `vehicle:dismount` | `{ kind }` | player |
| `dog:fed` / `animal:pet` | `{ id, kind }` | animals |
| `bell:rung` | `{}` | worldobjects |
| `goal:scored` | `{ goals }` | worldobjects (football) |
| `ball:goal` | `{ goal, byPlayer }` (`goal` = index into `FIELD.goals`; any goal, the kids' too) | worldobjects (football) |
| `photo:taken` | `{ placeId, name }` (`placeId` null if no landmark in shot) | worldobjects |
| `binocular:spotted` | `{ placeId, name }` | worldobjects |
| `item:used` | `{ id }` | items |
| `outfit:changed` | `{ id }` (`null` when taken off) | items (`wearItem`) |
| `shop:bought` | `{ shopId, id, price }` | items |
| `delivery:done` | `{ reward, onTime }` | worldobjects |
| `quest:started` / `quest:updated` / `quest:completed` | `{ id, title, step?, reward? }` | quests |
| `clock:hour` | `{ hour, day }` | state |
| `day:end` | `{ day }` | state |

## Module exports

### core/state.js (engine)
`state` (live object), `CLOCK`, `newGame()`, `save()`, `load()`, `hasSave()`, `addMoney(n, reason)`,
`spend(n) -> bool`, `addItem(id, qty)`, `removeItem(id, qty) -> bool`, `hasItem(id, qty)`, `itemCount(id)`,
`setFlag(k, v)`, `getFlag(k)`, `markCollected(id) -> isNew`, `isCollected(id)`, `discover(id, name) -> isNew`,
`advanceClock(dtSeconds)`, `nextDay()`, `clockText(hour)`, `saveSettings()`.
Shape: `{ money, inv: {id: qty}, quests: {id: {status, step, data}}, flags, collected: [], discovered: [],
stats: {distance, goals, deliveries, photos, talks}, time, day, player: {x, y, heading} | null, look,
settings: {sens, volume, invertY, labels, fov}, stamina (0..1), buffs: {name: secondsLeft} }`.

### input.js (engine)
`initInput()`, `isDown(action)`, `pressed(action)` (once per press, cleared by `endFrame()`), `axis() -> {x, y}`
(strafe, forward; keys plus the touch joystick, length <= 1), `wheel()` (accumulated wheel delta since last call),
`endFrame()`.
Actions: `forward back left right sprint crouch jump interact map journal inventory pause photo camera help`.
Keys: WASD/arrows, Shift, C or Left Ctrl (crouch, a toggle), Space, E (and F), M, J, I or Tab, Esc, P, V, H.

### player.js (engine)
`initPlayer()`, `updatePlayer(dt)`, `getPlayer()` -> live object `{ x, y, z, heading, speed, vx, vy, riding, seated,
crouching, cameraMode, stamina }`, `teleport(x, y, heading?)`, `mountVehicle(v)` where `v = { mesh, kind, x, y, heading,
maxSpeed?, onDismount?(v) }`, `dismount()`, `setSeated(seat | null)` with `seat = { x, y, z, heading }`,
`setCameraMode('third' | 'first' | 'binocular')`, `getCameraMode()`, `setInputLocked(bool)`,
`addBuff(name, seconds)` (`speed`, `stamina`), `setLook(appearance)`.

### npc/humanoid.js (characters)
`randomAppearance(rand, opts?) -> Appearance` (opts: `{ role, kid, female }`), `makeCharacter(appearance) ->
{ group, animate(dt, { state, speed }), setAppearance(a), height }`.
Appearance: `{ skin, hair, hairStyle: short|long|bun|bald|cap, top, topStyle: shirt|tshirt|kurta|blouse|robe|uniform,
bottom, bottomStyle: pants|shorts|dhoti|mekhela|sari|skirt, wrap (chador/sari drape colour or null), gamosa (bool),
hat: null|japi|cap|topi, bag (colour or null), umbrella (colour or null), height (scale, 1 = 1.65 m), build, kid }`.
Animation states: `idle walk run sit talk wave kick ride fall jump pray crouch pickup` (also `flinch floor`). `crouch` is a pose that also walks
(the clip follows `speed`); `kick` and `pickup` are one-shots of about 0.5 and 0.85 s. On the rigged model `walk` and `run` are only hints: idle, walk, jog and
sprint are blended by `speed`, so pass the real ground speed. Jump start / land and sitting down / standing up play by themselves when the state changes.
`makeCharacter` returns a rigged model (`npc/realchars.js`: Quaternius bodies from `public/assets/chars/`, built by
`pipeline/chars_build.mjs`) once `preloadCharacters()` has resolved, and the procedural humanoid otherwise; `animate` also takes
`seated` (talking while seated) and `restart`, and appearance may carry `female` (picks the body) and `beard`. Named NPCs, the player
and the 6 / 12 / 16 nearest ambient NPCs (`npc/realpool.js`, `n.real` makes `crowd.js` skip them) use the rigged model; the rest stay
on the instanced crowd.
`group` faces `+x`, origin at the feet, every mesh `castShadow` and `userData.noMerge`.

### npc/nav.js (characters)
`buildNav()`, `randomPoint(near, minD, maxD) -> { x, y, node }`, `findPath(ax, ay, bx, by) -> [[x, y], ...] | null`,
`nearestNode(x, y)`.

### npc/agents.js (characters)
`initNPCs()`, `updateNPCs(dt, player)`, `spawnNPC(def) -> npc`, `getNPC(id)`, `allNPCs()`,
`npcBlocking(x, y, r = 0.45, ignoreId) -> npc | null`, `npcSay(id, text, ms)`, `npcSetBehavior(id, behavior, opts)`,
`npcMoveTo(id, x, y, { run, onArrive })`, `npcFace(id, x, y)`, `removeNPC(id)`,
`addSpot(x, y, fromHour, toHour, make, r = 200, when?)`: a place that fills with people while the player is within `r` m, the hour is in
range and `when()` (if given) holds. `make(spot)` returns `[{ role, x, y, heading, behavior, fixed?, z?, name?, title?, appearance?, def? }]`:
`fixed` stands them off walkable ground (behind a shop counter), `z` is their floor height, `appearance` goes over a random look and
`def` joins the NPC's def (`onTalk`, `shop`, `greet`, `chat`...). Behaviour `dance`: a slow Bihu ring round `anchor`, arms raised.
NPC: `{ id, name, role, title, x, y, z, heading, speed, state, behavior, def, talking }`.
def: `{ id, name, role, title?, x, y, heading?, appearance? (partial), seed?, behavior?: idle|wander|patrol|sit|vendor|
play|follow|pace|football, anchor?: {x, y, r}, path?: [[x, y]], talk? (default true), onTalk?: async (npc) => void,
lines?: [string] }`. Every NPC with `talk !== false` gets an interactable (`npc:<id>`); talking stops it, turns it to
the player, emits `npc:talk`, then runs `def.onTalk(npc)` or a random line from `def.lines` / the ambient pool.
Head look: each frame an NPC may set `lookOn` with `lookX, lookY, lookZ` (a map point and absolute height); `npc/realpool.js` turns
the rigged model's head and neck toward it. Footballers watch the ball, play kids their ball, others the player when close and
in front of them. The field's kids are a 3-a-side match (`behavior: 'football'`, `team` 0/1, `fpos` keep/def/att; team 0 attacks
`FIELD.goals[1]`); they act on the ball only through `npcKick` and `pushBall`. Do not use `n.slot` for anything: it is the
rigged-model slot from `realpool.js`.

### animals.js (animals and traffic)
`initAnimals()`, `updateAnimals(dt, player)`, `allAnimals() -> [{ id, kind, name?, x, y, heading, state }]`,
`animalBlocking(x, y, r) -> animal | null`, `setDogFollow(id, on)`.
Kinds: `dog cow goat crow`. One named dog, Pori, lives at Hatigarh (around (-470, -70)); feeding her (needs a
`biscuits` item) emits `dog:fed` and makes her follow the player.

### traffic.js (animals and traffic)
`initTraffic()` (also turns parked vehicles into colliders), `updateTraffic(dt, player)`,
`vehicleAt(x, y, r = 0.5) -> vehicle | null` (moving traffic), `getTrafficVehicles() -> [{ x, y, heading, kind, speed }]`.

### interact.js (gameplay)
`register(spec) -> { id, remove(), set(props) }` with `spec = { id, x?, y?, z?, pos?: () => [x, y, z], r = 2,
label: string | () => string, kind?, priority = 0, enabled?: () => bool, onInteract: () => void | Promise }`,
`unregister(id)`, `updateInteract(player)` (focus = best enabled spec within `r`, roughly in front of the player;
shows the prompt through `hud.setPrompt`), `tryInteract() -> bool`, `getFocused()`.

### items.js (gameplay)
`ITEMS` (`{ id: { name, price, desc, use?, wear? } }`), `SHOPS` (`{ shopId: { name, owner, items: [id] } }`),
`openShop(shopId, owner?, title?) -> Promise`, `useItem(id) -> bool`, `wearItem(id) -> bool`, `isWorn(id)`.
Outfits (`mekhela_muga`, `mekhela_pat`, `dhoti_kurta`, sold at New Assam Dresses) carry `wear`, a partial appearance: wearing one
sets `state.wear = { id, ...wear }`, which player.js lays over `state.look` (it is kept in the bag, and taken off the same way).
A mekhela's woven motifs take `appearance.motif` (default: the blouse colour).

### content/shopkeepers.js (content)
`initShopkeepers()` (called by quests.js), `nearestShop(signName, x, y) -> bay | null`. One keeper per open shopfront on Mother Teresa
Rd, from `SHOP_BAYS` in world/shops.js (`{ row, name, tag, kind, sells, x, y, z, heading, fx, fy }`: the keeper's spot on the shop
floor, the customer's spot `fx, fy` on the footpath). Shops whose sign matches a table in `SHOPS` sell through "Buy something".
Quest `rongali_bihu` (Nabin Da at the field gate, after `morning_sah`): dress for Bihu and bring two til pitha, then the dance on the
field from 4:30 pm.

### worldobjects.js (gameplay mechanics)
`initWorldObjects()`, `updateWorldObjects(dt, player)`, `takePhoto()`, `setWorldMarker(id, { x, y, z?, color? })`,
`clearWorldMarker(id)`, `startDelivery() -> job | null` (job: `{ id, x, y, label, reward, timeLeft }`),
`getDelivery() -> job | null`, `cancelDelivery()`, `setBallPosition(x, y)`, `getBall() -> { x, y, inField }`,
`setScooterUnlocked(on)` (rideable scooters ask for permission until the quest unlocks them), `FIELD` (pitch frame: centre
`cx, cy`, long axis `ux, uy`, extents `lo, hi` along it and `wlo, whi` across it, `goals`), `ballRef()` (the live ball, read-only,
null before init), `ballInField()`, `npcKick(angle, speed, lift) -> bool` (refused while held, after a goal or within 0.3 s of the
last kick), `pushBall(x, y, r, speed)` (a body shoving the ball out of itself), `placeChair(x, y, heading) -> seat | null` (a
plastic chair registered as a one-person seat; agents.js puts one under a sitter with no bench in reach).

### seats.js (gameplay mechanics)
`addSeat({ x, y, z, heading, h?, single? })`, `claimSeat(x, y, who, r = 1.6) -> { x, y, z, h, heading, seat, k } | null`,
`releaseSeat(who)`, `SEATS`. (x, y) is where the hips go, z the ground, h the sitting surface above z (benches 0.47, chairs
0.44). Anyone sitting passes h on as `seatH` (NPC field, `animate({ seatH })` for the rigged models): the models then put the
pelvis on the seat point at that height instead of where the sitting clip leaves it.

### loose.js (gameplay mechanics)
`initLoose()`, `updateLoose(dt, player)`, `nearLoose(kind, x, y, r) -> obj | null`, `kickLoose(obj, angle, speed, lift)`.
Kinds `ball` (one, Children's Park; the play kids kick it about, the player can kick it with E), `can`, `bottle` (by the field
kiosks, the tea stall, Hatigarh and the bus stand). The player and NPCs knock them over by walking into them; they reset on
`game:start`. Three InstancedMeshes; only objects within 60 m of the player are simulated.

Item ids (`items.js`): `lal_sah doodh_sah samosa pitha jalebi biscuits banana marigold water newspaper cash_bag parcel`.
Shop ids: `tea_stall` (Bina, park forecourt x -121), `pan_tea` (Khagen, field kiosk x 24), `store` (Mamoni, x 31),
`snacks` (Rupa, x -44), `fruits` (Hari, x -37), `flower_cart` (Jonali, yellow carts x 36..39.5 by the mandir),
`hatigarh_kiosk` (yellow kiosk at (-501, -61.6)), `sweets` (first Hatigarh stall).

Page classes: `player.js` toggles `first-person`, `binocular` and `riding` on `#app` so the HUD can style for them.

### quests.js (gameplay content)
`initQuests()` (also spawns the named NPCs from `content/npcs.js`), `updateQuests(dt, player)`, `getQuestLog() ->
[{ id, title, desc, status, steps: [{ text, done }] }]`, `startQuest(id)`.

### content/npcs.js, content/places.js (gameplay)
`NAMED` (named NPC defs) and `spawnNamedNPCs()`; `PLACES` (`[{ id, name, x, y, r, kind }]`).

### hud.js (UI)
`initHUD()`, `updateHUD(dt)`, `toast(text, { kind: info|good|warn|quest, ms })`, `setPrompt(text | null, key = 'E')`,
`showDialogue({ speaker, role?, text, choices?: [{ text, value, disabled? }] }) -> Promise<value | null>`,
`isUIBlocking()`, `showMenu(name | null)` (`title pause journal inventory help settings`), `getOpenMenu()`,
`showShop({ title, subtitle?, items: [{ id, name, price, desc }], onBuy: id => true | 'reason' }) -> Promise`,
`setQuestTracker([{ title, steps: [{ text, done }] }])`, `setObjectiveTarget({ x, y, label } | null)`,
`bubble(key, getPos: () => THREE.Vector3, text, ms)`, `flash(color, ms)`, `fade(toBlack, ms) -> Promise`,
`setLoading(text | null)`, `bigMessage(title, sub?, ms)`.
Modals (dialogue with choices, shop, menus, full map) release pointer lock; plain dialogue lines advance with
E, Enter, Space or a click. The HUD imports `game.css`.

### map.js (UI)
`initMap()`, `updateMap(dt)`, `addMarker(id, { x, y, kind, label, color? })` (`kind`: quest shop npc travel
collectible poi job), `removeMarker(id)`, `toggleFullMap(force?)`, `isFullMapOpen()`, `getWaypoint()`.
The minimap reuses the explorer's base image (`makeMiniBase()` / `miniBase` from `ui/minimap.js`).

### audio.js (UI)
`initAudio()` (unlocks on the first user gesture), `sfx(name, { x, y, vol, pitch })`, `setListener(x, y, heading)`,
`setAmbience({ traffic, birds, crowd })` (0..1), `engine(on, speed01)`, `setVolume(v)`.
Sounds: `step coin pickup bell horn kick goal ui error quest bark moo caw whistle shutter splash door engine_start`.

## Rules added after the design review

1. **Input while a modal is open.** `input.js` evaluates a gate (`setInputGate(fn)`, main passes `isUIBlocking`) at
   keydown time: while it returns true, key presses are tracked as held but never recorded for `pressed()`. The HUD owns
   every key while something is open (E/Enter/Space advance, 1-4 and arrows choose, Esc/J/I/Tab close) and calls
   `resetPresses()` from `input.js` when a modal closes. Only `main.js` reads `pressed()` for interact, map, journal,
   inventory, help, photo, camera and pause; only `player.js` reads `pressed('jump')`. Every dialogue line counts as
   blocking, and `isUIBlocking()` includes the full map.
2. **Forced closes resolve.** Pause, the day change, teleports and `showMenu` replacing something all close modals
   through `closeModals()` (hud.js), which resolves every pending dialogue and shop promise with `null`. Code awaiting
   `showDialogue` treats `null` as "Bye" and leaves state consistent (try/finally around NPC and quest state).
3. **Pointer lock** belongs to the engine: `ui/controls.js` gets a look gate (`setLookGate(fn)`) so a canvas click
   doesn't lock the pointer under a menu or dialogue; `input.js` exports `requestLock()`. The HUD's Resume button emits
   `ui:resume` synchronously inside its click handler; main requests the lock inside that same gesture.
4. **Init builds, `game:start` applies state.** `init*()` only builds meshes and registers listeners. Anything that
   depends on the save (collected gamosas, quest markers, unlocks, Pori following, the look, money on screen) is applied
   in an `on('game:start', ...)` handler that may run more than once. Never keep a reference to `state.inv`,
   `state.quests`, `state.flags` and friends: `newGame()` and `load()` replace those objects.
5. **Heights and headings.** In every map-space API, `z` is absolute height (three.js y), not height above ground.
   `bubble(key, getPos)` is the one exception: `getPos` returns a THREE.Vector3 in three.js space. Never use
   `Object3D.lookAt` to orient characters, animals or vehicles (it aims +z): set `rotation.y = atan2(ty - y, tx - x)`
   in map space, and wrap angle differences with `atan2(sin d, cos d)`.
6. **Draw calls** (shadow pass not counted): characters (crowd plus player) <= 25, traffic <= 20, animals <= 10, world
   objects and markers <= 15. Only the player, the crowd, vehicles, dogs and cows cast shadows; crows, markers,
   collectibles and beams never do. Static props created by the game are merged per material (build them in a Group,
   run `mergeStatic(group)` from `render/staticmerge.js`, then add the group).
7. **Quality tiers** (read `QUALITY` from `render/quality.js`), low / medium / high: ambient NPCs 24 / 40 / 64, moving
   traffic 10 / 18 / 26, animals including crows 12 / 18 / 24. Low has no shadows at all.
8. **Sun and sky.** main.js moves the sun every 0.02 game hours but rebakes the environment map only every 0.5 game
   hours (2 on Low) through `refreshEnv(t, rebake)` in `world/sky.js`.
9. **Colliders are static.** `addCollider` is boot-time only and nothing removes colliders; the rideable scooters are
   not colliders. `player.js` owns the reaction to `player:hit`; traffic only emits it, rate-limited per vehicle.

## Units and ownership

| Unit | Files | May also edit |
|---|---|---|
| Engine | `game.html`, `src/game/main.js`, `src/game/input.js`, `src/game/player.js`, `src/game/core/state.js` | `vite.config.js`, `index.html` (a link to the game), `run.bat`, `README.md`, `src/ui/controls.js` (export the joystick state only) |
| Characters | `src/game/npc/humanoid.js`, `src/game/npc/crowd.js`, `src/game/npc/nav.js`, `src/game/npc/agents.js` | none |
| Animals and traffic | `src/game/animals.js`, `src/game/traffic.js` | `src/world/road/vehicles.js` (exports only, plus recording placed vehicles), `src/world/streetlife.js` (`buildTraffic({ lanes })` option, default unchanged) |
| Gameplay mechanics | `src/game/interact.js`, `src/game/items.js`, `src/game/worldobjects.js` | none |
| Gameplay content | `src/game/quests.js`, `src/game/content/npcs.js`, `src/game/content/places.js` | none |
| HUD | `src/game/hud.js`, `src/game/game.css` | none |
| Map and audio | `src/game/map.js`, `src/game/audio.js` | none |

`src/game/core/bus.js` is frozen.

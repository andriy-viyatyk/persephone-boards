# Gem Keep — author notes

An original 3D tower-defense game. Raiders walk a road from spawn portals to the player's vault
(a plate with a mound of gems), pick up gems and carry them back to their portal. The player builds and upgrades towers on stone pads
beside the road and drops meteors with mana. Rendering is Three.js (WebGL 2); there is no backend
and no permission is requested. Task history: BT-077 in `doc/tasks/`.

## Files

| File | Role |
|---|---|
| `index.html`, `styles.css` | Page shell: canvas, HUD, popups, level menu, result screen. Game UI uses its own dark-glass palette; the theme supplies the font and accent. |
| `js/main.js` | Entry module: renderer, frame loop, level menu, HUD, build/tower popups, floating texts, progress storage. |
| `js/data.js` | **All balance numbers**: towers (per-level stats and costs), enemies, meteor, mana, wave timing, environment color presets. |
| `js/level.js` | Loads `levels/index.json` and level files; parses the ASCII map; finds each spawn's route with BFS. |
| `js/world.js` | Static scene for a level: sky, lights, terrain tiles (instanced), nature models placed by the environment's `nature` block (simple shapes if they fail to load), generated ground texture (world-position noise in the terrain shader), water, bridges, vault, portals, pad markers, tile picking. |
| `js/game.js` | Simulation and moving meshes: enemies, towers, projectiles, storm chains, meteors, particles, waves, win/lose. |
| `js/sound.js` | Procedural sound effects (Web Audio oscillators + filtered noise, no audio files), per-sound throttling, voice cap, soft wind ambience. `main.js` pans and attenuates world sounds by screen position and camera distance. |
| `js/camera.js` | Orbit camera: wheel/pinch zoom, drag rotate, right/middle/Shift/pen-barrel pan, WASD/QE keys; reports taps. |
| `lib/three.*.min.js` | three.js 0.180.0 (MIT), ES modules. See `lib/VERSION.txt`. |
| `js/monsters.js` | Animated raider models: `loadMonsters()` (started at boot, awaited before a level), `createMonster(type)` returns a skinned clone with its own materials (frost tint), walk/fly and death animations. Returns null if a model failed to load; `game.js` then uses the old procedural shapes. |
| `models/` | One `<type>.glb` + `<type>.png` per raider (Quaternius "Ultimate Monsters", CC0, `LICENSE-monsters.txt`): scout = Blob Ninja, soldier = Orc, brute = Yeti, bat = Dragon. The .glb keeps only the move/Death/Hit animations and has no embedded image: inside a board GLTFLoader cannot `fetch()` the `blob:` URL it makes for embedded textures, so `monsters.js` loads the PNG with `TextureLoader`. Repack script: `pack_glb.py` (session scratchpad; regenerate it if needed: decode the base64 buffer, filter animations, drop unreferenced accessors/views, write GLB). |
| `js/towers.js` | Tower models stacked from Kenney "Tower Defense Kit" pieces: `DESIGNS` lists floors per upgrade level, the top piece and the weapon. `createTowerModel(type, level, {stormMaterial, copperMaterial})` returns the parts game.js animates: `aim` (weapon root, faces +Z), `recoil {object, axis, rest, kick}`, `spin`, `float {object, rest, amount}`, `orb`, `muzzle` (tower units). Returns null if a piece is missing; `game.js` then uses `simpleTower()`. Pieces carry `userData.shared`; `game.dispose()` skips them. |
| `models/towers/` | 12 Kenney pieces (CC0, `LICENSE-towers.txt`) as .glb without images + `palette-<type>.png`: Kenney's palette repainted per tower (lavender stone -> gray stone, orange -> dark wood, purple -> the tower's accent). Repack/repaint script: `pack_towers.py` (scratchpad; `ACCENTS` and the hue ranges live there). |
| `js/water.js` | Water surface: one ShaderMaterial sheet over the full grid. A mask DataTexture (r = water, g = distance-to-shore depth) discards land cells, draws shore foam at r ~ 0.5 and blends shallow -> deep color. Wave normals adapted from afl_ext's MIT ocean (credit in the file, same source as the Audio Player ocean). Sky reflection, sun glint, fog and tone mapping. Optional `waterDeep` / `waterShallow` environment colors, else derived from `water`. Tuning constants at the top. |
| `js/nature.js` | Nature models: `loadNature()` (boot + awaited before a level/backdrop), `placeNature(group, name, placements, {castShadow, tintAll})` draws one model's placements as InstancedMeshes (one per primitive). Geometry/materials/textures are shared across levels: meshes carry `userData.shared` and `world.dispose()` only frees their instance buffers. `HEIGHTS` sets each model's size in tiles; `WIND` sets per-texture sway (vertex shader, `updateNature(dt)` from `world.update`). Vertex colors are baked AO; `vertexColors` is only enabled when the model has them (missing attribute = black). |
| `models/nature/` | 26 Quaternius "Stylized Nature MegaKit" models (CC0, `LICENSE-nature.txt`) as .glb without images + 10 shared, downscaled textures. Each material names its texture in `extras.texture`. Bushes use the green tree leaves (the pack's bush texture is red). Repack script: `pack_nature.py` (scratchpad; the model list and texture sizes live there). |
| `lib/addons/` | three.js 0.180.0 `GLTFLoader`, `SkeletonUtils`, `BufferGeometryUtils`, with imports rewritten to `../three.module.min.js`. |
| `levels/` | `index.json` (order shown in the menu) + one JSON file per level. |

## Level format

`levels/index.json` lists `{ file, name, description }` in menu order; level N unlocks after level
N-1 is won. A level file:

```json
{
  "name": "Green Meadow", "description": "…", "environment": "meadow",
  "gold": 220, "gems": 20, "seed": 11,
  "towers": ["bolt", "mortar", "frost", "storm"],
  "colors": { "grass": "#5f9e3c" },
  "map": ["S###.", "..o#.", "...#V"],
  "waves": [ { "groups": [ { "enemy": "scout", "count": 8, "interval": 1.0, "delay": 0, "spawn": 0 } ] } ]
}
```

- `map` rows are equal-length strings, one character per tile. Legend: `.` grass, `,` grass
  (second shade), `#` road, `=` bridge (road over water), `o` build pad, `T` tree, `t` bush,
  `R` rock, `~` water, `^` hill, `S` spawn portal (one or more, numbered in reading order from 0),
  `V` vault (exactly one). Roads must connect each `S` to `V`; enemies take the shortest road, so
  keep separate road sections at least one tile apart or they will cut across.
- `environment`: `meadow`, `canyon`, `winter` or `dusk` (presets in `data.js`); `colors`
  overrides any preset field with `"#rrggbb"`.
- `towers` (optional) limits which towers can be built. `seed` changes the random decoration.
- Wave groups: `enemy` is `scout`, `soldier`, `brute` or `bat` (flying; mortars cannot hit it);
  `interval` seconds between spawns; `delay` seconds after the wave starts; `spawn` the portal
  index (default: groups alternate between portals). Enemy health grows 7% per wave
  (`WAVE_HP_GROWTH`).
- Errors (bad character, no route, unknown enemy) are shown on the menu, naming row and column.

## Rules that matter

- Coordinates: tile `(x, z)` maps to world `(x - (width-1)/2, z - (height-1)/2)`; one tile = one
  unit. Routes are kept in tile coordinates and converted with `world.toWorld`.
- Progress is `persephone.storage` key `progress`: `{ [levelFile]: { stars, gems } }`, with a
  `localStorage` fallback. Stars: 1 for a win, 2 for keeping 50% of gems, 3 for 90%.
- The camera's tap only fires for a primary-button press that moved less than 6 px, so dragging
  to rotate never builds a tower.
- The game pauses itself while the board's tab is hidden (`persephone.page.onVisibilityChange`).
- Calling a wave early pays `EARLY_BONUS_PER_SECOND` × the countdown left — only while the
  countdown is running, never while the previous wave is still spawning.
- Sound: the AudioContext starts on the first pointer/key press (browser autoplay rule). Mute (HUD button or M) is stored in `persephone.storage` key `sound` and mirrored to the page tab's mute button (`persephone.page.setMuted` / `onMuteToggle`). Audio is suspended while the tab is hidden.
- Gem flow (`game.js`): `state.gems` = on the plate, `state.outside` = carried + dropped,
  `state.lost` = carried through a portal. An enemy that reaches the plate takes up to
  `def.gems` (its carry capacity) and turns back (`returning`, distance decreasing, 85% speed); one
  that reaches the vault after it's empty also turns back, empty-handed. A killed carrier drops its gems on the
  road; any enemy with spare capacity passing within `PICKUP_RADIUS` picks them up and turns back.
  The level is lost when `lost >= maxGems`. On a win, gems still on the road return to the plate.
  Towers target carriers first (closest to their portal), then advancing enemies by progress,
  then empty returners.
- Each enemy and projectile owns a cloned material; `removeEnemy`/`dropProjectile` dispose them.

## Test loop

`boards.openBoard` with the board root, then `pages[id].editor.reload()`. Board-frame selectors are
not reachable from `window.screen.click`; use `window.screen.clickAt({x, y})` from a screenshot,
and `pages[id].editor.evaluate(...)` for `persephone.storage` (e.g. to unlock levels; reset it to
`{}` afterwards).

## Difficulty

`DIFFICULTIES` in `js/data.js` lists the menu choices (easiest first): `hp`, `speed`, `bounty`, `gold` multipliers applied
to every level by `createGame({ difficulty })`. Labels and tooltips come from `difficulty.<id>` / `difficulty.<id>.about`
in `lang/en.json` (or `label` / `about` on an added entry). The choice is stored under the `difficulty` storage key
(`{ id }`; empty = the entry marked `default`) and shown as a badge next to the wave counter. Stars and unlocks are
shared across difficulties.

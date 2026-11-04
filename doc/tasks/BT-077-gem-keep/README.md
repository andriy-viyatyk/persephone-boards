# BT-077: Gem Keep — 3D tower-defense board

## Goal

An original 3D tower-defense game board (`boards/gem-keep`), using WebGL, with a camera the user
moves with the mouse wheel, mouse drag, or a pen. Its levels are plain JSON files, so the user can
make their own environments and levels.

## Background

The user's request: a game in the spirit of the classic Flash tower-defense genre (defend a
treasure from waves of raiders), rebuilt in 3D. The design is our own: its towers, enemies, maps,
names, art and rules are not copied from any existing game.

## v1.0.0 scope (done)

- [x] Scaffold with `boards.createBoard`, vendor three.js 0.180.0 (MIT) as ES modules.
- [x] Level format: an ASCII map plus waves (`js/level.js`). Routes are found with BFS from each spawn to the vault.
- [x] World: instanced terrain with a decorative margin, trees, bushes, rocks, water, bridges, vault with gem ring, spawn portals, sky dome, soft shadows.
- [x] Four towers, each with 3 levels: Bolt (single target, hits air), Mortar (splash, ground only), Frost (slows), Storm (chain lightning). Upgrade and sell (60% refund).
- [x] Four enemies: scout, soldier (armor), brute (heavy armor, takes 2 gems) and bat (flying).
- [x] Meteor spell paid with mana (mana regenerates during play, +1 per kill).
- [x] Waves: the player starts wave 1. Later waves start automatically after a countdown; calling one early pays bonus gold.
- [x] Camera:
  - wheel or pinch zoom;
  - drag to rotate;
  - right drag, middle drag, Shift+drag or the pen barrel button to pan;
  - WASD/QE keys.
- [x] HUD, build/tower popups, floating gold texts, 1×/2×/3× speed, pause (Space). The game pauses itself when the tab is hidden.
- [x] Level menu with stars and unlocks. Progress is saved in `persephone.storage`.
- [x] Three levels: Green Meadow (meadow), Red Canyon (canyon, two spawns, a bridge) and Frost Pass (winter, a long serpentine road).

## Next ideas

- An in-board level editor: paint tiles, place pads, edit waves, save to a user folder.
- Load levels from a user folder, which needs the `fileSystem` permission.
- More environments, enemy abilities (healers, shields), tower specializations at level 3, sound effects.
- Balance pass after the user has played the levels.

## Acceptance criteria

- The board opens and shows the menu with a 3D backdrop. Each of the 3 levels loads and renders.
- Towers can be built, upgraded and sold. Waves spawn, enemies follow the road and towers kill them. Losing all gems ends the level, and clearing the last wave wins it.
- Wheel zoom, drag rotate and pan all work. A press without movement selects; a drag never builds.

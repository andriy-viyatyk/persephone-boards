// Game data: towers, enemies, spells and environment presets. Levels live in ../levels/*.json.

// Towers. `levels` lists each upgrade level; the first entry is what a fresh build gives.
// range is in tiles, rate is shots per second, cost is the price of reaching that level.
export const TOWERS = {
  bolt: {
    color: 0xc8a165,
    levels: [
      { cost: 70, damage: 15, range: 3.4, rate: 1.6 },
      { cost: 60, damage: 25, range: 3.7, rate: 1.8 },
      { cost: 110, damage: 42, range: 4.1, rate: 2.1 },
    ],
    projectile: { speed: 14, color: 0xffe6a0, size: 0.07 },
    hitsAir: true,
  },
  mortar: {
    color: 0x8b8f99,
    levels: [
      { cost: 100, damage: 42, range: 3.5, rate: 0.55, splash: 1.2 },
      { cost: 90, damage: 70, range: 3.8, rate: 0.6, splash: 1.35 },
      { cost: 150, damage: 115, range: 4.2, rate: 0.65, splash: 1.55 },
    ],
    projectile: { speed: 6, color: 0x333333, size: 0.14, arc: 2.2 },
    hitsAir: false,
  },
  frost: {
    color: 0x7fd4ff,
    levels: [
      { cost: 80, damage: 9, range: 3.0, rate: 1.0, slow: 0.45, slowTime: 2.0 },
      { cost: 70, damage: 15, range: 3.3, rate: 1.1, slow: 0.55, slowTime: 2.4 },
      { cost: 120, damage: 25, range: 3.7, rate: 1.25, slow: 0.65, slowTime: 2.8 },
    ],
    projectile: { speed: 9, color: 0xa8ecff, size: 0.11 },
    hitsAir: true,
  },
  storm: {
    color: 0xb48cff,
    levels: [
      { cost: 140, damage: 30, range: 3.1, rate: 0.85, chain: 3 },
      { cost: 120, damage: 46, range: 3.4, rate: 0.95, chain: 4 },
      { cost: 180, damage: 70, range: 3.8, rate: 1.05, chain: 5 },
    ],
    hitsAir: true,
  },
};
export const TOWER_ORDER = ["bolt", "mortar", "frost", "storm"];
export const SELL_REFUND = 0.6;

// Enemies. speed is tiles per second, armor is subtracted from every hit (minimum 1 damage).
export const ENEMIES = {
  scout: { hp: 30, speed: 1.4, armor: 0, bounty: 9, gems: 1, size: 0.75, color: 0x34343c },
  soldier: { hp: 80, speed: 0.95, armor: 2, bounty: 14, gems: 1, size: 0.95, color: 0x7aa83c },
  brute: { hp: 250, speed: 0.6, armor: 4, bounty: 35, gems: 2, size: 1.35, color: 0x9ad0e8 },
  bat: { hp: 44, speed: 1.3, armor: 0, bounty: 12, gems: 1, size: 0.85, color: 0xd0582c, flying: true },
};
// Extra enemy health per wave index, so later waves of the same type hit harder.
export const WAVE_HP_GROWTH = 0.05;

// Difficulty choices in the level menu, easiest first. Each multiplies, for every level:
// hp = raider health, speed = raider walking speed, bounty = gold per kill, gold = starting gold.
// The menu label comes from lang/<language>.json "difficulty.<id>" (or `label` for an added entry).
// `default` marks the choice preselected until the player picks one.
export const DIFFICULTIES = [
  { id: "easy", hp: 1, speed: 1, bounty: 1, gold: 1 },
  { id: "normal", hp: 1.45, speed: 1.1, bounty: 0.9, gold: 0.85, default: true },
  { id: "hard", hp: 2.1, speed: 1.2, bounty: 0.8, gold: 0.75 },
];

export const SPELLS = {
  meteor: { mana: 50, damage: 170, radius: 1.7, fall: 0.9 },
};
export const MANA = { max: 100, start: 60, regen: 2, perKill: 1 };

// Seconds between waves once the first wave has started; calling a wave early pays a bonus.
export const WAVE_GAP = 18;
export const EARLY_BONUS_PER_SECOND = 2;

// Environment presets. A level picks one by name and may override any field.
// Each environment's `nature` block picks the models world.js scatters (see js/nature.js for the
// names): trees for "T" tiles, bushes for "t", rocks for "R", ground cover as [name, weight] pairs
// with groundDensity = average models per grass tile, pebbles = chance of a pebble per path tile.
// Tints multiply the textures: leafTint for tree and bush leaves, grassTint for grass, rockTint and
// pebbleTint for stones. Without the models (failed load) the old simple shapes are drawn.
export const ENVIRONMENTS = {
  meadow: {
    skyTop: 0x5d9be0, skyBottom: 0xcfe6f2, fog: 0xbcd8e8,
    grass: 0x5f9e3c, grass2: 0x74b048, path: 0xc9a66b, pad: 0x9c9a92,
    hill: 0x6a9a40, water: 0x3f8fc8, rock: 0x8a8a86, foliage: 0x2f7a32, foliage2: 0x4a9a3a, trunk: 0x6b4a2b,
    sun: 0xfff1d6, sunIntensity: 2.6, ambient: 0.9,
    nature: {
      trees: ["CommonTree_3", "CommonTree_4", "CommonTree_5", "CommonTree_5", "Pine_5"],
      bushes: ["Bush_Common", "Bush_Common_Flowers"],
      rocks: ["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"],
      ground: [["Grass_Common_Short", 6], ["Grass_Wispy_Short", 4], ["Grass_Common_Tall", 2], ["Flower_3_Group", 1], ["Flower_4_Group", 1], ["Clover_1", 1.5]],
      groundDensity: 2.2, pebbles: 0.3,
      leafTint: 0xffffff, grassTint: 0xffffff, rockTint: 0xffffff, pebbleTint: 0xf0e0c8,
    },
  },
  canyon: {
    skyTop: 0xe08a4f, skyBottom: 0xf7d9a8, fog: 0xf0c99a,
    grass: 0xc98a52, grass2: 0xd99a5e, path: 0xe8c48a, pad: 0x8f7a66,
    hill: 0xa8653a, water: 0x3a9aa8, rock: 0x9c5a3a, foliage: 0x6d8a3a, foliage2: 0x8a9a44, trunk: 0x5e4028,
    sun: 0xffd9a8, sunIntensity: 2.8, ambient: 0.8,
    nature: {
      trees: ["DeadTree_1", "DeadTree_2", "DeadTree_1", "CommonTree_5"],
      bushes: ["Bush_Common"],
      rocks: ["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"],
      ground: [["Grass_Wispy_Short", 4], ["Grass_Common_Short", 2]],
      groundDensity: 0.9, pebbles: 0.45,
      leafTint: 0xe8d070, grassTint: 0xf0c060, rockTint: 0xf0b080, pebbleTint: 0xf8d0a0,
    },
  },
  winter: {
    skyTop: 0x7f9cc8, skyBottom: 0xe4ecf4, fog: 0xdce6f0,
    grass: 0xe8eef4, grass2: 0xd6e2ee, path: 0x9aa4b0, pad: 0x7b8592,
    hill: 0xf4f8fc, water: 0x86b8d8, rock: 0x6f7884, foliage: 0x2f5a48, foliage2: 0x3c6e58, trunk: 0x4e3a2c,
    sun: 0xeef4ff, sunIntensity: 2.2, ambient: 1.1,
    nature: {
      trees: ["Pine_1", "Pine_4", "Pine_5", "Pine_5"],
      bushes: ["Bush_Common"],
      rocks: ["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"],
      ground: [["Grass_Wispy_Short", 1]],
      groundDensity: 0.35, pebbles: 0.2,
      leafTint: 0xa8c8c0, grassTint: 0xd8e4dc, rockTint: 0xd0dcf0, pebbleTint: 0xd0d8e0,
    },
  },
  dusk: {
    skyTop: 0x1c1d45, skyBottom: 0xc0607a, fog: 0x6a4a6e,
    grass: 0x3e6a4a, grass2: 0x4b7a50, path: 0x8a7458, pad: 0x6e6a78,
    hill: 0x355c40, water: 0x2c4a7a, rock: 0x5a5868, foliage: 0x22483a, foliage2: 0x2e5a44, trunk: 0x3e2c22,
    sun: 0xffb08a, sunIntensity: 1.6, ambient: 0.7,
    nature: {
      trees: ["CommonTree_3", "Pine_1", "DeadTree_1", "CommonTree_4"],
      bushes: ["Bush_Common", "Bush_Common_Flowers"],
      rocks: ["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"],
      ground: [["Grass_Common_Short", 4], ["Grass_Wispy_Short", 3], ["Fern_1", 1], ["Mushroom_Common", 1], ["Clover_1", 1]],
      groundDensity: 1.6, pebbles: 0.3,
      leafTint: 0x98b8a8, grassTint: 0xa8c0b0, rockTint: 0xc0bcd0, pebbleTint: 0xc8b8a8,
    },
  },
};

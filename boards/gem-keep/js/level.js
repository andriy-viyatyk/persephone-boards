// Level loading: turns a level JSON (an ASCII map plus waves) into tiles and enemy routes.
import { ENVIRONMENTS, ENEMIES, TOWERS } from "./data.js";

// Map legend. Every row of "map" must be the same length.
export const TILE = {
  ".": "grass", ",": "grass2", "#": "path", "=": "bridge", "o": "pad", "T": "tree", "t": "bush",
  "R": "rock", "~": "water", "^": "hill", "S": "spawn", "V": "vault",
};
const WALKABLE = new Set(["path", "bridge", "spawn", "vault"]);

export async function loadLevelIndex() {
  const response = await fetch("levels/index.json");
  if (!response.ok) throw new Error(`levels/index.json: ${response.status}`);
  return (await response.json()).levels;
}

export async function loadLevel(file) {
  const response = await fetch(`levels/${file}`);
  if (!response.ok) throw new Error(`levels/${file}: ${response.status}`);
  return parseLevel(await response.json(), file);
}

export function parseLevel(data, file = "level") {
  const fail = (message) => { throw new Error(`${file}: ${message}`); };
  const rows = data.map;
  if (!Array.isArray(rows) || !rows.length) fail("\"map\" must be a non-empty array of strings");
  const width = rows[0].length, height = rows.length;
  const tiles = [];
  const spawns = [];
  let vault = null;
  rows.forEach((row, z) => {
    if (row.length !== width) fail(`map row ${z + 1} has ${row.length} characters, expected ${width}`);
    for (let x = 0; x < width; x++) {
      const type = TILE[row[x]];
      if (!type) fail(`unknown map character "${row[x]}" at row ${z + 1}, column ${x + 1}`);
      tiles.push(type);
      if (type === "spawn") spawns.push({ x, z });
      if (type === "vault") { if (vault) fail("map has more than one vault \"V\""); vault = { x, z }; }
    }
  });
  if (!vault) fail("map needs a vault \"V\"");
  if (!spawns.length) fail("map needs at least one spawn \"S\"");
  const at = (x, z) => (x < 0 || z < 0 || x >= width || z >= height ? null : tiles[z * width + x]);
  const routes = spawns.map((spawn, index) => findRoute(spawn, vault, at, width, height) || fail(`spawn ${index + 1} has no path to the vault`));
  const waves = (data.waves || []).map((wave, waveIndex) => ({
    groups: (wave.groups || []).map((group) => {
      if (!ENEMIES[group.enemy]) fail(`wave ${waveIndex + 1}: unknown enemy "${group.enemy}"`);
      return { enemy: group.enemy, count: group.count ?? 1, interval: group.interval ?? 1, delay: group.delay ?? 0, spawn: group.spawn ?? null };
    }),
  }));
  if (!waves.length) fail("level needs at least one wave");
  const towers = (data.towers || Object.keys(TOWERS)).filter((id) => TOWERS[id]);
  const environment = { ...(ENVIRONMENTS[data.environment] || ENVIRONMENTS.meadow), ...hexColors(data.colors || {}) };
  return {
    id: data.id || file.replace(/\.json$/, ""), name: data.name || file, description: data.description || "",
    width, height, tiles, at, spawns, vault, routes, waves, towers, environment,
    gold: data.gold ?? 200, gems: data.gems ?? 20, seed: data.seed ?? 1,
  };
}

// Shortest walkable route from a spawn to the vault, as tile-center waypoints with corners only.
function findRoute(start, goal, at, width, height) {
  const key = (x, z) => z * width + x;
  const previous = new Map([[key(start.x, start.z), -1]]);
  const queue = [start];
  while (queue.length) {
    const cell = queue.shift();
    if (cell.x === goal.x && cell.z === goal.z) break;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = cell.x + dx, z = cell.z + dz;
      if (!WALKABLE.has(at(x, z)) || previous.has(key(x, z))) continue;
      previous.set(key(x, z), key(cell.x, cell.z));
      queue.push({ x, z });
    }
  }
  if (!previous.has(key(goal.x, goal.z))) return null;
  const cells = [];
  for (let k = key(goal.x, goal.z); k !== -1; k = previous.get(k)) cells.unshift({ x: k % width, z: Math.floor(k / width) });
  // Keep only the cells where the direction changes, so enemies walk straight lines between corners.
  const points = cells.filter((cell, i) => {
    if (i === 0 || i === cells.length - 1) return true;
    const a = cells[i - 1], b = cells[i + 1];
    return (cell.x - a.x) !== (b.x - cell.x) || (cell.z - a.z) !== (b.z - cell.z);
  });
  let length = 0;
  const route = points.map((point, i) => {
    if (i) length += Math.hypot(point.x - points[i - 1].x, point.z - points[i - 1].z);
    return { x: point.x, z: point.z, distance: length };
  });
  route.total = length;
  return route;
}

function hexColors(colors) {
  const result = {};
  for (const [name, value] of Object.entries(colors)) result[name] = typeof value === "string" ? parseInt(value.replace("#", ""), 16) : value;
  return result;
}

// Position along a route at a travelled distance, with an optional sideways offset (in tiles).
export function routePoint(route, distance, side, out) {
  let i = 1;
  while (i < route.length - 1 && route[i].distance < distance) i++;
  const a = route[i - 1], b = route[i];
  const segment = b.distance - a.distance || 1;
  const t = Math.min(1, Math.max(0, (distance - a.distance) / segment));
  const dx = (b.x - a.x) / segment, dz = (b.z - a.z) / segment;
  out.x = a.x + (b.x - a.x) * t - dz * side;
  out.z = a.z + (b.z - a.z) * t + dx * side;
  out.heading = Math.atan2(dx, dz);
  return out;
}

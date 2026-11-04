// Tower models built from Kenney "Tower Defense Kit" pieces (CC0; see models/towers/LICENSE-towers.txt).
// loadTowers() fetches the pieces once; createTowerModel(type, level) stacks them into a tower and
// returns the same parts game.js animates: aim (turns to the target), recoil, spin, float, orb.
// Pieces share geometry and one material per tower type, marked userData.shared (never disposed).
import * as THREE from "../lib/three.module.min.js";
import { GLTFLoader } from "../lib/addons/GLTFLoader.js";

const PIECE_SCALE = 0.6;        // Kenney pieces are one unit wide; this sizes them to the build pad
const FLOOR_SQUASH = 0.62;      // floors are flattened so upgrades add bulk without towering over the road
// Pieces per tower type, bottom to top, for upgrade levels 0..2. The weapon or crown sits on top.
const DESIGNS = {
  bolt: { floors: [["tower-square-bottom-a"], ["tower-square-bottom-a", "tower-square-middle-b"], ["tower-square-bottom-a", "tower-square-middle-b", "tower-square-middle-a"]], top: "tower-square-top-a", weapon: "weapon-ballista", weaponInset: 0.2 },
  mortar: { floors: [["tower-round-bottom-a"], ["tower-round-bottom-a", "tower-round-middle-c"], ["tower-round-bottom-a", "tower-round-middle-c", "tower-round-middle-a"]], top: "tower-round-top-a", weapon: "weapon-cannon", weaponInset: 0.26 },
  frost: { floors: [["tower-round-bottom-a"], ["tower-round-bottom-a", "tower-round-middle-c"], ["tower-round-bottom-a", "tower-round-middle-c", "tower-round-middle-a"]], top: "tower-round-crystals" },
  storm: { floors: [["tower-round-bottom-a"], ["tower-round-bottom-a", "tower-round-middle-a"], ["tower-round-bottom-a", "tower-round-middle-a", "tower-round-middle-c"]], top: "tower-round-roof-c" },
};
const MORTAR_ELEVATION = -0.55; // cannon barrel tilt (radians, negative lifts the muzzle)

const pieces = {};
const materials = {};
let loading = null;
const url = (file) => new URL(`../models/towers/${file}`, import.meta.url).href;

export function loadTowers() {
  const names = new Set();
  for (const design of Object.values(DESIGNS)) {
    design.floors.flat().forEach((name) => names.add(name));
    names.add(design.top);
    if (design.weapon) names.add(design.weapon);
  }
  loading ??= Promise.all([
    ...[...names].map(async (name) => {
      try {
        const gltf = await new GLTFLoader().loadAsync(url(`${name}.glb`));
        const box = new THREE.Box3().setFromObject(gltf.scene);
        pieces[name] = { scene: gltf.scene, height: box.max.y };
      } catch (error) { console.warn(`Gem Keep: could not load the ${name} model`, error); }
    }),
    ...Object.keys(DESIGNS).map(async (type) => {
      try {
        const map = await new THREE.TextureLoader().loadAsync(url(`palette-${type}.png`));
        map.flipY = false;
        map.colorSpace = THREE.SRGBColorSpace;
        materials[type] = new THREE.MeshStandardMaterial({ map, roughness: 0.78, metalness: 0.05 });
      } catch (error) { console.warn(`Gem Keep: could not load the ${type} tower palette`, error); }
    }),
  ]);
  return loading;
}

function hasDesign(type, level) {
  const design = DESIGNS[type];
  if (!design || !materials[type]) return false;
  return [...design.floors[level], design.top, design.weapon].every((name) => !name || pieces[name]);
}

function piece(name, type) {
  const object = pieces[name].scene.clone(true);
  object.traverse((node) => {
    node.userData.shared = true;
    if (!node.isMesh) return;
    node.material = materials[type];
    node.castShadow = true;
    node.receiveShadow = true;
  });
  return object;
}

// Returns null when a piece or palette is missing; game.js then draws its simple shapes.
// Heights in the returned parts are in tower units (game.js scales the tower by TOWER_SCALE).
export function createTowerModel(type, level, { stormMaterial, copperMaterial } = {}) {
  if (!hasDesign(type, level)) return null;
  const design = DESIGNS[type];
  const tower = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(PIECE_SCALE);
  tower.add(body);
  let y = 0;
  for (const name of [...design.floors[level], design.top]) {
    const object = piece(name, type);
    object.position.y = y;
    if (name !== design.top) { object.scale.y = FLOOR_SQUASH; y += pieces[name].height * FLOOR_SQUASH; }
    body.add(object);
  }
  const topY = y;                                  // floor of the top piece, in piece units
  const parts = { tower, aim: null, spin: null, float: null, orb: null, recoil: null };

  if (design.weapon) {
    const weapon = piece(design.weapon, type);
    weapon.position.y = topY + design.weaponInset;
    body.add(weapon);
    parts.aim = weapon;
    const moving = weapon.getObjectByName(type === "mortar" ? "barrel" : "arrow");
    if (moving) {
      if (type === "mortar") moving.rotation.x = MORTAR_ELEVATION;
      parts.recoil = { object: moving, axis: "z", rest: moving.position.z, kick: -0.12 };
    }
    parts.muzzle = (topY + design.weaponInset + 0.42) * PIECE_SCALE;
  } else if (type === "frost") {
    const crown = body.children[body.children.length - 1];
    const crystal = crown.getObjectByName("crystal");
    if (crystal) { parts.spin = crystal; parts.float = { object: crystal, rest: crystal.position.y, amount: 0.06 }; }
    parts.muzzle = (topY + 0.75) * PIECE_SCALE;
  } else if (type === "storm") {
    const roofTop = topY + pieces[design.top].height;
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), stormMaterial);
    orb.position.y = roofTop + 0.12;
    body.add(orb);
    if (copperMaterial) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 6, 20).rotateX(Math.PI / 2), copperMaterial);
      ring.position.y = roofTop - 0.05;
      body.add(ring);
    }
    parts.orb = orb;
    parts.muzzle = (roofTop + 0.12) * PIECE_SCALE;
  }
  return parts;
}

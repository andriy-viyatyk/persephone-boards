// Builds the static 3D world for a level: sky, lights, terrain tiles, decorations, water,
// the vault and the spawn portals. Everything that moves lives in game.js.
import * as THREE from "../lib/three.module.min.js";
import { hasNature, placeNature, updateNature } from "./nature.js";
import { createWater } from "./water.js";

// Top-surface height of each tile type, in world units (one tile = one unit).
const HEIGHT = { grass: 0.3, grass2: 0.3, path: 0.22, bridge: 0.05, pad: 0.4, tree: 0.3, bush: 0.3, rock: 0.3, water: 0.05, hill: 0.62, spawn: 0.22, vault: 0.3 };
const WATER_LEVEL = 0.17;
const MARGIN = 9;               // decorative tiles drawn around the playable map
const HEIGHT_JITTER = 0.035;
const GEM_PILE_MAX = 40;        // most gem models drawn on the vault plate
const FAR_GROUND = 5;           // tiles this far outside the map get less ground cover

// Gems: shared by the vault pile, carried gems and gems dropped on the road.
const GEM_COLORS = [0x40ffd0, 0x4ad8ff, 0x7affa0];
const gemGeometry = new THREE.OctahedronGeometry(0.075, 0).scale(1, 1.35, 1);
const gemMaterials = GEM_COLORS.map((color) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, flatShading: true, roughness: 0.15, metalness: 0.2 }));
let gemCounter = 0;
export function createGemMesh() { return new THREE.Mesh(gemGeometry, gemMaterials[gemCounter++ % gemMaterials.length]); }    // random height variation of natural tiles
const COLOR_JITTER = 0.06;      // random brightness variation of tiles

// Ground texture: soft fractal noise plus small dark and light flecks, generated once. The terrain
// shader samples it by world position, so the pattern runs across tiles without seams.
const GROUND_SCALE = 0.23;      // texture repeats per world unit
const GROUND_CONTRAST = [0.6, 1.22];
let groundTexture = null;
function getGroundTexture() {
  if (groundTexture) return groundTexture;
  const size = 256, canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const random = seededRandom(7);
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, size, size);
  // Octaves: tiny random images drawn smoothly scaled up and tiled 3x3 so the result wraps.
  for (const [cells, alpha] of [[4, 0.5], [8, 0.35], [16, 0.25], [64, 0.18]]) {
    const small = document.createElement("canvas");
    small.width = small.height = cells;
    const smallCtx = small.getContext("2d"), data = smallCtx.createImageData(cells, cells);
    for (let i = 0; i < cells * cells; i++) { const v = random() * 255; data.data.set([v, v, v, 255], i * 4); }
    smallCtx.putImageData(data, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) ctx.drawImage(small, ox * size, oy * size, size, size);
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 2600; i++) {
    const v = random() < 0.6 ? 40 + random() * 50 : 190 + random() * 60;
    ctx.fillStyle = `rgba(${v},${v},${v},${0.25 + random() * 0.35})`;
    ctx.fillRect(random() * size, random() * size, 1 + random() * 1.5, 1 + random() * 2.5);
  }
  groundTexture = new THREE.CanvasTexture(canvas);
  groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping;
  groundTexture.anisotropy = 4;
  return groundTexture;
}
function texturedGround(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.groundNoise = { value: getGroundTexture() };
    shader.vertexShader = `varying vec3 vGroundPos;
${shader.vertexShader}`.replace("#include <begin_vertex>", `#include <begin_vertex>
      vec4 groundWorld = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        groundWorld = instanceMatrix * groundWorld;
      #endif
      vGroundPos = (modelMatrix * groundWorld).xyz;`);
    shader.fragmentShader = `uniform sampler2D groundNoise;
varying vec3 vGroundPos;
${shader.fragmentShader}`.replace("#include <color_fragment>", `#include <color_fragment>
      vec2 groundUv = (vGroundPos.xz + vec2(vGroundPos.y * 0.7, -vGroundPos.y * 0.7)) * ${GROUND_SCALE};
      float groundShade = texture2D(groundNoise, groundUv).r * 0.65 + texture2D(groundNoise, groundUv * 3.7 + 0.31).r * 0.35;
      diffuseColor.rgb *= mix(${GROUND_CONTRAST[0].toFixed(2)}, ${GROUND_CONTRAST[1].toFixed(2)}, groundShade);`);
  };
  material.customProgramCacheKey = () => "textured-ground";
  return material;
}

export function seededRandom(seed) {
  let a = seed >>> 0 || 1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function createWorld(scene, level) {
  const env = level.environment;
  const random = seededRandom(level.seed * 9973 + level.width * 31 + level.height);
  const group = new THREE.Group();
  scene.add(group);
  const offsetX = (level.width - 1) / 2, offsetZ = (level.height - 1) / 2;
  const toWorld = (x, z, out = new THREE.Vector3()) => out.set(x - offsetX, 0, z - offsetZ);

  // --- Sky, fog and lights -------------------------------------------------------------
  scene.background = new THREE.Color(env.skyBottom);
  scene.fog = new THREE.Fog(env.fog, 38, 95);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    uniforms: { top: { value: new THREE.Color(env.skyTop) }, bottom: { value: new THREE.Color(env.skyBottom) } },
    vertexShader: "varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "uniform vec3 top; uniform vec3 bottom; varying vec3 vPos; void main(){ float h = clamp(normalize(vPos).y * 1.6 + 0.08, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.8)), 1.0); }",
  }));
  group.add(sky);
  group.add(new THREE.HemisphereLight(env.skyTop, env.grass, env.ambient));
  const sun = new THREE.DirectionalLight(env.sun, env.sunIntensity);
  const span = Math.max(level.width, level.height) / 2 + 4;
  sun.position.set(span * 0.8, span * 1.4, span * 0.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: span * 5 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  group.add(sun, sun.target);

  // --- Terrain -------------------------------------------------------------------------
  const fullWidth = level.width + MARGIN * 2, fullHeight = level.height + MARGIN * 2;
  const tileGeometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const terrain = new THREE.InstancedMesh(tileGeometry, texturedGround(new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.95 })), fullWidth * fullHeight);
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  const instanceTile = new Int32Array(fullWidth * fullHeight).fill(-1);
  const heights = new Float32Array(level.width * level.height);
  const decor = { trees: [], bushes: [], rocks: [], bridges: [], ground: [], path: [] };
  const matrix = new THREE.Matrix4(), color = new THREE.Color(), position = new THREE.Vector3();
  const tileColor = { grass: env.grass, grass2: env.grass2, path: env.path, bridge: env.path, pad: env.pad, tree: env.grass, bush: env.grass, rock: env.grass, water: env.path, hill: env.hill, spawn: env.path, vault: env.pad };
  let instance = 0;
  const waterGrid = new Uint8Array(fullWidth * fullHeight);
  for (let z = -MARGIN; z < level.height + MARGIN; z++) {
    for (let x = -MARGIN; x < level.width + MARGIN; x++) {
      const inside = x >= 0 && z >= 0 && x < level.width && z < level.height;
      let type = inside ? level.at(x, z) : outerTile(x, z);
      let height = HEIGHT[type];
      if (["grass", "grass2", "tree", "bush", "rock", "hill"].includes(type)) height += (random() - 0.5) * 2 * HEIGHT_JITTER;
      if (!inside) height += Math.min(0.5, edgeDistance(x, z) * 0.06) * (type === "hill" ? 1 : 0.3);
      if (inside) heights[z * level.width + x] = type === "bridge" ? 0.3 : height;
      toWorld(x, z, position);
      matrix.makeScale(1, height + 1, 1).setPosition(position.x, -1, position.z);
      terrain.setMatrixAt(instance, matrix);
      color.setHex(tileColor[type]).multiplyScalar(1 + (random() - 0.5) * 2 * COLOR_JITTER);
      if (type === "water" || type === "bridge") color.multiplyScalar(0.55);
      terrain.setColorAt(instance, color);
      if (inside) instanceTile[instance] = z * level.width + x;
      if (type === "water" || type === "bridge") waterGrid[instance] = 1;
      if (type === "tree") decor.trees.push({ x: position.x, y: height, z: position.z, scale: 0.8 + random() * 0.5 });
      if (type === "bush") decor.bushes.push({ x: position.x + (random() - 0.5) * 0.4, y: height, z: position.z + (random() - 0.5) * 0.4, scale: 0.7 + random() * 0.5 });
      if (type === "rock") decor.rocks.push({ x: position.x, y: height, z: position.z, scale: 0.8 + random() * 0.5 });
      if (type === "bridge") decor.bridges.push({ x, z, position: position.clone() });
      if (["grass", "grass2", "hill", "tree", "bush", "rock"].includes(type)) decor.ground.push({ x: position.x, y: height, z: position.z, far: edgeDistance(x, z) > FAR_GROUND, sparse: type !== "grass" && type !== "grass2" && type !== "hill" });
      if (type === "path") decor.path.push({ x: position.x, y: height, z: position.z });
      instance++;
    }
  }
  group.add(terrain);

  // Decorative land around the map: mostly grass, with forests and hills further out.
  function edgeDistance(x, z) { return Math.max(-x, -z, x - level.width + 1, z - level.height + 1, 0); }
  function outerTile(x, z) {
    const d = edgeDistance(x, z), r = random();
    if (d > 4 && r < 0.35) return "hill";
    if (r < 0.12 + d * 0.05) return "tree";
    if (r < 0.2 + d * 0.05) return "bush";
    if (r < 0.23 + d * 0.05) return "rock";
    return r < 0.6 ? "grass" : "grass2";
  }

  // --- Decorations ---------------------------------------------------------------------
  const shadowed = (mesh) => { mesh.castShadow = true; mesh.receiveShadow = true; return mesh; };
  const nature = env.nature;
  if (nature && nature.trees.some(hasNature)) placeModels();
  else placeSimpleShapes();

  // Nature models (js/nature.js), chosen and tinted by the environment's `nature` block.
  function placeModels() {
    const byName = {};
    const add = (name, placement) => { if (name && hasNature(name)) (byName[name] ??= []).push(placement); };
    const pick = (list) => list[Math.floor(random() * list.length)];
    const vary = (hex, amount) => color.setHex(hex).multiplyScalar(1 + (random() - 0.5) * 2 * amount).getHex();
    const totalWeight = nature.ground.reduce((sum, [, weight]) => sum + weight, 0);
    const pickGround = () => {
      let r = random() * totalWeight;
      for (const [name, weight] of nature.ground) if ((r -= weight) < 0) return name;
      return nature.ground[0][0];
    };
    for (const tree of decor.trees) add(pick(nature.trees), { x: tree.x + (random() - 0.5) * 0.3, y: tree.y, z: tree.z + (random() - 0.5) * 0.3, scale: tree.scale * 0.85, rotation: random() * Math.PI * 2, tint: vary(nature.leafTint, 0.12) });
    for (const bush of decor.bushes) add(pick(nature.bushes), { x: bush.x, y: bush.y, z: bush.z, scale: bush.scale, rotation: random() * Math.PI * 2, tint: vary(nature.leafTint, 0.1) });
    const rocks = {};
    for (const rock of decor.rocks) (rocks[pick(nature.rocks)] ??= []).push({ x: rock.x, y: rock.y - 0.03, z: rock.z, scale: rock.scale, rotation: random() * Math.PI * 2, tint: vary(nature.rockTint, 0.08) });
    const ground = {};
    for (const tile of decor.ground) {
      const count = Math.floor(nature.groundDensity * (tile.far ? 0.35 : 1) * (tile.sparse ? 0.4 : 1) + random());
      for (let i = 0; i < count; i++) {
        const name = pickGround();
        const plain = /^(Flower|Mushroom)/.test(name);
        (ground[name] ??= []).push({ x: tile.x + (random() - 0.5) * 0.9, y: tile.y, z: tile.z + (random() - 0.5) * 0.9, scale: 0.75 + random() * 0.6, rotation: random() * Math.PI * 2, tint: plain ? 0xffffff : vary(nature.grassTint, 0.1) });
      }
    }
    const pebbles = {};
    for (const tile of decor.path) {
      if (random() >= nature.pebbles) continue;
      const name = pick(["Pebble_Round_1", "Pebble_Round_2", "Pebble_Round_3", "Pebble_Square_1", "Pebble_Square_2"]);
      (pebbles[name] ??= []).push({ x: tile.x + (random() - 0.5) * 0.8, y: tile.y, z: tile.z + (random() - 0.5) * 0.8, scale: 0.8 + random() * 0.5, rotation: random() * Math.PI * 2, tint: vary(nature.pebbleTint, 0.08) });
    }
    for (const [name, list] of Object.entries(byName)) placeNature(group, name, list);
    for (const [name, list] of Object.entries(rocks)) placeNature(group, name, list, { tintAll: true });
    for (const [name, list] of Object.entries(ground)) placeNature(group, name, list, { castShadow: false });
    for (const [name, list] of Object.entries(pebbles)) placeNature(group, name, list, { castShadow: false, tintAll: true });
  }

  // Simple shapes, used when the nature models could not be loaded.
  function placeSimpleShapes() {
  const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 });
  if (decor.trees.length) {
    const trunks = shadowed(new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.1, 0.45, 6).translate(0, 0.22, 0), new THREE.MeshStandardMaterial({ color: env.trunk, flatShading: true }), decor.trees.length));
    const lower = shadowed(new THREE.InstancedMesh(new THREE.ConeGeometry(0.42, 0.75, 7).translate(0, 0.7, 0), foliageMaterial, decor.trees.length));
    const upper = shadowed(new THREE.InstancedMesh(new THREE.ConeGeometry(0.3, 0.6, 7).translate(0, 1.1, 0), foliageMaterial, decor.trees.length));
    decor.trees.forEach((tree, i) => {
      matrix.makeRotationY(random() * Math.PI).scale(new THREE.Vector3(tree.scale, tree.scale * (0.9 + random() * 0.3), tree.scale)).setPosition(tree.x + (random() - 0.5) * 0.3, tree.y, tree.z + (random() - 0.5) * 0.3);
      trunks.setMatrixAt(i, matrix); lower.setMatrixAt(i, matrix); upper.setMatrixAt(i, matrix);
      lower.setColorAt(i, color.setHex(env.foliage).multiplyScalar(0.9 + random() * 0.2));
      upper.setColorAt(i, color.setHex(env.foliage2).multiplyScalar(0.9 + random() * 0.2));
    });
    group.add(trunks, lower, upper);
  }
  if (decor.bushes.length) {
    const bushes = shadowed(new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.28, 0).translate(0, 0.15, 0), foliageMaterial, decor.bushes.length));
    decor.bushes.forEach((bush, i) => {
      matrix.makeRotationY(random() * 6).scale(new THREE.Vector3(bush.scale, bush.scale * 0.75, bush.scale)).setPosition(bush.x, bush.y, bush.z);
      bushes.setMatrixAt(i, matrix);
      bushes.setColorAt(i, color.setHex(env.foliage2).multiplyScalar(0.9 + random() * 0.25));
    });
    group.add(bushes);
  }
  if (decor.rocks.length) {
    const rocks = shadowed(new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.3, 0), new THREE.MeshStandardMaterial({ color: env.rock, flatShading: true, roughness: 1 }), decor.rocks.length));
    decor.rocks.forEach((rock, i) => {
      matrix.makeRotationFromEuler(new THREE.Euler(random() * 3, random() * 3, random() * 3)).scale(new THREE.Vector3(rock.scale, rock.scale * 0.7, rock.scale)).setPosition(rock.x, rock.y + 0.08, rock.z);
      rocks.setMatrixAt(i, matrix);
    });
    group.add(rocks);
  }
  }

  // Bridges: planks across the water, oriented along the path.
  const plankMaterial = new THREE.MeshStandardMaterial({ color: env.trunk, flatShading: true, roughness: 0.9 });
  for (const bridge of decor.bridges) {
    const alongX = ["path", "bridge", "spawn", "vault"].includes(level.at(bridge.x - 1, bridge.z)) || ["path", "bridge", "spawn", "vault"].includes(level.at(bridge.x + 1, bridge.z));
    const deck = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.08, 0.8), plankMaterial));
    deck.position.set(bridge.position.x, 0.26, bridge.position.z);
    deck.rotation.y = alongX ? 0 : Math.PI / 2;
    for (const side of [-0.42, 0.42]) {
      const rail = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.06, 0.06), plankMaterial));
      rail.position.set(0, 0.2, side);
      deck.add(rail);
    }
    group.add(deck);
  }

  // Water: one sheet at water level, hidden under land everywhere except on water tiles.
  // The shader (js/water.js) discards land cells, adds shore foam and shades shallow edges lighter.
  const corner = toWorld(-MARGIN, -MARGIN);
  const waterSurface = createWater({
    gridWidth: fullWidth, gridHeight: fullHeight, originX: corner.x, originZ: corner.z, env,
    isWater: (x, z) => waterGrid[z * fullWidth + x] === 1, sunDirection: sun.position,
  });
  const water = waterSurface.mesh;
  water.position.y = WATER_LEVEL;
  group.add(water);

  // --- Vault: a stone plate with a mound of gems, one gem model per gem the player owns ------
  const vaultPosition = toWorld(level.vault.x, level.vault.z);
  const vault = new THREE.Group();
  vault.position.copy(vaultPosition).setY(0.3);
  const stone = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, flatShading: true, roughness: 0.8 });
  vault.add(shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.64, 0.14, 16).translate(0, 0.07, 0), stone)));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.53, 0.03, 6, 32).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffc94a, metalness: 0.7, roughness: 0.3, emissive: 0x442200 }));
  rim.position.y = 0.14;
  vault.add(rim);
  const pileGems = [];
  const pileCount = Math.min(GEM_PILE_MAX, level.gems);
  for (let i = 0; i < pileCount; i++) {
    // Bottom gems first, so hiding from the end takes gems off the top of the mound.
    const t = i / Math.max(1, pileCount - 1), angle = i * 2.39996;
    const radius = 0.4 * Math.pow(1 - t, 0.7) * (0.75 + random() * 0.25);
    const gem = shadowed(createGemMesh());
    gem.position.set(Math.cos(angle) * radius, 0.2 + t * 0.26, Math.sin(angle) * radius);
    gem.rotation.set(random() * 0.6, random() * 6, random() * 0.6);
    vault.add(gem);
    pileGems.push(gem);
  }
  const vaultLight = new THREE.PointLight(0x40ffd0, 2.5, 4, 1.5);
  vaultLight.position.y = 0.7;
  vault.add(vaultLight);
  group.add(vault);

  // --- Spawn portals -------------------------------------------------------------------
  const portals = level.spawns.map((spawn, index) => {
    const route = level.routes[index];
    const portal = new THREE.Group();
    portal.position.copy(toWorld(spawn.x, spawn.z)).setY(0.22);
    portal.rotation.y = Math.atan2(route[1].x - route[0].x, route[1].z - route[0].z);
    const archStone = new THREE.MeshStandardMaterial({ color: 0x4a4458, flatShading: true });
    for (const side of [-0.45, 0.45]) {
      const post = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.0, 0.2).translate(0, 0.5, 0), archStone));
      post.position.x = side;
      portal.add(post);
    }
    portal.add(shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.24).translate(0, 1.05, 0), archStone)));
    const swirl = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.06, 6, 20), new THREE.MeshStandardMaterial({ color: 0x9a50ff, emissive: 0x7a30ff, emissiveIntensity: 1.6 }));
    swirl.position.y = 0.52;
    portal.add(swirl);
    const glow = new THREE.PointLight(0x9a50ff, 1.6, 3, 1.5);
    glow.position.y = 0.5;
    portal.add(glow);
    group.add(portal);
    return { portal, swirl };
  });

  // --- Build pads ----------------------------------------------------------------------
  const pads = [];
  level.tiles.forEach((type, index) => {
    if (type !== "pad") return;
    const x = index % level.width, z = Math.floor(index / level.width);
    pads.push({ index, x, z, position: toWorld(x, z).setY(HEIGHT.pad) });
  });
  const padMarker = new THREE.InstancedMesh(new THREE.RingGeometry(0.3, 0.38, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.55 }), Math.max(1, pads.length));
  pads.forEach((pad, i) => padMarker.setMatrixAt(i, matrix.makeTranslation(pad.position.x, pad.position.y + 0.01, pad.position.z)));
  padMarker.count = pads.length;
  group.add(padMarker);

  function setPadMarker(padIndex, visible) {
    padMarker.setMatrixAt(padIndex, visible ? matrix.makeTranslation(pads[padIndex].position.x, pads[padIndex].position.y + 0.01, pads[padIndex].position.z) : matrix.makeScale(0, 0, 0));
    padMarker.instanceMatrix.needsUpdate = true;
  }

  // Show `count` of the level's gems on the plate (scaled when the level has more than the pile holds).
  function showGems(count) {
    const visible = Math.ceil(count / level.gems * pileGems.length);
    pileGems.forEach((gem, i) => { gem.visible = i < visible; });
    vaultLight.intensity = count > 0 ? 2.5 : 0.4;
  }

  let time = 0;
  function update(dt) {
    time += dt;
    updateNature(dt);
    water.position.y = WATER_LEVEL + Math.sin(time * 1.3) * 0.012;
    waterSurface.update(dt);
    for (const { swirl } of portals) swirl.rotation.z += dt * 2.5;
  }

  // Tile under a ray: the playable tile index, or -1.
  function pickTile(raycaster) {
    const hit = raycaster.intersectObject(terrain, false)[0];
    return hit && hit.instanceId != null ? instanceTile[hit.instanceId] : -1;
  }
  function pickGround(raycaster) {
    const hit = raycaster.intersectObject(terrain, false)[0];
    return hit ? hit.point : null;
  }

  function dispose() {
    scene.remove(group);
    waterSurface.dispose();
    group.traverse((object) => {
      if (object.userData.shared) { object.dispose(); return; }   // nature models: free the instance buffers, keep the shared geometry and materials
      object.geometry?.dispose(); if (object.material) [].concat(object.material).forEach((m) => m.dispose()); });
  }

  return {
    group, toWorld, heights, pads, vaultPosition: vault.position, bounds: { x: level.width / 2 + 2, z: level.height / 2 + 2 },
    heightAt: (x, z) => heights[z * level.width + x] ?? 0.3,
    setPadMarker, showGems, update, pickTile, pickGround, dispose,
  };
}

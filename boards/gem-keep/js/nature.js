// Nature models: trees, bushes, rocks, grass, flowers and pebbles (Quaternius "Stylized Nature
// MegaKit", CC0; see models/nature/LICENSE-nature.txt). loadNature() fetches them once;
// placeNature(group, name, placements) draws every placement of one model with instanced meshes.
// Geometry, materials and textures are shared between levels and never disposed.
import * as THREE from "../lib/three.module.min.js";
import { GLTFLoader } from "../lib/addons/GLTFLoader.js";

// Height (tiles) each model is scaled to before a placement's own scale. Pebbles use a fixed scale.
const HEIGHTS = {
  CommonTree_3: 2.0, CommonTree_4: 2.0, CommonTree_5: 1.85, Pine_1: 2.1, Pine_4: 2.4, Pine_5: 2.0,
  DeadTree_1: 2.0, DeadTree_2: 2.1, Bush_Common: 0.6, Bush_Common_Flowers: 0.6,
  Rock_Medium_1: 0.45, Rock_Medium_2: 0.4, Rock_Medium_3: 0.48,
  Grass_Common_Short: 0.3, Grass_Common_Tall: 0.42, Grass_Wispy_Short: 0.28, Flower_3_Group: 0.36, Flower_4_Group: 0.38,
  Clover_1: 0.24, Fern_1: 0.3, Mushroom_Common: 0.13,
};
const PEBBLE_SCALE = 0.32;
// Wind: sway amplitude per material texture, in model units per model unit of height.
const WIND = { "leaves-tree.png": 0.012, "leaves-pine.png": 0.008, "leaves.png": 0.05, "flowers.png": 0.05, "grass.png": 0.07 };

const windTime = { value: 0 };
const models = {};
const textures = {};
const materials = {};
let loading = null;

const textureUrl = (file) => new URL(`../models/nature/${file}`, import.meta.url).href;

function texture(file) {
  if (!textures[file]) {
    const map = new THREE.TextureLoader().load(textureUrl(file));
    map.flipY = false;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    textures[file] = map;
  }
  return textures[file];
}

// One material per texture (plus alpha mode), shared by every model that uses it.
function material(source, vertexColors) {
  const file = source.userData.texture;
  const key = `${file}|${source.alphaTest}|${source.side}|${vertexColors}`;
  if (materials[key]) return materials[key];
  const result = new THREE.MeshStandardMaterial({
    map: file ? texture(file) : null, vertexColors, alphaTest: source.alphaTest, side: source.side,
    roughness: 0.92, metalness: 0,
  });
  const wind = WIND[file];
  if (wind) {
    result.onBeforeCompile = (shader) => {
      shader.uniforms.windTime = windTime;
      shader.vertexShader = `uniform float windTime;\n${shader.vertexShader}`.replace("#include <begin_vertex>", `#include <begin_vertex>
        vec3 windBase = vec3(0.0);
        #ifdef USE_INSTANCING
          windBase = instanceMatrix[3].xyz;
        #endif
        float windHeight = max(transformed.y, 0.0) * ${wind.toFixed(4)};
        transformed.x += sin(windTime * 1.6 + windBase.x * 0.8 + windBase.z * 0.6) * windHeight;
        transformed.z += cos(windTime * 1.2 + windBase.x * 0.5 + windBase.z * 0.9) * windHeight * 0.6;`);
    };
    result.customProgramCacheKey = () => `wind-${wind}`;
  }
  result.userData.foliage = /^(leaves|flowers|grass)/.test(file || "");
  materials[key] = result;
  return result;
}

export function loadNature() {
  loading ??= Promise.all([...Object.keys(HEIGHTS), "Pebble_Round_1", "Pebble_Round_2", "Pebble_Round_3", "Pebble_Square_1", "Pebble_Square_2"].map(async (name) => {
    try {
      const gltf = await new GLTFLoader().loadAsync(textureUrl(`${name}.glb`));
      gltf.scene.updateMatrixWorld(true);
      const parts = [];
      gltf.scene.traverse((node) => {
        if (!node.isMesh) return;
        const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
        // Vertex colors are baked ambient occlusion; models without them must not enable vertexColors
        // (a missing color attribute reads as black).
        parts.push({ geometry, material: material(node.material, !!geometry.attributes.color) });
      });
      const box = new THREE.Box3();
      for (const part of parts) { part.geometry.computeBoundingBox(); box.union(part.geometry.boundingBox); }
      const scale = HEIGHTS[name] ? HEIGHTS[name] / (box.max.y - box.min.y) : PEBBLE_SCALE;
      models[name] = { parts, scale, baseY: -box.min.y * scale };
    } catch (error) {
      console.warn(`Gem Keep: could not load the ${name} model`, error);
    }
  }));
  return loading;
}

export const hasNature = (name) => !!models[name];
export function updateNature(dt) { windTime.value += dt; }

// placements: [{ x, y, z, scale, rotation, tint? }] where y is the ground height. tint (hex)
// colors the foliage parts only; trunks, rocks and mushrooms keep their texture colors unless
// tintAll is set.
export function placeNature(group, name, placements, { castShadow = true, tintAll = false } = {}) {
  const model = models[name];
  if (!model || !placements.length) return;
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(), position = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), color = new THREE.Color();
  for (const part of model.parts) {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, placements.length);
    const tinted = tintAll || part.material.userData.foliage;
    placements.forEach((p, i) => {
      const s = model.scale * p.scale;
      quaternion.setFromAxisAngle(up, p.rotation);
      matrix.compose(position.set(p.x, p.y + model.baseY * p.scale, p.z), quaternion, scale.set(s, s * (p.stretch ?? 1), s));
      mesh.setMatrixAt(i, matrix);
      if (tinted) mesh.setColorAt(i, color.setHex(p.tint ?? 0xffffff));
    });
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.userData.shared = true;    // world.dispose() must not dispose the shared geometry and material
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
}

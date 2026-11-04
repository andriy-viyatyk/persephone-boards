// Animated raider models (Quaternius "Ultimate Monsters", CC0; see models/LICENSE-monsters.txt).
// loadMonsters() fetches every model once; createMonster(type) returns a fresh animated copy, or
// null when the model could not be loaded, in which case game.js falls back to simple shapes.
import * as THREE from "../lib/three.module.min.js";
import { GLTFLoader } from "../lib/addons/GLTFLoader.js";
import { clone as cloneSkinned } from "../lib/addons/SkeletonUtils.js";

// fit: the model is scaled so this dimension (in enemy body units, before the enemy's own size
// scale) matches; ground models stand on y = 0, flying ones are centered on it.
// rate: walk/fly animation speed at the enemy's normal pace.
const MODELS = {
  scout: { file: "scout.glb", move: "Walk", death: "Death", fit: { height: 0.8 }, rate: 1.7 },
  soldier: { file: "soldier.glb", move: "Walk", death: "Death", fit: { height: 0.82 }, rate: 1.25 },
  brute: { file: "brute.glb", move: "Walk", death: "Death", fit: { height: 0.78 }, rate: 0.85 },
  bat: { file: "bat.glb", move: "Fast_Flying", death: "Death", fit: { width: 0.85 }, rate: 1.1, flying: true },
};
const DEATH_SPEED = 1.6;          // death animation playback rate

const loaded = {};
let loading = null;

export function loadMonsters() {
  loading ??= Promise.all(Object.entries(MODELS).map(async ([type, spec]) => {
    try {
      const url = (file) => new URL(`../models/${file}`, import.meta.url).href;
      // The texture ships as a separate PNG: GLTFLoader cannot fetch() the blob: URL it creates
      // for embedded images inside a board, so the .glb files carry no image.
      const [gltf, texture] = await Promise.all([
        new GLTFLoader().loadAsync(url(spec.file)),
        new THREE.TextureLoader().loadAsync(url(spec.file.replace(".glb", ".png"))),
      ]);
      texture.flipY = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      gltf.scene.traverse((node) => { if (node.isMesh) { node.material.map = texture; node.material.needsUpdate = true; } });
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const scale = spec.fit.height ? spec.fit.height / size.y : spec.fit.width / size.x;
      const offsetY = spec.flying ? -(box.min.y + size.y / 2) * scale : -box.min.y * scale;
      loaded[type] = { spec, scene: gltf.scene, clips: gltf.animations, scale, offsetY };
    } catch (error) {
      console.warn(`Gem Keep: could not load the ${type} model`, error);
    }
  }));
  return loading;
}

export function createMonster(type) {
  const source = loaded[type];
  if (!source) return null;
  const { spec, clips } = source;
  const model = cloneSkinned(source.scene);
  model.scale.setScalar(source.scale);
  model.position.y = source.offsetY;
  const materials = [];
  model.traverse((node) => {
    if (!node.isMesh) return;
    node.material = node.material.clone();
    materials.push(node.material);
    node.castShadow = true;
    node.frustumCulled = false;   // skinned bounds do not follow the animation
  });
  const object = new THREE.Group();
  object.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const clip = (name) => clips.find((c) => c.name === name);
  const move = mixer.clipAction(clip(spec.move));
  move.time = Math.random() * move.getClip().duration;
  move.play();
  return {
    object,
    flying: !!spec.flying,
    update(dt, pace) { move.timeScale = spec.rate * pace; mixer.update(dt); },
    setTint(hex) { for (const material of materials) material.emissive.setHex(hex); },
    // Plays the death animation once and holds the last pose; returns its length in seconds.
    die() {
      const death = mixer.clipAction(clip(spec.death));
      death.setLoop(THREE.LoopOnce, 1);
      death.clampWhenFinished = true;
      death.timeScale = DEATH_SPEED;
      move.fadeOut(0.1);
      death.reset().fadeIn(0.1).play();
      return death.getClip().duration / DEATH_SPEED;
    },
    setOpacity(value) {
      for (const material of materials) { material.transparent = value < 1; material.opacity = value; }
    },
    dispose() {
      mixer.stopAllAction();
      for (const material of materials) material.dispose();
    },
  };
}

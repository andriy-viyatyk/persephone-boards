// Game simulation and everything that moves: enemies, towers, projectiles, spells, particles.
import * as THREE from "../lib/three.module.min.js";
import { TOWERS, ENEMIES, SPELLS, MANA, SELL_REFUND, WAVE_GAP, EARLY_BONUS_PER_SECOND, WAVE_HP_GROWTH } from "./data.js";
import { routePoint } from "./level.js";
import { createGemMesh } from "./world.js";
import { createMonster } from "./monsters.js";
import { createTowerModel } from "./towers.js";

const SIDE_SPREAD = 0.28;        // max sideways offset of an enemy from the path center (tiles)
const FLY_HEIGHT = 1.1;          // flying enemies hover this high above the ground
const CHAIN_JUMP = 1.8;          // storm tower: max distance between chained targets
const CHAIN_FALLOFF = 0.8;       // storm tower: damage multiplier per jump
const PARTICLES = 700;           // particle pool size
const GRAVITY = 9;
const ENEMY_SCALE = 1.2;         // overall size of enemy models
const TOWER_SCALE = 1.3;         // overall size of tower models
const CARRY_SPEED = 0.85;        // speed multiplier while an enemy carries gems home
const PICKUP_RADIUS = 0.6;       // how close (tiles) an enemy must pass to pick up a dropped gem
const CORPSE_TIME = 0.9;         // a killed model stays this long after its death animation, then sinks away
const SLOW_TINT = 0x1a5a90;      // emissive tint of a frost-slowed enemy

export function createGame({ scene, camera, world, level, difficulty, onChange, onFloat, onEnd, onSound }) {
  const diff = { hp: 1, speed: 1, bounty: 1, gold: 1, ...difficulty };
  const group = new THREE.Group();
  scene.add(group);
  const state = {
    gold: Math.round(level.gold * diff.gold), gems: level.gems, maxGems: level.gems, lost: 0, outside: 0, mana: MANA.start,
    wave: 0, waveCount: level.waves.length, countdown: null, status: "ready", spawning: 0,
  };
  const enemies = [], dying = [], towers = [], projectiles = [], bolts = [], meteors = [], spawners = [], dropped = [];
  const temp = new THREE.Vector3(), point = { x: 0, z: 0, heading: 0 };
  const changed = () => onChange?.(state);
  const sound = (name, position) => onSound?.(name, position);

  // --- Shared geometry and materials ---------------------------------------------------
  const geo = {
    capsule: new THREE.CapsuleGeometry(0.15, 0.2, 3, 8),
    head: new THREE.SphereGeometry(0.11, 10, 8),
    eye: new THREE.SphereGeometry(0.025, 6, 4),
    wing: new THREE.BoxGeometry(0.34, 0.02, 0.18),
    horn: new THREE.ConeGeometry(0.035, 0.12, 5),
    bar: new THREE.PlaneGeometry(0.5, 0.06),
    projectile: new THREE.SphereGeometry(1, 8, 6),
    particle: new THREE.BoxGeometry(0.06, 0.06, 0.06),
    ring: new THREE.RingGeometry(0.96, 1, 64).rotateX(-Math.PI / 2),
  };
  const mat = {
    skin: new THREE.MeshStandardMaterial({ color: 0xe0b48a, flatShading: true }),
    eye: new THREE.MeshBasicMaterial({ color: 0x111111 }),
    barBack: new THREE.MeshBasicMaterial({ color: 0x1a1a1a, depthTest: false, transparent: true, opacity: 0.8 }),
    stone: new THREE.MeshStandardMaterial({ color: 0xa8a49a, flatShading: true, roughness: 0.85 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x8a5a32, flatShading: true }),
    metal: new THREE.MeshStandardMaterial({ color: 0x4a4e58, flatShading: true, metalness: 0.6, roughness: 0.4 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xffc94a, metalness: 0.7, roughness: 0.3, emissive: 0x442200 }),
    frost: new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x2a9ad0, emissiveIntensity: 1.2, flatShading: true, transparent: true, opacity: 0.92 }),
    storm: new THREE.MeshStandardMaterial({ color: 0xd6b8ff, emissive: 0x8a50ff, emissiveIntensity: 1.8 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xc87a4a, metalness: 0.8, roughness: 0.35, flatShading: true }),
  };
  const shadowed = (mesh) => { mesh.castShadow = true; mesh.receiveShadow = true; return mesh; };

  // Range ring and hover ring, positioned by the UI through showRange() / showHover().
  const rangeRing = new THREE.Mesh(geo.ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
  const rangeFill = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false }));
  rangeRing.visible = rangeFill.visible = false;
  const hoverRing = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.46, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.9, depthWrite: false }));
  hoverRing.visible = false;
  group.add(rangeRing, rangeFill, hoverRing);

  // --- Particles -----------------------------------------------------------------------
  const particleMesh = new THREE.InstancedMesh(geo.particle, new THREE.MeshBasicMaterial({ color: 0xffffff }), PARTICLES);
  particleMesh.frustumCulled = false;
  const particles = Array.from({ length: PARTICLES }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 1 }));
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0), matrix = new THREE.Matrix4(), color = new THREE.Color();
  for (let i = 0; i < PARTICLES; i++) { particleMesh.setMatrixAt(i, hidden); particleMesh.setColorAt(i, color.setHex(0xffffff)); }
  group.add(particleMesh);
  let particleCursor = 0;
  function burst(position, hex, count, { speed = 2, up = 2, size = 1, life = 0.7 } = {}) {
    for (let n = 0; n < count; n++) {
      const p = particles[particleCursor];
      particleMesh.setColorAt(particleCursor, color.setHex(hex).multiplyScalar(0.8 + Math.random() * 0.4));
      particleCursor = (particleCursor + 1) % PARTICLES;
      const angle = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.6);
      Object.assign(p, { life: life * (0.6 + Math.random() * 0.4), max: life, x: position.x, y: position.y, z: position.z, vx: Math.cos(angle) * s, vy: up * (0.5 + Math.random()), vz: Math.sin(angle) * s, size: size * (0.6 + Math.random() * 0.8) });
    }
    particleMesh.instanceColor.needsUpdate = true;
  }
  function updateParticles(dt) {
    for (let i = 0; i < PARTICLES; i++) {
      const p = particles[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { particleMesh.setMatrixAt(i, hidden); continue; }
      p.vy -= GRAVITY * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.25) { p.y = 0.25; p.vy *= -0.3; p.vx *= 0.7; p.vz *= 0.7; }
      const s = p.size * (p.life / p.max);
      matrix.makeScale(s, s, s).setPosition(p.x, p.y, p.z);
      particleMesh.setMatrixAt(i, matrix);
    }
    particleMesh.instanceMatrix.needsUpdate = true;
  }

  // --- Enemies -------------------------------------------------------------------------
  function enemyMesh(def, type) {
    const body = new THREE.Group();
    const monster = createMonster(type);
    const parts = monster ? { monster, wings: [], setTint: (hex) => monster.setTint(hex) } : proceduralEnemy(def, type, body);
    if (monster) body.add(monster.object);
    body.scale.setScalar(def.size * ENEMY_SCALE);
    const bar = new THREE.Group();
    const back = new THREE.Mesh(geo.bar, mat.barBack);
    const fill = new THREE.Mesh(geo.bar, new THREE.MeshBasicMaterial({ color: 0x5ee05e, depthTest: false, transparent: true }));
    fill.position.z = 0.001;
    back.renderOrder = 10; fill.renderOrder = 11;
    bar.add(back, fill);
    bar.scale.setScalar(Math.max(0.8, def.size));
    parts.fill = fill;
    return { body, bar, parts };
  }

  // Fallback shapes, used only when a raider model could not be loaded.
  function proceduralEnemy(def, type, body) {
    const material = new THREE.MeshStandardMaterial({ color: def.color, flatShading: true, roughness: 0.7 });
    const parts = { material, wings: [], setTint: (hex) => material.emissive.setHex(hex) };
    if (def.flying) {
      const core = shadowed(new THREE.Mesh(geo.head, material));
      core.scale.set(1.3, 1.1, 1.5);
      body.add(core);
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.1, 0.02, 0);
        const wing = shadowed(new THREE.Mesh(geo.wing, material));
        wing.position.x = side * 0.17;
        pivot.add(wing);
        body.add(pivot);
        parts.wings.push({ pivot, side });
      }
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(geo.eye, new THREE.MeshBasicMaterial({ color: 0xffd24a }));
        eye.position.set(side * 0.05, 0.04, 0.14);
        body.add(eye);
      }
    } else {
      const torso = shadowed(new THREE.Mesh(geo.capsule, material));
      torso.position.y = 0.28;
      const head = shadowed(new THREE.Mesh(geo.head, type === "brute" ? material : mat.skin));
      head.position.y = 0.58;
      body.add(torso, head);
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(geo.eye, mat.eye);
        eye.position.set(side * 0.045, 0.6, 0.09);
        body.add(eye);
      }
      if (type === "brute") for (const side of [-1, 1]) {
        const horn = new THREE.Mesh(geo.horn, mat.stone);
        horn.position.set(side * 0.08, 0.7, 0);
        horn.rotation.z = -side * 0.5;
        body.add(horn);
      }
      if (type === "soldier") {
        const shield = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 8).rotateX(Math.PI / 2), mat.metal));
        shield.position.set(0.17, 0.3, 0.06);
        body.add(shield);
      }
    }
    return parts;
  }

  function spawnEnemy(type, spawnIndex) {
    const def = ENEMIES[type];
    const route = level.routes[spawnIndex];
    const hp = Math.round(def.hp * diff.hp * (1 + WAVE_HP_GROWTH * (state.wave - 1)));
    const { body, bar, parts } = enemyMesh(def, type);
    group.add(body, bar);
    enemies.push({ type, def, route, hp, maxHp: hp, distance: 0, side: (Math.random() * 2 - 1) * SIDE_SPREAD, slow: 0, slowTime: 0, body, bar, parts, position: new THREE.Vector3(), age: Math.random() * 10, alive: true, returning: false, carried: [] });
  }

  function placeEnemy(enemy) {
    routePoint(enemy.route, enemy.distance, enemy.side, point);
    world.toWorld(point.x, point.z, enemy.position);
    const tileHeight = world.heightAt(Math.round(point.x), Math.round(point.z));
    enemy.position.y = enemy.def.flying ? tileHeight + FLY_HEIGHT + Math.sin(enemy.age * 3) * 0.08 : tileHeight + (enemy.parts.monster ? 0 : Math.abs(Math.sin(enemy.age * 9 * enemy.def.speed)) * 0.05);
    enemy.body.position.copy(enemy.position);
    const turn = point.heading + (enemy.returning ? Math.PI : 0) - enemy.body.rotation.y;
    enemy.body.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * 0.25;
    enemy.bar.position.set(enemy.position.x, enemy.position.y + (enemy.def.flying ? 0.45 : 1.08 * enemy.def.size), enemy.position.z);
    enemy.bar.quaternion.copy(camera.quaternion);
  }

  function damage(enemy, amount, { slow, slowTime } = {}) {
    if (!enemy.alive) return;
    enemy.hp -= Math.max(1, amount - enemy.def.armor);
    if (slow) { enemy.slow = Math.max(enemy.slow, slow); enemy.slowTime = Math.max(enemy.slowTime, slowTime); }
    if (enemy.hp <= 0) kill(enemy);
    else updateBar(enemy);
  }
  function updateBar(enemy) {
    const share = Math.max(0, enemy.hp / enemy.maxHp);
    enemy.parts.fill.scale.x = share;
    enemy.parts.fill.position.x = -0.25 * (1 - share);
    enemy.parts.fill.material.color.setHSL(share * 0.33, 0.8, 0.5);
  }
  function kill(enemy) {
    enemy.alive = false;
    const bounty = Math.max(1, Math.round(enemy.def.bounty * diff.bounty));
    state.gold += bounty;
    state.mana = Math.min(MANA.max, state.mana + MANA.perKill);
    burst(enemy.position.clone().setY(enemy.position.y + 0.3), enemy.def.color, 18, { speed: 2.2, up: 2.5, size: 1.1 });
    onFloat?.(`+${bounty}`, enemy.position.clone().setY(enemy.position.y + 0.8), "gold");
    sound("death", enemy.position);
    dropGems(enemy);
    const monster = enemy.parts.monster;
    if (monster) {
      // The model plays its death animation where it fell, then sinks into the ground.
      enemies.splice(enemies.indexOf(enemy), 1);
      group.remove(enemy.bar);
      enemy.parts.fill.material.dispose();
      monster.setTint(0x000000);
      const groundY = enemy.position.y - (enemy.def.flying ? FLY_HEIGHT : 0);
      dying.push({ enemy, left: monster.die() + CORPSE_TIME, fromY: enemy.position.y, groundY, age: 0 });
    } else removeEnemy(enemy);
    changed();
  }
  function removeEnemy(enemy) {
    enemy.alive = false;
    group.remove(enemy.body, enemy.bar);
    enemy.parts.material?.dispose();
    enemy.parts.monster?.dispose();
    enemy.parts.fill.material.dispose();
    const index = enemies.indexOf(enemy);
    if (index >= 0) enemies.splice(index, 1);
  }
  const SINK_TIME = 0.6;
  function updateDying(dt) {
    for (const corpse of [...dying]) {
      const { enemy } = corpse;
      corpse.age += dt; corpse.left -= dt;
      enemy.parts.monster.update(dt, 1);
      // Flying raiders drop to the ground first.
      if (enemy.def.flying) enemy.body.position.y = Math.max(corpse.groundY, corpse.fromY - 2.5 * corpse.age * corpse.age);
      if (corpse.left < SINK_TIME) enemy.body.position.y -= dt * 0.5;
      if (corpse.left <= 0) { dying.splice(dying.indexOf(corpse), 1); removeEnemy(enemy); }
    }
  }

  function updateEnemies(dt) {
    for (const enemy of [...enemies]) {
      enemy.age += dt;
      if (enemy.slowTime > 0) { enemy.slowTime -= dt; if (enemy.slowTime <= 0) enemy.slow = 0; }
      enemy.parts.setTint(enemy.slow > 0 ? SLOW_TINT : 0x000000);
      const pace = (1 - enemy.slow) * (enemy.carried.length ? CARRY_SPEED : 1);
      enemy.parts.monster?.update(dt, pace * diff.speed);
      const step = enemy.def.speed * diff.speed * pace * dt;
      enemy.distance += enemy.returning ? -step : step;
      for (const { pivot, side } of enemy.parts.wings) pivot.rotation.z = side * Math.sin(enemy.age * 16) * 0.7;
      if (!enemy.returning && enemy.distance >= enemy.route.total) { enemy.distance = enemy.route.total; reachVault(enemy); }
      if (enemy.returning && enemy.distance <= 0) { reachPortal(enemy); continue; }
      placeEnemy(enemy);
      if (dropped.length && enemy.carried.length < enemy.def.gems) pickUp(enemy);
    }
  }

  // --- Gems: taken from the vault, carried home, dropped when the carrier dies ----------
  function countGems() {
    let carried = 0;
    for (const enemy of enemies) carried += enemy.carried.length;
    state.outside = carried + dropped.length;
  }
  function carry(enemy, gem) {
    const count = enemy.carried.length;
    gem.position.set((count - (enemy.def.gems - 1) / 2) * 0.16, enemy.def.flying ? 0.24 : 0.86, 0);
    gem.scale.setScalar(1.3);
    enemy.body.add(gem);
    enemy.carried.push(gem);
    enemy.returning = true;
  }
  function reachVault(enemy) {
    const take = Math.min(enemy.def.gems, state.gems);
    for (let i = 0; i < take; i++) carry(enemy, createGemMesh());
    enemy.returning = true;
    if (!take) return;
    state.gems -= take;
    world.showGems(state.gems);
    burst(world.vaultPosition.clone().setY(0.7), 0x40ffd0, 10, { speed: 1.2, up: 2.5 });
    sound("steal", world.vaultPosition);
    countGems();
    changed();
  }
  function reachPortal(enemy) {
    const count = enemy.carried.length;
    if (count) {
      state.lost += count;
      burst(enemy.position.clone().setY(enemy.position.y + 0.6), 0x40ffd0, 14, { speed: 1.5, up: 3 });
      onFloat?.(`-${count}`, enemy.position.clone().setY(enemy.position.y + 1.2), "gem");
      sound("gemLost", enemy.position);
    }
    removeEnemy(enemy);
    countGems();
    if (state.lost >= state.maxGems) finish("lost");
    changed();
  }
  function dropGems(enemy) {
    if (!enemy.carried.length) return;
    const tileHeight = world.heightAt(Math.round(enemy.position.x + (level.width - 1) / 2), Math.round(enemy.position.z + (level.height - 1) / 2));
    enemy.carried.forEach((gem, i) => {
      enemy.body.remove(gem);
      gem.scale.setScalar(1.9);
      const angle = Math.random() * Math.PI * 2, spread = i ? 0.18 : 0;
      gem.position.set(enemy.position.x + Math.cos(angle) * spread, tileHeight + 0.14, enemy.position.z + Math.sin(angle) * spread);
      gem.castShadow = true;
      const ring = new THREE.Mesh(dropRingGeometry, new THREE.MeshBasicMaterial({ color: 0x40ffd0, transparent: true, opacity: 0.7, depthWrite: false }));
      ring.position.set(gem.position.x, tileHeight + 0.02, gem.position.z);
      group.add(gem, ring);
      dropped.push({ gem, ring, baseY: gem.position.y, age: Math.random() * 6 });
    });
    enemy.carried.length = 0;
  }
  function pickUp(enemy) {
    for (const item of [...dropped]) {
      if (enemy.carried.length >= enemy.def.gems) break;
      const dx = item.gem.position.x - enemy.position.x, dz = item.gem.position.z - enemy.position.z;
      if (dx * dx + dz * dz > PICKUP_RADIUS * PICKUP_RADIUS) continue;
      removeDropRing(item);
      group.remove(item.gem);
      dropped.splice(dropped.indexOf(item), 1);
      carry(enemy, item.gem);
      sound("steal", enemy.position);
    }
    countGems();
  }
  const dropRingGeometry = new THREE.RingGeometry(0.16, 0.22, 24).rotateX(-Math.PI / 2);
  function removeDropRing(item) { group.remove(item.ring); item.ring.material.dispose(); }
  function updateDropped(dt) {
    for (const item of dropped) {
      item.age += dt;
      item.gem.rotation.y += dt * 2;
      item.gem.position.y = item.baseY + Math.sin(item.age * 3) * 0.05;
      item.ring.scale.setScalar(1 + (item.age * 0.8 % 1) * 0.8);
      item.ring.material.opacity = 0.75 * (1 - item.age * 0.8 % 1);
    }
  }
  // When the level is won, gems still lying on the road go back to the vault.
  function returnDropped() {
    for (const item of dropped) {
      burst(item.gem.position, 0x40ffd0, 6, { speed: 1, up: 2, size: 0.8 });
      removeDropRing(item);
      group.remove(item.gem);
    }
    state.gems += dropped.length;
    dropped.length = 0;
    world.showGems(state.gems);
    countGems();
  }

  // --- Towers --------------------------------------------------------------------------
  // Tower models (js/towers.js), or the simple shapes below when they could not be loaded.
  // parts: aim (turns to the target), recoil { object, axis, rest, kick }, spin, float { object, rest, amount },
  // orb, muzzle (shot origin height in tower units).
  function towerMesh(type, levelIndex) {
    return createTowerModel(type, levelIndex, { stormMaterial: mat.storm, copperMaterial: mat.copper }) ?? simpleTower(type, levelIndex);
  }
  function simpleTower(type, levelIndex) {
    const muzzle = (0.75 + levelIndex * 0.06) / TOWER_SCALE;
    const tower = new THREE.Group();
    const grow = 1 + levelIndex * 0.14;
    const base = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.3 * grow, 8).translate(0, 0.15 * grow, 0), mat.stone));
    tower.add(base);
    const top = 0.3 * grow;
    // Level pips: one gold stud per level around the base.
    for (let i = 0; i <= levelIndex; i++) {
      const pip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 4), mat.gold);
      const angle = Math.PI / 2 + (i - levelIndex / 2) * 0.45;
      pip.position.set(Math.cos(angle) * 0.38, 0.12, Math.sin(angle) * 0.38);
      tower.add(pip);
    }
    const head = new THREE.Group();
    head.position.y = top;
    tower.add(head);
    let spin = null;
    if (type === "bolt") {
      head.add(shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34 * grow, 0.42).translate(0, 0.17 * grow, 0), mat.wood)));
      const turret = new THREE.Group();
      turret.position.y = 0.34 * grow + 0.08;
      turret.add(shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.46), mat.wood)));
      const bow = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 4, 12, Math.PI), mat.metal));
      bow.rotation.x = -Math.PI / 2; bow.position.z = 0.12;
      turret.add(bow);
      head.add(turret);
      return { tower, aim: turret, spin, muzzle };
    }
    if (type === "mortar") {
      const turret = new THREE.Group();
      turret.position.y = 0.05;
      turret.add(shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.12, 10).translate(0, 0.06, 0), mat.metal)));
      const barrel = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.1 * grow, 0.13 * grow, 0.42, 10).translate(0, 0.21, 0), mat.metal));
      barrel.rotation.x = 0.7; barrel.position.y = 0.1;
      turret.add(barrel);
      head.add(turret);
      return { tower, aim: turret, spin, muzzle, recoil: { object: barrel, axis: "y", rest: 0.1, kick: -0.12 } };
    }
    if (type === "frost") {
      const crystal = shadowed(new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0).scale(1, 2.2, 1), mat.frost));
      crystal.position.y = 0.45 + levelIndex * 0.05;
      head.add(crystal);
      for (let i = 0; i < 3 + levelIndex; i++) {
        const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0).scale(1, 2, 1), mat.frost);
        const angle = i / (3 + levelIndex) * Math.PI * 2;
        shard.position.set(Math.cos(angle) * 0.24, 0.1, Math.sin(angle) * 0.24);
        shard.rotation.z = Math.cos(angle) * 0.4; shard.rotation.x = -Math.sin(angle) * 0.4;
        head.add(shard);
      }
      return { tower, aim: null, spin: crystal, muzzle, float: { object: crystal, rest: crystal.position.y, amount: 0.04 } };
    }
    // storm
    head.add(shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.55 * grow, 8).translate(0, 0.27 * grow, 0), mat.metal)));
    for (let i = 0; i < 2 + levelIndex; i++) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.16 - i * 0.02, 0.025, 6, 16), mat.copper);
      coil.rotation.x = Math.PI / 2; coil.position.y = 0.12 + i * 0.13;
      head.add(coil);
    }
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), mat.storm);
    orb.position.y = 0.55 * grow + 0.12;
    head.add(orb);
    return { tower, aim: null, spin: null, orb, muzzle };
  }

  function stats(tower) { return TOWERS[tower.type].levels[tower.level]; }

  function build(padIndex, type) {
    const pad = world.pads[padIndex];
    const cost = TOWERS[type].levels[0].cost;
    if (!pad || towerAt(padIndex) || state.gold < cost || isOver()) return null;
    state.gold -= cost;
    const tower = { type, level: 0, padIndex, position: pad.position.clone(), cooldown: 0.3, spent: cost, parts: null };
    setTowerMesh(tower);
    towers.push(tower);
    world.setPadMarker(padIndex, false);
    burst(pad.position.clone().setY(0.5), 0xd8cfb8, 16, { speed: 1.6, up: 1.8 });
    sound("build", pad.position);
    changed();
    return tower;
  }
  function setTowerMesh(tower) {
    if (tower.parts) group.remove(tower.parts.tower);
    tower.parts = towerMesh(tower.type, tower.level);
    tower.parts.tower.position.copy(tower.position);
    tower.parts.tower.scale.setScalar(TOWER_SCALE);
    group.add(tower.parts.tower);
  }
  function upgradeCost(tower) { return TOWERS[tower.type].levels[tower.level + 1]?.cost ?? null; }
  function upgrade(tower) {
    const cost = upgradeCost(tower);
    if (cost == null || state.gold < cost || isOver()) return false;
    state.gold -= cost; tower.spent += cost; tower.level++;
    setTowerMesh(tower);
    burst(tower.position.clone().setY(0.8), 0xffd76a, 20, { speed: 1.4, up: 2.6 });
    sound("upgrade", tower.position);
    changed();
    return true;
  }
  function sellValue(tower) { return Math.floor(tower.spent * SELL_REFUND); }
  function sell(tower) {
    if (isOver()) return;
    state.gold += sellValue(tower);
    group.remove(tower.parts.tower);
    towers.splice(towers.indexOf(tower), 1);
    world.setPadMarker(tower.padIndex, true);
    sound("sell", tower.position);
    burst(tower.position.clone().setY(0.5), 0xd8cfb8, 16, { speed: 1.6, up: 1.8 });
    changed();
  }
  function towerAt(padIndex) { return towers.find((tower) => tower.padIndex === padIndex) || null; }

  function findTarget(tower, range, exclude) {
    let best = null, bestProgress = -1;
    const hitsAir = TOWERS[tower.type].hitsAir;
    for (const enemy of enemies) {
      if (!enemy.alive || (enemy.def.flying && !hitsAir) || exclude?.has(enemy)) continue;
      const dx = enemy.position.x - tower.position.x, dz = enemy.position.z - tower.position.z;
      if (dx * dx + dz * dz > range * range) continue;
      const share = enemy.distance / enemy.route.total;
      const progress = enemy.carried.length ? 3 - share : enemy.returning ? 1 - share : 1 + share;
      if (progress > bestProgress) { best = enemy; bestProgress = progress; }
    }
    return best;
  }

  function updateTowers(dt, time) {
    for (const tower of towers) {
      const s = stats(tower), parts = tower.parts;
      if (parts.spin) parts.spin.rotation.y += dt * 1.5;
      if (parts.float) parts.float.object.position.y = parts.float.rest + Math.sin(time * 2 + tower.padIndex) * parts.float.amount;
      if (parts.orb) parts.orb.scale.setScalar(1 + Math.sin(time * 6 + tower.padIndex) * 0.08);
      if (parts.recoil) { const r = parts.recoil; r.object.position[r.axis] += (r.rest - r.object.position[r.axis]) * Math.min(1, dt * 8); }
      tower.cooldown -= dt;
      const target = findTarget(tower, s.range);
      if (target && parts.aim) {
        const want = Math.atan2(target.position.x - tower.position.x, target.position.z - tower.position.z);
        const turn = want - parts.aim.rotation.y;
        parts.aim.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 12);
      }
      if (!target || tower.cooldown > 0) continue;
      tower.cooldown = 1 / s.rate;
      fire(tower, target, s);
    }
  }

  function fire(tower, target, s) {
    const def = TOWERS[tower.type];
    const muzzle = tower.position.clone().setY(tower.position.y + tower.parts.muzzle * TOWER_SCALE);
    sound(tower.type === "mortar" ? "mortarFire" : tower.type, tower.position);
    if (tower.type === "storm") {
      const hit = new Set();
      let from = muzzle, current = target, amount = s.damage;
      for (let i = 0; i < s.chain && current; i++) {
        hit.add(current);
        const to = current.position.clone().setY(current.position.y + 0.35 * current.def.size);
        addBolt(from, to);
        damage(current, amount);
        from = to; amount *= CHAIN_FALLOFF;
        current = nearestEnemy(to, CHAIN_JUMP, hit);
      }
      tower.parts.orb.scale.setScalar(1.4);
      return;
    }
    if (tower.parts.recoil) { const r = tower.parts.recoil; r.object.position[r.axis] = r.rest + r.kick; }
    const mesh = new THREE.Mesh(geo.projectile, new THREE.MeshStandardMaterial({ color: def.projectile.color, emissive: tower.type === "frost" ? 0x3aa8e0 : 0x000000, emissiveIntensity: 1 }));
    mesh.scale.setScalar(def.projectile.size);
    mesh.castShadow = true;
    mesh.position.copy(muzzle);
    group.add(mesh);
    const projectile = { tower: tower.type, stats: s, def: def.projectile, mesh, target, from: muzzle.clone(), to: target.position.clone(), time: 0 };
    if (def.projectile.arc) projectile.duration = Math.max(0.5, muzzle.distanceTo(target.position) / def.projectile.speed);
    projectiles.push(projectile);
  }

  function nearestEnemy(position, radius, exclude) {
    let best = null, bestDistance = radius;
    for (const enemy of enemies) {
      if (!enemy.alive || exclude.has(enemy)) continue;
      const d = enemy.position.distanceTo(position);
      if (d < bestDistance) { best = enemy; bestDistance = d; }
    }
    return best;
  }

  function updateProjectiles(dt) {
    for (const p of [...projectiles]) {
      p.time += dt;
      if (p.def.arc) {
        const t = Math.min(1, p.time / p.duration);
        p.mesh.position.lerpVectors(p.from, p.to, t);
        p.mesh.position.y += Math.sin(t * Math.PI) * p.def.arc;
        if (t < 1) continue;
        explode(p.to, p.stats.splash, p.stats.damage, false, 0x9a8a70);
        sound("explosion", p.to);
        dropProjectile(p);
        continue;
      }
      if (p.target.alive) p.to.copy(p.target.position).setY(p.target.position.y + 0.35 * p.target.def.size);
      temp.subVectors(p.to, p.mesh.position);
      const step = p.def.speed * dt;
      if (temp.length() <= step) {
        if (p.target.alive) { damage(p.target, p.stats.damage, p.stats); if (p.tower === "bolt") sound("hit", p.to); }
        if (p.tower === "frost") burst(p.to, 0xbff2ff, 6, { speed: 1, up: 1, size: 0.8, life: 0.4 });
        dropProjectile(p);
        continue;
      }
      p.mesh.position.addScaledVector(temp.normalize(), step);
    }
  }
  function dropProjectile(p) {
    group.remove(p.mesh);
    p.mesh.material.dispose();
    projectiles.splice(projectiles.indexOf(p), 1);
  }

  function explode(position, radius, amount, hitsAir, hex) {
    for (const enemy of [...enemies]) {
      if (enemy.def.flying && !hitsAir) continue;
      const dx = enemy.position.x - position.x, dz = enemy.position.z - position.z;
      const d = Math.hypot(dx, dz);
      if (d <= radius) damage(enemy, amount * (1 - 0.4 * d / radius));
    }
    burst(position.clone().setY(Math.max(position.y, 0.3)), hex, 22, { speed: 2.6, up: 2.4, size: 1.2 });
    burst(position.clone().setY(Math.max(position.y, 0.3)), 0xffa040, 10, { speed: 1.5, up: 1.5, size: 1.4, life: 0.4 });
  }

  // Storm tower lightning: a jagged line that fades quickly.
  function addBolt(from, to) {
    const points = [from.clone()];
    for (let i = 1; i < 6; i++) {
      const p = from.clone().lerp(to, i / 6);
      p.x += (Math.random() - 0.5) * 0.18; p.y += (Math.random() - 0.5) * 0.18; p.z += (Math.random() - 0.5) * 0.18;
      points.push(p);
    }
    points.push(to.clone());
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xe6d0ff, transparent: true }));
    group.add(line);
    bolts.push({ line, life: 0.14 });
    burst(to, 0xc8a8ff, 4, { speed: 1, up: 1, size: 0.7, life: 0.3 });
  }
  function updateBolts(dt) {
    for (const bolt of [...bolts]) {
      bolt.life -= dt;
      bolt.line.material.opacity = Math.max(0, bolt.life / 0.14);
      if (bolt.life > 0) continue;
      group.remove(bolt.line);
      bolt.line.geometry.dispose(); bolt.line.material.dispose();
      bolts.splice(bolts.indexOf(bolt), 1);
    }
  }

  // --- Meteor spell --------------------------------------------------------------------
  const meteorGeometry = new THREE.IcosahedronGeometry(0.28, 0);
  const meteorMaterial = new THREE.MeshStandardMaterial({ color: 0x5a3020, emissive: 0xff5a10, emissiveIntensity: 1.6, flatShading: true });
  function castMeteor(target) {
    const spell = SPELLS.meteor;
    if (state.mana < spell.mana || isOver() || state.status === "ready") return false;
    state.mana -= spell.mana;
    const mesh = new THREE.Mesh(meteorGeometry, meteorMaterial);
    const from = target.clone().add(new THREE.Vector3(-3, 9, -2));
    mesh.position.copy(from);
    group.add(mesh);
    const marker = new THREE.Mesh(geo.ring, new THREE.MeshBasicMaterial({ color: 0xff7a30, transparent: true, opacity: 0.8, depthWrite: false }));
    marker.scale.setScalar(spell.radius);
    marker.position.copy(target).setY(target.y + 0.03);
    group.add(marker);
    meteors.push({ mesh, marker, from, to: target.clone(), time: 0 });
    sound("meteorCast", target);
    changed();
    return true;
  }
  function updateMeteors(dt) {
    const spell = SPELLS.meteor;
    for (const m of [...meteors]) {
      m.time += dt;
      const t = Math.min(1, m.time / spell.fall);
      m.mesh.position.lerpVectors(m.from, m.to, t * t);
      m.mesh.rotation.x += dt * 8;
      if (Math.random() < 0.8) burst(m.mesh.position, 0xff8a30, 1, { speed: 0.3, up: 0.2, size: 1.3, life: 0.35 });
      if (t < 1) continue;
      explode(m.to, spell.radius, spell.damage, true, 0x6a4030);
      sound("meteorImpact", m.to);
      burst(m.to.clone().setY(m.to.y + 0.2), 0xffc040, 30, { speed: 3.4, up: 3.5, size: 1.4 });
      group.remove(m.mesh, m.marker);
      m.marker.material.dispose();
      meteors.splice(meteors.indexOf(m), 1);
    }
  }

  // --- Waves ---------------------------------------------------------------------------
  function startNextWave() {
    if (state.wave >= state.waveCount || isOver()) return 0;
    let bonus = 0;
    if (state.wave > 0) {
      bonus = Math.round((state.countdown ?? 0) * EARLY_BONUS_PER_SECOND);
      if (bonus > 0) { state.gold += bonus; onFloat?.(`+${bonus}`, world.vaultPosition.clone().setY(1.6), "gold"); }
    }
    const wave = level.waves[state.wave];
    state.wave++;
    state.status = "playing";
    sound("waveStart", null);
    state.countdown = null;
    wave.groups.forEach((g, index) => {
      spawners.push({ enemy: g.enemy, remaining: g.count, interval: g.interval, timer: g.delay, spawn: g.spawn ?? index % level.routes.length });
    });
    changed();
    return bonus;
  }

  function updateWaves(dt) {
    for (const spawner of [...spawners]) {
      spawner.timer -= dt;
      while (spawner.timer <= 0 && spawner.remaining > 0) {
        const spawn = Math.min(spawner.spawn, level.routes.length - 1);
        spawnEnemy(spawner.enemy, spawn);
        spawner.remaining--;
        spawner.timer += spawner.interval;
      }
      if (spawner.remaining <= 0) spawners.splice(spawners.indexOf(spawner), 1);
    }
    state.spawning = spawners.length;
    if (state.status !== "playing") return;
    if (!spawners.length && state.wave < state.waveCount) {
      if (state.countdown == null) { state.countdown = WAVE_GAP; changed(); }
      state.countdown -= dt;
      if (state.countdown <= 0) startNextWave();
    }
    if (!spawners.length && state.wave >= state.waveCount && !enemies.length) finish("won");
  }

  function isOver() { return state.status === "won" || state.status === "lost"; }
  function finish(status) {
    if (isOver()) return;
    if (status === "won") returnDropped();
    state.status = status;
    state.countdown = null;
    changed();
    onEnd?.(status, state);
  }

  // --- Frame update --------------------------------------------------------------------
  let time = 0, lastNotify = 0;
  function update(dt) {
    time += dt;
    if (!isOver()) {
      state.mana = Math.min(MANA.max, state.mana + MANA.regen * dt * (state.status === "playing" ? 1 : 0));
      updateWaves(dt);
      updateEnemies(dt);
      updateTowers(dt, time);
    } else {
      for (const enemy of enemies) { enemy.age += dt; enemy.parts.monster?.update(dt, 1); placeEnemy(enemy); }
    }
    updateDying(dt);
    updateDropped(dt);
    updateProjectiles(dt);
    updateMeteors(dt);
    updateBolts(dt);
    updateParticles(dt);
    if (time - lastNotify > 0.1) { lastNotify = time; changed(); }
  }

  function showRange(position, range, hex = 0xffffff) {
    rangeRing.visible = rangeFill.visible = position != null;
    if (!position) return;
    rangeRing.position.set(position.x, 0.45, position.z);
    rangeFill.position.set(position.x, 0.44, position.z);
    rangeRing.scale.setScalar(range); rangeFill.scale.setScalar(range);
    rangeRing.material.color.setHex(hex); rangeFill.material.color.setHex(hex);
  }
  function showHover(position) {
    hoverRing.visible = position != null;
    if (position) hoverRing.position.set(position.x, position.y + 0.02, position.z);
  }

  function dispose() {
    // Raider models share geometry and textures with the loaded originals: release only the copies.
    for (const enemy of [...enemies, ...dying.map((corpse) => corpse.enemy)]) {
      const monster = enemy.parts.monster;
      if (monster) { enemy.body.remove(monster.object); monster.dispose(); }
    }
    scene.remove(group);
    group.traverse((object) => {
      if (object.userData.shared) return;   // tower pieces: geometry and materials shared between levels
      object.geometry?.dispose(); if (object.material) [].concat(object.material).forEach((m) => m.dispose()); });
  }

  world.showGems(state.gems);
  return {
    state, towers, update, build, upgrade, upgradeCost, sell, sellValue, towerAt, stats, startNextWave, castMeteor,
    showRange, showHover, dispose, isOver,
  };
}

// Gem Keep entry point: renderer, frame loop, level menu, HUD and input.
import * as THREE from "../lib/three.module.min.js";
import { TOWERS, SPELLS, EARLY_BONUS_PER_SECOND, DIFFICULTIES } from "./data.js";
import { loadLevelIndex, loadLevel } from "./level.js";
import { createWorld } from "./world.js";
import { createGame } from "./game.js";
import { loadMonsters } from "./monsters.js";
import { loadNature } from "./nature.js";
import { loadTowers } from "./towers.js";
import { createCameraControls } from "./camera.js";
import { createSound } from "./sound.js";

const MAX_FRAME = 0.05;              // seconds; longer frames are clamped so the game never jumps
const SPEEDS = [1, 2, 3];
const STAR_THRESHOLDS = [0.5, 0.9];  // share of gems kept for the 2nd and 3rd star
const PROGRESS_KEY = "progress";
const SOUND_KEY = "sound";
const DIFFICULTY_KEY = "difficulty";
const SOUND_NEAR = 14;               // camera distance at which world sounds play at full volume
const TOWER_HEX = { bolt: 0xffd890, mortar: 0xffb070, frost: 0x9fe8ff, storm: 0xd0b0ff };

const $ = (id) => document.getElementById(id);
const t = (key, params) => (window.persephone?.i18n ? persephone.i18n.t(key, params) : key);
function translatePage() {
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
}

// --- Progress storage (per board, survives restarts) -------------------------------------
async function readStored(key) {
  try { if (window.persephone?.storage) return (await persephone.storage.get(key)) || {}; } catch { /* fall through */ }
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}
async function writeStored(key, value) {
  try { if (window.persephone?.storage) { await persephone.storage.set(key, value); return; } } catch { /* fall through */ }
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not available */ }
}
const readProgress = () => readStored(PROGRESS_KEY);

// --- Difficulty (js/data.js DIFFICULTIES), picked in the level menu and remembered -----------
let difficultyId = null;
function currentDifficulty() {
  return DIFFICULTIES.find((d) => d.id === difficultyId) ?? DIFFICULTIES.find((d) => d.default) ?? DIFFICULTIES[0];
}
const difficultyLabel = (d) => d.label ?? t(`difficulty.${d.id}`);
function renderDifficulty() {
  const selected = currentDifficulty();
  $("difficulty").replaceChildren(...DIFFICULTIES.map((d) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "difficulty-option";
    button.dataset.name = `difficulty-${d.id}`;
    button.textContent = difficultyLabel(d);
    const about = d.about ?? t(`difficulty.${d.id}.about`);
    if (about !== `difficulty.${d.id}.about`) button.title = about;
    button.setAttribute("aria-pressed", String(d === selected));
    button.addEventListener("click", () => {
      difficultyId = d.id;
      writeStored(DIFFICULTY_KEY, { id: d.id });
      renderDifficulty();
    });
    return button;
  }));
}
const writeProgress = (progress) => writeStored(PROGRESS_KEY, progress);

// --- Renderer ----------------------------------------------------------------------------
const canvas = $("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
const raycaster = new THREE.Raycaster();
const sound = createSound();
const pointer = new THREE.Vector2();

function resize() {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);

// --- Session state -----------------------------------------------------------------------
let levels = [], progress = {}, current = null; // current = { entry, index, level, world, game }
let speedIndex = 0, paused = false, hiddenPause = false, targeting = false;
let selection = null; // { padIndex, tower|null }
const bounds = { x: 10, z: 10 };

const controls = createCameraControls(camera, canvas, {
  bounds,
  onTap: (event) => handleTap(event),
  onHover: (event) => handleHover(event),
});

function rayFrom(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return raycaster;
}
function padAt(event) {
  if (!current) return -1;
  const tile = current.world.pickTile(rayFrom(event));
  return current.world.pads.findIndex((pad) => pad.index === tile);
}

function handleHover(event) {
  if (!current || current.game.isOver()) return;
  if (targeting) { canvas.style.cursor = "crosshair"; return; }
  const padIndex = padAt(event);
  current.game.showHover(padIndex >= 0 ? current.world.pads[padIndex].position : null);
  canvas.style.cursor = padIndex >= 0 ? "pointer" : "";
}

function handleTap(event) {
  if (!current || current.game.isOver()) return;
  if (targeting) {
    const point = current.world.pickGround(rayFrom(event));
    if (point && current.game.castMeteor(point)) setTargeting(false);
    return;
  }
  const padIndex = padAt(event);
  if (padIndex < 0 || selection?.padIndex === padIndex) { select(null); return; }
  select(padIndex);
}

// --- Sound ------------------------------------------------------------------------------
// World sounds pan with their screen position and fade with distance from the camera.
const heard = new THREE.Vector3();
function playAt(name, position) {
  if (!position) { sound.play(name); return; }
  heard.copy(position).project(camera);
  const distance = camera.position.distanceTo(position);
  const offscreen = Math.abs(heard.x) > 1.1 || Math.abs(heard.y) > 1.1 ? 0.45 : 1;
  sound.play(name, { pan: heard.x * 0.7, gain: Math.min(1, SOUND_NEAR / distance) * offscreen });
}
function setMuted(value, persist = true) {
  sound.setMuted(value);
  $("mute").classList.toggle("muted", sound.muted);
  $("mute").setAttribute("aria-pressed", String(sound.muted));
  window.persephone?.page?.setMuted?.(sound.muted);
  if (persist) writeStored(SOUND_KEY, { muted: sound.muted });
}

// --- Selection popups --------------------------------------------------------------------
function select(padIndex) {
  selection = padIndex == null ? null : { padIndex, tower: current.game.towerAt(padIndex) };
  current?.game.showRange(null);
  $("build-panel").hidden = $("tower-panel").hidden = true;
  if (!selection) return;
  sound.play("click");
  if (selection.tower) { renderTowerPanel(); $("tower-panel").hidden = false; }
  else { renderBuildPanel(); $("build-panel").hidden = false; }
  placePopups();
}

function renderBuildPanel() {
  const panel = $("build-panel");
  panel.replaceChildren(...current.level.towers.map((type) => {
    const def = TOWERS[type], cost = def.levels[0].cost;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "build-option";
    button.dataset.name = `build-${type}`;
    button.dataset.type = type;
    button.title = t(`tower.${type}.about`);
    button.innerHTML = `<span class="tower-icon ${type}"></span><span class="build-name"></span><span class="cost"></span>`;
    button.querySelector(".build-name").textContent = t(`tower.${type}`);
    button.querySelector(".cost").textContent = cost;
    button.addEventListener("pointerenter", () => current.game.showRange(current.world.pads[selection.padIndex].position, def.levels[0].range, TOWER_HEX[type]));
    button.addEventListener("pointerleave", () => current.game.showRange(null));
    button.addEventListener("click", () => {
      const tower = current.game.build(selection.padIndex, type);
      if (tower) select(null); else sound.play("denied");
    });
    return button;
  }));
  updatePanels();
}

function renderTowerPanel() {
  const tower = selection.tower, game = current.game;
  const s = game.stats(tower), next = TOWERS[tower.type].levels[tower.level + 1];
  const lines = [t("stat.damage", { value: s.damage }), t("stat.range", { value: s.range }), t("stat.rate", { value: s.rate })];
  if (s.splash) lines.push(t("stat.splash", { value: s.splash }));
  if (s.slow) lines.push(t("stat.slow", { value: Math.round(s.slow * 100) }));
  if (s.chain) lines.push(t("stat.chain", { value: s.chain }));
  const panel = $("tower-panel");
  panel.innerHTML = `<div class="tower-head"><span class="tower-icon ${tower.type}"></span><div><b></b><small></small></div></div><ul class="tower-stats"></ul><div class="tower-buttons"><button type="button" class="upgrade" data-name="upgrade-tower"></button><button type="button" class="sell" data-name="sell-tower"></button></div>`;
  panel.querySelector("b").textContent = t(`tower.${tower.type}`);
  panel.querySelector("small").textContent = t("tower.level", { level: tower.level + 1 });
  panel.querySelector(".tower-stats").replaceChildren(...lines.map((line) => Object.assign(document.createElement("li"), { textContent: line })));
  const upgrade = panel.querySelector(".upgrade"), sell = panel.querySelector(".sell");
  upgrade.innerHTML = next ? `<span></span><span class="cost">${next.cost}</span>` : "<span></span>";
  upgrade.firstChild.textContent = next ? t("tower.upgrade") : t("tower.maxed");
  upgrade.dataset.cost = next?.cost ?? "";
  sell.innerHTML = `<span></span><span class="refund">+${game.sellValue(tower)}</span>`;
  sell.firstChild.textContent = t("tower.sell");
  upgrade.addEventListener("click", () => { if (game.upgrade(tower)) renderTowerPanel(); else sound.play("denied"); });
  upgrade.addEventListener("pointerenter", () => next && game.showRange(tower.position, next.range, TOWER_HEX[tower.type]));
  upgrade.addEventListener("pointerleave", () => game.showRange(tower.position, s.range, TOWER_HEX[tower.type]));
  sell.addEventListener("click", () => { game.sell(tower); select(null); });
  game.showRange(tower.position, s.range, TOWER_HEX[tower.type]);
  updatePanels();
}

// Enable or disable popup buttons as gold changes.
function updatePanels() {
  if (!current) return;
  const gold = current.game.state.gold;
  $("build-panel").querySelectorAll(".build-option").forEach((button) => { button.disabled = gold < TOWERS[button.dataset.type].levels[0].cost; });
  const upgrade = $("tower-panel").querySelector(".upgrade");
  if (upgrade) upgrade.disabled = !upgrade.dataset.cost || gold < Number(upgrade.dataset.cost);
}

const projected = new THREE.Vector3();
function placePopups() {
  if (!selection || !current) return;
  const panel = selection.tower ? $("tower-panel") : $("build-panel");
  projected.copy(current.world.pads[selection.padIndex].position).project(camera);
  const stage = $("stage").getBoundingClientRect();
  const x = (projected.x + 1) / 2 * stage.width, y = (1 - projected.y) / 2 * stage.height;
  const width = panel.offsetWidth, height = panel.offsetHeight;
  panel.style.left = `${Math.min(stage.width - width - 8, Math.max(8, x - width / 2))}px`;
  panel.style.top = `${Math.min(stage.height - height - 8, Math.max(56, y - height - 28))}px`;
}

// --- Floating "+gold" texts --------------------------------------------------------------
const floats = [];
function addFloat(text, position, kind) {
  const el = document.createElement("span");
  el.className = `float ${kind}`;
  el.textContent = text;
  $("floats").append(el);
  floats.push({ el, position, age: 0 });
}
function updateFloats(dt) {
  const stage = $("stage").getBoundingClientRect();
  for (const f of [...floats]) {
    f.age += dt;
    if (f.age > 1.1) { f.el.remove(); floats.splice(floats.indexOf(f), 1); continue; }
    projected.copy(f.position).project(camera);
    f.el.style.transform = `translate(${(projected.x + 1) / 2 * stage.width}px, ${(1 - projected.y) / 2 * stage.height - f.age * 40}px) translate(-50%, -50%)`;
    f.el.style.opacity = String(Math.min(1, (1.1 - f.age) * 3));
  }
}

// --- HUD ---------------------------------------------------------------------------------
let lastHud = "";
function updateHud(state) {
  const meteor = SPELLS.meteor;
  const key = `${Math.floor(state.gold)}|${state.gems}|${state.outside}|${state.wave}|${Math.floor(state.mana)}|${state.countdown == null ? "-" : Math.ceil(state.countdown)}|${state.status}|${targeting}`;
  if (key === lastHud) return;
  lastHud = key;
  $("gold").textContent = Math.floor(state.gold);
  $("gems").textContent = state.gems;
  $("gems-out").textContent = state.outside ? t("hud.gemsOut", { count: state.outside }) : "";
  $("wave").textContent = t("hud.wave", { current: state.wave, total: state.waveCount });
  $("mana-fill").style.width = `${state.mana}%`;
  $("meteor-cost").textContent = t("spell.cost", { mana: meteor.mana });
  const waveButton = $("wave-button");
  if (state.status === "ready") {
    waveButton.textContent = t("wave.start");
    waveButton.disabled = false;
    waveButton.classList.add("pulse");
  } else {
    waveButton.classList.remove("pulse");
    const more = state.wave < state.waveCount;
    waveButton.disabled = !more || state.status !== "playing";
    if (!more) waveButton.textContent = t("wave.last");
    else if (state.countdown != null) {
      waveButton.textContent = "";
      const main = document.createElement("span"), bonus = document.createElement("small");
      main.textContent = t("wave.next", { seconds: Math.ceil(state.countdown) });
      bonus.textContent = t("wave.bonus", { gold: Math.round(state.countdown * EARLY_BONUS_PER_SECOND) });
      waveButton.append(main, bonus);
    } else waveButton.textContent = t("wave.call", { wave: state.wave + 1 });
  }
  $("meteor-button").disabled = state.mana < meteor.mana || state.status !== "playing";
  $("meteor-button").classList.toggle("active", targeting);
  if (targeting && $("meteor-button").disabled) setTargeting(false);
  updatePanels();
}

function setTargeting(on) {
  targeting = on;
  $("target-hint").hidden = !on;
  canvas.style.cursor = on ? "crosshair" : "";
  if (on) select(null);
  lastHud = "";
}

// --- Level flow --------------------------------------------------------------------------
function starsFor(state) {
  const share = state.gems / state.maxGems;
  return 1 + STAR_THRESHOLDS.filter((threshold) => share >= threshold).length;
}
function starsHtml(count) { return [0, 1, 2].map((i) => `<span class="star${i < count ? " on" : ""}">★</span>`).join(""); }

function unlocked(index) { return index === 0 || (progress[levels[index - 1]?.file]?.stars ?? 0) > 0; }

function showMenu() {
  closeLevel();
  sound.setAmbience(false);
  $("hud").hidden = $("actions").hidden = $("controls-hint").hidden = true;
  $("result").hidden = true;
  $("menu").hidden = false;
  renderDifficulty();
  const list = $("level-list");
  list.replaceChildren(...levels.map((entry, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "level-card";
    card.dataset.name = `level-${index + 1}`;
    const open = unlocked(index);
    card.disabled = !open;
    if (!open) card.title = t("menu.locked");
    card.innerHTML = `<span class="level-number">${index + 1}</span><span class="level-text"><b></b><small></small></span><span class="stars">${starsHtml(progress[entry.file]?.stars ?? 0)}</span>`;
    card.querySelector("b").textContent = entry.name;
    card.querySelector("small").textContent = entry.description || "";
    card.addEventListener("click", () => startLevel(index));
    return card;
  }));
  // A calm backdrop behind the menu: the first level, slowly turning.
  if (levels.length) showBackdrop();
}

let backdrop = null;
async function showBackdrop() {
  try {
    const [level] = await Promise.all([loadLevel(levels[0].file), loadNature()]);
    if (current || $("menu").hidden) return;
    backdrop?.dispose();
    backdrop = createWorld(scene, level);
    bounds.x = backdrop.bounds.x; bounds.z = backdrop.bounds.z;
    controls.reset({ distance: Math.max(level.width, level.height) * 1.05, pitch: 0.75 });
  } catch { /* the menu works without a backdrop */ }
}

async function startLevel(index) {
  const entry = levels[index];
  let level;
  try { [level] = await Promise.all([loadLevel(entry.file), loadMonsters(), loadNature(), loadTowers()]); }
  catch (error) { $("menu-error").textContent = t("level.loadError", { error: error.message }); $("menu-error").hidden = false; return; }
  closeLevel();
  backdrop?.dispose(); backdrop = null;
  $("menu").hidden = $("result").hidden = true;
  $("menu-error").hidden = true;
  const world = createWorld(scene, level);
  bounds.x = world.bounds.x; bounds.z = world.bounds.z;
  const game = createGame({
    scene, camera, world, level, difficulty: currentDifficulty(),
    onChange: updateHud, onFloat: addFloat, onSound: playAt,
    onEnd: (status, state) => endLevel(status, state),
  });
  current = { entry, index, level, world, game };
  controls.reset({ distance: Math.max(level.width, level.height) * 0.95, pitch: 0.95, yaw: 0.35 });
  speedIndex = 0; paused = false; targeting = false; selection = null;
  $("speed").textContent = "1×";
  $("difficulty-badge").textContent = difficultyLabel(currentDifficulty());
  $("paused").hidden = true;
  $("hud").hidden = $("actions").hidden = $("controls-hint").hidden = false;
  $("target-hint").hidden = true;
  lastHud = "";
  updateHud(game.state);
  sound.setAmbience(true);
}

function closeLevel() {
  if (!current) return;
  select(null);
  current.game.dispose();
  current.world.dispose();
  current = null;
  floats.splice(0).forEach((f) => f.el.remove());
}

async function endLevel(status, state) {
  setTargeting(false);
  select(null);
  const stars = status === "won" ? starsFor(state) : 0;
  setTimeout(() => sound.play(status === "won" ? "win" : "lose"), 500);
  if (stars) {
    const file = current.entry.file;
    const best = progress[file] || {};
    progress[file] = { stars: Math.max(best.stars ?? 0, stars), gems: Math.max(best.gems ?? 0, state.gems) };
    await writeProgress(progress);
  }
  $("result-title").textContent = t(status === "won" ? "result.won" : "result.lost");
  $("result-text").textContent = status === "won" ? t("result.wonText", { gems: state.gems, total: state.maxGems }) : t("result.lostText");
  $("result-stars").innerHTML = status === "won" ? starsHtml(stars) : "";
  $("result-next").hidden = !(status === "won" && current.index + 1 < levels.length);
  setTimeout(() => { $("result").hidden = false; }, 900);
}

// --- Buttons and keys --------------------------------------------------------------------
$("wave-button").addEventListener("click", () => current?.game.startNextWave());
$("meteor-button").addEventListener("click", () => setTargeting(!targeting));
$("speed").addEventListener("click", () => {
  speedIndex = (speedIndex + 1) % SPEEDS.length;
  $("speed").textContent = `${SPEEDS[speedIndex]}×`;
});
$("pause").addEventListener("click", () => setPaused(!paused));
$("mute").addEventListener("click", () => setMuted(!sound.muted));
window.persephone?.page?.onMuteToggle?.(() => setMuted(!sound.muted));
document.addEventListener("click", (event) => { if (event.target.closest(".hud-button, .menu-button, .level-card, .action")) sound.play("click"); });
$("restart").addEventListener("click", () => current && startLevel(current.index));
$("levels").addEventListener("click", showMenu);
$("result-retry").addEventListener("click", () => startLevel(current.index));
$("result-next").addEventListener("click", () => startLevel(current.index + 1));
$("result-levels").addEventListener("click", showMenu);
canvas.addEventListener("pointerdown", (event) => { if (event.button === 2 && targeting) setTargeting(false); });
window.addEventListener("keydown", (event) => {
  if (!current) return;
  if (event.key === "Escape") { if (targeting) setTargeting(false); else select(null); }
  if (event.key === " ") { event.preventDefault(); setPaused(!paused); }
  if (event.key.toLowerCase() === "m") setMuted(!sound.muted);
});

function setPaused(on) {
  paused = on;
  $("paused").hidden = !paused;
  $("pause").classList.toggle("active", paused);
}

// Pause while the board's tab is not visible, so a game is never lost in the background.
if (window.persephone?.page?.onVisibilityChange) {
  persephone.page.onVisibilityChange((visible) => {
    hiddenPause = !visible;
    sound.setSuspended(!visible);
  });
}

// --- Frame loop --------------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(MAX_FRAME, (now - last) / 1000);
  last = now;
  if (hiddenPause) return;
  controls.update(dt);
  if (current) {
    const gameDt = paused ? 0 : dt * SPEEDS[speedIndex];
    if (gameDt) current.game.update(gameDt);
    current.world.update(dt);
    updateFloats(paused ? 0 : dt);
    placePopups();
  } else if (backdrop) {
    controls.state.yaw += dt * 0.08;
    backdrop.update(dt);
  }
  renderer.render(scene, camera);
}

async function boot() {
  translatePage();
  loadMonsters();   // in the background while the menu is up
  loadNature();
  loadTowers();
  resize();
  try {
    const [index, saved, soundPrefs, difficulty] = await Promise.all([loadLevelIndex(), readProgress(), readStored(SOUND_KEY), readStored(DIFFICULTY_KEY)]);
    levels = index; progress = saved;
    difficultyId = difficulty.id ?? null;
    setMuted(!!soundPrefs.muted, false);
  } catch (error) {
    $("menu-error").textContent = t("menu.loadError", { error: error.message });
    $("menu-error").hidden = false;
  }
  showMenu();
  requestAnimationFrame(frame);
}
boot();

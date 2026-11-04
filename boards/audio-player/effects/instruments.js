(() => {
  const GROUPS = ["kick", "hats", "bass", "vocals", "other"];
  const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  // Splash droplet sprites (lightning strikes): radius in pixels of the pre-rendered dot stamp.
  const STAMP_SIZE = 1.8;
  // 3D ocean (effects/ocean-gl.js). OCEAN_PITCH tilts the camera down (radians), which puts the horizon a little above the middle.
  // OCEAN_SCALE renders at a fraction of the canvas resolution; OCEAN_FADE is the distance at which the sea fades into the background.
  // Audio: the sea is built from wave bands (big swells -> fine chop), one per instrument group in OCEAN_BANDS order. A louder group
  // The water keeps its dark colour: OCEAN_TINT (group colours mixed into the water) is 0, and the sea is lit only by the note lights'
  // reflections (OCEAN_LIGHT_REFLECT) and lightning.
  // makes its band taller (OCEAN_BAND_GAIN) and faster (OCEAN_BAND_SPEED); kick hits add OCEAN_KICK_PULSE to the swell band.
  // Heights ease up over OCEAN_BAND_ATTACK and back over OCEAN_BAND_RELEASE seconds. OCEAN_DRAG_BASS lets bass make the waves choppier.
  // Currently only the kick moves the sea: the other bands' gains and speeds, and the bass drag, are 0 (they stay at their calm motion).
  const OCEAN_PITCH = .07, OCEAN_SCALE = .5, OCEAN_FADE = 60, OCEAN_AMP = .6, OCEAN_SPEED = .7, OCEAN_BAND_ATTACK = .08, OCEAN_BAND_RELEASE = .4, OCEAN_KICK_PULSE = .8;
  const OCEAN_BANDS = ["kick", "bass", "vocals", "other", "hats"], OCEAN_BAND_GAIN = [1.4, 0, 0, 0, 0], OCEAN_BAND_SPEED = [.8, 0, 0, 0, 0];
  const OCEAN_DRAG = .22, OCEAN_DRAG_BASS = 0, OCEAN_TINT = 0, OCEAN_LIGHT_REFLECT = 1.2, OCEAN_SKY_DARK = .35, OCEAN_SKY_LIGHT = 1;
  // Droplets splash up where lightning hits the sea.
  const SPLASH_SPEED = .1, SPLASH_GRAVITY = .7, SPLASH_LIFE = .5, SPLASH_SIZE = 1.1;
  const groupHue = (key) => GROUPS.indexOf(key) / (GROUPS.length - 1) * 270;
  function hueToRgb(hue) { const k = (n) => (n + hue / 30) % 12, f = (n) => .5 - .5 * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)); return [f(0), f(8), f(4)]; }
  const GROUP_RGB = GROUPS.map((key) => hueToRgb(groupHue(key)));
  // Sky (drawn by ocean-gl.js): a drifting 3D cloud deck with the 12 note lights shining behind it.
  // CLOUD_COVER: higher = fewer clouds (0.3 overcast .. 0.7 scattered). CLOUD_WIND: drift speed. Ambient = unlit cloud colour per theme.
  // Lights sit at random spots in the sky. A light that went dark (below LIGHT_OFF) moves to a new spot when its note returns,
  // picked as the best of LIGHT_TRIES candidates (farthest from the other lights). Area fractions: x across the width, y from the top
  // down to LIGHT_SKY_BOTTOM of the way to the horizon.
  const LIGHT_OFF = .05, LIGHT_TRIES = 12, LIGHT_X_MIN = .06, LIGHT_X_MAX = .94, LIGHT_Y_MIN = .06, LIGHT_SKY_BOTTOM = .8;
  // Underwater lights: one per instrument group (the original five bars, same colours and left-to-right order), brightness and size
  // following that group's volume. World units: DEEP_DEPTH below sea level, DEEP_DISTANCE ahead of the camera (alternate lights
  // DEEP_STAGGER further back), DEEP_SPREAD apart sideways. DEEP_GAIN scales their brightness.
  const DEEP_ORDER = ["kick", "hats", "bass", "vocals", "other"], DEEP_DEPTH = 1.8, DEEP_DISTANCE = 7, DEEP_STAGGER = 1.5, DEEP_SPREAD = 1.9, DEEP_GAIN = 1.2;
  const DEEP_POSITIONS = new Float32Array(DEEP_ORDER.flatMap((_, i) => [(i - (DEEP_ORDER.length - 1) / 2) * DEEP_SPREAD, -DEEP_DEPTH, DEEP_DISTANCE + (i % 2) * DEEP_STAGGER]));
  const CLOUD_COVER = .48, CLOUD_WIND = .025, CLOUD_AMBIENT_DARK = [.08, .09, .11], CLOUD_AMBIENT_LIGHT = [.82, .84, .88];
  // Lightning: on a detected kick, with LIGHTNING_CHANCE, a jagged bolt strikes from a loud cloud down to the distant sea, or across to another lit cloud.
  // Times in seconds; LIGHTNING_JAG is the sideways jitter as a fraction of each segment's length.
  const LIGHTNING_CHANCE = .3, LIGHTNING_COOLDOWN = .7, LIGHTNING_LIFE = .32, LIGHTNING_MIN_CLOUD = .3, LIGHTNING_JAG = .38, LIGHTNING_DEPTH = 6, LIGHTNING_BRANCHES = 2, LIGHTNING_FLASH = .07, LIGHTNING_SPLASH = 6, LIGHTNING_SEA_FLASH = .6;
  // Sea strikes land far away, just below the horizon (LIGHTNING_FAR_MIN..MAX of the way from the horizon to the bottom edge),
  // drawn thinner (LIGHTNING_FAR_WIDTH) with a smaller splash (LIGHTNING_FAR_SPLASH). With LIGHTNING_CLOUD_CHANCE a bolt
  // instead jumps between two lit sky lights; it lights the sea only by LIGHTNING_CLOUD_SEA_FLASH of a sea strike.
  const LIGHTNING_FAR_MIN = .005, LIGHTNING_FAR_MAX = .07, LIGHTNING_FAR_WIDTH = .6, LIGHTNING_FAR_SPLASH = .3, LIGHTNING_FAR_DRIFT = .08, LIGHTNING_CLOUD_CHANCE = .4, LIGHTNING_CLOUD_SEA_FLASH = .4, LIGHTNING_CLOUD_WIDTH = .75;
  function jaggedLine(x1, y1, x2, y2, depth) {
    let points = [[x1, y1], [x2, y2]];
    for (let level = 0; level < depth; level++) {
      const next = [points[0]];
      for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1], [bx, by] = points[i], dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy) || 1, offset = (Math.random() - .5) * length * LIGHTNING_JAG;
        next.push([(ax + bx) / 2 - dy / length * offset, (ay + by) / 2 + dx / length * offset], points[i]);
      }
      points = next;
    }
    return points;
  }
  const noteColor = (n, isDark) => isDark ? `hsl(${n * 30}, 100%, 62%)` : `hsl(${n * 30}, 85%, 48%)`;
  class InstrumentsEffect {
    constructor() { this.usesGroups = true; this.stamps = []; this.stampDark = null; this.lastDrawTime = 0; this.splashes = []; this.bolts = []; this.prevKick = 0; this.lastStrike = 0; this.ocean = window.AudioOceanGL?.create() || null; this.cloudTime = 0; this.deepColors = new Float32Array(DEEP_ORDER.length * 3); this.lightSpots = NOTES.map(() => null); this.lightLit = new Uint8Array(NOTES.length); this.lights = new Float32Array(NOTES.length * 3); this.lightColors = new Float32Array(NOTES.map((_, n) => hueToRgb(n * 30)).flat()); this.oceanPhases = new Float32Array(OCEAN_BANDS.length); this.oceanGains = new Float32Array(OCEAN_BANDS.length); }
    dispose() { this.ocean?.dispose(); this.ocean = null; this.bolts.length = 0; this.splashes.length = 0; this.stamps.length = 0; }
    draw(ctx, analyser, W, H, isDark, features) {
      const now = performance.now() / 1000, dt = this.lastDrawTime > 0 ? Math.min(now - this.lastDrawTime, .1) : 0; this.lastDrawTime = now;
      ctx.clearRect(0, 0, W, H);
      // Screen row of the horizon for the camera pitch (the shader's view ray uses a focal length of 1.5).
      const horizonY = H * (1 - 1.5 * Math.tan(OCEAN_PITCH)) / 2, seaY = () => horizonY + (H - horizonY) * (LIGHTNING_FAR_MIN + Math.random() * (LIGHTNING_FAR_MAX - LIGHTNING_FAR_MIN));
      // Light spots are kept as fractions of the canvas so a resize keeps them in place.
      const randomSpot = () => ({ x: LIGHT_X_MIN + Math.random() * (LIGHT_X_MAX - LIGHT_X_MIN), y: LIGHT_Y_MIN + Math.random() * (horizonY / H * LIGHT_SKY_BOTTOM - LIGHT_Y_MIN) });
      NOTES.forEach((_, n) => {
        const lit = (features?.notes?.[n] || 0) > LIGHT_OFF;
        if (!this.lightSpots[n] || (lit && !this.lightLit[n])) {
          let best = null, bestGap = -1;
          for (let t = 0; t < LIGHT_TRIES; t++) { const spot = randomSpot(); let gap = Infinity; this.lightSpots.forEach((other, m) => { if (other && m !== n) gap = Math.min(gap, Math.hypot((spot.x - other.x) * W, (spot.y - other.y) * H)); }); if (gap > bestGap) { bestGap = gap; best = spot; } }
          this.lightSpots[n] = best;
        }
        this.lightLit[n] = lit ? 1 : 0;
      });
      if (this.stampDark !== isDark) { this.stampDark = isDark; this.stamps = NOTES.map((_, n) => { const size = Math.ceil(STAMP_SIZE * 2 + 2), stamp = new OffscreenCanvas(size, size), sctx = stamp.getContext("2d"); sctx.fillStyle = noteColor(n, isDark); sctx.beginPath(); sctx.arc(size / 2, size / 2, STAMP_SIZE, 0, Math.PI * 2); sctx.fill(); return stamp; }); }
      // A kick onset is a jump in the beat detector's pulse; only some of them, and not too often, strike.
      const kick = features?.kick || 0, kickOnset = kick > this.prevKick + .25; this.prevKick = kick;
      if (kickOnset && now - this.lastStrike > LIGHTNING_COOLDOWN && Math.random() < LIGHTNING_CHANCE) {
        let total = 0; const loud = NOTES.map((_, n) => { const level = features?.notes?.[n] || 0; return level > LIGHTNING_MIN_CLOUD ? level : 0; }); loud.forEach((v) => { total += v; });
        if (total > 0) {
          let pick = Math.random() * total, n = 0; while (n < NOTES.length - 1 && (pick > loud[n] || !loud[n])) { pick -= loud[n]; n++; }
          // A cloud-to-cloud bolt needs a second lit light; the other loud clouds are preferred.
          const lit = NOTES.map((_, m) => m !== n && (features?.notes?.[m] || 0) > LIGHT_OFF ? m : -1).filter((m) => m >= 0), louder = lit.filter((m) => loud[m] > 0), pool = louder.length ? louder : lit;
          const toCloud = pool.length > 0 && Math.random() < LIGHTNING_CLOUD_CHANCE, target = toCloud ? pool[Math.floor(Math.random() * pool.length)] : -1;
          const x1 = this.lightSpots[n].x * W, y1 = this.lightSpots[n].y * H;
          const x2 = toCloud ? this.lightSpots[target].x * W : x1 + (Math.random() - .5) * W * LIGHTNING_FAR_DRIFT, y2 = toCloud ? this.lightSpots[target].y * H : seaY();
          const main = jaggedLine(x1, y1, x2, y2, LIGHTNING_DEPTH), paths = [main], length = Math.hypot(x2 - x1, y2 - y1), heading = Math.atan2(y2 - y1, x2 - x1);
          // Branches fork off the main channel within 60 degrees of its heading.
          for (let b = 0; b < LIGHTNING_BRANCHES; b++) { const [bx, by] = main[Math.floor(main.length * (.2 + Math.random() * .5))], reach = length * (.2 + Math.random() * .25), angle = heading + (Math.random() - .5) * Math.PI * 2 / 3; paths.push(jaggedLine(bx, by, bx + Math.cos(angle) * reach, by + Math.sin(angle) * reach, LIGHTNING_DEPTH - 2)); }
          this.bolts.push({ note: n, paths, t: now, width: toCloud ? LIGHTNING_CLOUD_WIDTH : LIGHTNING_FAR_WIDTH, seaFlash: toCloud ? LIGHTNING_CLOUD_SEA_FLASH : 1 }); this.lastStrike = now;
          if (!toCloud) for (let s = 0; s < LIGHTNING_SPLASH; s++) this.splashes.push({ note: n, x: x2, y: y2, vx: (Math.random() - .5) * SPLASH_SPEED * H * 2 * LIGHTNING_FAR_SPLASH, vy: -SPLASH_SPEED * H * (.6 + Math.random()) * LIGHTNING_FAR_SPLASH, gravity: LIGHTNING_FAR_SPLASH, size: LIGHTNING_FAR_SPLASH * 2, age: 0 });
        }
      }
      // Ocean: render the shader at reduced resolution and stretch it over the canvas; the sky part is transparent.
      if (this.ocean) {
        const groups = features?.groups || {}, level = (key) => groups[key] || 0, tint = [0, 0, 0], flash = [0, 0, 0];
        GROUPS.forEach((key, i) => { for (let c = 0; c < 3; c++) tint[c] += GROUP_RGB[i][c] * level(key) * OCEAN_TINT; });
        for (const bolt of this.bolts) { const fade = Math.max(0, 1 - (now - bolt.t) / LIGHTNING_LIFE), rgb = hueToRgb(bolt.note * 30); for (let c = 0; c < 3; c++) flash[c] += (.5 + rgb[c] * .5) * fade * LIGHTNING_SEA_FLASH * bolt.seaFlash; }
        OCEAN_BANDS.forEach((key, b) => {
          this.oceanPhases[b] += dt * OCEAN_SPEED * (1 + level(key) * OCEAN_BAND_SPEED[b]);
          const target = level(key) * OCEAN_BAND_GAIN[b] + (b === 0 ? kick * OCEAN_KICK_PULSE : 0), current = this.oceanGains[b];
          if (dt > 0) this.oceanGains[b] += (target - current) * (1 - Math.exp(-dt / (target > current ? OCEAN_BAND_ATTACK : OCEAN_BAND_RELEASE)));
        });
        this.cloudTime += dt * CLOUD_WIND;
        DEEP_ORDER.forEach((key, i) => { const rgb = GROUP_RGB[GROUPS.indexOf(key)]; for (let c = 0; c < 3; c++) this.deepColors[i * 3 + c] = rgb[c] * level(key) * DEEP_GAIN; });
        NOTES.forEach((_, n) => { this.lights[n * 3] = (this.lightSpots[n].x * 2 - 1) * (W / H); this.lights[n * 3 + 1] = 1 - 2 * this.lightSpots[n].y; this.lights[n * 3 + 2] = features?.notes?.[n] || 0; });
        const image = this.ocean.render(Math.max(1, Math.round(W * OCEAN_SCALE)), Math.max(1, Math.round(H * OCEAN_SCALE)), {
          gains: this.oceanGains, phases: this.oceanPhases, amp: OCEAN_AMP, drag: OCEAN_DRAG + level("bass") * OCEAN_DRAG_BASS,
          pitch: OCEAN_PITCH, sky: isDark ? OCEAN_SKY_DARK : OCEAN_SKY_LIGHT, fade: OCEAN_FADE, tint, flash,
          lights: this.lights, lightColors: this.lightColors, cloudWind: [this.cloudTime, this.cloudTime * .35], cloudCover: CLOUD_COVER, cloudAmbient: isDark ? CLOUD_AMBIENT_DARK : CLOUD_AMBIENT_LIGHT, lightSea: OCEAN_LIGHT_REFLECT, deepPositions: DEEP_POSITIONS, deepColors: this.deepColors,
        });
        ctx.drawImage(image, 0, 0, W, H);
      }
      for (let j = this.splashes.length - 1; j >= 0; j--) {
        const p = this.splashes[j]; p.vy += SPLASH_GRAVITY * H * (p.gravity ?? 1) * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.age += dt;
        if (p.age > SPLASH_LIFE) { this.splashes[j] = this.splashes[this.splashes.length - 1]; this.splashes.pop(); continue; }
        const stamp = this.stamps[p.note], size = stamp.width * SPLASH_SIZE * (p.size ?? 1) / STAMP_SIZE; ctx.globalAlpha = (1 - p.age / SPLASH_LIFE) * .9; ctx.drawImage(stamp, p.x - size / 2, p.y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      // Bolts flicker and fade over LIGHTNING_LIFE: a coloured glow under a white core, plus a faint full-canvas flash.
      for (let j = this.bolts.length - 1; j >= 0; j--) {
        const bolt = this.bolts[j], fade = 1 - (now - bolt.t) / LIGHTNING_LIFE; if (fade <= 0) { this.bolts.splice(j, 1); continue; }
        const flicker = fade * (.55 + Math.random() * .45), color = noteColor(bolt.note, isDark);
        ctx.save(); ctx.globalAlpha = LIGHTNING_FLASH * fade; ctx.fillStyle = isDark ? "#fff" : color; ctx.fillRect(0, 0, W, H);
        ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.shadowColor = color; ctx.shadowBlur = 18 * bolt.width;
        bolt.paths.forEach((points, index) => {
          ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]); for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
          ctx.globalAlpha = flicker * (index ? .6 : 1); ctx.strokeStyle = color; ctx.lineWidth = (index ? 2.5 : 4) * bolt.width; ctx.stroke();
          ctx.strokeStyle = isDark ? "#fff" : "rgba(255, 255, 255, .9)"; ctx.lineWidth = Math.max(.7, (index ? 1 : 1.6) * bolt.width); ctx.stroke();
        });
        ctx.restore();
      }
    }
  }
  window.AudioInstrumentsEffect = InstrumentsEffect;
})();

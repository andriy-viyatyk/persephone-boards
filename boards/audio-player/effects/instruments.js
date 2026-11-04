(() => {
  const GROUPS = ["kick", "hats", "bass", "vocals", "other"];
  const NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  // Note "rain": a dot louder than RAIN_MIN emits drops of its colour that fall into the waves.
  // Rates are drops per second; speeds and gravity are fractions of the canvas height per second.
  const RAIN_MIN = .55, RAIN_MAX_RATE = 30, RAIN_START_SPEED = .05, RAIN_GRAVITY = .35, RAIN_DRIFT = .03, RAIN_SIZE = 1.8, RAIN_MAX_AGE = 4, RAIN_MAX_DROPS = 1500;
  // Ocean waves: layer order far -> near; positions and heights are fractions of the canvas height, speeds in radians per second.
  const WAVE_ORDER = ["other", "vocals", "hats", "bass", "kick"];
  const WAVE_TOP = .6, WAVE_LAYER_GAP = .07, WAVE_RISE = .12, WAVE_CALM = .012, WAVE_SWELL = .05, WAVE_SPEED = .8, WAVE_SPEED_BOOST = 1.5, WAVE_STEP = 8, WAVE_SHADE_DEPTH = .8;
  // Drop impacts: a ripple packet runs outward along the wave surface and fades, and a few droplets splash up.
  // Ripple sizes are fractions of the canvas height (amplitude) or width (speed, wavelength, packet width); times in seconds.
  const RIPPLE_AMP = .003, RIPPLE_SPEED = .12, RIPPLE_WAVELENGTH = .012, RIPPLE_WIDTH = .025, RIPPLE_DECAY = .45, RIPPLE_LIFE = 1.4, RIPPLE_MAX = 40;
  const SPLASH_COUNT = 3, SPLASH_SPEED = .1, SPLASH_GRAVITY = .7, SPLASH_LIFE = .5, SPLASH_SIZE = 1.1;
  const groupHue = (key) => GROUPS.indexOf(key) / (GROUPS.length - 1) * 270;
  // Each note's drops land on the wave whose colour is nearest to the note's colour (hue distance around the wheel).
  const NOTE_LAYER = NOTES.map((_, n) => { let best = 0, bestDistance = Infinity; WAVE_ORDER.forEach((key, layer) => { const raw = Math.abs(n * 30 - groupHue(key)), distance = Math.min(raw, 360 - raw); if (distance < bestDistance) { bestDistance = distance; best = layer; } }); return best; });
  // Cloud outline as overlapping puffs over a flat base, in units of the cloud's radius: [x, y, radius].
  const CLOUD_PUFFS = [[-.55, .12, .42], [-.12, -.22, .58], [.38, -.05, .48], [.72, .2, .32], [-.78, .3, .26]];
  function cloudPath(ctx, x, y, r) {
    ctx.beginPath();
    for (const [px, py, pr] of CLOUD_PUFFS) { ctx.moveTo(x + (px + pr) * r, y + py * r); ctx.arc(x + px * r, y + py * r, pr * r, 0, Math.PI * 2); }
    ctx.rect(x - .78 * r, y + .1 * r, 1.5 * r, .42 * r);
  }
  // Lightning: on a detected kick, with LIGHTNING_CHANCE, a jagged bolt strikes from a loud cloud down to that note's wave.
  // Times in seconds; LIGHTNING_JAG is the sideways jitter as a fraction of each segment's length.
  const LIGHTNING_CHANCE = .3, LIGHTNING_COOLDOWN = .7, LIGHTNING_LIFE = .32, LIGHTNING_MIN_CLOUD = .3, LIGHTNING_JAG = .38, LIGHTNING_DEPTH = 6, LIGHTNING_BRANCHES = 2, LIGHTNING_FLASH = .07, LIGHTNING_SPLASH = 10;
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
    constructor() { this.usesGroups = true; this.drops = []; this.rainAccum = new Float32Array(NOTES.length); this.stamps = []; this.stampDark = null; this.lastDrawTime = 0; this.wavePhase = new Float32Array(WAVE_ORDER.length); this.ripples = WAVE_ORDER.map(() => []); this.splashes = []; this.bolts = []; this.prevKick = 0; this.lastStrike = 0; }
    dispose() { this.bolts.length = 0; this.drops.length = 0; this.splashes.length = 0; this.ripples.forEach((list) => { list.length = 0; }); this.stamps.length = 0; }
    draw(ctx, analyser, W, H, isDark, features) {
      const now = performance.now() / 1000, dt = this.lastDrawTime > 0 ? Math.min(now - this.lastDrawTime, .1) : 0; this.lastDrawTime = now;
      ctx.clearRect(0, 0, W, H);
      const width = Math.min(W * .8, H * 1.2), left = (W - width) / 2;
      const noteSlot = width / NOTES.length, maxRadius = Math.min(noteSlot * .42, H * .07), minRadius = maxRadius * .12, dotY = H * .05 + maxRadius;
      if (this.stampDark !== isDark) { this.stampDark = isDark; this.stamps = NOTES.map((_, n) => { const size = Math.ceil(RAIN_SIZE * 2 + 2), stamp = new OffscreenCanvas(size, size), sctx = stamp.getContext("2d"); sctx.fillStyle = noteColor(n, isDark); sctx.beginPath(); sctx.arc(size / 2, size / 2, RAIN_SIZE, 0, Math.PI * 2); sctx.fill(); return stamp; }); }
      // Advance and shape the waves first: drops need each wave's surface to know where they land.
      const waves = WAVE_ORDER.map((key, layer) => {
        const level = features?.groups?.[key] || 0;
        this.wavePhase[layer] += dt * WAVE_SPEED * (1 + layer * .35) * (1 + level * WAVE_SPEED_BOOST);
        const ripples = this.ripples[layer]; while (ripples.length && now - ripples[0].t > RIPPLE_LIFE) ripples.shift();
        return { hue: groupHue(key), layer, ripples, baseY: H * (WAVE_TOP + layer * WAVE_LAYER_GAP) - level * WAVE_RISE * H, amp: H * (WAVE_CALM + level * WAVE_SWELL), k: Math.PI * 2 / (W * (.55 + (WAVE_ORDER.length - layer) * .12)), phase: this.wavePhase[layer], dir: layer % 2 ? -1 : 1 };
      });
      const rippleK = Math.PI * 2 / (RIPPLE_WAVELENGTH * W), rippleSigma = RIPPLE_WIDTH * W, rippleSpeed = RIPPLE_SPEED * W, rippleAmp = RIPPLE_AMP * H;
      const surfaceY = (w, x) => {
        let y = w.baseY + w.amp * (Math.sin(w.k * x + w.dir * w.phase + w.layer) * .7 + Math.sin(w.k * 2.3 * x - w.dir * w.phase * 1.6 + w.layer * 2) * .3);
        for (const r of w.ripples) { const age = now - r.t, front = Math.abs(x - r.x) - rippleSpeed * age, envelope = Math.exp(-age / RIPPLE_DECAY - (front / rippleSigma) ** 2); if (envelope > .01) y += rippleAmp * envelope * Math.cos(rippleK * front); }
        return y;
      };
      // Emit from loud notes, then move and draw every drop first, so the waves and dots paint over the rain. A drop ends on its own wave's surface.
      NOTES.forEach((_, n) => {
        const level = features?.notes?.[n] || 0; if (level <= RAIN_MIN) { this.rainAccum[n] = 0; return; }
        const strength = (level - RAIN_MIN) / (1 - RAIN_MIN), radius = minRadius + level * (maxRadius - minRadius), x = left + (n + .5) * noteSlot;
        this.rainAccum[n] += strength * RAIN_MAX_RATE * dt;
        while (this.rainAccum[n] >= 1 && this.drops.length < RAIN_MAX_DROPS) { this.rainAccum[n] -= 1; this.drops.push({ note: n, x: x + (Math.random() - .5) * radius * 1.4, y: dotY + radius * .6, vx: (Math.random() - .5) * RAIN_DRIFT * H, vy: RAIN_START_SPEED * H * (.5 + Math.random()), age: 0 }); }
        if (this.rainAccum[n] >= 1) this.rainAccum[n] = 0;
      });
      for (let j = this.drops.length - 1; j >= 0; j--) {
        const d = this.drops[j]; d.vy += RAIN_GRAVITY * H * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.age += dt;
        const wave = waves[NOTE_LAYER[d.note]], surface = surfaceY(wave, d.x);
        if (d.y >= surface) {
          if (wave.ripples.length >= RIPPLE_MAX) wave.ripples.shift(); wave.ripples.push({ x: d.x, t: now });
          for (let s = 0; s < SPLASH_COUNT; s++) this.splashes.push({ note: d.note, x: d.x, y: surface, vx: (Math.random() - .5) * SPLASH_SPEED * H, vy: -SPLASH_SPEED * H * (.4 + Math.random() * .6), age: 0 });
        }
        if (d.y >= surface || d.age > RAIN_MAX_AGE) { this.drops[j] = this.drops[this.drops.length - 1]; this.drops.pop(); continue; }
        const stamp = this.stamps[d.note], half = stamp.width / 2; ctx.globalAlpha = Math.max(0, 1 - d.age / RAIN_MAX_AGE) * .85; ctx.drawImage(stamp, d.x - half, d.y - half);
      }
      for (let j = this.splashes.length - 1; j >= 0; j--) {
        const p = this.splashes[j]; p.vy += SPLASH_GRAVITY * H * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.age += dt;
        if (p.age > SPLASH_LIFE) { this.splashes[j] = this.splashes[this.splashes.length - 1]; this.splashes.pop(); continue; }
        const stamp = this.stamps[p.note], size = stamp.width * SPLASH_SIZE / RAIN_SIZE; ctx.globalAlpha = (1 - p.age / SPLASH_LIFE) * .9; ctx.drawImage(stamp, p.x - size / 2, p.y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      // A kick onset is a jump in the beat detector's pulse; only some of them, and not too often, strike.
      const kick = features?.kick || 0, kickOnset = kick > this.prevKick + .25; this.prevKick = kick;
      if (kickOnset && now - this.lastStrike > LIGHTNING_COOLDOWN && Math.random() < LIGHTNING_CHANCE) {
        let total = 0; const loud = NOTES.map((_, n) => { const level = features?.notes?.[n] || 0; return level > LIGHTNING_MIN_CLOUD ? level : 0; }); loud.forEach((v) => { total += v; });
        if (total > 0) {
          let pick = Math.random() * total, n = 0; while (n < NOTES.length - 1 && (pick > loud[n] || !loud[n])) { pick -= loud[n]; n++; }
          const radius = minRadius + loud[n] * (maxRadius - minRadius), x1 = left + (n + .5) * noteSlot, y1 = dotY + radius * .4, x2 = x1 + (Math.random() - .5) * W * .18, y2 = surfaceY(waves[NOTE_LAYER[n]], x2);
          const main = jaggedLine(x1, y1, x2, y2, LIGHTNING_DEPTH), paths = [main];
          for (let b = 0; b < LIGHTNING_BRANCHES; b++) { const [bx, by] = main[Math.floor(main.length * (.2 + Math.random() * .5))], reach = (y2 - y1) * (.2 + Math.random() * .25); paths.push(jaggedLine(bx, by, bx + (Math.random() - .5) * reach * 1.2, by + reach, LIGHTNING_DEPTH - 2)); }
          this.bolts.push({ note: n, paths, t: now }); this.lastStrike = now;
          for (let s = 0; s < LIGHTNING_SPLASH; s++) this.splashes.push({ note: n, x: x2, y: y2, vx: (Math.random() - .5) * SPLASH_SPEED * H * 2, vy: -SPLASH_SPEED * H * (.6 + Math.random()), age: 0 });
        }
      }
      // Ocean: one wave layer per group, far (high on screen) to near (low). Louder groups lift their wave and raise its swell.
      waves.forEach((wave) => {
        const { hue, baseY, amp } = wave;
        // Opaque at the crest, fading to transparent at the bottom of the strip this layer shows.
        const depth = Math.min(H, baseY + amp + H * (WAVE_LAYER_GAP + WAVE_RISE) * WAVE_SHADE_DEPTH), fill = ctx.createLinearGradient(0, baseY - amp, 0, depth);
        fill.addColorStop(0, isDark ? `hsla(${hue}, 100%, 65%, .95)` : `hsla(${hue}, 90%, 50%, .95)`); fill.addColorStop(.12, isDark ? `hsla(${hue}, 100%, 60%, .4)` : `hsla(${hue}, 90%, 50%, .4)`); fill.addColorStop(.45, `hsla(${hue}, 100%, 60%, .08)`); fill.addColorStop(1, `hsla(${hue}, 100%, 60%, 0)`);
        ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(0, H);
        for (let x = 0; x <= W + WAVE_STEP; x += WAVE_STEP) ctx.lineTo(x, surfaceY(wave, x));
        ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      });
      // Bolts flicker and fade over LIGHTNING_LIFE: a coloured glow under a white core, plus a faint full-canvas flash.
      for (let j = this.bolts.length - 1; j >= 0; j--) {
        const bolt = this.bolts[j], fade = 1 - (now - bolt.t) / LIGHTNING_LIFE; if (fade <= 0) { this.bolts.splice(j, 1); continue; }
        const flicker = fade * (.55 + Math.random() * .45), color = noteColor(bolt.note, isDark);
        ctx.save(); ctx.globalAlpha = LIGHTNING_FLASH * fade; ctx.fillStyle = isDark ? "#fff" : color; ctx.fillRect(0, 0, W, H);
        ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.shadowColor = color; ctx.shadowBlur = 18;
        bolt.paths.forEach((points, index) => {
          ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]); for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
          ctx.globalAlpha = flicker * (index ? .6 : 1); ctx.strokeStyle = color; ctx.lineWidth = index ? 2.5 : 4; ctx.stroke();
          ctx.strokeStyle = isDark ? "#fff" : "rgba(255, 255, 255, .9)"; ctx.lineWidth = index ? 1 : 1.6; ctx.stroke();
        });
        ctx.restore();
      }
      // One cloud per note (C … B) across the top: size and glow grow with that note's volume.
      NOTES.forEach((_, n) => {
        const level = features?.notes?.[n] || 0, x = left + (n + .5) * noteSlot, color = noteColor(n, isDark);
        ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = level * maxRadius * 1.6; ctx.globalAlpha = .35 + level * .65;
        ctx.fillStyle = color; cloudPath(ctx, x, dotY, minRadius + level * (maxRadius - minRadius)); ctx.fill(); ctx.restore();
      });
    }
  }
  window.AudioInstrumentsEffect = InstrumentsEffect;
})();

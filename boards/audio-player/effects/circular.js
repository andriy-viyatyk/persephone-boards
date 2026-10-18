(() => {
  const BANDS = [
    { startFrac: 0, endFrac: .06, darkRgb: "70, 15, 7", lightRgb: "180, 40, 10", darkSparkRgb: "240, 225, 220", lightSparkRgb: "210, 170, 155", sparkMin: .75, sparkMax: .85, sparkSize: 1, baseR: 0, rotSpeed: .003, segments: 16, modSource: 2, expansionScale: 1 },
    { startFrac: .06, endFrac: .28, darkRgb: "12, 60, 16", lightRgb: "10, 140, 30", darkSparkRgb: "220, 240, 225", lightSparkRgb: "155, 210, 170", sparkMin: .5, sparkMax: .6, sparkSize: 2, baseR: .44, rotSpeed: -.00143, segments: 24, modSource: 0, expansionScale: .7 },
    { startFrac: .28, endFrac: .65, darkRgb: "15, 32, 70", lightRgb: "20, 60, 180", darkSparkRgb: "220, 225, 240", lightSparkRgb: "155, 170, 210", sparkMin: .3, sparkMax: .4, sparkSize: 3, baseR: .74, rotSpeed: .0009375, segments: 32, modSource: 1, expansionScale: .5 },
  ];
  const MAX_SPIKE_FRAC = .11, EXPANSION = .3, SAMPLES_PER_SEG = 8, MOD_STRENGTH = .6, GLOW_WIDTH = 14, GLOW_PAD = Math.ceil(GLOW_WIDTH / 2) + 2;
  const SPARK_SPEED = .12, SPARK_MIN_RATE = 1, SPARK_MAX_RATE = 15, SPARK_MAX_AGE = 10, MOD_SAMPLES = 64, SEG_PTS = SAMPLES_PER_SEG + 1;
  const REORDER = (() => { const map = new Uint8Array(SAMPLES_PER_SEG), center = SAMPLES_PER_SEG >> 1; let s = 0; map[center] = s++; for (let off = 1; s < SAMPLES_PER_SEG; off++) { if (center - off >= 0) map[center - off] = s++; if (center + off < SAMPLES_PER_SEG && s < SAMPLES_PER_SEG) map[center + off] = s++; } return map; })();
  class CircularEffect {
    constructor() { this.data = new Uint8Array(0); this.smoothedEnergy = new Float32Array(BANDS.length); this.smoothedBins = Array.from({ length: BANDS.length }, () => new Float32Array(SAMPLES_PER_SEG)); this.modBins = Array.from({ length: BANDS.length }, () => new Float32Array(MOD_SAMPLES)); this.rotations = new Float32Array(BANDS.length); this.oc = null; this.ocW = 0; this.ocH = 0; this.sparks = []; this.sparkAccum = new Float32Array(BANDS.length); this.lastDrawTime = 0; this.sparkStamps = []; this.sparkStampDark = false; this.segOX = new Float32Array(SEG_PTS); this.segOY = new Float32Array(SEG_PTS); this.segIX = new Float32Array(SEG_PTS); this.segIY = new Float32Array(SEG_PTS); }
    dispose() { this.oc = null; this.octx = null; this.sparks.length = 0; this.sparkStamps.length = 0; }
    draw(ctx, analyser, W, H, isDark) {
      if (this.data.length !== analyser.frequencyBinCount) this.data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(this.data);
      const now = performance.now() / 1000, dt = this.lastDrawTime > 0 ? Math.min(now - this.lastDrawTime, .1) : 0; this.lastDrawTime = now;
      ctx.globalCompositeOperation = "destination-out"; ctx.fillStyle = "rgba(0, 0, 0, 0.28)"; ctx.fillRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2, unit = Math.min(W, H) / 2, binCount = this.data.length;
      for (let i = 0; i < BANDS.length; i++) {
        const { startFrac, endFrac } = BANDS[i], binStart = Math.round(startFrac * binCount), binEnd = Math.max(binStart + 1, Math.round(endFrac * binCount)), bandRange = binEnd - binStart;
        let sum = 0; for (let b = binStart; b < binEnd; b++) sum += this.data[b];
        this.smoothedEnergy[i] = this.smoothedEnergy[i] * .62 + (sum / bandRange / 255) * .38;
        for (let s = 0; s < SAMPLES_PER_SEG; s++) { const exact = binStart + (s / SAMPLES_PER_SEG) * (bandRange - 1), lo = Math.floor(exact), hi = Math.min(lo + 1, binEnd - 1), raw = (this.data[lo] * (1 - (exact - lo)) + this.data[hi] * (exact - lo)) / 255; this.smoothedBins[i][s] = this.smoothedBins[i][s] * .6 + raw * .4; }
        for (let s = 0; s < MOD_SAMPLES; s++) { const exact = binStart + (s / MOD_SAMPLES) * (bandRange - 1), lo = Math.floor(exact), hi = Math.min(lo + 1, binEnd - 1), raw = (this.data[lo] * (1 - (exact - lo)) + this.data[hi] * (exact - lo)) / 255; this.modBins[i][s] = this.modBins[i][s] * .55 + raw * .45; }
      }
      const maxR = unit * (.74 + .30 + .11 * 1.5) + GLOW_PAD, maxSeg = Math.PI * 2 / 16, needW = Math.ceil(maxR) + GLOW_PAD * 2, needH = Math.ceil(maxR * Math.sin(maxSeg)) + GLOW_PAD * 2;
      if (!this.oc || this.ocW < needW || this.ocH < needH) { this.ocW = needW; this.ocH = needH; this.oc = new OffscreenCanvas(needW, needH); this.octx = this.oc.getContext("2d"); }
      if (this.sparkStamps.length !== BANDS.length || this.sparkStampDark !== isDark) { this.sparkStampDark = isDark; for (let i = 0; i < BANDS.length; i++) { const r = BANDS[i].sparkSize, sz = r * 2 + 4, half = sz / 2, sc = new OffscreenCanvas(sz, sz), sctx = sc.getContext("2d"); sctx.fillStyle = `rgb(${isDark ? BANDS[i].darkSparkRgb : BANDS[i].lightSparkRgb})`; sctx.beginPath(); sctx.arc(half, half, r, 0, Math.PI * 2); sctx.fill(); this.sparkStamps[i] = sc; } }
      ctx.globalCompositeOperation = "source-over";
      for (let j = this.sparks.length - 1; j >= 0; j--) { const s = this.sparks[j]; s.x += s.vx * dt; s.y += s.vy * dt; s.age += dt; if (s.x < -20 || s.x > W + 20 || s.y < -20 || s.y > H + 20 || s.age > SPARK_MAX_AGE) { this.sparks[j] = this.sparks[this.sparks.length - 1]; this.sparks.pop(); continue; } const stamp = this.sparkStamps[s.bandIdx], half = stamp.width / 2; ctx.globalAlpha = Math.max(0, 1 - s.age / SPARK_MAX_AGE); ctx.drawImage(stamp, s.x - half, s.y - half); }
      ctx.globalCompositeOperation = isDark ? "lighter" : "multiply";
      for (let i = 0; i < BANDS.length; i++) {
        const band = BANDS[i], energy = this.smoothedEnergy[i], ringR = unit * (band.baseR + energy * energy * EXPANSION * band.expansionScale), maxSpike = unit * MAX_SPIKE_FRAC, segments = band.segments, segAngle = Math.PI * 2 / segments, baseAlpha = .20 + energy * .80, color = `rgb(${isDark ? band.darkRgb : band.lightRgb})`;
        let sparkRate = 0; if (energy > band.sparkMin) { const sparkEnergy = Math.max(0, energy - band.sparkMax) / (1 - band.sparkMax); sparkRate = SPARK_MIN_RATE + sparkEnergy * sparkEnergy * (SPARK_MAX_RATE - SPARK_MIN_RATE); }
        this.sparkAccum[i] += sparkRate * dt;
        while (this.sparkAccum[i] >= 1) { this.sparkAccum[i] -= 1; const a = Math.random() * Math.PI * 2, speed = unit * SPARK_SPEED; this.sparks.push({ x: cx + Math.cos(a) * ringR, y: cy + Math.sin(a) * ringR, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, bandIdx: i, age: 0 }); }
        const ox = GLOW_PAD, oy = GLOW_PAD;
        for (let s = 0; s < SEG_PTS; s++) { const angle = (s / SAMPLES_PER_SEG) * segAngle, segIdx = REORDER[s % SAMPLES_PER_SEG], amp = Math.pow(this.smoothedBins[i][segIdx], 1.8) * maxSpike, c = Math.cos(angle), sn = Math.sin(angle); this.segOX[s] = ox + c * (ringR + amp); this.segOY[s] = oy + sn * (ringR + amp); this.segIX[s] = ox + c * (ringR - amp * .5); this.segIY[s] = oy + sn * (ringR - amp * .5); }
        const oc = this.octx; oc.clearRect(0, 0, this.ocW, this.ocH); oc.globalAlpha = baseAlpha * .20; oc.strokeStyle = color; oc.lineWidth = GLOW_WIDTH; oc.lineJoin = "round"; oc.lineCap = "round"; oc.beginPath(); oc.moveTo(this.segOX[0], this.segOY[0]); for (let s = 1; s < SEG_PTS; s++) oc.lineTo(this.segOX[s], this.segOY[s]); oc.stroke();
        oc.globalAlpha = baseAlpha * .90; oc.fillStyle = color; oc.beginPath(); oc.moveTo(this.segOX[0], this.segOY[0]); for (let s = 1; s < SEG_PTS; s++) oc.lineTo(this.segOX[s], this.segOY[s]); oc.lineTo(this.segIX[SEG_PTS - 1], this.segIY[SEG_PTS - 1]); for (let s = SEG_PTS - 2; s >= 0; s--) oc.lineTo(this.segIX[s], this.segIY[s]); oc.closePath(); oc.fill();
        let peakAmp = 0; oc.beginPath(); for (let s = 0; s < SAMPLES_PER_SEG; s++) { const segIdx = REORDER[s], amp = Math.pow(this.smoothedBins[i][segIdx], 1.8); if (amp < .05) continue; peakAmp = Math.max(peakAmp, amp); const angle = (s / SAMPLES_PER_SEG) * segAngle, spikeLen = amp * maxSpike * 1.5, c = Math.cos(angle), sn = Math.sin(angle); oc.moveTo(ox + c * ringR, oy + sn * ringR); oc.lineTo(ox + c * (ringR + spikeLen), oy + sn * (ringR + spikeLen)); oc.moveTo(ox + c * ringR, oy + sn * ringR); oc.lineTo(ox + c * (ringR - spikeLen * .5), oy + sn * (ringR - spikeLen * .5)); }
        if (peakAmp > 0) { oc.globalAlpha = baseAlpha * (.5 + peakAmp * .5); oc.strokeStyle = isDark ? `rgba(255, 255, 255, ${.6 + peakAmp * .4})` : `rgba(0, 0, 0, ${.6 + peakAmp * .4})`; oc.lineWidth = 1 + peakAmp * 2; oc.lineCap = "round"; oc.stroke(); }
        const modSrc = this.modBins[band.modSource];
        for (let seg = 0; seg < segments; seg++) { const angle = seg * segAngle + this.rotations[i], modFrac = (seg + .5) / segments, modIdx = Math.round(modFrac * (MOD_SAMPLES - 1)), mod = 1 - MOD_STRENGTH + modSrc[modIdx] * MOD_STRENGTH; ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle); ctx.globalAlpha = mod; ctx.drawImage(this.oc, -ox, -oy); ctx.restore(); }
      }
      for (let i = 0; i < BANDS.length; i++) this.rotations[i] += BANDS[i].rotSpeed;
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    }
  }
  window.AudioCircularEffect = CircularEffect;
})();

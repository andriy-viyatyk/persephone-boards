(() => {
  const BAR_COUNT = 48, BAR_GAP = 3, PARTICLE_H = 3, PARTICLE_SPEED = 45;
  const PARTICLE_MAX_AGE = 3, EMIT_THRESHOLD = 0.70, EMIT_RATE = 1.5;
  function colors(i, dark) {
    const hue = (i / (BAR_COUNT - 1)) * 270;
    return dark ? [`hsl(${hue}, 90%, 15%)`, `hsl(${hue}, 100%, 60%)`]
      : [`hsl(${hue}, 80%, 30%)`, `hsl(${hue}, 90%, 50%)`];
  }
  class BarsEffect {
    constructor() { this.data = new Uint8Array(0); this.particles = []; this.emitAccum = new Float32Array(BAR_COUNT); this.lastTime = 0; this.stamps = []; this.stampDark = false; this.stampBarWidth = 0; }
    dispose() { this.particles.length = 0; this.stamps.length = 0; }
    draw(ctx, analyser, W, H, isDark) {
      if (this.data.length !== analyser.frequencyBinCount) this.data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(this.data); ctx.clearRect(0, 0, W, H);
      const now = performance.now() / 1000, dt = this.lastTime > 0 ? Math.min(now - this.lastTime, 0.1) : 0; this.lastTime = now;
      const unit = Math.min(W, H) / 2, drawW = unit * 2, drawH = unit * 2, drawX = W / 2 - unit, cy = H / 2;
      const barWidth = (drawW - BAR_GAP * (BAR_COUNT - 1)) / BAR_COUNT;
      if (barWidth !== this.stampBarWidth || isDark !== this.stampDark) {
        this.stampBarWidth = barWidth; this.stampDark = isDark; const sw = Math.max(1, Math.ceil(barWidth));
        for (let i = 0; i < BAR_COUNT; i++) { const sc = new OffscreenCanvas(sw, PARTICLE_H), sctx = sc.getContext("2d"), [edge, hi] = colors(i, isDark), grad = sctx.createLinearGradient(0, 0, sw, 0); grad.addColorStop(0, edge); grad.addColorStop(.45, hi); grad.addColorStop(1, edge); sctx.fillStyle = grad; sctx.beginPath(); sctx.roundRect(0, 0, sw, PARTICLE_H, 2); sctx.fill(); this.stamps[i] = sc; }
      }
      for (let j = this.particles.length - 1; j >= 0; j--) { const p = this.particles[j]; p.y += p.vy * dt; p.age += dt; if (p.age > PARTICLE_MAX_AGE) { this.particles[j] = this.particles[this.particles.length - 1]; this.particles.pop(); continue; } ctx.globalAlpha = Math.max(0, 1 - p.age / PARTICLE_MAX_AGE); ctx.drawImage(this.stamps[p.barIdx], p.x, p.y - PARTICLE_H / 2); }
      ctx.globalAlpha = 1;
      for (let i = 0; i < BAR_COUNT; i++) {
        const binIndex = Math.round(Math.pow(i / BAR_COUNT, 1.5) * (this.data.length - 1)), value = this.data[binIndex] / 255;
        const halfH = Math.max(1, value * drawH * .35), x = drawX + i * (barWidth + BAR_GAP), [edge, hi] = colors(i, isDark), grad = ctx.createLinearGradient(x, 0, x + barWidth, 0);
        grad.addColorStop(0, edge); grad.addColorStop(.45, hi); grad.addColorStop(1, edge); ctx.fillStyle = grad;
        ctx.beginPath(); ctx.roundRect(x, cy - halfH, barWidth, halfH, [2, 2, 0, 0]); ctx.fill();
        ctx.beginPath(); ctx.roundRect(x, cy, barWidth, halfH, [0, 0, 2, 2]); ctx.fill();
        if (value > EMIT_THRESHOLD) { const energy = (value - EMIT_THRESHOLD) / (1 - EMIT_THRESHOLD); this.emitAccum[i] += energy * EMIT_RATE * dt; while (this.emitAccum[i] >= 1) { this.emitAccum[i] -= 1; this.particles.push({ x, y: cy - halfH, vy: -PARTICLE_SPEED, barIdx: i, age: 0 }, { x, y: cy + halfH, vy: PARTICLE_SPEED, barIdx: i, age: 0 }); } } else this.emitAccum[i] = 0;
      }
    }
  }
  window.AudioBarsEffect = BarsEffect;
})();

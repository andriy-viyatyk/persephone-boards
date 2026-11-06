class WakeCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = 16000;
    this.step = sampleRate / this.targetRate;
    this.position = 0;
    this.previous = 0;
    this.hasPrevious = false;
    this.output = [];
    this.port.onmessage = (event) => { if (event.data?.type === "stop") this.output.length = 0; };
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length || !channels[0]?.length) return true;
    const mono = new Float32Array(channels[0].length);
    for (let c = 0; c < channels.length; c++) for (let i = 0; i < mono.length; i++) mono[i] += channels[c][i] / channels.length;
    for (const current of mono) {
      if (!this.hasPrevious) { this.previous = current; this.hasPrevious = true; continue; }
      while (this.position < 1) {
        const value = this.previous + (current - this.previous) * this.position;
        this.output.push(Math.max(-32768, Math.min(32767, Math.round(value * (value < 0 ? 32768 : 32767)))));
        if (this.output.length === 1280) {
          const pcm = Int16Array.from(this.output); this.output.length = 0;
          this.port.postMessage({ type: "audio", data: pcm.buffer }, [pcm.buffer]);
        }
        this.position += this.step;
      }
      this.position -= 1; this.previous = current;
    }
    return true;
  }
}
registerProcessor("wake-capture", WakeCaptureProcessor);

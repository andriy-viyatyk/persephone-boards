"use strict";
class SpeechCaptureProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.pending = []; this.levelEvery = 4096; this.samples = 0; }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    const mono = new Float32Array(channels[0].length);
    for (let i = 0; i < mono.length; i++) {
      let sum = 0;
      for (const channel of channels) sum += channel[i] || 0;
      mono[i] = sum / channels.length;
    }
    let energy = 0;
    for (const sample of mono) energy += sample * sample;
    this.port.postMessage({ type: "level", value: Math.sqrt(energy / Math.max(1, mono.length)) });
    this.port.postMessage({ type: "samples", data: mono }, [mono.buffer]);
    return true;
  }
}
registerProcessor("speech-capture", SpeechCaptureProcessor);

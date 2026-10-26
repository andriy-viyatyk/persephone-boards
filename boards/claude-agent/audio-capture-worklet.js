"use strict";
class AgentCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    const mono = new Float32Array(channels[0].length);
    for (let i = 0; i < mono.length; i++) {
      let sum = 0;
      for (const channel of channels) sum += channel[i] || 0;
      mono[i] = sum / channels.length;
    }
    this.port.postMessage({ type: "samples", data: mono }, [mono.buffer]);
    return true;
  }
}
registerProcessor("agent-capture", AgentCaptureProcessor);

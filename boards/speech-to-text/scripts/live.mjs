import { spawn } from "node:child_process";
import path from "node:path";
import { stopProcessTree } from "./downloads.mjs";

const FRAME = 512, PRE = 16000, POST = 4800, DRAFT_PAUSE = 8000, COMMIT_PAUSE = 19200, JOIN_GAP = 19200, MIN_SPEECH = 4000, MAX_UTTERANCE = 400000;

export class Segmenter {
  constructor(emit = () => {}) {
    this.emit = emit;
    this.reset();
  }
  reset() {
    this.state = "idle";
    this.received = 0;
    this.previousCommitEnd = 0;
    this.utterance = 0;
    this.current = null;
    this.inSpeech = false;
    this.rawStart = null;
    this.lastRawEnd = 0;
    this.rawDuration = 0;
    this.draftSent = false;
    this.frames = [];
    this.lastFrame = -1;
    this.finished = false;
  }
  observe({ frame, speechProbability }) {
    if (this.finished || !Number.isInteger(frame) || frame !== this.lastFrame + 1 || !Number.isFinite(speechProbability) || speechProbability < 0 || speechProbability > 1) throw new Error("Invalid VAD observation.");
    this.lastFrame = frame;
    const start = frame * FRAME, end = start + FRAME;
    this.received = Math.max(this.received, end);
    const wasSpeech = this.inSpeech;
    if (wasSpeech ? speechProbability >= 0.35 : speechProbability >= 0.5) this.inSpeech = true;
    else this.inSpeech = false;
    if (this.inSpeech && !wasSpeech) this.beginRun(start);
    if (!this.inSpeech && wasSpeech) this.endRun(start);
    if (this.inSpeech && this.current) this.rawDuration += FRAME;
    if (this.current) {
      this.frames.push({ start, probability: speechProbability });
      if (!this.inSpeech && this.rawStart === null) this.pauseEvents(end);
      if (this.current && end - this.current.start >= MAX_UTTERANCE) this.cut(end);
    }
  }
  beginRun(sample) {
    if (this.current && sample - this.lastRawEnd >= JOIN_GAP) this.commit(this.lastRawEnd);
    if (!this.current) this.newUtterance(sample);
    this.rawStart = sample;
    this.draftSent = false;
    this.state = "speech";
  }
  endRun(sample) {
    if (this.rawStart !== null) {
      this.lastRawEnd = sample;
      this.rawStart = null;
    }
    this.state = "pause-after-speech";
  }
  newUtterance(sample) {
    this.current = { id: ++this.utterance, start: Math.max(this.previousCommitEnd, sample - PRE), firstSpeech: sample };
    this.lastRawEnd = sample;
    this.rawDuration = 0;
    this.draftSent = false;
    this.frames = [];
  }
  pauseEvents(now) {
    const pause = now - this.lastRawEnd;
    if (pause >= COMMIT_PAUSE) this.commit(this.lastRawEnd);
    else if (pause >= DRAFT_PAUSE) this.draft();
  }
  range(end, padding = true) {
    const stop = Math.min(this.received, padding ? end + POST : end);
    return { type: "range", utterance: this.current.id, start: this.current.start, end: Math.max(this.current.start, stop) };
  }
  draft() {
    // One draft per pause; speech resuming re-arms it.
    if (!this.current || this.draftSent || this.rawDuration < MIN_SPEECH) return;
    const range = this.range(this.lastRawEnd, false);
    this.draftSent = true;
    this.emit({ type: "draft", utterance: range.utterance, start: range.start, end: range.end, speechSamples: this.rawDuration });
  }
  commit(end, { padded = true } = {}) {
    if (!this.current) return;
    if (this.inSpeech && this.rawStart !== null) { this.lastRawEnd = this.received; this.rawStart = null; }
    const current = this.current;
    const stop = Math.min(this.received, padded ? end + POST : end);
    const range = { type: "commit", utterance: current.id, start: current.start, end: Math.max(current.start, stop) };
    if (this.rawDuration >= MIN_SPEECH) this.emit({ ...range, speechSamples: this.rawDuration });
    this.previousCommitEnd = range.end;
    this.current = null;
    this.rawDuration = 0;
    this.draftSent = false;
    this.frames = [];
    this.state = this.inSpeech ? "speech" : "idle";
  }
  cut(now) {
    if (!this.current) return;
    const boundary = this.current.start + MAX_UTTERANCE;
    const candidates = this.frames.filter((item) => item.start >= boundary - 48000 && item.start < boundary);
    const quietest = candidates.reduce((best, item) => !best || item.probability < best.probability ? item : best, null);
    const cutAt = quietest?.start ?? boundary;
    const old = this.current;
    const stop = Math.min(this.received, cutAt);
    if (this.rawDuration >= MIN_SPEECH) this.emit({ type: "commit", utterance: old.id, start: old.start, end: Math.max(old.start, stop), speechSamples: this.rawDuration });
    this.previousCommitEnd = Math.max(old.start, stop);
    this.current = null;
    this.rawDuration = 0;
    this.draftSent = false;
    this.frames = this.frames.filter((item) => item.start >= cutAt);
    if (this.inSpeech) {
      this.current = { id: ++this.utterance, start: cutAt, firstSpeech: cutAt };
      this.rawDuration = Math.max(0, now - cutAt);
      this.lastRawEnd = now;
      this.rawStart = cutAt;
      this.state = "speech";
    } else this.state = "idle";
  }
  flush() {
    if (this.finished) return;
    this.finished = true;
    if (this.current) {
      if (this.inSpeech) this.lastRawEnd = this.received;
      this.commit(this.lastRawEnd + POST, { padded: false });
    }
  }
  dispose() { this.reset(); this.finished = true; this.emit = () => {}; }
}

export class LiveStream {
  constructor({ runtime, onEvent = () => {}, onFailure = () => {} }) {
    this.runtime = runtime;
    this.onEvent = onEvent;
    this.onFailure = onFailure;
    this.parts = [];
    this.samples = 0;
    this.accepting = true;
    this.failed = false;
    this.closed = false;
    this.ending = false;
    this.expectedFrame = 0;
    this.maxProbability = 0;
    this.line = "";
    this.child = null;
    this.exitPromise = null;
    this.segmenter = new Segmenter((event) => this.onEvent(event));
    this.start();
  }
  start() {
    const cwd = this.runtime;
    const child = spawn(path.join(cwd, "whisper-vad-helper.exe"), ["--model", "models/ggml-silero-v6.2.0.bin", "--threads", "1"], { cwd, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    this.child = child;
    this.exitPromise = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (part) => this.read(part));
    child.stdout.on("error", (error) => this.fail(error));
    child.stdin.on("error", (error) => this.fail(error));
    child.once("error", (error) => this.fail(error));
    child.once("close", (code) => { if (!this.closed && !this.ending) this.fail(new Error(`VAD helper exited before end (${code}).`)); });
  }
  read(part) {
    this.line += part;
    for (;;) {
      const at = this.line.indexOf("\n");
      if (at < 0) break;
      const line = this.line.slice(0, at).trim();
      this.line = this.line.slice(at + 1);
      if (line) this.record(line);
    }
  }
  record(line) {
    if (this.failed) return;
    try {
      const item = JSON.parse(line);
      if (!Number.isInteger(item.frame) || item.frame !== this.expectedFrame || !Number.isFinite(item.speechProbability) || item.speechProbability < 0 || item.speechProbability > 1) throw new Error("Invalid VAD helper frame.");
      this.expectedFrame++;
      this.maxProbability = Math.max(this.maxProbability, item.speechProbability);
      this.segmenter.observe(item);
    } catch (error) { this.fail(error); }
  }
  append(data) {
    if (!this.accepting || this.failed) throw new Error("Live audio intake has stopped.");
    const bytes = Buffer.from(data);
    const start = this.samples;
    this.parts.push({ start, end: start + bytes.length / 2, bytes });
    this.samples += bytes.length / 2;
    try { this.child.stdin.write(bytes); } catch (error) { this.fail(error); throw error; }
    return this.samples;
  }
  slice(start, end) {
    const chunks = [];
    for (const part of this.parts) {
      const left = Math.max(start, part.start), right = Math.min(end, part.end);
      if (right > left) chunks.push(part.bytes.subarray((left - part.start) * 2, (right - part.start) * 2));
    }
    return chunks;
  }
  fail(error) {
    if (this.failed || this.closed) return;
    this.failed = true;
    this.accepting = false;
    this.segmenter.dispose();
    console.error("[speech-to-text] live VAD helper failed:", error?.message || error);
    Promise.resolve(this.onFailure(error)).catch(() => {});
    if (this.child && this.child.exitCode === null) void stopProcessTree(this.child);
  }
  async finish() {
    if (this.closed) return;
    this.accepting = false;
    if (!this.failed) {
      this.ending = true;
      this.child.stdin.end();
      const exit = await this.exitPromise;
      if (this.line.trim()) { const line = this.line.trim(); this.line = ""; this.record(line); }
      this.segmenter.received = this.samples;
      if (!this.failed && exit.code === 0 && this.expectedFrame !== Math.ceil(this.samples / FRAME)) this.fail(new Error("VAD helper omitted frames."));
      if (!this.failed && exit.code === 0) this.segmenter.flush();
      else if (!this.failed) this.fail(new Error(`VAD helper exited (${exit.code}).`));
    } else await this.exitPromise;
    this.closed = true;
  }
  async stop() {
    this.accepting = false;
    this.closed = true;
    this.segmenter.dispose();
    if (this.child && this.child.exitCode === null) await stopProcessTree(this.child);
    await this.exitPromise;
    this.parts.length = 0;
  }
  clear() { this.parts.length = 0; this.samples = 0; this.segmenter.dispose(); }
}
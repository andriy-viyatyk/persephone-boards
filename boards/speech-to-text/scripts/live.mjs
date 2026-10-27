import { spawn } from "node:child_process";
import path from "node:path";
import { stopProcessTree } from "./downloads.mjs";

// Keep live timing and agreement tuning together so latency and stability can be measured as one set.
export const LIVE_TUNING = {
  passIntervalMs: 1000, // Target cadence between partial inference passes.
  agreementCount: 2, // Consecutive hypotheses required by LocalAgreement-N; compare N=3 during verification.
  minNewWords: 2, // Minimum newly stable words committed during continuous speech.
  minAudioBeforeFirstPassMs: 1000, // Avoid inference on a tiny first audio window.
  trimAfterMs: 8000, // Do not consider removing committed audio before this window duration.
  maxAudioWindowMs: 25000, // Bound retained audio and preserve the existing utterance cap.
  maxPassMs: 3000, // A forced-language pass above this duration counts as slow.
  slowPassesBeforeFallback: 3, // Disable partial inference after this many consecutive slow forced-language passes.
  languageLatchSpeechMs: 1000, // Speech in a partial pass before its detected language is fixed for the stream.
  speechOnProbability: 0.5, // Enter speech at or above this VAD probability.
  speechOffProbability: 0.35, // Remain in speech at or above this VAD probability.
  frameMs: 32, // VAD frame length at 16 kHz.
  preRollMs: 1000, // Preserve audio immediately before speech onset.
  postRollMs: 300, // Preserve a short tail after a pause or commit boundary.
  draftPauseMs: 500, // Delay before a pause-based fallback draft.
  commitPauseMs: 1200, // Finalize an utterance after this much silence.
  joinGapMs: 1200, // Keep short gaps inside one utterance.
  minSpeechMs: 250, // Ignore detections shorter than this minimum speech duration.
  trimBoundarySearchMs: 3000, // Search this much audio before a cap for a quiet split point.
};
const samplesForMs = (ms) => Math.round(ms * 16);
const FRAME = samplesForMs(LIVE_TUNING.frameMs);
const PRE = samplesForMs(LIVE_TUNING.preRollMs), POST = samplesForMs(LIVE_TUNING.postRollMs);
const DRAFT_PAUSE = samplesForMs(LIVE_TUNING.draftPauseMs), COMMIT_PAUSE = samplesForMs(LIVE_TUNING.commitPauseMs);
const JOIN_GAP = samplesForMs(LIVE_TUNING.joinGapMs), MIN_SPEECH = samplesForMs(LIVE_TUNING.minSpeechMs);
const MAX_UTTERANCE = samplesForMs(LIVE_TUNING.maxAudioWindowMs), PASS_INTERVAL = samplesForMs(LIVE_TUNING.passIntervalMs);
const MIN_FIRST_PASS = samplesForMs(LIVE_TUNING.minAudioBeforeFirstPassMs);

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
    this.partialEnabled = true;
    this.partialBusy = false;
    this.lastPartialStart = null;
    this.nextPartialAt = null;
    this.pausePasses = 0;
  }
  observe({ frame, speechProbability }) {
    if (this.finished || !Number.isInteger(frame) || frame !== this.lastFrame + 1 || !Number.isFinite(speechProbability) || speechProbability < 0 || speechProbability > 1) throw new Error("Invalid VAD observation.");
    this.lastFrame = frame;
    const start = frame * FRAME, end = start + FRAME;
    this.received = Math.max(this.received, end);
    const wasSpeech = this.inSpeech;
    if (wasSpeech ? speechProbability >= LIVE_TUNING.speechOffProbability : speechProbability >= LIVE_TUNING.speechOnProbability) this.inSpeech = true;
    else this.inSpeech = false;
    if (this.inSpeech && !wasSpeech) this.beginRun(start);
    if (!this.inSpeech && wasSpeech) this.endRun(start);
    if (this.inSpeech && this.current) this.rawDuration += FRAME;
    if (this.current) {
      this.frames.push({ start, probability: speechProbability });
      this.partialEvents(end);
      if (!this.inSpeech && this.rawStart === null) this.pauseEvents(end);
      if (this.current && end - this.current.utteranceStart >= MAX_UTTERANCE) this.cut(end);
    }
  }
  beginRun(sample) {
    if (this.current && sample - this.lastRawEnd >= JOIN_GAP) this.commit(this.lastRawEnd);
    if (!this.current) this.newUtterance(sample);
    this.rawStart = sample;
    this.draftSent = false;
    this.pausePasses = 0;
    // Short gaps inside an utterance keep the pass schedule; only a new utterance waits for its first audio.
    if (this.nextPartialAt === null) this.nextPartialAt = sample + Math.max(MIN_FIRST_PASS, PASS_INTERVAL);
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
    const start = Math.max(this.previousCommitEnd, sample - PRE);
    this.current = { id: ++this.utterance, start, utteranceStart: start, firstSpeech: sample };
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
  partialEvents(now) {
    // A pause is when the words just spoken settle, so passes continue into it, up to agreementCount of them.
    if (!this.partialEnabled || !this.current || this.partialBusy || now < this.nextPartialAt) return;
    if (!this.inSpeech && this.pausePasses >= LIVE_TUNING.agreementCount) return;
    const range = this.range(now, false);
    if (range.end - range.start < MIN_FIRST_PASS) return;
    if (!this.inSpeech) this.pausePasses++;
    this.partialBusy = true;
    this.lastPartialStart = now;
    this.emit({ type: "partial", utterance: range.utterance, start: range.start, end: range.end, speechSamples: this.rawDuration });
  }
  partialComplete(passEndSample, utterance) {
    if (this.current?.id !== utterance) return;
    this.partialBusy = false;
    this.nextPartialAt = Math.max((this.lastPartialStart ?? passEndSample) + PASS_INTERVAL, passEndSample);
  }
  disablePartials() { this.partialEnabled = false; this.partialBusy = false; }
  range(end, padding = true) {
    const stop = Math.min(this.received, padding ? end + POST : end);
    return { type: "range", utterance: this.current.id, start: this.current.start, end: Math.max(this.current.start, stop) };
  }
  draft() {
    // One draft per pause; speech resuming re-arms it.
    if (!this.current || this.draftSent || this.rawDuration < MIN_SPEECH) return;
    const range = this.range(this.lastRawEnd, false);
    this.draftSent = true;
    if (!this.partialEnabled) this.emit({ type: "draft", utterance: range.utterance, start: range.start, end: range.end, speechSamples: this.rawDuration });
  }
  commit(end, { padded = true } = {}) {
    if (!this.current) return;
    if (this.inSpeech && this.rawStart !== null) { this.lastRawEnd = this.received; this.rawStart = null; }
    const current = this.current;
    if (this.partialBusy) this.emit({ type: "partial-cancel", utterance: current.id });
    const stop = Math.min(this.received, padded ? end + POST : end);
    const range = { type: "commit", utterance: current.id, start: current.start, end: Math.max(current.start, stop) };
    if (this.rawDuration >= MIN_SPEECH) this.emit({ ...range, speechSamples: this.rawDuration });
    this.previousCommitEnd = range.end;
    this.current = null;
    this.rawDuration = 0;
    this.draftSent = false;
    this.partialBusy = false;
    this.nextPartialAt = null;
    this.frames = [];
    this.state = this.inSpeech ? "speech" : "idle";
  }
  cut(now) {
    if (!this.current) return;
    const boundary = this.current.utteranceStart + MAX_UTTERANCE;
    const candidates = this.frames.filter((item) => item.start >= boundary - samplesForMs(LIVE_TUNING.trimBoundarySearchMs) && item.start < boundary);
    const quietest = candidates.reduce((best, item) => !best || item.probability < best.probability ? item : best, null);
    const cutAt = quietest?.start ?? boundary;
    const old = this.current;
    if (this.partialBusy) this.emit({ type: "partial-cancel", utterance: old.id });
    const stop = Math.min(this.received, cutAt);
    if (this.rawDuration >= MIN_SPEECH) this.emit({ type: "commit", utterance: old.id, start: old.start, end: Math.max(old.start, stop), speechSamples: this.rawDuration });
    this.previousCommitEnd = Math.max(old.start, stop);
    this.current = null;
    this.rawDuration = 0;
    this.draftSent = false;
    this.partialBusy = false;
    this.nextPartialAt = null;
    this.frames = this.frames.filter((item) => item.start >= cutAt);
    if (this.inSpeech) {
      this.current = { id: ++this.utterance, start: cutAt, utteranceStart: cutAt, firstSpeech: cutAt };
      this.rawDuration = Math.max(0, now - cutAt);
      this.lastRawEnd = now;
      this.rawStart = cutAt;
      this.state = "speech";
      this.nextPartialAt = cutAt + Math.max(MIN_FIRST_PASS, PASS_INTERVAL);
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
    this.baseSample = 0;
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
  trimBefore(sample) {
    const boundary = Math.max(this.baseSample, Math.min(sample, this.samples));
    this.parts = this.parts.flatMap((part) => {
      if (part.end <= boundary) return [];
      if (part.start >= boundary) return [part];
      return [{ start: boundary, end: part.end, bytes: part.bytes.subarray((boundary - part.start) * 2) }];
    });
    this.baseSample = boundary;
    if (this.segmenter.current) this.segmenter.current.start = Math.max(this.segmenter.current.start, boundary);
    return boundary;
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
  clear() { this.parts.length = 0; this.samples = 0; this.baseSample = 0; this.segmenter.dispose(); }
}

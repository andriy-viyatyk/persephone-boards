"use strict";

// BT-085 measured about 0.8–1.1 s from onset to delivery; allowance includes
// LOOK_AHEAD_MS 300, PROCESSING_MARGIN_MS 200 and inference. Tune on real hardware.
const PRE_ROLL_MS = 3000;
const REQUEST_HOLD_BACK_MS = 1500;
const MAX_REQUEST_MS = 60000;
const DEFAULT_SILENCE_MS = 2000;
const NO_SPEECH_TIMEOUT_MS = 10000;
const INTERRUPT_WAIT_MS = 10000;
const SPEECH_IGNORE_MS = 700; // after the wake: its tail and the chime echo are not counted as speech
const MIN_SPEECH_MS = 300; // speech-level sound needed before silence can end the request
// While a request listens, Persephone's own playback (a film, a browser tab) is muted with
// audio.muteApp(). The request starts this long after the newest captured chunk at the moment the mute
// took effect, so sound still on its way from the speakers is not transcribed as the user.
const MUTE_SETTLE_MS = 200;

// Whisper invents these on silence or noise. A request whose whole text is one of them is treated as
// empty: nothing is sent and the reject chime plays. Compared lowercase, letters and spaces only.
const HALLUCINATIONS = new Set([
  "thank you", "thank you very much", "thanks", "thanks for watching", "thank you for watching", "you", "bye",
  "дякую", "дякую за перегляд", "дякуємо за перегляд", "продовження буде", "субтитри",
  "спасибо", "спасибо за просмотр", "продолжение следует",
]);

function isHallucination(text) {
  const normalized = text.toLowerCase().replace(/[^\p{L}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return !normalized || HALLUCINATIONS.has(normalized);
}

// Chimes: bell-like notes that overlap as each one decays.
//   wake   - rising E5 → B5: listening started
//   end    - falling B5 → E5: the request was heard and is being sent (stop word or silence)
//   reject - low, dull E4 → C4: nothing was sent (no speech, empty text, an error, a cancelled request)
const CHIME_SAMPLE_RATE = 24000;
const CHIMES = {
  wake: { notes: [{ frequency: 659.25, startMs: 0 }, { frequency: 987.77, startMs: 110 }], overtone: 0.25 },
  end: { notes: [{ frequency: 987.77, startMs: 0 }, { frequency: 659.25, startMs: 110 }], overtone: 0.25 },
  reject: { notes: [{ frequency: 329.63, startMs: 0 }, { frequency: 261.63, startMs: 180 }], overtone: 0.1 },
};
const CHIME_NOTE_MS = 400;
const CHIME_ATTACK_MS = 6;
const CHIME_DECAY_MS = 250; // exponential decay time constant
const CHIME_DRIVE = 3; // tanh saturation: raises loudness well above what the peak alone allows
const CHIME_PEAK = 0.95;

// Builds a chime as float32 samples: normalized, saturated, then scaled so its loudest sample is CHIME_PEAK.
// The overtone (an octave above, relative level) gives the bell colour; less of it sounds duller.
function chimeSamples(name) {
  const { notes, overtone } = CHIMES[name];
  const lastNote = notes[notes.length - 1];
  const length = Math.ceil((lastNote.startMs + CHIME_NOTE_MS) * CHIME_SAMPLE_RATE / 1000);
  const samples = new Float32Array(length);
  for (const note of notes) {
    const offset = Math.round(note.startMs * CHIME_SAMPLE_RATE / 1000);
    const noteLength = Math.round(CHIME_NOTE_MS * CHIME_SAMPLE_RATE / 1000);
    for (let i = 0; i < noteLength && offset + i < length; i++) {
      const ms = i * 1000 / CHIME_SAMPLE_RATE;
      const attack = Math.min(1, ms / CHIME_ATTACK_MS);
      const release = Math.min(1, (CHIME_NOTE_MS - ms) / 20); // fades the tail to zero, no click
      const envelope = attack * release * Math.exp(-ms / CHIME_DECAY_MS);
      const phase = 2 * Math.PI * note.frequency * i / CHIME_SAMPLE_RATE;
      samples[offset + i] += envelope * (Math.sin(phase) + overtone * Math.sin(2 * phase));
    }
  }
  const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  const saturationPeak = Math.tanh(CHIME_DRIVE);
  for (let i = 0; i < length; i++) {
    samples[i] = CHIME_PEAK * Math.tanh(CHIME_DRIVE * samples[i] / peak) / saturationPeak;
  }
  return samples;
}

window.createWakeAssistant = function createWakeAssistant(options) {
  let generation = 0, owner = null, capture = null, listener = null, beep = null;
  let audio = null, wake = null, speech = null, provider = null, description = null;
  let request = null, ring = [], state = "off", detail = "", preview = "", runningView = null;
  let detections = Promise.resolve();
  let recoveryAttempts = 0;
  const message = (key) => options.message(key);

  function render(next = state, message = detail, text = preview) {
    state = next;
    detail = message;
    preview = text;
    options.render(state, detail, preview);
  }

  function close(channel) {
    try {
      channel?.close();
    } catch { /* already closed */ }
  }

  function cancelRequest() {
    const old = request;
    request = null;
    if (!old) return;
    unmuteApp(old);
    clearTimeout(old.timer);
    old.cancelled = true;
    try {
      old.channel?.send({
        type: "cancel"
      });
    } catch { /* already closed */ }
    close(old.channel);
    old.chunks = [];
  }

  // Mute Persephone's playback for a request. Resolves true once the mute is in effect; false when
  // this Persephone has no muteApp or the call failed (the request then keeps the wake-time start).
  async function muteApp(item) {
    if (typeof audio?.muteApp !== "function") return false;
    try {
      const lease = await audio.muteApp();
      if (item.unmuted) {
        void lease.release().catch(() => undefined);
        return false;
      }
      item.lease = lease;
      return true;
    } catch (error) {
      console.warn("Wake mute failed:", error);
      return false;
    }
  }

  // Release the mute once the request has stopped capturing. Safe to call more than once.
  function unmuteApp(item) {
    if (!item || item.unmuted) return;
    item.unmuted = true;
    const lease = item.lease;
    item.lease = null;
    if (lease) void lease.release().catch((error) => console.warn("Wake unmute failed:", error));
  }

  function release() {
    cancelRequest();
    const channels = [
      listener, capture, beep, owner
    ];
    listener = capture = beep = owner = null;
    ring = [];
    runningView = null;
    for (const channel of channels) close(channel);
  }

  function fail(error) {
    ++generation;
    release();
    render("error", error?.message || message("connectionClosed"), preview);
  }

  // Readiness and channels
  // Query transcription features before opening a request channel.
  async function describeProvider(item) {
    const channel = await persephone.services.connect("speech.transcribe", {
      provider: item.provider, version: 1
    }, {
      type: "describe"
    });
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(null, new Error(message("transcriptionTimeout"))), 10000);

      function finish(value, error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        close(channel);
        if (error) reject(error);
        else resolve(value);
      }
      channel.onMessage((message) => {
        if (message?.type === "description") finish(message);
        else if (message?.type === "error") finish(null, new Error(message.message || message.code));
      });
      channel.onClose((reason) => finish(null, new Error(reason?.message || message("transcriptionRefused"))));
    });
  }

  async function ready(token) {
    const marker = options.preferences.read("wake-session", null);
    if (!marker?.id || !options.lookupSession(marker)) throw new Error(message("chooseSession"));
    const [audioCapability, wakeCapability, speechCapability] = await Promise.all([
      "audio", "speech.wake", "speech.synthesize"
    ].map((id) => persephone.getCapability(id, {
      version: 1
    })));
    if (token !== generation) return;
    if (!audioCapability || !wakeCapability || !speechCapability) throw new Error(message("providers"));
    const [wakeDescription, wakes, stops, providers] = await Promise.all([
      wakeCapability.describe(),
      wakeCapability.list("agent-wake"),
      wakeCapability.list("agent-stop"),
      persephone.services.list("speech.transcribe"),
    ]);
    if (token !== generation) return;
    if (!wakeDescription?.local) throw new Error(message("localWake"));
    if (![
      wakes, stops
    ].every((groups) => Array.isArray(groups) && groups.some((group) => group.samples?.length)))
      throw new Error(message("enrollments"));
    const selectedProvider = options.selectProvider(providers);
    if (!selectedProvider) throw new Error(message("transcriptionProvider"));
    const selectedDescription = await describeProvider(selectedProvider);
    if (token !== generation) return;
    if (!selectedDescription?.local) throw new Error(message("localTranscription"));
    if (!selectedDescription.features?.includes("live") &&
      (!Number.isFinite(selectedDescription.maxAudioMs) || selectedDescription.maxAudioMs <= 0))
      throw new Error(message("transcriptionLimit"));
    audio = audioCapability;
    wake = wakeCapability;
    speech = speechCapability;
    provider = selectedProvider;
    description = selectedDescription;
    let deviceId = options.preferences.read("wake-device", "");
    if (deviceId && !(await audio.devices()).some((device) => device.deviceId === deviceId)) deviceId = "";
    if (token !== generation) return;
    const input = {
      source: "microphone", echoCancel: true, ...(deviceId ? {
        deviceId
      } : {})
    };
    const openedCapture = await audio.capture(input);
    if (token !== generation) {
      close(openedCapture);
      return;
    }
    capture = openedCapture;
    capture.onMessage((message) => {
      if (token === generation && capture === openedCapture && message?.type === "chunk") onChunk(message);
    });
    capture.onClose((reason) => {
      if (token === generation && capture === openedCapture) restart(reason?.message || message("captureClosed"));
    });
    const openedListener = await wake.listen({
      phrases: [
        "agent-wake", "agent-stop"
      ], sources: [
        "microphone"
      ], echoCancel: true, ...(deviceId ? {
        deviceId
      } : {}), threshold: options.preferences.read("wake-threshold", 0.85)
    });
    if (token !== generation) {
      close(openedListener);
      return;
    }
    listener = openedListener;
    listener.onMessage((message) => {
      if (token !== generation || listener !== openedListener) return;
      if (message?.type === "detection") {
        detections = detections.then(() => token === generation ? detection(message) : undefined)
          .catch((error) => {
            if (token === generation) fail(error);
          });
      } else if (message?.type === "status" && message.status === "reset") restart(options.message("clockReset"));
      else if (message?.type === "error") fail(new Error(message.message || message.code));
    });
    listener.onClose((reason) => {
      if (token === generation && listener === openedListener) restart(reason?.message || message("listenerClosed"));
    });
    render("waiting", "", "");
  }

  // Re-establish channels once after a capture or clock failure.
  function restart(reason) {
    cancelRequest();
    if (recoveryAttempts++ > 0) {
      fail(new Error(reason));
      return;
    }
    void setEnabled(true, reason);
  }

  async function setEnabled(enabled, recoveryReason = "") {
    const token = ++generation;
    release();
    if (!recoveryReason) recoveryAttempts = 0;
    if (!enabled) {
      render("off", "", "");
      return;
    }
    render("starting", recoveryReason, "");
    try {
      const channel = await persephone.service.openChannel({
        type: "wake-owner"
      });
      if (token !== generation) {
        close(channel);
        return;
      }
      owner = channel;
      channel.onMessage((message) => {
        if (token !== generation || message?.type !== "wake-owner") return;
        if (message.status === "occupied") {
          owner = null;
          render("occupied", "", "");
        } else if (message.status === "acquired")
          void ready(token).catch((error) => {
            if (token === generation) fail(error);
          });
      });
      channel.onClose((reason) => {
        if (token === generation && owner === channel) fail(new Error(reason?.message || message("ownerLost")));
      });
    } catch (error) {
      if (token === generation) fail(error);
    }
  }

  // Audio ring and request buffer
  // Convert the exclusive end of a 16 kHz s16le chunk to audio-clock milliseconds.
  function chunkEnd(chunk) {
    return chunk.timeMs + chunk.data.byteLength / 32;
  }

  function onChunk(chunk) {
    if (!(chunk.data instanceof ArrayBuffer) || chunk.data.byteLength % 2 || chunk.sampleRate !== 16000) {
      restart(message("invalidAudio"));
      return;
    }
    const last = ring[ring.length - 1];
    if (last && (last.epoch !== chunk.epoch || Math.abs(chunk.timeMs - chunkEnd(last)) > 1)) {
      restart(message("audioGap"));
      return;
    }
    ring.push(chunk);
    recoveryAttempts = 0;
    while (ring.length > 1 && chunkEnd(ring[0]) < chunkEnd(chunk) - PRE_ROLL_MS) ring.shift();
    if (request && !request.ending) appendAudio(request, chunk);
  }

  function appendAudio(item, chunk) {
    if (chunk.epoch !== item.epoch) {
      restart(message("clockReset"));
      return;
    }
    const from = Math.max(0, Math.ceil((item.start - chunk.timeMs) * 16));
    const maxSamples = Math.floor(Math.min(MAX_REQUEST_MS, item.limitMs) * 16);
    const remaining = maxSamples - item.samples;
    const count = Math.min(chunk.data.byteLength / 2 - from, remaining);
    if (count > 0) {
      const data = chunk.data.slice(from * 2, (from + count) * 2);
      item.chunks.push({
        timeMs: chunk.timeMs + from / 16, data
      });
      item.samples += count;
      if (item.channel && item.samples - item.sent > 16000 * 10) {
        fail(new Error(message("backpressure")));
        return;
      }
      measure(item, data);
      if (request !== item) return;
      queueAudio(item, Math.max(0, item.samples - REQUEST_HOLD_BACK_MS * 16));
    }
    if (item.samples >= maxSamples) finishAfterHold(item);
  }

  // Silence
  // Measure 100 ms windows against a floor and the median speech level.
  function measure(item, data) {
    const samples = new DataView(data);
    for (let i = 0; i < samples.byteLength; i += 2) {
      const value = samples.getInt16(i, true) / 32768;
      item.squares += value * value;
      item.windowSamples++;
      if (item.windowSamples < 1600) continue;
      const rms = Math.sqrt(item.squares / item.windowSamples);
      item.squares = 0;
      item.windowSamples = 0;
      item.elapsed += 100;
      // The wake word's tail and the chime's echo fill the first moments; they are not the user speaking.
      if (item.elapsed <= SPEECH_IGNORE_MS) continue;
      const levels = item.levels.slice().sort((a, b) => a - b);
      const threshold = Math.max(0.005, (levels[Math.floor(levels.length / 2)] || 0) * 0.2);
      if (rms >= threshold) {
        item.levels.push(rms);
        if (item.levels.length > 100) item.levels.shift();
        item.speechMs += 100;
        if (item.speechMs >= MIN_SPEECH_MS) item.spoken = true;
        item.quiet = 0;
      } else item.quiet += 100;
      if (!item.spoken && item.elapsed >= NO_SPEECH_TIMEOUT_MS) {
        cancelRequest();
        chime("reject");
        render(runningView?.busy ? "running" : "waiting", message("noSpeech"), "");
        return;
      }
      if (item.spoken && item.quiet >= item.silenceMs) {
        finishAfterHold(item);
        return;
      }
    }
  }

  // Transcription
  // sent and target are exclusive sample positions in the whole request; offset locates each chunk within it.
  function queueAudio(item, target) {
    item.queue = item.queue.then(async () => {
      if (item.cancelled || !item.channel) return;
      let offset = 0;
      for (const chunk of item.chunks) {
        const size = chunk.data.byteLength / 2;
        const start = Math.max(0, item.sent - offset);
        const end = Math.min(size, target - offset);
        if (end > start) {
          if (!item.channel.writable) await item.channel.whenWritable();
          if (item.cancelled) return;
          item.channel.send({
            type: "audio", data: chunk.data.slice(start * 2, end * 2)
          });
          item.sent = offset + end;
        }
        offset += size;
        if (offset >= target) break;
      }
    }).catch((error) => {
      if (request === item) fail(error);
    });
  }

  async function openTranscription(item) {
    const channel = await persephone.services.connect("speech.transcribe", {
      provider: provider.provider, version: 1
    }, {
      type: "transcribe", format: {
        encoding: "pcm-s16le", sampleRate: 16000, channels: 1
      }, ...(item.live ? {
        live: true
      } : {}),
    });
    if (request !== item || item.cancelled) {
      close(channel);
      return;
    }
    item.channel = channel;
    channel.onMessage((message) => {
      if (request !== item || item.channel !== channel) return;
      if (message.type === "segment" && item.live) {
        item.segments.push(message.text || "");
        item.drafts.delete(message.utterance);
        showPreview(item);
      } else if (message.type === "draft" && item.live) {
        item.drafts.set(message.utterance, message.text || "");
        showPreview(item);
      } else if (message.type === "result") {
        item.channel = null;
        void submit(item, message.text || "");
      } else if (message.type === "error")
        fail(new Error(message.message || message.code));
    });
    channel.onClose((reason) => {
      if (request === item && item.channel === channel && !item.cancelled) {
        fail(new Error(reason?.message || message("transcriptionClosed")));
      }
    });
    queueAudio(item, Math.max(0, item.samples - REQUEST_HOLD_BACK_MS * 16));
  }

  function showPreview(item) {
    render(state, detail, [
      ...item.segments, ...item.drafts.values()
    ].filter(Boolean).join(" "));
  }

  // Play a chime. Best effort: a failed chime never affects the request. A new chime replaces the
  // previous one; turning Wake mode off (a new generation) silences it.
  function chime(name) {
    if (!audio) return;
    const token = generation;
    close(beep);
    beep = null;
    void (async () => {
      const channel = await audio.play({ sampleRate: CHIME_SAMPLE_RATE });
      if (token !== generation) {
        close(channel);
        return;
      }
      beep = channel;
      channel.onMessage((message) => {
        if (message.type === "ended" && beep === channel) beep = null;
      });
      channel.onClose(() => {
        if (beep === channel) beep = null;
      });
      const samples = chimeSamples(name);
      if (!channel.writable) await channel.whenWritable();
      if (beep !== channel) return;
      channel.send({ type: "chunk", data: samples.buffer });
      if (!channel.writable) await channel.whenWritable();
      if (beep === channel) channel.send({ type: "end" });
    })().catch((error) => console.warn("Wake chime failed:", error));
  }

  // State and turns
  // Serialize wake and stop handling around the current request and marked turn.
  async function detection(message) {
    if (![
      "agent-wake", "agent-stop"
    ].includes(message.phrase))
      return;
    // The wake word does not restart a request in progress (as in US-1786): a name mentioned, or a
    // false match, while the user is still speaking would cut the request in half.
    if (message.phrase === "agent-wake" && (state === "listening" || state === "sending")) return;
    const token = generation;
    try {
      await speech.stop();
    } catch (error) {
      if (token === generation) fail(error);
      return;
    }
    if (token !== generation) return;
    if (message.phrase === "agent-stop") {
      if (request && state === "listening") void cutRequest(request, message);
      else if (request && state === "sending") {
        cancelRequest();
        chime("reject");
        render(runningView?.busy ? "running" : "waiting", "", "");
      } else {
        const view = options.markedView();
        if (view?.busy) await options.interruptSession(view);
      }
      return;
    }
    cancelRequest();
    const first = ring[0], last = ring[ring.length - 1], start = message.time?.timeMs;
    if (!first || !last || first.epoch !== message.time?.epoch || !Number.isFinite(start) ||
      start < first.timeMs || start > chunkEnd(last)) {
      render("waiting", options.message("preRollLost"), "");
      return;
    }
    const item = {
      epoch: first.epoch,
      start,
      person: message.person || "",
      chunks: [],
      samples: 0,
      sent: 0,
      queue: Promise.resolve(),
      channel: null,
      cancelled: false,
      ending: false,
      live: description.features?.includes("live"),
      limitMs: description.features?.includes("live")
        ? MAX_REQUEST_MS : Math.min(MAX_REQUEST_MS, description.maxAudioMs || MAX_REQUEST_MS),
      silenceMs: (options.preferences.read("wake-silence", DEFAULT_SILENCE_MS / 1000) * 1000),
      squares: 0,
      windowSamples: 0,
      elapsed: 0,
      quiet: 0,
      spoken: false,
      speechMs: 0,
      levels: [],
      segments: [],
      drafts: new Map(),
      lease: null,
      unmuted: false
    };
    render("listening", "", "");
    // Silence Persephone before taking any audio: what played until now (a film's dialogue) is not
    // the user's request. The user speaks after the wake chime, which plays below.
    if (await muteApp(item)) {
      const latest = ring[ring.length - 1];
      if (latest?.epoch === item.epoch) item.start = Math.max(item.start, chunkEnd(latest) + MUTE_SETTLE_MS);
    }
    if (token !== generation) {
      unmuteApp(item);
      return;
    }
    request = item;
    for (const chunk of ring) {
      if (request !== item || item.ending) break;
      appendAudio(item, chunk);
    }
    chime("wake");
    item.opening = openTranscription(item);
    try {
      await item.opening;
    } catch (error) {
      if (request === item) fail(error);
    }
  }

  // Keep the tail unsent during the hold so a delayed stop detection can still cut it.
  function finishAfterHold(item) {
    if (request !== item || item.ending) return;
    item.ending = true;
    unmuteApp(item);
    chime("end");
    item.timer = setTimeout(() => void endTranscription(item), REQUEST_HOLD_BACK_MS);
  }

  async function endTranscription(item) {
    if (request !== item) return;
    render("sending", "", preview);
    try {
      while (request === item && !item.channel) await new Promise((resolve) => setTimeout(resolve, 50));
      if (request !== item) return;
      queueAudio(item, item.samples);
      await item.queue;
      if (request !== item) return;
      if (!item.channel.writable) await item.channel.whenWritable();
      if (request === item) {
        item.channel.send({
          type: "end"
        });
      }
    } catch (error) {
      if (request === item) fail(error);
    }
  }

  // Stop cut
  // If the stop precedes audio already sent, discard that preview and transcribe the cut buffer again.
  async function cutRequest(item, message) {
    if (message.start?.epoch !== item.epoch || !Number.isFinite(message.start.timeMs)) {
      restart(options.message("clockReset"));
      return;
    }
    clearTimeout(item.timer);
    if (!item.ending) chime("end"); // a stop during the silence hold already had its chime
    item.ending = true;
    unmuteApp(item);
    item.chunks = item.chunks.map((chunk) => {
      const count = Math.max(0, Math.min(
        chunk.data.byteLength / 2,
        Math.floor((message.start.timeMs - chunk.timeMs) * 16)
      ));
      return {
        timeMs: chunk.timeMs, data: chunk.data.slice(0, count * 2)
      };
    }).filter((chunk) => chunk.data.byteLength);
    const count = item.chunks.reduce((total, chunk) => total + chunk.data.byteLength / 2, 0);
    item.samples = count;
    try {
      await item.opening;
      await item.queue;
    } catch (error) {
      if (request === item) fail(error);
      return;
    }
    if (request !== item) return;
    if (item.sent > count) {
      const old = item.channel;
      item.channel = null;
      try {
        old?.send({
          type: "cancel"
        });
      } catch { /* already closed */ }
      close(old);
      item.sent = 0;
      item.segments = [];
      item.drafts.clear();
      render("sending", "", "");
      try {
        await openTranscription(item);
      } catch (error) {
        if (request === item) fail(error);
        return;
      }
    }
    void endTranscription(item);
  }

  // State and turns
  // Send only the final nonempty transcription, interrupting a busy marked session first.
  async function submit(item, text) {
    if (request !== item) return;
    text = text.trim();
    item.chunks = [];
    if (isHallucination(text)) {
      request = null;
      chime("reject");
      render(runningView?.busy ? "running" : "waiting", "", "");
      return;
    }
    render("sending", "", text);
    try {
      const marker = options.preferences.read("wake-session", null);
      const view = await options.resolveSession(marker);
      if (request !== item) return;
      if (!view) throw new Error(message("sessionUnavailable"));
      if (view.busy) {
        await options.interruptSession(view);
        const idle = await options.waitForIdle(view, INTERRUPT_WAIT_MS);
        if (request !== item) return;
        if (!idle || view.busy) throw new Error(message("interruptTimeout"));
      }
      await options.send(view, item.person, text);
      if (request !== item) return;
      request = null;
      runningView = view;
      render("running", "", "");
    } catch (error) {
      if (request === item) {
        request = null;
        chime("reject");
        render("error", error?.message || String(error), text);
      }
    }
  }

  function turnEnded(view) {
    if (view === runningView) {
      runningView = null;
      if (!request) render("waiting", "", "");
    }
  }

  // Teardown
  function cancelListeningRequest() {
    cancelRequest();
    if (options.preferences.read("wake-mode", false)) void setEnabled(true);
  }

  function dispose() {
    ++generation;
    release();
    render("off", "", "");
  }
  return {
    setEnabled, dispose, refresh: () => render(), cancelListeningRequest, turnEnded
  };
};

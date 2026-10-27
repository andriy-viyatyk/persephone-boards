import { BergamotRuntime } from "./bergamot-runtime.mjs";
import { LanguageDetection, normalizeHtmlLang } from "./language-detection.mjs";

const MAX_ITEMS = 32, MAX_POINTS = 64_000, MAX_MESSAGE = 1024 * 1024;
const settingIds = ["idle-unload-minutes", "caller-approval-policy"];
const priorities = { visible: 0, near: 1, background: 2 };
const supportedInterface = (info) => info?.interface?.id === "text.translate" && info.interface.version === 1;
const send = async (channel, message) => {
  if (channel.closed) return false;
  try { if (!channel.writable) await channel.whenWritable(); if (channel.closed) return false; channel.send(message); return true; }
  catch { return false; }
};
const close = (channel, reason) => { if (!channel.closed) channel.close(reason); };
const err = (code, message) => Object.assign(new Error(message), { code });
const pairKey = (from, to) => `${from}-${to}`;

const settings = { idleMinutes: 3, approval: "accept-granted" };
let runtime, detection;
const queue = [], downloads = new Map(), management = new Set();
let activeJob = null, pumping = false, sequence = 0, selectionCache = null;

async function selectedModels({ refresh = false } = {}) {
  if (!selectionCache || refresh) selectionCache = await runtime.discoverModels({ forceRefresh: refresh });
  return selectionCache;
}
function checkCaller(info) {
  if (info?.interface) return settings.approval === "accept-granted" && supportedInterface(info);
  // Same-board channels carry no interface; the host only delivers them from this board's own pages.
  return true;
}
function refuse(channel) { close(channel, { code: "connection-refused", message: "This provider does not accept this caller." }); }
async function failOpen(channel, code, message) { await send(channel, { type: "error", code, message }); close(channel); }
async function routeFor(from, to, selection) { return runtime.resolveInstalledRoute(from, to, { selection }); }
function routeLegs(from, to, selection) {
  if (selection.has(pairKey(from, to))) return [{ from, to }];
  if (from !== "en" && to !== "en" && selection.has(pairKey(from, "en")) && selection.has(pairKey("en", to))) return [{ from, to: "en" }, { from: "en", to }];
  return null;
}
async function description(channel) {
  const selection = await selectedModels();
  const pairs = [];
  for (const pair of selection.values()) {
    const installed = Boolean(await runtime.assets.getInstalledPair(pair.from, pair.to, { selection }));
    pairs.push({ from: pair.from, to: pair.to, installed, sizeBytes: Object.values(pair.files).reduce((sum, file) => sum + file.compressedSize, 0) });
  }
  await send(channel, { type: "description", engine: "Bergamot", model: "Firefox desktop models v3", pairs, features: ["detect", "html", "download-progress"] });
  close(channel);
}
async function detect(channel, open, signal, selection) {
  if (typeof open.text !== "string") throw err("too-large", "Detection requires a text sample.");
  const codes = new Set([...selection.values()].flatMap((pair) => [pair.from, pair.to]));
  const result = await detection.detect(open.text, codes, { signal });
  const hint = normalizeHtmlLang(open.htmlLang, codes);
  if (hint && (result.confidence === "low" || !result.language)) result.language = hint;
  await send(channel, { type: "detection", ...result });
  close(channel);
}
function validateTranslate(open) {
  if (typeof open.id !== "string" || !open.id.trim() || typeof open.to !== "string" || !open.to) throw err("unsupported-language-pair", "A non-empty batch id and target language are required.");
  if (!Array.isArray(open.items) || open.items.length > MAX_ITEMS) throw err(open.items?.length > MAX_ITEMS ? "too-large" : "unsupported-format", "Translation requires an items array with at most 32 items.");
  let points = 0;
  const seen = new Set();
  for (const item of open.items) {
    if (!item || (typeof item.key !== "string" && typeof item.key !== "number") || seen.has(item.key) || typeof item.text !== "string") throw err("unsupported-format", "Each item needs a unique string or number key and string text.");
    seen.add(item.key);
    if (item.format !== "text" && item.format !== "html") throw err("unsupported-format", "Item format must be text or html.");
    points += [...item.text].length;
  }
  if (points > MAX_POINTS || Buffer.byteLength(JSON.stringify(open), "utf8") >= MAX_MESSAGE) throw err("too-large", "The translation request exceeds the v1 size limit.");
  if (!Object.hasOwn(priorities, open.priority ?? "background")) throw err("unsupported-format", "Priority must be visible, near, or background.");
  return { priority: open.priority ?? "background" };
}
async function sendTranslationError(channel, id, code, message) { await send(channel, { type: "error", ...(id ? { id } : {}), code, message }); close(channel); }
function removeQueued(job) { const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1); }
function cancelJob(job, reason = "Translation cancelled.") {
  if (job.cancelled) return;
  job.cancelled = true; job.controller.abort(err("cancelled", reason)); removeQueued(job);
}
async function runTranslation(job) {
  const { channel, open, route, from, selection } = job;
  if (channel.closed || job.cancelled) return;
  const output = new Array(open.items.length), groups = new Map();
  for (let i = 0; i < open.items.length; i++) {
    const item = open.items[i];
    if (!groups.has(item.format)) groups.set(item.format, []);
    groups.get(item.format).push({ item, index: i });
  }
  let done = 0;
  const progress = async () => { done++; await send(channel, { type: "progress", id: open.id, done, total: open.items.length }); };
  for (const [format, group] of groups) {
    if (job.controller.signal.aborted) throw job.controller.signal.reason;
    const eligible = format === "html" ? group.filter(({ item }) => item.text.length <= 8192) : group;
    for (const { item, index } of group) if (!eligible.some((entry) => entry.index === index)) {
      output[index] = { key: item.key, ok: false, error: { code: "engine-failed", message: "This HTML fragment exceeds the engine's 8,192 code unit limit." } };
      await progress();
    }
    if (!eligible.length) continue;
    try {
      const translated = await runtime.translate({ from, to: open.to, route, selection, html: format === "html", signal: job.controller.signal,
        items: eligible.map(({ item }) => ({ key: item.key, text: item.text })) });
      const byKey = new Map(translated.map((item) => [item.key, item.text]));
      for (const { item, index } of eligible) {
        const text = byKey.get(item.key);
        output[index] = text === undefined ? { key: item.key, ok: false, error: { code: "engine-failed", message: "This item could not be translated." } } : { key: item.key, ok: true, text };
        await progress();
      }
    } catch (error) {
      if (job.controller.signal.aborted) throw job.controller.signal.reason;
      for (const { item, index } of eligible) { output[index] = { key: item.key, ok: false, error: { code: "engine-failed", message: error?.message || "This item could not be translated." } }; await progress(); }
    }
  }
  if (!channel.closed && !job.cancelled) { await send(channel, { type: "result", id: open.id, items: output }); close(channel); }
}
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      queue.sort((a, b) => priorities[a.priority] - priorities[b.priority] || a.sequence - b.sequence);
      const job = queue.shift();
      if (job.cancelled || job.channel.closed) continue;
      activeJob = job;
      try { await runTranslation(job); }
      catch (error) { if (!job.channel.closed) await sendTranslationError(job.channel, job.open.id, error?.code || "engine-failed", error?.message || "Translation failed."); }
      finally { activeJob = null; }
    }
  } finally { pumping = false; if (queue.length) void pump(); }
}
async function acceptTranslate(channel, open, signal, early = []) {
  const { priority } = validateTranslate(open);
  if (signal?.aborted) throw signal.reason || err("cancelled", "Translation channel closed.");
  if (!open.items.length) { await send(channel, { type: "result", id: open.id, items: [] }); close(channel); return; }
  const selection = await selectedModels();
  let from = open.from;
  if (from === undefined) {
    const sample = open.items.map((item) => item.text).join("\n").slice(0, 4096);
    const codes = new Set([...selection.values()].flatMap((pair) => [pair.from, pair.to]));
    const result = await detection.detect(sample, codes, { signal });
    from = result.language;
  }
  if (signal?.aborted) throw signal.reason || err("cancelled", "Translation channel closed.");
  if (typeof from !== "string" || !from) throw err("unsupported-language-pair", "A supported source language could not be determined.");
  const route = await routeFor(from, open.to, selection);
  if (!route) {
    const legs = routeLegs(from, open.to, selection);
    if (!legs) throw err("unsupported-language-pair", `No direct or English-pivot route exists for ${from} to ${open.to}.`);
    throw err("not-ready", "Download the required language models first.");
  }
  const controller = new AbortController();
  const cancelOnClose = () => controller.abort(signal.reason || err("cancelled", "Translation channel closed."));
  if (signal?.aborted) cancelOnClose(); else signal?.addEventListener("abort", cancelOnClose, { once: true });
  const job = { channel, open, route, from, selection, priority, sequence: sequence++, controller, cancelled: false };
  if (signal?.aborted || channel.closed) { cancelJob(job, "Translation channel closed."); return; }
  channel.onMessage((message) => { if (message?.type === "cancel") cancelJob(job); });
  channel.onClose(() => cancelJob(job, "Translation channel closed."));
  for (const message of early) if (message?.type === "cancel") cancelJob(job);
  queue.push(job);
  void pump();
}

async function managementSnapshot(channel, { refresh = false } = {}) {
  const selection = await selectedModels({ refresh });
  const installed = new Set((await runtime.listModels()).map((pair) => pairKey(pair.from, pair.to)));
  const active = [...downloads.values()].map((entry) => ({ from: entry.from, to: entry.to, version: entry.version, phase: entry.phase, loadedBytes: entry.loaded, totalBytes: entry.total }));
  await send(channel, { type: "snapshot", pairs: [...selection.values()].map((pair) => ({ from: pair.from, to: pair.to, version: pair.version, sizeBytes: Object.values(pair.files).reduce((sum, file) => sum + file.compressedSize, 0), installed: installed.has(pair.id) })), downloads: active });
}
async function explicitDownload(channel, from, to, signal, { onProgress = () => {}, controller } = {}) {
  const selection = await selectedModels();
  const legs = routeLegs(from, to, selection);
  if (!legs) throw err("unsupported-language-pair", `No direct or English-pivot route exists for ${from} to ${to}.`);
  for (const leg of legs) {
    if (signal?.aborted) throw signal.reason || err("cancelled", "Download cancelled.");
    const model = selection.get(pairKey(leg.from, leg.to));
    const version = model.version;
    const activeKey = `${pairKey(leg.from, leg.to)}@${version}`;
    const record = { from: leg.from, to: leg.to, version, phase: "starting", loaded: 0, total: Object.values(model.files).reduce((sum, file) => sum + file.compressedSize, 0), controller };
    downloads.set(activeKey, record);
    await Promise.all([...management].map((item) => send(item, { type: "download-progress", from, to, leg, loadedBytes: 0, totalBytes: record.total })));
    try {
      await runtime.download(leg.from, leg.to, { signal, selection, onProgress: (event) => {
        record.phase = event.phase || "downloading"; record.loaded = event.loaded || 0; record.total = event.total || record.total;
        const progress = { type: "download-progress", from, to, leg, loadedBytes: record.loaded, totalBytes: record.total };
        onProgress(progress);
        for (const item of management) void send(item, progress);
      } });
    } finally {
      downloads.delete(activeKey);
      await Promise.all([...management].map((item) => managementSnapshot(item)));
    }
  }
  selectionCache = null;
}
async function providerDownload(channel, open, controller, early = []) {
  const record = { controller, from: open.from, to: open.to };
  channel.onMessage((message) => { if (message?.type === "cancel") controller.abort(err("cancelled", "Download cancelled.")); });
  channel.onClose(() => controller.abort(err("cancelled", "Download channel closed.")));
  for (const message of early) if (message?.type === "cancel") controller.abort(err("cancelled", "Download cancelled."));
  try {
    await explicitDownload(channel, open.from, open.to, controller.signal, { controller, onProgress: (message) => void send(channel, message) });
    if (!channel.closed && !controller.signal.aborted) { await send(channel, { type: "download-result", from: open.from, to: open.to, installed: true }); close(channel); }
  } catch (error) { if (!channel.closed) await sendTranslationError(channel, undefined, controller.signal.aborted ? "cancelled" : error?.code || "download-failed", error?.message || "Model download failed."); }
}
async function managementCommand(channel, message) {
  try {
    if (message?.type === "snapshot" || message?.type === "refresh") return await managementSnapshot(channel, { refresh: message.type === "refresh" });
    if (message?.type === "download") {
      const controller = new AbortController();
      try { await explicitDownload(channel, message.from, message.to, controller.signal, { controller, onProgress: (progress) => void send(channel, { type: "download-progress", ...progress }) }); }
      finally { selectionCache = null; }
      await managementSnapshot(channel); return;
    }
    if (message?.type === "cancel") {
      const key = `${message.from}-${message.to}`;
      const record = [...downloads.entries()].find(([, item]) => item.from === message.from && item.to === message.to)?.[1];
      if (record) record.controller.abort(err("cancelled", "Model download cancelled."));
      else await runtime.cancelDownload(key, message.version);
      return;
    }
    if (message?.type === "remove") {
      await runtime.remove(message.from, message.to, message.version);
      selectionCache = null;
      await Promise.all([...management].map((item) => managementSnapshot(item)));
      return;
    }
    await send(channel, { type: "error", code: "unsupported-format", message: "Unknown management command." });
  } catch (error) { await send(channel, { type: "error", code: error?.code || "download-failed", message: error?.message || "Management operation failed." }); }
}
async function applySetting(id, value) {
  if (id === "idle-unload-minutes") {
    const number = Number(value);
    settings.idleMinutes = Number.isFinite(number) ? Math.max(1, Math.min(120, number)) : 3;
    runtime?.setIdleUnloadMinutes(settings.idleMinutes);
  } else if (id === "caller-approval-policy") settings.approval = value === "same-board-only" ? value : "accept-granted";
}
for (const id of settingIds) persephone.settings.onChange(({ id: changed, value }) => { void applySetting(changed, value); });
const settingsReady = Promise.all(settingIds.map(async (id) => applySetting(id, await persephone.settings.get(id))));

runtime = new BergamotRuntime({ idleMinutes: settings.idleMinutes });
detection = new LanguageDetection();
persephone.service.onChannel(async (channel, open, info) => {
  const early = [];
  const stopEarly = channel.onMessage((message) => early.push(message));
  await settingsReady;
  if (!checkCaller(info)) return refuse(channel);
  if (open?.type === "management") {
    if (info?.interface) return refuse(channel);
    management.add(channel);
    channel.onClose(() => management.delete(channel));
    stopEarly();
    channel.onMessage((message) => void managementCommand(channel, message));
    for (const message of early) void managementCommand(channel, message);
    await managementSnapshot(channel);
    return;
  }
  if (info?.interface && !supportedInterface(info)) return refuse(channel);
  stopEarly();
  if (!["describe", "detect", "translate", "download"].includes(open?.type)) return failOpen(channel, "unsupported-format", "Unknown text.translate operation.");
  const controller = new AbortController();
  channel.onClose(() => controller.abort(err("cancelled", "Channel closed.")));
  try {
    const selection = await selectedModels();
    if (open?.type === "describe") return await description(channel);
    if (open?.type === "detect") return await detect(channel, open, controller.signal, selection);
    if (open?.type === "translate") return await acceptTranslate(channel, open, controller.signal, early);
    if (open?.type === "download") {
      return await providerDownload(channel, open, controller, early);
    }
    await failOpen(channel, "unsupported-format", "Unknown text.translate operation.");
  } catch (error) {
    await failOpen(channel, error?.code || "engine-failed", error?.message || "The translation service failed.");
  }
});
persephone.service.onShutdown(async () => {
  for (const job of queue) cancelJob(job, "Service shutting down.");
  if (activeJob) cancelJob(activeJob, "Service shutting down.");
  for (const record of downloads.values()) record.controller?.abort(err("cancelled", "Service shutting down."));
  await Promise.all([runtime.close(), detection.close()]);
});

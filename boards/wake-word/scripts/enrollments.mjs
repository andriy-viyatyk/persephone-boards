import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { TEMPLATE_VERSION } from "./engine.mjs";

export function dataRoot(env = process.env) {
  const local = env.LOCALAPPDATA;
  if (typeof local !== "string" || !path.isAbsolute(local) || local.startsWith("\\\\")) {
    throw new Error("LOCALAPPDATA is unavailable or invalid.");
  }
  return path.resolve(local, "Persephone", "board-data", "wake-word");
}

const file = () => path.join(dataRoot(), "enrollments-v1.json");
let queue = Promise.resolve();

function serialized(action) {
  const result = queue.then(action);
  queue = result.catch(() => {});
  return result;
}

async function save(state) {
  await mkdir(path.dirname(file()), { recursive: true });
  const temporary = `${file()}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, file());
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function readState(signal) {
  let state;
  try {
    state = JSON.parse(await readFile(file(), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { version: 2, samples: [] };
    throw error;
  }
  if (!Array.isArray(state.samples) || ![1, 2].includes(state.version)) {
    throw new Error("Unsupported enrollment data version.");
  }
  if (state.version === 1) {
    const samples = state.samples.map(sample => ({
      ...sample,
      phrase: sample.phrase === sample.kind && (sample.kind === "wake" || sample.kind === "stop")
        ? `agent-${sample.kind}` : sample.phrase,
      echoCancel: false,
      legacyCapture: true,
    }));
    state = { ...state, version: 2, samples };
    if (signal?.aborted) throw Object.assign(new Error("Cancelled."), { code: "cancelled" });
    await save(state);
  }
  return state;
}

export function list(phrase, { privateDetails = false } = {}) {
  return serialized(async () => {
    const state = await readState();
    const groups = new Map();
    for (const sample of state.samples) {
      if (sample.phrase !== phrase) continue;
      const key = JSON.stringify([sample.phrase, sample.kind, sample.person]);
      let group = groups.get(key);
      if (!group) {
        group = { phrase: sample.phrase, kind: sample.kind, person: sample.person, samples: [] };
        groups.set(key, group);
      }
      group.samples.push({
        sampleId: sample.sampleId,
        createdAt: sample.createdAt ?? null,
        frontendVersion: sample.frontendVersion ?? null,
        echoCancel: sample.echoCancel,
        legacyCapture: sample.legacyCapture === true,
        ...(privateDetails ? { duration: sample.frontendVersion === 2 && Array.isArray(sample.embeddings)
          && sample.embeddings.length >= 2 && sample.embeddings.length <= 33
          ? (sample.embeddings.length - 2) * 0.08 : null } : {}),
      });
    }
    return [...groups.values()];
  });
}

export function templates() {
  return serialized(async () => (await readState()).samples.filter(sample => sample.frontendVersion === TEMPLATE_VERSION));
}

export function add({ phrase, kind, person, embeddings, echoCancel }, signal) {
  return serialized(async () => {
    const state = await readState(signal);
    if (signal?.aborted) throw Object.assign(new Error("Cancelled."), { code: "cancelled" });
    const earlier = state.samples.filter(sample => sample.phrase === phrase && sample.kind === kind && sample.person === person);
    const sampleId = randomUUID();
    state.samples.push({ sampleId, phrase, kind, person, createdAt: new Date().toISOString(), embeddings, frontendVersion: TEMPLATE_VERSION, echoCancel, legacyCapture: false });
    await save(state);
    return { sampleId, earlier };
  });
}

export function remove(target, signal) {
  return serialized(async () => {
    const state = await readState(signal);
    if (signal?.aborted) throw Object.assign(new Error("Cancelled."), { code: "cancelled" });
    const before = state.samples.length;
    state.samples = state.samples.filter(sample => !Object.entries(target).every(([key, value]) => sample[key] === value));
    await save(state);
    return before - state.samples.length;
  });
}

export function scoreAgainstEarlier(embeddings, phrase, kind, person, sampleSimilarity) {
  return serialized(async () => {
    const state = await readState();
    const earlier = state.samples.filter(sample => sample.frontendVersion === TEMPLATE_VERSION && sample.phrase === phrase && sample.kind === kind && sample.person === person);
    if (!earlier.length) return null;
    let best = 0;
    for (const sample of earlier) best = Math.max(best, sampleSimilarity(embeddings, sample.embeddings));
    return best;
  });
}

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export function dataRoot(env = process.env) {
  const local = env.LOCALAPPDATA;
  if (typeof local !== "string" || !path.isAbsolute(local) || local.startsWith("\\\\")) throw new Error("LOCALAPPDATA is unavailable or invalid.");
  return path.resolve(local, "Persephone", "board-data", "wake-word");
}

const file = () => path.join(dataRoot(), "enrollments-v1.json");
let writeQueue = Promise.resolve();
async function readState() {
  try {
    const value = JSON.parse(await readFile(file(), "utf8"));
    if (value.version !== 1 || !Array.isArray(value.samples)) throw new Error("Unsupported enrollment data version.");
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, samples: [] };
    throw error;
  }
}
async function mutate(fn) {
  const task = writeQueue.then(async () => {
    const state = await readState();
    const result = await fn(state);
    await mkdir(path.dirname(file()), { recursive: true });
    const temp = `${file()}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify(state)}\n`, { encoding: "utf8", flag: "wx" });
    try { await rename(temp, file()); } catch (error) { await import("node:fs/promises").then(({ rm }) => rm(temp, { force: true })); throw error; }
    return result;
  });
  writeQueue = task.catch(() => {});
  return task;
}

export async function list() {
  const state = await readState();
  const groups = new Map();
  for (const sample of state.samples) {
    const key = JSON.stringify([sample.phrase, sample.kind, sample.person]);
    let row = groups.get(key);
    if (!row) groups.set(key, row = { phrase: sample.phrase, kind: sample.kind, person: sample.person, samples: [] });
    row.samples.push({ sampleId: sample.sampleId });
  }
  return [...groups.values()];
}

export async function templates() { return (await readState()).samples; }

export async function add({ phrase, kind, person, embeddings }) {
  return mutate((state) => {
    const earlier = state.samples.filter((s) => s.phrase === phrase && s.kind === kind && s.person === person);
    const sampleId = randomUUID();
    state.samples.push({ sampleId, phrase, kind, person, createdAt: new Date().toISOString(), embeddings, frontendVersion: 1 });
    return { sampleId, earlier };
  });
}

export async function remove(target) {
  return mutate((state) => {
    const matches = (sample) => target.sampleId ? sample.sampleId === target.sampleId : target.person ? sample.person === target.person : sample.phrase === target.phrase && sample.kind === target.kind;
    const before = state.samples.length;
    state.samples = state.samples.filter((sample) => !matches(sample));
    return before - state.samples.length;
  });
}

export async function scoreAgainstEarlier(embeddings, phrase, kind, person, cosineDistance) {
  const earlier = (await readState()).samples.filter((s) => s.phrase === phrase && s.kind === kind && s.person === person);
  if (!earlier.length) return null;
  let best = 0;
  for (const sample of earlier) {
    let total = 0, count = 0;
    for (const a of embeddings) for (const b of sample.embeddings) { total += cosineDistance(a, b); count++; }
    best = Math.max(best, Math.max(0, Math.min(1, 1 - total / Math.max(1, count))));
  }
  return best;
}

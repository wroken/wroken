// Estado local por sitio: cola de temas, registro de ejecuciones y bloqueo
// para que dos ejecuciones programadas no publiquen a la vez en el mismo sitio.

import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./config.js";

const LOCK_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function file(siteId, name) {
  return path.join(dataDir(siteId), name);
}

function readJson(f, fallback) {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(f, data) {
  const tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, f);
}

function norm(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

function loadTopics(siteId) {
  return readJson(file(siteId, "topics.json"), { queue: [], used: [] });
}

export function addTopics(siteId, topics) {
  const db = loadTopics(siteId);
  const known = new Set([...db.queue, ...db.used].map((t) => norm(t.topic)));
  const added = [];
  for (const t of topics) {
    const item = typeof t === "string" ? { topic: t } : t;
    if (!item.topic || known.has(norm(item.topic))) continue;
    known.add(norm(item.topic));
    db.queue.push({ ...item, addedAt: new Date().toISOString() });
    added.push(item.topic);
  }
  writeJson(file(siteId, "topics.json"), db);
  return { added, queueLength: db.queue.length };
}

export function nextTopic(site) {
  const db = loadTopics(site.id);
  const used = new Set(db.used.map((t) => norm(t.topic)));
  const fromQueue = db.queue.find((t) => !used.has(norm(t.topic)));
  if (fromQueue) return { source: "queue", ...fromQueue, remaining: db.queue.length };
  const seed = (site.topics?.seedTopics || []).find((t) => !used.has(norm(t)));
  if (seed) return { source: "profile.seedTopics", topic: seed, remaining: 0 };
  return {
    source: "none",
    topic: null,
    pillars: site.topics?.pillars || [],
    avoid: site.topics?.avoid || [],
    recentlyUsed: db.used.slice(-30).map((t) => t.topic),
    message: "No quedan temas en la cola. Propón uno nuevo dentro de los pilares del sitio, que sea actual y no repita lo ya publicado.",
  };
}

export function markTopicUsed(siteId, topic, { postId, postUrl } = {}) {
  const db = loadTopics(siteId);
  db.queue = db.queue.filter((t) => norm(t.topic) !== norm(topic));
  db.used.push({ topic, postId, postUrl, at: new Date().toISOString() });
  writeJson(file(siteId, "topics.json"), db);
  return { queueLength: db.queue.length, usedCount: db.used.length };
}

export function listTopics(siteId) {
  return loadTopics(siteId);
}

export function acquireLock(siteId, runId) {
  const f = file(siteId, "run.lock");
  const lock = readJson(f, null);
  if (lock && Date.now() - Date.parse(lock.at) < LOCK_MAX_AGE_MS) {
    return { ok: false, heldBy: lock.runId, since: lock.at };
  }
  writeJson(f, { runId, at: new Date().toISOString() });
  return { ok: true, runId };
}

export function releaseLock(siteId, runId) {
  const f = file(siteId, "run.lock");
  const lock = readJson(f, null);
  if (lock && lock.runId === runId) fs.rmSync(f, { force: true });
}

export function logRun(siteId, entry) {
  fs.appendFileSync(file(siteId, "runs.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}

export function recentRuns(siteId, n = 10) {
  try {
    return fs
      .readFileSync(file(siteId, "runs.jsonl"), "utf8")
      .trim()
      .split("\n")
      .slice(-n)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

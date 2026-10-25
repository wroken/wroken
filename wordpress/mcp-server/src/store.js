// Estado por sitio: cola de temas, historial de ejecuciones y bloqueo.
//
// Si el sitio tiene el plugin Autoblog Bridge, el estado y el bloqueo se guardan en el
// propio WordPress, así el PC y la nube comparten cola, historial y bloqueo. Si no, se
// guardan en <AUTOBLOG_HOME>/data/<sitio>/.

import fs from "node:fs";
import path from "node:path";
import { dataDir, getCredentials } from "./config.js";
import * as wp from "./wordpress.js";

const LOCK_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_USED = 500;
const MAX_RUNS = 100;

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
  return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

async function useRemote(site) {
  if (!getCredentials(site.id)) return false;
  try {
    return (await wp.siteInfo(site)).bridge;
  } catch {
    return false;
  }
}

async function load(site, key, fallback) {
  if (await useRemote(site)) return (await wp.remoteState(site, key)) ?? fallback;
  return readJson(file(site.id, `${key}.json`), fallback);
}

async function save(site, key, value) {
  if (await useRemote(site)) return wp.remoteStateSet(site, key, value);
  writeJson(file(site.id, `${key}.json`), value);
}

// ---------- Temas ----------

export async function addTopics(site, topics) {
  const db = await load(site, "topics", { queue: [], used: [] });
  const known = new Set([...db.queue, ...db.used].map((t) => norm(t.topic)));
  const added = [];
  for (const t of topics) {
    const item = typeof t === "string" ? { topic: t } : t;
    if (!item.topic || known.has(norm(item.topic))) continue;
    known.add(norm(item.topic));
    db.queue.push({ ...item, addedAt: new Date().toISOString() });
    added.push(item.topic);
  }
  await save(site, "topics", db);
  return { added, queueLength: db.queue.length };
}

export async function nextTopic(site) {
  const db = await load(site, "topics", { queue: [], used: [] });
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
    message:
      "No quedan temas en la cola. Busca uno con datos: seo_opportunities (Search Console) o seo_keyword_ideas sobre los pilares del sitio. Debe ser actual y no repetir lo ya publicado.",
  };
}

export async function markTopicUsed(site, topic, { postId, postUrl } = {}) {
  const db = await load(site, "topics", { queue: [], used: [] });
  db.queue = db.queue.filter((t) => norm(t.topic) !== norm(topic));
  db.used.push({ topic, postId, postUrl, at: new Date().toISOString() });
  db.used = db.used.slice(-MAX_USED);
  await save(site, "topics", db);
  return { queueLength: db.queue.length, usedCount: db.used.length };
}

export async function listTopics(site) {
  return load(site, "topics", { queue: [], used: [] });
}

// ---------- Bloqueo ----------

function localLock(siteId, runId) {
  const f = file(siteId, "run.lock");
  const lock = readJson(f, null);
  if (lock && Date.now() - Date.parse(lock.at) < LOCK_MAX_AGE_MS) return { ok: false, heldBy: lock.runId, since: lock.at };
  writeJson(f, { runId, at: new Date().toISOString() });
  return { ok: true };
}

function localUnlock(siteId, runId) {
  const f = file(siteId, "run.lock");
  const lock = readJson(f, null);
  if (lock && lock.runId === runId) fs.rmSync(f, { force: true });
}

export async function acquireLock(site, runId) {
  const local = localLock(site.id, runId);
  if (!local.ok) return { ...local, scope: "local" };
  if (await useRemote(site)) {
    try {
      const r = await wp.remoteLock(site, runId, LOCK_MAX_AGE_MS / 1000);
      if (!r.ok) {
        localUnlock(site.id, runId);
        return { ok: false, heldBy: r.held_by, since: r.expires ? new Date((r.expires - LOCK_MAX_AGE_MS / 1000) * 1000).toISOString() : null, scope: "wordpress" };
      }
      return { ok: true, scope: "wordpress" };
    } catch (e) {
      localUnlock(site.id, runId);
      throw e;
    }
  }
  return { ok: true, scope: "local" };
}

export async function releaseLock(site, runId) {
  localUnlock(site.id, runId);
  if (await useRemote(site)) {
    try {
      await wp.remoteUnlock(site, runId);
    } catch {
      /* caduca solo */
    }
  }
}

// ---------- Historial ----------

export async function logRun(site, entry) {
  const item = { at: new Date().toISOString(), ...entry };
  fs.appendFileSync(file(site.id, "runs.jsonl"), JSON.stringify(item) + "\n");
  if (await useRemote(site)) {
    const runs = (await wp.remoteState(site, "runs")) || [];
    runs.push(item);
    await wp.remoteStateSet(site, "runs", runs.slice(-MAX_RUNS));
  }
}

export async function recentRuns(site, n = 10) {
  if (await useRemote(site)) return ((await wp.remoteState(site, "runs")) || []).slice(-n);
  try {
    return fs
      .readFileSync(file(site.id, "runs.jsonl"), "utf8")
      .trim()
      .split("\n")
      .slice(-n)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export async function lastRunWith(site, outcome) {
  const runs = await recentRuns(site, MAX_RUNS);
  return [...runs].reverse().find((r) => r.outcome === outcome) || null;
}

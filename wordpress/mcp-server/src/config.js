// Carga de perfiles de sitio y credenciales.
//
// - Perfiles (sin secretos): AUTOBLOG_SITES_DIR, por defecto wordpress/sites/*.json
// - Credenciales: variables de entorno AUTOBLOG_<SITIO>_USER / AUTOBLOG_<SITIO>_APP_PASSWORD
//   o el archivo <AUTOBLOG_HOME>/credentials.json
// - Datos locales (cola de temas): <AUTOBLOG_HOME>/data/<sitio>/

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export function autoblogHome() {
  return process.env.AUTOBLOG_HOME || path.join(os.homedir(), ".autoblog");
}

export function sitesDir() {
  return process.env.AUTOBLOG_SITES_DIR || path.resolve(here, "..", "..", "sites");
}

export function dataDir(siteId) {
  const dir = path.join(autoblogHome(), "data", siteId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const DEFAULT_PROFILE = {
  enabled: true,
  language: "es",
  tone: "cercano, claro y bien documentado",
  frequency: { everyHours: 24, maxPostsPerRun: 1 },
  publishing: { status: "publish", minQualityScore: 7, author: null, defaultCategory: null },
  content: {
    minWords: 900,
    maxWords: 1600,
    minSources: 3,
    includeFaq: true,
    includeSourcesSection: true,
    internalLinks: 3,
  },
  categories: [],
  topics: { pillars: [], seedTopics: [], avoid: [] },
  sources: { preferred: [], blocked: [] },
  images: {
    featured: ["magnific", "higgsfield", "internet"],
    inContent: 1,
    style: "fotografía editorial realista, luz natural, sin texto",
    aspectRatio: "16:9",
    internetProviders: ["openverse", "wikimedia", "pexels"],
  },
  seo: { plugin: "auto" },
};

function deepMerge(base, extra) {
  if (Array.isArray(base) || Array.isArray(extra)) return extra ?? base;
  if (typeof base !== "object" || base === null) return extra ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = k in base ? deepMerge(base[k], v) : v;
  }
  return out;
}

export function envKey(siteId) {
  return siteId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

export function loadSites() {
  const dir = sitesDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => {
      const raw = readJson(path.join(dir, f));
      const id = raw.id || path.basename(f, ".json");
      const profile = deepMerge(DEFAULT_PROFILE, { ...raw, id });
      if (!profile.url) throw new Error(`El perfil ${f} no tiene "url"`);
      profile.url = profile.url.replace(/\/+$/, "");
      return profile;
    });
}

export function getSite(siteId) {
  const site = loadSites().find((s) => s.id === siteId);
  if (!site) {
    const ids = loadSites().map((s) => s.id).join(", ") || "(ninguno)";
    throw new Error(`No existe el sitio "${siteId}". Sitios disponibles: ${ids}`);
  }
  return site;
}

function credentialsFile() {
  return path.join(autoblogHome(), "credentials.json");
}

export function getCredentials(siteId) {
  const key = envKey(siteId);
  const user = process.env[`AUTOBLOG_${key}_USER`];
  const appPassword = process.env[`AUTOBLOG_${key}_APP_PASSWORD`];
  if (user && appPassword) return { user, appPassword, source: "env" };

  const file = credentialsFile();
  if (fs.existsSync(file)) {
    const all = readJson(file);
    const c = all[siteId];
    if (c?.user && c?.appPassword) return { user: c.user, appPassword: c.appPassword, source: "file" };
  }
  return null;
}

export function requireCredentials(siteId) {
  const c = getCredentials(siteId);
  if (!c) {
    const key = envKey(siteId);
    throw new Error(
      `Faltan credenciales para "${siteId}". Define AUTOBLOG_${key}_USER y AUTOBLOG_${key}_APP_PASSWORD, ` +
        `o añade el sitio a ${credentialsFile()}.`
    );
  }
  return c;
}

// Claves de servicios: variable de entorno o "_keys" dentro de credentials.json
export function apiKey(name) {
  if (process.env[name]) return process.env[name];
  const file = credentialsFile();
  if (fs.existsSync(file)) {
    try {
      return readJson(file)._keys?.[name] || null;
    } catch {
      return null;
    }
  }
  return null;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

export function saveProfile(profile) {
  if (!ID_RE.test(profile.id || "")) throw new Error('El "id" debe ser minúsculas, números o guiones (p. ej. "viajesok")');
  if (!/^https?:\/\/[^/]+/.test(profile.url || "")) throw new Error('El "url" debe empezar por https://');
  const dir = sitesDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${profile.id}.json`);
  const existed = fs.existsSync(file);
  fs.writeFileSync(file, JSON.stringify(profile, null, 2) + "\n");
  return { file, created: !existed };
}

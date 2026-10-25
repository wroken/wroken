// Cliente de la API REST de WordPress (autenticación con contraseña de aplicación).

import { requireCredentials } from "./config.js";
import { request } from "./http.js";

const SEO_META = {
  rankmath: { title: "rank_math_title", description: "rank_math_description", focus_keyword: "rank_math_focus_keyword" },
  yoast: { title: "_yoast_wpseo_title", description: "_yoast_wpseo_metadesc", focus_keyword: "_yoast_wpseo_focuskw" },
};

const infoCache = new Map();

function authHeader(site) {
  const { user, appPassword } = requireCredentials(site.id);
  return "Basic " + Buffer.from(`${user}:${appPassword}`).toString("base64");
}

export async function wp(site, route, { method = "GET", query, json, body, headers = {}, auth = true, timeoutMs } = {}) {
  const url = new URL(`${site.url}/wp-json/${route.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const h = { Accept: "application/json", ...headers };
  if (auth) h.Authorization = authHeader(site);
  if (json !== undefined) {
    h["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }
  const res = await request(url.toString(), { method, headers: h, body, timeoutMs });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = data?.message || (typeof data === "string" ? data.slice(0, 300) : res.statusText);
    const hint =
      res.status === 401
        ? " (revisa usuario y contraseña de aplicación; si el servidor es Apache, mira la sección 'Error 401' del README)"
        : "";
    throw new Error(`WordPress ${site.id}: HTTP ${res.status} en ${route}: ${msg}${hint}`);
  }
  return { data, headers: res.headers };
}

export async function siteInfo(site, { refresh = false } = {}) {
  if (!refresh && infoCache.has(site.id)) return infoCache.get(site.id);
  const { data } = await wp(site, "", { auth: false });
  const ns = data?.namespaces || [];
  let seo = site.seo?.plugin && site.seo.plugin !== "auto" ? site.seo.plugin : "none";
  if (site.seo?.plugin === "auto" || !site.seo?.plugin) {
    if (ns.some((n) => n.startsWith("rankmath"))) seo = "rankmath";
    else if (ns.some((n) => n.startsWith("yoast"))) seo = "yoast";
  }
  const info = {
    name: data?.name,
    description: data?.description,
    seoPlugin: seo,
    bridge: ns.includes("autoblog/v1"),
    namespaces: ns,
  };
  infoCache.set(site.id, info);
  return info;
}

export async function me(site) {
  const { data } = await wp(site, "wp/v2/users/me", { query: { context: "edit" } });
  return data;
}

export async function checkSite(site) {
  const info = await siteInfo(site, { refresh: true });
  const user = await me(site);
  const caps = user.capabilities || {};
  return {
    site: site.id,
    url: site.url,
    name: info.name,
    user: user.username || user.name,
    canPublish: Boolean(caps.publish_posts),
    canUpload: Boolean(caps.upload_files),
    seoPlugin: info.seoPlugin,
    bridgeInstalled: info.bridge,
  };
}

export async function recentPosts(site, { count = 20, search, onlyMine = false } = {}) {
  const query = {
    per_page: Math.min(Math.max(count, 1), 100),
    orderby: "date",
    order: "desc",
    _fields: "id,date,link,title,slug,categories,tags,author",
    search,
  };
  if (onlyMine) query.author = (await me(site)).id;
  const { data } = await wp(site, "wp/v2/posts", { query });
  return data.map((p) => ({
    id: p.id,
    date: p.date,
    title: decodeEntities(p.title?.rendered || ""),
    link: p.link,
    slug: p.slug,
    categories: p.categories,
    tags: p.tags,
  }));
}

export async function listTerms(site, taxonomy = "categories") {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const { data, headers } = await wp(site, `wp/v2/${taxonomy}`, {
      query: { per_page: 100, page, _fields: "id,name,slug,count,parent" },
    });
    out.push(...data);
    if (page >= Number(headers.get("x-wp-totalpages") || 1)) break;
  }
  return out;
}

function norm(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

// Convierte nombres en IDs. Las etiquetas se crean si no existen; las categorías solo si
// el perfil lo permite (publishing.allowNewCategories), si no se usa la categoría por defecto.
export async function resolveTerms(site, taxonomy, names = []) {
  names = names || [];
  const existing = await listTerms(site, taxonomy);
  const ids = [];
  const skipped = [];
  for (const name of names) {
    const found = existing.find((t) => norm(t.name) === norm(name) || t.slug === norm(name).replace(/\s+/g, "-"));
    if (found) {
      ids.push(found.id);
      continue;
    }
    const mayCreate = taxonomy === "tags" || site.publishing?.allowNewCategories;
    if (!mayCreate) {
      skipped.push(name);
      continue;
    }
    try {
      const { data } = await wp(site, `wp/v2/${taxonomy}`, { method: "POST", json: { name } });
      ids.push(data.id);
      existing.push(data);
    } catch (e) {
      // term_exists devuelve el id existente
      const m = /term_id["']?:\s*(\d+)/.exec(e.message);
      if (m) ids.push(Number(m[1]));
      else skipped.push(name);
    }
  }
  if (taxonomy === "categories" && ids.length === 0 && site.publishing?.defaultCategory) {
    const def = existing.find((t) => norm(t.name) === norm(site.publishing.defaultCategory));
    if (def) ids.push(def.id);
  }
  return { ids: [...new Set(ids)], skipped };
}

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

export function slugify(s, max = 60) {
  return (
    norm(s)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max) || "imagen"
  );
}

export async function uploadMedia(site, { buffer, contentType, filename, altText, caption, title, description }) {
  if (!contentType?.startsWith("image/")) throw new Error(`El archivo no es una imagen (content-type: ${contentType || "desconocido"})`);
  const ext = EXT[contentType] || contentType.split("/")[1] || "jpg";
  const base = slugify(filename ? filename.replace(/\.[a-z0-9]+$/i, "") : title || altText || "imagen");
  const { data } = await wp(site, "wp/v2/media", {
    method: "POST",
    body: buffer,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${base}.${ext}"`,
    },
    timeoutMs: 120000,
  });
  const meta = {};
  if (altText) meta.alt_text = altText;
  if (caption) meta.caption = caption;
  if (title) meta.title = title;
  if (description) meta.description = description;
  let media = data;
  if (Object.keys(meta).length) media = (await wp(site, `wp/v2/media/${data.id}`, { method: "POST", json: meta })).data;
  return {
    id: media.id,
    url: media.source_url,
    sizes: Object.fromEntries(Object.entries(media.media_details?.sizes || {}).map(([k, v]) => [k, v.source_url])),
  };
}

async function buildPostPayload(site, input) {
  const payload = {};
  for (const k of ["title", "content", "excerpt", "slug", "date", "featured_media", "author", "comment_status"]) {
    if (input[k] !== undefined && input[k] !== null) payload[k] = input[k];
  }
  if (input.status) payload.status = input.status;
  const warnings = [];
  if (input.categories) {
    const r = await resolveTerms(site, "categories", input.categories);
    payload.categories = r.ids;
    if (r.skipped.length) warnings.push(`Categorías inexistentes omitidas: ${r.skipped.join(", ")}`);
  }
  if (input.tags) {
    const r = await resolveTerms(site, "tags", input.tags);
    payload.tags = r.ids;
    if (r.skipped.length) warnings.push(`Etiquetas omitidas: ${r.skipped.join(", ")}`);
  }

  const info = await siteInfo(site);
  if (info.bridge) {
    const meta = {};
    const keys = SEO_META[info.seoPlugin];
    if (keys && input.seo) {
      for (const [field, metaKey] of Object.entries(keys)) if (input.seo[field]) meta[metaKey] = input.seo[field];
    }
    if (input.sources?.length) meta._autoblog_sources = JSON.stringify(input.sources);
    if (input.quality_score !== undefined) meta._autoblog_quality = String(input.quality_score);
    if (Object.keys(meta).length) payload.meta = meta;
  } else if (input.seo && info.seoPlugin !== "none") {
    warnings.push(
      `SEO (${info.seoPlugin}) no aplicado: instala el plugin "Autoblog Bridge" en el sitio para poder escribir el título y la meta descripción.`
    );
  }
  return { payload, warnings };
}

export async function createPost(site, input) {
  const { payload, warnings } = await buildPostPayload(site, input);
  if (!payload.status) payload.status = site.publishing?.status || "draft";
  if (!payload.author && site.publishing?.author) payload.author = site.publishing.author;
  const { data } = await wp(site, "wp/v2/posts", { method: "POST", json: payload });
  return { id: data.id, status: data.status, link: data.link, slug: data.slug, warnings };
}

export async function updatePost(site, postId, input) {
  const { payload, warnings } = await buildPostPayload(site, input);
  const { data } = await wp(site, `wp/v2/posts/${postId}`, { method: "POST", json: payload });
  return { id: data.id, status: data.status, link: data.link, warnings };
}

export async function lastPostByMe(site) {
  const meId = (await me(site)).id;
  const { data } = await wp(site, "wp/v2/posts", {
    query: { author: meId, per_page: 1, orderby: "date", order: "desc", status: "publish,future", _fields: "id,date_gmt,link,title" },
  });
  return data[0] || null;
}

const NAMED = {
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Uuml: "Ü",
  iexcl: "¡", iquest: "¿", laquo: "«", raquo: "»", ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", deg: "°", copy: "©", reg: "®", euro: "€",
};

export function decodeEntities(s) {
  return String(s)
    .replace(/&([a-zA-Z]+);/g, (m, n) => NAMED[n] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

#!/usr/bin/env node
// Servidor MCP "autoblog": herramientas para que Claude investigue, redacte,
// ilustre y publique artículos en varios sitios WordPress.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { autoblogHome, envKey, getCredentials, getSite, inPublishingWindow, loadSites, localHour, saveProfile, sitesDir } from "./config.js";
import { checkUrl, cleanHtml, domainOf, similarTitles, titleIssues, validateLinks, verifyAgainstSources, wordCount } from "./content.js";
import { download } from "./http.js";
import { searchImages } from "./images.js";
import { fetchReadable, searchProviders, webSearch } from "./research.js";
import { contentScore, keywordIdeas, opportunities, scProperty, searchConsoleConfigured, searchConsoleQuery, serpAnalysis } from "./seo.js";
import { acquireLock, addTopics, lastRunWith, listTopics, logRun, markTopicUsed, nextTopic, recentRuns, releaseLock } from "./store.js";
import * as wp from "./wordpress.js";

const VERSION = "1.1.0";
const server = new McpServer({ name: "autoblog", version: VERSION });

function ok(data) {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

function tool(name, description, inputSchema, handler, annotations = {}) {
  server.registerTool(name, { description, inputSchema, annotations }, async (args) => {
    try {
      return ok(await handler(args));
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  });
}

const siteArg = z.string().describe("ID del sitio (nombre del archivo de perfil, p. ej. 'wroken')");

function normTitle(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function hoursSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - Date.parse(/Z$|[+-]\d\d:\d\d$/.test(iso) ? iso : iso + "Z")) / 36e5;
}

const round1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);

// ---------- Sitios ----------

tool("sites_list", "Lista los sitios configurados, si están activos y si tienen credenciales.", {}, async () => ({
  version: VERSION,
  sitesDir: sitesDir(),
  autoblogHome: autoblogHome(),
  searchProviders: searchProviders(),
  searchConsole: searchConsoleConfigured(),
  sites: loadSites().map((s) => ({
    id: s.id,
    name: s.name,
    url: s.url,
    enabled: s.enabled,
    language: s.language,
    everyHours: s.frequency?.everyHours,
    credentials: getCredentials(s.id) ? "ok" : `faltan (AUTOBLOG_${envKey(s.id)}_USER / _APP_PASSWORD)`,
  })),
}), { readOnlyHint: true });

tool("site_get", "Devuelve el perfil editorial completo de un sitio (temática, tono, reglas de contenido, imágenes, SEO).", { site: siteArg }, async ({ site }) => getSite(site), {
  readOnlyHint: true,
});

tool(
  "site_save_profile",
  "Crea o actualiza el perfil editorial de un sitio (sin credenciales). Si el sitio ya existe, los campos indicados se combinan con los actuales.",
  {
    profile: z
      .object({ id: z.string(), url: z.string().optional(), name: z.string().optional() })
      .passthrough()
      .describe("Campos del perfil, con la misma forma que sites/_plantilla.json"),
  },
  async ({ profile }) => {
    let current = {};
    const f = path.join(sitesDir(), `${profile.id}.json`);
    if (fs.existsSync(f)) current = JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
    const merged = { ...current, ...profile };
    for (const k of Object.keys(profile)) {
      if (profile[k] && typeof profile[k] === "object" && !Array.isArray(profile[k]) && current[k] && typeof current[k] === "object") {
        merged[k] = { ...current[k], ...profile[k] };
      }
    }
    const res = saveProfile(merged);
    return { ...res, credentials: getCredentials(profile.id) ? "ok" : `faltan: ejecuta el script configurar-sitio con el id "${profile.id}"` };
  }
);

tool(
  "site_check",
  "Comprueba la conexión con un sitio: autenticación, permisos, plugin SEO detectado, si el plugin Autoblog Bridge está instalado y si hay acceso a Search Console.",
  { site: siteArg },
  async ({ site }) => {
    const s = getSite(site);
    const r = await wp.checkSite(s);
    let searchConsole = "no configurado";
    if (searchConsoleConfigured()) {
      try {
        await searchConsoleQuery(s, { days: 7, dimensions: ["query"], rowLimit: 1 });
        searchConsole = `ok (${scProperty(s)})`;
      } catch (e) {
        searchConsole = `error: ${e.message}`;
      }
    }
    return { ...r, searchConsole };
  },
  { readOnlyHint: true }
);

tool(
  "sites_due",
  "Indica a qué sitios activos les toca publicar ahora (según frequency.everyHours, la franja horaria publishing.hours y el último artículo del usuario de Autoblog, incluidos borradores) y a cuáles les toca actualizar un artículo antiguo.",
  { ignore_hours: z.boolean().default(false).describe("Ignorar la franja horaria (si el usuario lo pide expresamente)") },
  async ({ ignore_hours }) => {
    const out = [];
    for (const s of loadSites().filter((x) => x.enabled)) {
      if (!getCredentials(s.id)) {
        out.push({ site: s.id, due: false, reason: "sin credenciales" });
        continue;
      }
      if (/REVISAR/.test(s.niche || "")) {
        out.push({ site: s.id, due: false, reason: "perfil sin terminar (REVISAR en niche)" });
        continue;
      }
      try {
        const last = await wp.lastActivityByMe(s);
        const hours = hoursSince(last?.date_gmt);
        const every = s.frequency?.everyHours ?? 24;
        const inWindow = ignore_hours || inPublishingWindow(s);
        let refreshDue = false;
        if (s.refresh?.enabled) {
          const lastRefresh = await lastRunWith(s, "refreshed");
          refreshDue = hoursSince(lastRefresh?.at) >= (s.refresh.everyHours ?? 168);
          if (refreshDue) refreshDue = (await wp.stalePosts(s, { olderThanDays: s.refresh.olderThanDays ?? 270, count: 1 })).length > 0;
        }
        out.push({
          site: s.id,
          due: hours >= every && inWindow,
          refreshDue: refreshDue && inWindow,
          reason: hours < every ? `faltan ${round1(every - hours)} h` : inWindow ? undefined : `fuera de la franja ${s.publishing.hours.join("–")} h (ahora ${localHour(s)} h)`,
          last: last ? { date: last.date_gmt, status: last.status, link: last.link } : null,
          hoursSinceLast: round1(hours),
          everyHours: every,
          maxPostsPerRun: s.frequency?.maxPostsPerRun ?? 1,
        });
      } catch (e) {
        out.push({ site: s.id, due: false, reason: e.message });
      }
    }
    return { due: out.filter((x) => x.due).map((x) => x.site), refreshDue: out.filter((x) => x.refreshDue).map((x) => x.site), sites: out };
  },
  { readOnlyHint: true }
);

// ---------- Ejecución ----------

tool(
  "run_begin",
  "Empieza una ejecución en un sitio: bloquea el sitio (en WordPress si tiene el plugin Bridge, así el PC y la nube no publican a la vez) y devuelve el perfil, el siguiente tema, los artículos recientes y las categorías.",
  { site: siteArg, mode: z.enum(["new", "refresh"]).default("new") },
  async ({ site, mode }) => {
    const s = getSite(site);
    const runId = randomUUID();
    const lock = await acquireLock(s, runId);
    if (!lock.ok) return { started: false, reason: `Ya hay una ejecución en curso (${lock.scope}) desde ${lock.since || "?"}`, lock };
    try {
      const [info, recent, categories, topic] = await Promise.all([
        wp.siteInfo(s),
        wp.recentPosts(s, { count: 40 }),
        wp.listTerms(s, "categories"),
        mode === "new" ? nextTopic(s) : null,
      ]);
      return {
        started: true,
        runId,
        mode,
        profile: s,
        site: { name: info.name, seoPlugin: info.seoPlugin, bridgeInstalled: info.bridge, lockScope: lock.scope },
        searchConsole: searchConsoleConfigured(),
        nextTopic: topic,
        staleCandidates: mode === "refresh" ? await wp.stalePosts(s, { olderThanDays: s.refresh?.olderThanDays ?? 270, count: 10 }) : undefined,
        recentPosts: recent.map((p) => ({ title: p.title, link: p.link, date: p.date })),
        categories: categories.map((c) => c.name),
      };
    } catch (e) {
      await releaseLock(s, runId);
      throw e;
    }
  }
);

function notifyHtml(site, { outcome, topic, post_url, notes }) {
  const esc = (x) => String(x ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  return `<p><strong>${esc(site.name || site.id)}</strong>: ${esc(outcome)}</p>` + (topic ? `<p>Tema: ${esc(topic)}</p>` : "") + (post_url ? `<p><a href="${esc(post_url)}">${esc(post_url)}</a></p>` : "") + (notes ? `<p>${esc(notes)}</p>` : "");
}

tool(
  "run_end",
  "Cierra una ejecución: libera el bloqueo, registra el resultado, marca el tema como usado y envía el aviso por correo si el perfil lo pide (notify).",
  {
    site: siteArg,
    run_id: z.string(),
    outcome: z.enum(["published", "draft", "refreshed", "skipped", "failed"]),
    topic: z.string().optional(),
    post_id: z.number().int().optional(),
    post_url: z.string().optional(),
    notes: z.string().optional().describe("Resumen breve: fuentes usadas, origen de la imagen, puntuaciones, avisos o errores"),
  },
  async ({ site, run_id, outcome, topic, post_id, post_url, notes }) => {
    const s = getSite(site);
    try {
      if (topic && (outcome === "published" || outcome === "draft")) await markTopicUsed(s, topic, { postId: post_id, postUrl: post_url });
      await logRun(s, { runId: run_id, outcome, topic, postId: post_id, postUrl: post_url, notes });
    } finally {
      await releaseLock(s, run_id);
    }
    const n = s.notify || {};
    const wants = (outcome === "published" && n.onPublish) || (outcome === "draft" && n.onDraft) || (outcome === "failed" && n.onFail) || (outcome === "refreshed" && n.onPublish);
    let notified = false;
    if (wants) {
      try {
        const r = await wp.notify(s, { to: n.email, subject: `Autoblog ${s.name || s.id}: ${outcome}`, body: notifyHtml(s, { outcome, topic, post_url, notes }) });
        notified = r.ok;
      } catch {
        notified = false;
      }
    }
    return { ok: true, notified };
  }
);

tool(
  "notify_send",
  "Envía un correo con el sistema de correo del WordPress del sitio (requiere el plugin Bridge). Útil para el resumen final de una ejecución con varios sitios.",
  { site: siteArg, subject: z.string(), body_html: z.string(), to: z.string().email().optional() },
  async ({ site, subject, body_html, to }) => {
    const s = getSite(site);
    return wp.notify(s, { to: to || s.notify?.email, subject, body: body_html });
  }
);

tool("runs_recent", "Últimas ejecuciones registradas en un sitio (resultado, tema, URL, notas).", { site: siteArg, count: z.number().int().min(1).max(100).default(10) }, async ({ site, count }) => recentRuns(getSite(site), count), {
  readOnlyHint: true,
});

// ---------- Temas ----------

tool(
  "topics_add",
  "Añade temas a la cola de un sitio (se ignoran duplicados).",
  {
    site: siteArg,
    topics: z
      .array(z.union([z.string(), z.object({ topic: z.string(), keyword: z.string().optional(), notes: z.string().optional() })]))
      .min(1),
  },
  async ({ site, topics }) => addTopics(getSite(site), topics)
);

tool("topics_next", "Devuelve el siguiente tema pendiente de un sitio, o los pilares temáticos si la cola está vacía.", { site: siteArg }, async ({ site }) => nextTopic(getSite(site)), {
  readOnlyHint: true,
});

tool("topics_list", "Muestra la cola de temas y los temas ya usados de un sitio.", { site: siteArg }, async ({ site }) => listTopics(getSite(site)), {
  readOnlyHint: true,
});

tool(
  "topics_check_similar",
  "Comprueba si un tema o título se parece a artículos ya publicados en el sitio (busca en todo el sitio, no solo en los recientes). Úsalo antes de escribir.",
  { site: siteArg, topic: z.string(), keywords: z.array(z.string()).optional().describe("2–4 palabras clave del tema para buscar en el sitio") },
  async ({ site, topic, keywords }) => {
    const s = getSite(site);
    const kws = keywords?.length ? keywords : [topic];
    const [recent, related] = await Promise.all([wp.recentPosts(s, { count: 100 }), wp.findRelated(s, kws, { count: 30 })]);
    const pool = new Map([...recent, ...related].map((p) => [p.link, p]));
    const similar = similarTitles(topic, [...pool.values()], 0.5);
    return {
      topic,
      verdict: similar.some((x) => x.score >= 0.85) ? "muy_parecido" : similar.length ? "parecido" : "nuevo",
      similar: similar.slice(0, 10),
      advice:
        similar.length && similar[0].score >= 0.85
          ? "Ya existe un artículo casi igual: actualiza ese (modo refresh) o elige otro ángulo muy distinto."
          : similar.length
            ? "Hay artículos cercanos: diferencia el ángulo y enlázalos."
            : "Tema nuevo para el sitio.",
    };
  },
  { readOnlyHint: true }
);

// ---------- SEO ----------

tool(
  "seo_keyword_ideas",
  "Ideas de palabras clave reales a partir del autocompletado de Google (lo que la gente escribe), con preguntas y la intención de búsqueda. Sin clave; no da volumen.",
  {
    seed: z.string().describe("Tema o palabra clave base, p. ej. 'qué ver en valparaíso'"),
    language: z.string().default("es-CL").describe("Idioma-país, p. ej. es-CL, es-ES, en-US"),
    alphabet: z.boolean().default(false).describe("Ampliar con 'seed a', 'seed b'… (más ideas, más lento)"),
  },
  async ({ seed, language, alphabet }) => keywordIdeas(seed, { language, alphabet }),
  { readOnlyHint: true, openWorldHint: true }
);

tool(
  "seo_opportunities",
  "Oportunidades SEO del sitio según Google Search Console: ideas de artículos nuevos (búsquedas donde el sitio aparece muy abajo), artículos que mejorar (puesto 4–20) y títulos que mejorar (buena posición, pocos clics).",
  { site: siteArg, days: z.number().int().min(7).max(480).default(90), min_impressions: z.number().int().min(1).default(30) },
  async ({ site, days, min_impressions }) => opportunities(getSite(site), { days, minImpressions: min_impressions }),
  { readOnlyHint: true, openWorldHint: true }
);

tool(
  "seo_search_console",
  "Consulta directa a Google Search Console del sitio (clics, impresiones, CTR y posición por búsqueda y/o página).",
  {
    site: siteArg,
    days: z.number().int().min(1).max(480).default(28),
    dimensions: z.array(z.enum(["query", "page", "country", "device", "date"])).default(["query"]),
    query_contains: z.string().optional(),
    page_contains: z.string().optional(),
    row_limit: z.number().int().min(1).max(25000).default(100),
  },
  async ({ site, days, dimensions, query_contains, page_contains, row_limit }) =>
    searchConsoleQuery(getSite(site), { days, dimensions, query: query_contains, page: page_contains, rowLimit: row_limit }),
  { readOnlyHint: true, openWorldHint: true }
);

tool(
  "seo_serp_analysis",
  "Analiza los primeros resultados de Google para una palabra clave (como SEOWriting.ai o Surfer): longitud recomendada, encabezados de los competidores, términos que usan varios de ellos y preguntas. Sin Tavily/Brave, pasa las URLs de los primeros resultados.",
  {
    keyword: z.string(),
    urls: z.array(z.string().url()).optional().describe("URLs de los primeros resultados orgánicos (si no hay buscador configurado)"),
    count: z.number().int().min(3).max(10).default(8),
  },
  async ({ keyword, urls, count }) => serpAnalysis(keyword, { urls, count }),
  { readOnlyHint: true, openWorldHint: true }
);

tool(
  "seo_content_score",
  "Puntúa el SEO de un borrador (0–100): palabra clave en título, intro, H2 y meta; longitud frente a los competidores; cobertura de términos del análisis de resultados; legibilidad; imágenes; enlaces; FAQ. Devuelve qué corregir y los términos que faltan.",
  {
    content: z.string(),
    keyword: z.string(),
    title: z.string(),
    seo_title: z.string().optional(),
    meta_description: z.string().optional(),
    slug: z.string().optional(),
    terms: z.array(z.object({ term: z.string() }).passthrough()).optional().describe("'terms' de seo_serp_analysis"),
    recommended_words: z.number().int().optional().describe("wordCount.recommended de seo_serp_analysis"),
  },
  async (a) =>
    contentScore({
      content: cleanHtml(a.content),
      keyword: a.keyword,
      title: a.title,
      seoTitle: a.seo_title,
      metaDescription: a.meta_description,
      slug: a.slug,
      terms: a.terms,
      recommendedWords: a.recommended_words,
    }),
  { readOnlyHint: true }
);

// ---------- Investigación ----------

tool(
  "research_search",
  "Busca fuentes en la web (Tavily o Brave si hay API key). Si no hay ninguna configurada, usa la búsqueda web propia de Claude.",
  {
    query: z.string(),
    max_results: z.number().int().min(1).max(20).default(8),
    recent_days: z.number().int().min(1).optional().describe("Limitar a noticias de los últimos N días"),
    news: z.boolean().default(false),
    site: siteArg.optional().describe("Si se indica, aplica los dominios bloqueados del perfil"),
  },
  async ({ query, max_results, recent_days, news, site }) => {
    const s = site ? getSite(site) : null;
    return webSearch(query, { maxResults: max_results, recentDays: recent_days, news, blockedDomains: s?.sources?.blocked });
  },
  { readOnlyHint: true, openWorldHint: true }
);

tool(
  "research_fetch",
  "Lee una página web y devuelve su texto limpio, título, fecha, autor e imagen principal, para usarla como fuente.",
  { url: z.string().url(), max_chars: z.number().int().min(1000).max(60000).default(12000) },
  async ({ url, max_chars }) => fetchReadable(url, { maxChars: max_chars }),
  { readOnlyHint: true, openWorldHint: true }
);

// ---------- Imágenes ----------

tool(
  "images_search",
  "Busca fotos reales en internet con licencia que permite uso comercial (Openverse, Wikimedia Commons, Pexels). Devuelve URL, licencia y el HTML de atribución que hay que poner como pie de foto.",
  {
    query: z.string().describe("Búsqueda en inglés suele dar más resultados"),
    providers: z.array(z.enum(["openverse", "wikimedia", "pexels"])).optional(),
    count: z.number().int().min(1).max(20).default(6),
    orientation: z.enum(["landscape", "portrait", "square"]).default("landscape"),
  },
  async ({ query, providers, count, orientation }) => searchImages(query, { providers, count, orientation }),
  { readOnlyHint: true, openWorldHint: true }
);

// ---------- WordPress ----------

tool(
  "wp_recent_posts",
  "Lista artículos recientes de un sitio, opcionalmente filtrando por texto.",
  { site: siteArg, count: z.number().int().min(1).max(100).default(20), search: z.string().optional() },
  async ({ site, count, search }) => wp.recentPosts(getSite(site), { count, search }),
  { readOnlyHint: true }
);

tool(
  "wp_find_related",
  "Busca en TODO el sitio artículos relacionados con unas palabras clave, para el enlazado interno. Ordena por cuántas palabras clave coinciden.",
  { site: siteArg, keywords: z.array(z.string()).min(1).max(8), count: z.number().int().min(1).max(30).default(10), exclude_ids: z.array(z.number().int()).optional() },
  async ({ site, keywords, count, exclude_ids }) => wp.findRelated(getSite(site), keywords, { count, excludeIds: exclude_ids || [] }),
  { readOnlyHint: true }
);

tool(
  "wp_stale_posts",
  "Artículos publicados que no se actualizan hace más de N días (candidatos a actualizar con datos nuevos).",
  { site: siteArg, older_than_days: z.number().int().min(30).default(270), count: z.number().int().min(1).max(50).default(10) },
  async ({ site, older_than_days, count }) => wp.stalePosts(getSite(site), { olderThanDays: older_than_days, count }),
  { readOnlyHint: true }
);

tool(
  "wp_get_post",
  "Devuelve un artículo completo (HTML editable, extracto, categorías, metadatos) para revisarlo o actualizarlo.",
  { site: siteArg, post_id: z.number().int() },
  async ({ site, post_id }) => wp.getPost(getSite(site), post_id),
  { readOnlyHint: true }
);

tool(
  "wp_terms",
  "Lista las categorías o etiquetas existentes de un sitio.",
  { site: siteArg, taxonomy: z.enum(["categories", "tags"]).default("categories") },
  async ({ site, taxonomy }) => (await wp.listTerms(getSite(site), taxonomy)).map((t) => ({ id: t.id, name: t.name, count: t.count })),
  { readOnlyHint: true }
);

const MIN_FEATURED_WIDTH = 1200;

tool(
  "wp_upload_media",
  "Sube una imagen a la biblioteca de medios de un sitio desde una URL (p. ej. la devuelta por Higgsfield, Magnific o images_search), un archivo local o base64. Devuelve el ID para usar como imagen destacada.",
  {
    site: siteArg,
    source_url: z.string().url().optional(),
    file_path: z.string().optional(),
    base64: z.string().optional(),
    content_type: z.string().optional().describe("Obligatorio con base64, p. ej. image/png"),
    filename: z.string().optional().describe("Nombre SEO del archivo, sin extensión"),
    alt_text: z.string().describe("Texto alternativo descriptivo (SEO y accesibilidad)"),
    caption: z.string().optional().describe("Pie de foto. Para fotos de internet, la atribución (attributionHtml)"),
    title: z.string().optional(),
  },
  async ({ site, source_url, file_path, base64, content_type, filename, alt_text, caption, title }) => {
    const s = getSite(site);
    let buffer;
    let type = content_type;
    if (source_url) {
      const d = await download(source_url);
      buffer = d.buffer;
      type = type || d.contentType;
    } else if (file_path) {
      buffer = fs.readFileSync(file_path);
      const ext = path.extname(file_path).toLowerCase();
      type = type || { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif" }[ext];
      filename = filename || path.basename(file_path, ext);
    } else if (base64) {
      buffer = Buffer.from(base64.replace(/^data:[^,]+,/, ""), "base64");
    } else {
      throw new Error("Indica source_url, file_path o base64");
    }
    if (!type || type === "application/octet-stream") type = sniffImageType(buffer);
    const res = await wp.uploadMedia(s, { buffer, contentType: type, filename, altText: alt_text, caption, title });
    const warnings = [];
    if (res.width && res.width < MIN_FEATURED_WIDTH) warnings.push(`La imagen mide ${res.width} px de ancho: para imagen destacada se recomienda ≥ ${MIN_FEATURED_WIDTH} px (Google Discover).`);
    if (buffer.length > 3 * 1024 * 1024) warnings.push(`La imagen pesa ${Math.round(buffer.length / 1024 / 1024)} MB; WordPress generará tamaños menores (en WebP si el plugin Bridge está activo).`);
    return { ...res, bytes: buffer.length, warnings };
  }
);

const seoSchema = z
  .object({
    title: z.string().optional().describe("Título SEO (≤ 60 caracteres)"),
    description: z.string().optional().describe("Meta descripción (140–160 caracteres)"),
    focus_keyword: z.string().optional(),
  })
  .optional();

const sourceItem = z.object({
  title: z.string(),
  url: z.string().url(),
  excerpt: z.string().optional().describe("Fragmentos del texto de la fuente que respaldan las cifras y citas (útil si la web bloquea descargas)"),
});
const sourcesSchema = z.array(sourceItem).optional();

tool(
  "content_verify",
  "Comprueba un borrador antes de publicar: que cada cifra y cada cita textual aparezca en las fuentes, que los enlaces funcionen (incluye páginas 404 disfrazadas) y que el título sea correcto. Devuelve lo que hay que corregir.",
  {
    content: z.string().describe("HTML del artículo"),
    sources: z.array(z.union([z.string().url(), sourceItem])).min(1).describe("URLs o {title, url, excerpt}"),
    title: z.string().optional(),
  },
  async ({ content, sources, title }) => {
    const html = cleanHtml(content);
    const [facts, links] = await Promise.all([verifyAgainstSources(html, sources), validateLinks(html)]);
    const urls = sources.map((x) => (typeof x === "string" ? x : x.url));
    return {
      ...facts,
      brokenLinks: links.broken,
      uncheckableLinks: links.unknown,
      distinctPublishers: new Set(urls.map(domainOf)).size,
      titleIssues: title ? titleIssues(title) : [],
      words: wordCount(html),
    };
  },
  { readOnlyHint: true, openWorldHint: true }
);

tool(
  "wp_create_post",
  "Crea un artículo. Salvaguardas: limpia el HTML, quita enlaces rotos, verifica cifras y citas contra las fuentes, revisa el título y lo compara con lo ya publicado; si quality_score < publishing.minQualityScore, hay menos medios distintos que content.minSources, citas sin respaldo, más de 2 cifras sin respaldo o un artículo casi igual, se guarda como borrador en vez de publicarse. Rechaza títulos ya publicados.",
  {
    site: siteArg,
    title: z.string(),
    content: z.string().describe("HTML del artículo (bloques <h2>, <p>, <ul>, <figure>…)"),
    excerpt: z.string().optional(),
    slug: z.string().optional(),
    status: z.enum(["publish", "draft", "pending", "future"]).optional().describe("Por defecto, publishing.status del perfil"),
    date: z.string().optional().describe("Fecha ISO para programar (con status 'future')"),
    categories: z.array(z.string()).optional().describe("Nombres de categorías"),
    tags: z.array(z.string()).optional().describe("Nombres de etiquetas (se crean si no existen)"),
    featured_media: z.number().int().optional(),
    seo: seoSchema,
    sources: sourcesSchema,
    quality_score: z.number().min(0).max(10).describe("Autoevaluación del artículo (0–10) según la rúbrica de la skill"),
    seo_score: z.number().min(0).max(100).optional().describe("Resultado de seo_content_score"),
    validate_links: z.boolean().default(true).describe("Comprobar enlaces y fuentes; los rotos se quitan"),
    verify_facts: z.boolean().default(true).describe("Comprobar cifras y citas contra las fuentes"),
  },
  async (input) => {
    const s = getSite(input.site);
    const existing = await wp.recentPosts(s, { count: 10, search: input.title });
    if (existing.some((p) => normTitle(p.title) === normTitle(input.title))) {
      throw new Error(`Ya existe un artículo con el título "${input.title}". Cambia el enfoque o el título.`);
    }

    const warnings = [];
    const blockers = [];
    input = { ...input, content: cleanHtml(input.content) };
    if (input.validate_links) {
      const v = await validateLinks(input.content);
      input.content = v.html;
      if (v.broken.length) warnings.push(`Enlaces rotos eliminados del texto: ${v.broken.join(", ")}`);
      if (input.sources?.length) {
        const checked = await Promise.all(input.sources.map(async (src) => ({ src, status: await checkUrl(src.url) })));
        const bad = checked.filter((c) => c.status === "invalid");
        if (bad.length) warnings.push(`Fuentes que no responden (no cuentan): ${bad.map((b) => b.src.url).join(", ")}`);
        input.sources = checked.filter((c) => c.status !== "invalid").map((c) => c.src);
      }
    }

    const words = wordCount(input.content);
    if (s.content?.minWords && words < s.content.minWords * 0.8) warnings.push(`Texto corto: ${words} palabras (mínimo del perfil ${s.content.minWords}).`);

    const tIssues = titleIssues(input.title, (input.sources || []).map((x) => x.title));
    if (tIssues.length) warnings.push(`Título: ${tIssues.join("; ")}`);
    if (tIssues.some((i) => i.includes("marcadores") || i.includes("idéntico"))) blockers.push("título no válido");

    const recent = await wp.recentPosts(s, { count: 100 });
    const similar = similarTitles(input.title, recent, 0.6);
    if (similar.length) warnings.push(`Parecido a: ${similar.slice(0, 3).map((x) => `"${x.title}" (${x.score})`).join(", ")}`);
    if (similar.some((x) => x.score >= 0.9)) blockers.push("ya hay un artículo casi igual");

    let facts = null;
    if (input.verify_facts && input.sources?.length) {
      facts = await verifyAgainstSources(input.content, input.sources);
      if (facts.skipped) warnings.push("No se pudo leer ninguna fuente para verificar cifras y citas (pasa 'excerpt' en las fuentes).");
      if (facts.unsupportedQuotes.length) blockers.push(`${facts.unsupportedQuotes.length} cita(s) que no aparecen en las fuentes`);
      if (facts.unsupportedNumbers.length > 2) blockers.push(`${facts.unsupportedNumbers.length} cifras sin respaldo en las fuentes`);
      else if (facts.unsupportedNumbers.length) warnings.push(`Cifras sin respaldo claro: ${facts.unsupportedNumbers.map((n) => n.number).join(", ")}`);
    }
    const minSeo = s.seo?.minContentScore ?? 70;
    if (input.seo_score !== undefined && input.seo_score < minSeo) warnings.push(`Puntuación SEO ${input.seo_score}/100 por debajo del objetivo del perfil (${minSeo}).`);

    const publishers = new Set((input.sources || []).map((x) => domainOf(x.url))).size;
    let status = input.status || s.publishing?.status || "draft";
    const minScore = s.publishing?.minQualityScore ?? 7;
    const minSources = s.content?.minSources ?? 3;
    if (input.quality_score < minScore) blockers.push(`puntuación ${input.quality_score} < ${minScore}`);
    if (publishers < minSources) blockers.push(`solo ${publishers} medios distintos como fuente (mínimo ${minSources})`);
    if ((status === "publish" || status === "future") && blockers.length) {
      status = "draft";
      warnings.push(`Guardado como BORRADOR para revisión: ${blockers.join("; ")}.`);
    }
    if ((status === "publish" || status === "future") && !input.featured_media) warnings.push("El artículo no tiene imagen destacada.");

    // Las fuentes se guardan sin los extractos (pueden ser largos)
    const sourcesMeta = input.sources?.map(({ title, url }) => ({ title, url }));
    const res = await wp.createPost(s, { ...input, sources: sourcesMeta, status });
    return {
      ...res,
      words,
      distinctPublishers: publishers,
      unsupportedNumbers: facts?.unsupportedNumbers,
      unsupportedQuotes: facts?.unsupportedQuotes,
      similar: similar.slice(0, 3),
      warnings: [...warnings, ...res.warnings],
    };
  }
);

tool(
  "wp_update_post",
  "Actualiza un artículo existente (contenido, estado, imagen destacada, SEO, categorías…). Con refreshed = true marca la fecha de actualización por Autoblog. Si cambias el contenido, verifica antes con content_verify.",
  {
    site: siteArg,
    post_id: z.number().int(),
    title: z.string().optional(),
    content: z.string().optional(),
    excerpt: z.string().optional(),
    status: z.enum(["publish", "draft", "pending", "future", "private"]).optional(),
    categories: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    featured_media: z.number().int().optional(),
    seo: seoSchema,
    sources: sourcesSchema,
    refreshed: z.boolean().optional().describe("true si es una actualización de un artículo antiguo"),
  },
  async ({ site, post_id, content, sources, ...rest }) => {
    const s = getSite(site);
    const input = { ...rest, sources: sources?.map(({ title, url }) => ({ title, url })) };
    const warnings = [];
    if (content !== undefined) {
      const v = await validateLinks(cleanHtml(content));
      input.content = v.html;
      if (v.broken.length) warnings.push(`Enlaces rotos eliminados del texto: ${v.broken.join(", ")}`);
    }
    const res = await wp.updatePost(s, post_id, input);
    return { ...res, warnings: [...warnings, ...res.warnings] };
  }
);

function sniffImageType(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return "image/png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
  if (buf.toString("ascii", 4, 12).startsWith("ftypavi")) return "image/avif";
  return "application/octet-stream";
}

const transport = new StdioServerTransport();
await server.connect(transport);

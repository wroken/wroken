#!/usr/bin/env node
// Servidor MCP "autoblog": herramientas para que Claude investigue, redacte,
// ilustre y publique artículos en varios sitios WordPress.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { autoblogHome, getCredentials, getSite, loadSites, saveProfile, sitesDir, envKey } from "./config.js";
import { checkUrl, cleanHtml, domainOf, titleIssues, validateLinks, verifyAgainstSources, wordCount } from "./content.js";
import { download } from "./http.js";
import { searchImages } from "./images.js";
import { fetchReadable, searchProviders, webSearch } from "./research.js";
import { acquireLock, addTopics, listTopics, logRun, markTopicUsed, nextTopic, recentRuns, releaseLock } from "./store.js";
import * as wp from "./wordpress.js";

const VERSION = "1.0.0";
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
  return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

// ---------- Sitios ----------

tool("sites_list", "Lista los sitios configurados, si están activos y si tienen credenciales.", {}, async () => ({
  sitesDir: sitesDir(),
  autoblogHome: autoblogHome(),
  searchProviders: searchProviders(),
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
  "Comprueba la conexión con un sitio: autenticación, permisos, plugin SEO detectado y si el plugin Autoblog Bridge está instalado.",
  { site: siteArg },
  async ({ site }) => wp.checkSite(getSite(site)),
  { readOnlyHint: true }
);

tool(
  "sites_due",
  "Indica qué sitios activos toca publicar ahora, según su frecuencia (frequency.everyHours) y la fecha del último artículo publicado por el usuario de Autoblog.",
  {},
  async () => {
    const now = Date.now();
    const out = [];
    for (const s of loadSites().filter((x) => x.enabled)) {
      if (!getCredentials(s.id)) {
        out.push({ site: s.id, due: false, reason: "sin credenciales" });
        continue;
      }
      try {
        const last = await wp.lastPostByMe(s);
        const hours = last ? (now - Date.parse(last.date_gmt + "Z")) / 36e5 : Infinity;
        const every = s.frequency?.everyHours ?? 24;
        out.push({
          site: s.id,
          due: hours >= every,
          lastPost: last ? { date: last.date_gmt, link: last.link } : null,
          hoursSinceLast: Number.isFinite(hours) ? Math.round(hours * 10) / 10 : null,
          everyHours: every,
          maxPostsPerRun: s.frequency?.maxPostsPerRun ?? 1,
        });
      } catch (e) {
        out.push({ site: s.id, due: false, reason: e.message });
      }
    }
    return { due: out.filter((x) => x.due).map((x) => x.site), sites: out };
  },
  { readOnlyHint: true }
);

// ---------- Ejecución ----------

tool(
  "run_begin",
  "Empieza una ejecución en un sitio: bloquea el sitio (evita publicaciones duplicadas), y devuelve el perfil, el siguiente tema, los artículos recientes (para no repetir y para enlazado interno) y las categorías disponibles.",
  { site: siteArg },
  async ({ site }) => {
    const s = getSite(site);
    const runId = randomUUID();
    const lock = acquireLock(s.id, runId);
    if (!lock.ok) return { started: false, reason: `Ya hay una ejecución en curso desde ${lock.since}`, lock };
    try {
      const [info, recent, categories] = await Promise.all([
        wp.siteInfo(s),
        wp.recentPosts(s, { count: 40 }),
        wp.listTerms(s, "categories"),
      ]);
      return {
        started: true,
        runId,
        profile: s,
        site: { name: info.name, seoPlugin: info.seoPlugin, bridgeInstalled: info.bridge },
        nextTopic: nextTopic(s),
        recentPosts: recent.map((p) => ({ title: p.title, link: p.link, date: p.date })),
        categories: categories.map((c) => c.name),
      };
    } catch (e) {
      releaseLock(s.id, runId);
      throw e;
    }
  }
);

tool(
  "run_end",
  "Cierra una ejecución: libera el bloqueo, registra el resultado y marca el tema como usado si se publicó.",
  {
    site: siteArg,
    run_id: z.string(),
    outcome: z.enum(["published", "draft", "skipped", "failed"]),
    topic: z.string().optional(),
    post_id: z.number().int().optional(),
    post_url: z.string().optional(),
    notes: z.string().optional().describe("Resumen breve: fuentes usadas, origen de la imagen, puntuación, errores"),
  },
  async ({ site, run_id, outcome, topic, post_id, post_url, notes }) => {
    const s = getSite(site);
    if (topic && (outcome === "published" || outcome === "draft")) markTopicUsed(s.id, topic, { postId: post_id, postUrl: post_url });
    logRun(s.id, { runId: run_id, outcome, topic, postId: post_id, postUrl: post_url, notes });
    releaseLock(s.id, run_id);
    return { ok: true };
  }
);

tool("runs_recent", "Últimas ejecuciones registradas en un sitio (resultado, tema, URL, notas).", { site: siteArg, count: z.number().int().min(1).max(100).default(10) }, async ({ site, count }) => recentRuns(getSite(site).id, count), {
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
  async ({ site, topics }) => addTopics(getSite(site).id, topics)
);

tool("topics_next", "Devuelve el siguiente tema pendiente de un sitio, o los pilares temáticos si la cola está vacía.", { site: siteArg }, async ({ site }) => nextTopic(getSite(site)), {
  readOnlyHint: true,
});

tool("topics_list", "Muestra la cola de temas y los temas ya usados de un sitio.", { site: siteArg }, async ({ site }) => listTopics(getSite(site).id), {
  readOnlyHint: true,
});

// ---------- Investigación ----------

tool(
  "research_search",
  "Busca fuentes en la web (Tavily o Brave si hay API key). Si no hay ninguna configurada, usa la búsqueda web propia de Claude.",
  {
    query: z.string(),
    max_results: z.number().int().min(1).max(20).default(8),
    recent_days: z.number().int().min(1).optional().describe("Limitar a noticias de los últimos N días"),
    news: z.boolean().default(false),
    site: siteArg.optional().describe("Si se indica, aplica los dominios preferidos/bloqueados del perfil"),
  },
  async ({ query, max_results, recent_days, news, site }) => {
    const s = site ? getSite(site) : null;
    return webSearch(query, {
      maxResults: max_results,
      recentDays: recent_days,
      news,
      blockedDomains: s?.sources?.blocked,
    });
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
  "Lista artículos recientes de un sitio, opcionalmente filtrando por texto. Útil para evitar duplicados y para enlazado interno.",
  { site: siteArg, count: z.number().int().min(1).max(100).default(20), search: z.string().optional() },
  async ({ site, count, search }) => wp.recentPosts(getSite(site), { count, search }),
  { readOnlyHint: true }
);

tool(
  "wp_terms",
  "Lista las categorías o etiquetas existentes de un sitio.",
  { site: siteArg, taxonomy: z.enum(["categories", "tags"]).default("categories") },
  async ({ site, taxonomy }) => (await wp.listTerms(getSite(site), taxonomy)).map((t) => ({ id: t.id, name: t.name, count: t.count })),
  { readOnlyHint: true }
);

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
    return wp.uploadMedia(s, { buffer, contentType: type, filename, altText: alt_text, caption, title });
  }
);

const seoSchema = z
  .object({
    title: z.string().optional().describe("Título SEO (≤ 60 caracteres)"),
    description: z.string().optional().describe("Meta descripción (140–160 caracteres)"),
    focus_keyword: z.string().optional(),
  })
  .optional();

const sourcesSchema = z.array(z.object({ title: z.string(), url: z.string().url() })).optional();

tool(
  "content_verify",
  "Comprueba un borrador antes de publicar: que cada cifra y cada cita textual aparezca en las fuentes, que los enlaces funcionen (incluye páginas 404 disfrazadas) y que el título sea correcto. Devuelve lo que hay que corregir.",
  {
    content: z.string().describe("HTML del artículo"),
    source_urls: z.array(z.string().url()).min(1),
    title: z.string().optional(),
  },
  async ({ content, source_urls, title }) => {
    const html = cleanHtml(content);
    const [facts, links] = await Promise.all([verifyAgainstSources(html, source_urls), validateLinks(html)]);
    return {
      ...facts,
      brokenLinks: links.broken,
      uncheckableLinks: links.unknown,
      distinctPublishers: new Set(source_urls.map(domainOf)).size,
      titleIssues: title ? titleIssues(title) : [],
      words: wordCount(html),
    };
  },
  { readOnlyHint: true, openWorldHint: true }
);

tool(
  "wp_create_post",
  "Crea un artículo. Salvaguardas: limpia el HTML, quita enlaces rotos, verifica cifras y citas contra las fuentes y revisa el título; si quality_score < publishing.minQualityScore, hay menos medios distintos que content.minSources, citas sin respaldo o más de 2 cifras sin respaldo, se guarda como borrador en vez de publicarse. Rechaza títulos ya publicados.",
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

    let facts = null;
    if (input.verify_facts && input.sources?.length) {
      facts = await verifyAgainstSources(input.content, input.sources.map((x) => x.url));
      if (facts.unsupportedQuotes.length) blockers.push(`${facts.unsupportedQuotes.length} cita(s) que no aparecen en las fuentes`);
      if (facts.unsupportedNumbers.length > 2) blockers.push(`${facts.unsupportedNumbers.length} cifras sin respaldo en las fuentes`);
      else if (facts.unsupportedNumbers.length) warnings.push(`Cifras sin respaldo claro: ${facts.unsupportedNumbers.map((n) => n.number).join(", ")}`);
    }

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

    const res = await wp.createPost(s, { ...input, status });
    return {
      ...res,
      words,
      distinctPublishers: publishers,
      unsupportedNumbers: facts?.unsupportedNumbers,
      unsupportedQuotes: facts?.unsupportedQuotes,
      warnings: [...warnings, ...res.warnings],
    };
  }
);

tool(
  "wp_update_post",
  "Actualiza un artículo existente (contenido, estado, imagen destacada, SEO, categorías…).",
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
  },
  async ({ site, post_id, ...rest }) => wp.updatePost(getSite(site), post_id, rest)
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

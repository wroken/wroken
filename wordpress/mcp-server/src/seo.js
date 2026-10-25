// SEO: ideas de palabras clave (autocompletado de Google), datos de Search Console,
// análisis de los resultados de Google (como SEOWriting.ai o Surfer) y puntuación SEO.

import crypto from "node:crypto";
import fs from "node:fs";
import { apiKey } from "./config.js";
import { getJson, request } from "./http.js";
import { fetchReadable, htmlToText, sourceTextCache, webSearch } from "./research.js";

// ---------- Utilidades de texto ----------

const STOP = new Set(
  `a al algo algunos ante antes aqui asi aun cada casi como con contra cual cuales cuando de del desde donde dos el ella ellas ellos en
  entre era es esa ese eso esta estas este esto estos fue ha han hasta hay la las le les lo los mas me mi mientras muy nada ni no nos o
  otra otras otro otros para pero poco por porque puede pueden que se segun ser si sin sobre solo son su sus tambien te tiene tienen
  todo todos tu tus un una uno unos unas usted y ya yo sera estan esta hacer hace puedes debes cuanto tanto cosa cosas parte vez veces
  the of and to in for on with is are be this that from by or as at it an your you can how what why which when where will more most
  also have has not but its our their they them than then these those into about over just like`.split(/\s+/)
);

function strip(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function words(text) {
  return strip(text)
    .replace(/[^a-z0-9ñ\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^\d+$/.test(w));
}

function termCounts(text) {
  const ws = words(text);
  const counts = new Map();
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (!STOP.has(w)) counts.set(w, (counts.get(w) || 0) + 1);
    const n = ws[i + 1];
    if (n && !STOP.has(w) && !STOP.has(n)) {
      const bi = `${w} ${n}`;
      counts.set(bi, (counts.get(bi) || 0) + 1);
    }
  }
  return counts;
}

function median(nums) {
  const a = [...nums].sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

// ---------- Ideas de palabras clave ----------

const QUESTION_MODS = {
  es: ["cómo", "qué", "cuándo", "dónde", "por qué", "cuánto", "mejor", "mejores", "vs", "para"],
  en: ["how", "what", "when", "where", "why", "best", "vs", "for", "cost"],
};

async function suggest(q, { hl, gl }) {
  const u = new URL("https://suggestqueries.google.com/complete/search");
  u.searchParams.set("client", "firefox");
  u.searchParams.set("hl", hl);
  u.searchParams.set("gl", gl);
  u.searchParams.set("ie", "utf-8");
  u.searchParams.set("oe", "utf-8");
  u.searchParams.set("q", q);
  const res = await request(u.toString(), { timeoutMs: 10000 });
  if (!res.ok) throw new Error(`Autocompletado HTTP ${res.status}`);
  const data = JSON.parse(await res.text());
  return Array.isArray(data?.[1]) ? data[1] : [];
}

function intentOf(q) {
  const s = strip(q);
  if (/\b(comprar|precio|precios|barato|oferta|descuento|tienda|cotizar|buy|price|cheap|deal)\b/.test(s)) return "transaccional";
  if (/\b(mejor|mejores|vs|comparativa|opiniones|review|top|best|alternativas)\b/.test(s)) return "comparativa";
  if (/\b(como|que|cuando|donde|por que|cuanto|guia|tutorial|how|what|why|when|where)\b/.test(s)) return "informativa";
  return "general";
}

// Sugerencias reales de búsqueda de Google (servicio no oficial, sin clave).
export async function keywordIdeas(seed, { language = "es", country = "cl", expand = true, alphabet = false } = {}) {
  const hl = language.split("-")[0];
  const gl = (language.split("-")[1] || country || "cl").toLowerCase();
  const queries = [seed];
  if (expand) for (const m of QUESTION_MODS[hl] || QUESTION_MODS.en) queries.push(m === "vs" || m === "para" || m === "for" || m === "cost" ? `${seed} ${m}` : `${m} ${seed}`);
  if (alphabet) for (const c of "abcdefghijklmnopqrstuvwxyz") queries.push(`${seed} ${c}`);
  const seen = new Map();
  const errors = [];
  for (const q of queries) {
    try {
      for (const s of await suggest(q, { hl, gl })) {
        const k = strip(s).trim();
        if (!seen.has(k)) seen.set(k, { keyword: s, from: q, intent: intentOf(s) });
      }
    } catch (e) {
      errors.push(`${q}: ${e.message}`);
      if (errors.length > 3) break;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  const ideas = [...seen.values()];
  return {
    seed,
    count: ideas.length,
    questions: ideas.filter((i) => /^(como|cómo|que|qué|cuando|cuándo|donde|dónde|por que|por qué|cuanto|cuánto|how|what|why|when|where)\b/i.test(i.keyword)),
    ideas,
    errors,
    note: "Sugerencias del autocompletado de Google: indican que la gente lo busca, pero no el volumen. Para volumen real usa Search Console.",
  };
}

// ---------- Search Console (cuenta de servicio) ----------

let tokenCache = null;

function serviceAccount() {
  const raw = apiKey("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!raw) return null;
  const text = raw.trim().startsWith("{") ? raw : fs.readFileSync(raw, "utf8");
  return JSON.parse(text);
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function googleToken() {
  if (tokenCache && tokenCache.exp > Date.now() + 60000) return tokenCache.token;
  const sa = serviceAccount();
  if (!sa) throw new Error("Falta GOOGLE_SERVICE_ACCOUNT_JSON (ver README, sección Search Console).");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      aud: sa.token_uri || "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const sig = b64url(crypto.sign("RSA-SHA256", Buffer.from(`${header}.${claim}`), sa.private_key));
  const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claim}.${sig}` });
  const data = await getJson(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  tokenCache = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return tokenCache.token;
}

export function searchConsoleConfigured() {
  return Boolean(apiKey("GOOGLE_SERVICE_ACCOUNT_JSON"));
}

export function scProperty(site) {
  return site.searchConsole?.property || `sc-domain:${new URL(site.url).hostname.replace(/^www\./, "")}`;
}

export async function searchConsoleQuery(site, { days = 90, dimensions = ["query", "page"], rowLimit = 5000, query, page } = {}) {
  const token = await googleToken();
  const end = new Date(Date.now() - 2 * 864e5);
  const start = new Date(end.getTime() - days * 864e5);
  const body = {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    dimensions,
    rowLimit,
  };
  const filters = [];
  if (query) filters.push({ dimension: "query", operator: "contains", expression: query });
  if (page) filters.push({ dimension: "page", operator: "contains", expression: page });
  if (filters.length) body.dimensionFilterGroups = [{ filters }];
  const prop = encodeURIComponent(scProperty(site));
  const base = process.env.AUTOBLOG_GOOGLE_API_BASE || "https://www.googleapis.com";
  const data = await getJson(`${base}/webmasters/v3/sites/${prop}/searchAnalytics/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (data.rows || []).map((r) => {
    const row = { clicks: r.clicks, impressions: r.impressions, ctr: Math.round(r.ctr * 1000) / 10, position: Math.round(r.position * 10) / 10 };
    dimensions.forEach((d, i) => (row[d] = r.keys[i]));
    return row;
  });
}

// CTR esperado aproximado por posición (curva típica de resultados orgánicos)
const EXPECTED_CTR = [0, 28, 15, 10, 7, 5.5, 4, 3, 2.5, 2, 1.8];

export async function opportunities(site, { days = 90, minImpressions = 30, limit = 15 } = {}) {
  const rows = await searchConsoleQuery(site, { days });
  const byQuery = new Map();
  for (const r of rows) {
    const q = byQuery.get(r.query) || { query: r.query, impressions: 0, clicks: 0, bestPosition: 999, pages: [] };
    q.impressions += r.impressions;
    q.clicks += r.clicks;
    q.bestPosition = Math.min(q.bestPosition, r.position);
    q.pages.push({ page: r.page, position: r.position, impressions: r.impressions, ctr: r.ctr });
    byQuery.set(r.query, q);
  }
  const all = [...byQuery.values()].filter((q) => q.impressions >= minImpressions);
  const top = (arr, key) => arr.sort((a, b) => b[key] - a[key]).slice(0, limit);

  // Ya aparece entre el puesto 4 y 20: mejorar o ampliar esa página puede subirla a la primera página
  const striking = top(
    all.filter((q) => q.bestPosition > 3 && q.bestPosition <= 20).map((q) => ({ ...q, page: q.pages.sort((a, b) => a.position - b.position)[0].page })),
    "impressions"
  );
  // Buena posición pero pocos clics: mejorar título y meta descripción
  const lowCtr = top(
    rows
      .filter((r) => r.position <= 10 && r.impressions >= minImpressions && r.ctr < (EXPECTED_CTR[Math.round(r.position)] || 2) * 0.5)
      .map((r) => ({ query: r.query, page: r.page, position: r.position, ctr: r.ctr, impressions: r.impressions, expectedCtr: EXPECTED_CTR[Math.round(r.position)] })),
    "impressions"
  );
  // La gente busca esto y el sitio aparece muy abajo: candidato a artículo nuevo dedicado
  const gaps = top(all.filter((q) => q.bestPosition > 20), "impressions").map((q) => ({ query: q.query, impressions: q.impressions, bestPosition: q.bestPosition }));
  return {
    property: scProperty(site),
    days,
    newArticleIdeas: gaps,
    improveExisting: striking.map((q) => ({ query: q.query, page: q.page, bestPosition: q.bestPosition, impressions: q.impressions, clicks: q.clicks })),
    improveTitles: lowCtr,
  };
}

// ---------- Análisis de los resultados de Google ----------

const QUESTION_RE = /^(como|cómo|que|qué|cual|cuál|cuando|cuándo|donde|dónde|por que|por qué|cuanto|cuánto|how|what|why|when|where|which)\b|\?$/i;

function headingsOf(text) {
  return text
    .split("\n")
    .filter((l) => l.startsWith("## "))
    .map((l) => l.slice(3).trim())
    .filter((h) => h.length > 3 && h.length < 140);
}

export async function serpAnalysis(keyword, { urls, count = 8, language = "es" } = {}) {
  let list = urls;
  let provider = "urls";
  if (!list?.length) {
    const r = await webSearch(keyword, { maxResults: count });
    if (r.provider === "none") {
      return {
        keyword,
        error:
          "No hay buscador configurado. Busca la palabra clave con la búsqueda web de Claude y vuelve a llamar con 'urls' (los 5–10 primeros resultados orgánicos, sin anuncios ni redes sociales).",
      };
    }
    provider = r.provider;
    list = r.results.map((x) => x.url);
  }
  list = list.slice(0, count);
  const pages = [];
  const failed = [];
  await Promise.all(
    list.map(async (url) => {
      try {
        const p = await fetchReadable(url, { maxChars: 500 });
        const full = sourceTextCache.get(url) || p.text;
        pages.push({ url, title: p.title, text: full, words: words(full).length, headings: headingsOf(full) });
      } catch (e) {
        failed.push({ url, error: e.message });
      }
    })
  );
  if (!pages.length) return { keyword, provider, error: "No se pudo leer ningún resultado", failed };

  // Términos que usan varios de los primeros resultados (como el "NLP" de SEOWriting.ai)
  const docFreq = new Map();
  const totals = new Map();
  for (const p of pages) {
    const c = termCounts(p.text);
    for (const [t, n] of c) {
      docFreq.set(t, (docFreq.get(t) || 0) + 1);
      totals.set(t, (totals.get(t) || 0) + n);
    }
  }
  const minDocs = Math.max(2, Math.ceil(pages.length * 0.4));
  const terms = [...docFreq.entries()]
    .filter(([, d]) => d >= minDocs)
    .map(([term, docs]) => ({ term, docs, avgUses: Math.round((totals.get(term) / docs) * 10) / 10 }))
    .sort((a, b) => b.docs - a.docs || b.avgUses - a.avgUses)
    .slice(0, 60);

  const allHeadings = pages.flatMap((p) => p.headings.map((h) => ({ h, url: p.url })));
  const questions = [...new Set(allHeadings.map((x) => x.h).filter((h) => QUESTION_RE.test(strip(h).trim())))].slice(0, 20);
  const med = median(pages.map((p) => p.words));
  return {
    keyword,
    provider,
    analyzed: pages.length,
    failed,
    wordCount: { median: med, recommended: Math.round(med * 1.1), min: Math.min(...pages.map((p) => p.words)), max: Math.max(...pages.map((p) => p.words)) },
    headingsMedian: median(pages.map((p) => p.headings.length)),
    terms,
    questions,
    competitors: pages.map((p) => ({ url: p.url, title: p.title, words: p.words, headings: p.headings.slice(0, 25) })),
    language,
  };
}

// ---------- Puntuación SEO del contenido ----------

export function contentScore({ content, keyword, title, seoTitle, metaDescription, slug, terms = [], recommendedWords }) {
  const text = htmlToText(content);
  const kw = strip(keyword).trim();
  const kwWords = kw.split(/\s+/);
  const has = (s) => {
    const t = strip(s || "");
    return t.includes(kw) || kwWords.every((w) => t.includes(w));
  };
  const firstWords = words(text).slice(0, 120).join(" ");
  const h2s = [...String(content).matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => m[1].replace(/<[^>]+>/g, ""));
  const imgs = [...String(content).matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const links = [...String(content).matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const wc = words(text).length;
  const sentences = text.split(/[.!?¡¿]+\s/).filter((s) => s.trim().length > 0);
  const avgSentence = sentences.length ? Math.round(wc / sentences.length) : 0;
  const paragraphs = [...String(content).matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => words(m[1].replace(/<[^>]+>/g, "")).length);
  const longParagraphs = paragraphs.filter((n) => n > 90).length;

  const checks = [];
  const add = (ok, pts, label, fix) => checks.push({ ok, pts: ok ? pts : 0, max: pts, label, fix: ok ? undefined : fix });

  add(has(title), 8, "Palabra clave en el título", "Pon la palabra clave al principio del título.");
  add(has(seoTitle || title) && (seoTitle || title).length <= 60, 5, "Título SEO con palabra clave y ≤ 60 caracteres", "Ajusta el título SEO.");
  add(Boolean(metaDescription) && metaDescription.length >= 120 && metaDescription.length <= 160 && has(metaDescription), 6, "Meta descripción 120–160 caracteres con la palabra clave", "Reescribe la meta descripción.");
  add(has(firstWords), 7, "Palabra clave en las primeras 120 palabras", "Menciona la palabra clave en la introducción.");
  add(h2s.some(has), 5, "Palabra clave (o variante) en algún H2", "Usa la palabra clave en al menos un H2.");
  add(!slug || has(slug.replace(/-/g, " ")), 3, "Slug con la palabra clave", "Usa un slug corto con la palabra clave.");
  add(h2s.length >= 4, 5, "Al menos 4 secciones H2", "Divide el texto en más secciones.");

  const target = recommendedWords || 1000;
  const lenRatio = wc / target;
  add(lenRatio >= 0.8 && lenRatio <= 1.6, 10, `Longitud adecuada (${wc} palabras; objetivo ≈ ${target})`, lenRatio < 0.8 ? "Amplía con los subtemas que cubren los competidores." : "Recorta relleno.");

  let coverage = null;
  if (terms.length) {
    const ct = termCounts(text);
    const top = terms.slice(0, 40);
    const covered = top.filter((t) => ct.has(t.term));
    coverage = Math.round((covered.length / top.length) * 100);
    const pts = Math.round((Math.min(coverage, 80) / 80) * 25);
    checks.push({
      ok: coverage >= 60,
      pts,
      max: 25,
      label: `Cobertura de términos de los primeros resultados: ${coverage}%`,
      fix: coverage >= 60 ? undefined : "Incluye de forma natural los términos que faltan (missingTerms).",
    });
  }

  add(imgs.length >= 1 && imgs.every((i) => /\balt=["'][^"']{5,}["']/i.test(i)), 5, "Imágenes con texto alternativo", "Añade alt descriptivo a todas las imágenes.");
  const external = links.filter((l) => /^https?:/i.test(l)).length;
  add(external >= 2, 5, "Enlaces a fuentes externas", "Enlaza las fuentes en el texto.");
  add(avgSentence > 0 && avgSentence <= 25, 5, `Frases de longitud cómoda (media ${avgSentence} palabras)`, "Acorta las frases largas.");
  add(longParagraphs === 0, 5, "Párrafos cortos", `Divide ${longParagraphs} párrafo(s) de más de 90 palabras.`);
  add(/preguntas frecuentes|faq/i.test(h2s.join(" ")), 6, "Sección de preguntas frecuentes", "Añade preguntas frecuentes reales (de questions del análisis).");

  const score = checks.reduce((a, c) => a + c.pts, 0);
  const max = checks.reduce((a, c) => a + c.max, 0);
  const missingTerms = terms.length ? terms.slice(0, 40).map((t) => t.term).filter((t) => !termCounts(text).has(t)).slice(0, 20) : [];
  return {
    score: Math.round((score / max) * 100),
    words: wc,
    termCoverage: coverage,
    missingTerms,
    fixes: checks.filter((c) => !c.ok).map((c) => c.fix),
    checks: checks.map(({ ok, pts, max, label }) => ({ ok, pts, max, label })),
  };
}

// Búsqueda de fuentes (Tavily o Brave) y lectura de páginas como texto limpio.

import { apiKey } from "./config.js";
import { getJson, request } from "./http.js";
import { decodeEntities } from "./wordpress.js";

export function searchProviders() {
  return {
    tavily: Boolean(apiKey("TAVILY_API_KEY")),
    brave: Boolean(apiKey("BRAVE_API_KEY")),
  };
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function filterDomains(results, { blocked = [] } = {}) {
  return results.filter((r) => !blocked.some((d) => domainOf(r.url).endsWith(d.replace(/^www\./, ""))));
}

export async function webSearch(query, { maxResults = 8, recentDays, news = false, includeDomains, blockedDomains } = {}) {
  const tavily = apiKey("TAVILY_API_KEY");
  const brave = apiKey("BRAVE_API_KEY");
  let results;
  let provider;

  if (tavily) {
    provider = "tavily";
    const body = {
      query,
      max_results: maxResults,
      search_depth: "advanced",
      topic: news ? "news" : "general",
      include_answer: false,
    };
    if (recentDays) body.days = recentDays;
    if (includeDomains?.length) body.include_domains = includeDomains;
    if (blockedDomains?.length) body.exclude_domains = blockedDomains;
    const data = await getJson("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tavily}` },
      body: JSON.stringify(body),
    });
    results = (data.results || []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      published: r.published_date || null,
      score: r.score,
    }));
  } else if (brave) {
    provider = "brave";
    const u = new URL("https://api.search.brave.com/res/v1/web/search");
    u.searchParams.set("q", query);
    u.searchParams.set("count", String(Math.min(maxResults, 20)));
    if (recentDays) u.searchParams.set("freshness", recentDays <= 1 ? "pd" : recentDays <= 7 ? "pw" : recentDays <= 31 ? "pm" : "py");
    const data = await getJson(u.toString(), { headers: { "X-Subscription-Token": brave } });
    results = (data.web?.results || []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description?.replace(/<[^>]+>/g, ""),
      published: r.age || null,
    }));
  } else {
    return {
      provider: "none",
      results: [],
      message:
        "No hay TAVILY_API_KEY ni BRAVE_API_KEY configuradas. Usa la herramienta de búsqueda web de Claude (WebSearch) y luego research_fetch para leer cada fuente.",
    };
  }
  return { provider, results: filterDomains(results, { blocked: blockedDomains }) };
}

function metaContent(html, attr, name) {
  const re = new RegExp(`<meta[^>]+${attr}=["']${name}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  const c = tag.match(/content=["']([^"']*)["']/i);
  return c ? decodeEntities(c[1]) : null;
}

export function htmlToText(html) {
  let h = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|form|nav|footer|header|aside)[\s\S]*?<\/\1>/gi, " ");
  const main = h.match(/<article[\s\S]*<\/article>/i)?.[0] || h.match(/<main[\s\S]*<\/main>/i)?.[0];
  if (main && main.length > 500) h = main;
  return decodeEntities(
    h
      .replace(/<(h[1-6])[^>]*>/gi, "\n\n## ")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Texto completo de las fuentes leídas en esta sesión, para verificar cifras y citas.
export const sourceTextCache = new Map();

function jsonLdDate(html) {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const d = m[1].match(/"datePublished"\s*:\s*"([^"]+)"/);
    if (d) return d[1];
  }
  return null;
}

export async function fetchReadable(url, { maxChars = 12000 } = {}) {
  const res = await request(url, { headers: { Accept: "text/html,application/xhtml+xml" }, timeoutMs: 30000 });
  if (!res.ok) throw new Error(`HTTP ${res.status} al leer ${url}`);
  const type = res.headers.get("content-type") || "";
  if (!type.includes("html") && !type.includes("text")) throw new Error(`Contenido no legible (${type}) en ${url}`);
  const html = (await res.text()).slice(0, 3_000_000);
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "");
  const text = htmlToText(html);
  sourceTextCache.set(url, text);
  sourceTextCache.set(res.url, text);
  return {
    url: res.url,
    domain: domainOf(res.url),
    title: metaContent(html, "property", "og:title") || title,
    description: metaContent(html, "name", "description") || metaContent(html, "property", "og:description"),
    published: jsonLdDate(html) || metaContent(html, "property", "article:published_time") || metaContent(html, "name", "date"),
    author: metaContent(html, "name", "author"),
    siteName: metaContent(html, "property", "og:site_name"),
    image: metaContent(html, "property", "og:image"),
    lang: html.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1] || null,
    text: text.length > maxChars ? text.slice(0, maxChars) + "\n[…texto recortado…]" : text,
    chars: text.length,
  };
}

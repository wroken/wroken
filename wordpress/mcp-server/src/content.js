// Limpieza del HTML generado, validación de enlaces y verificación de cifras y citas
// contra las fuentes. Ideas tomadas de AutoPost AI (enlaces) y Draft2Publish
// (cifras, citas, páginas 404 "blandas").

import { request } from "./http.js";
import { fetchReadable, htmlToText, sourceTextCache } from "./research.js";

export function cleanHtml(html) {
  return String(html)
    .replace(/^\s*```(?:html)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .replace(/^\s*<!doctype[^>]*>/i, "")
    .replace(/<\/?(html|head|body)[^>]*>/gi, "")
    .replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, "") // WordPress ya muestra el título como H1
    .trim();
}

export function extractLinks(html) {
  const out = [];
  const re = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/^https?:\/\//i.test(m[1])) out.push(m[1]);
  }
  return [...new Set(out)];
}

const SOFT_404 =
  /\b(404|page not found|not found|no encontrad[ao]|no existe|página no disponible|pagina no disponible|could not be found|ha sido eliminad[ao]|error 404)\b/i;

async function readLimited(res, max = 65536) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

const cache = new Map();

export async function checkUrl(url) {
  if (cache.has(url)) return cache.get(url);
  let status = "unknown";
  try {
    const res = await request(url, { headers: { Accept: "text/html,*/*" }, timeoutMs: 10000 });
    const c = res.status;
    if (c >= 200 && c < 400) {
      status = "valid";
      const type = res.headers.get("content-type") || "";
      const from = new URL(url);
      const to = new URL(res.url || url);
      // Redirección a la portada: el contenido ya no existe
      if (from.pathname.replace(/\/+$/, "") !== "" && to.pathname.replace(/\/+$/, "") === "" && to.hostname.replace(/^www\./, "") === from.hostname.replace(/^www\./, "")) {
        status = "invalid";
      } else if (type.includes("html")) {
        const head = await readLimited(res);
        const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
        const h1 = head.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, "") || "";
        if (SOFT_404.test(title) || SOFT_404.test(h1)) status = "invalid";
      } else {
        res.body?.cancel?.().catch(() => {});
      }
    } else if (c === 401 || c === 403 || c === 429) {
      status = "valid"; // existe, pero bloquea bots
    } else if (c >= 400 && c < 500) {
      status = "invalid";
    }
  } catch {
    status = "unknown";
  }
  cache.set(url, status);
  return status;
}

// Quita el enlace (deja el texto) de los que están rotos.
export async function validateLinks(html, { max = 40 } = {}) {
  const links = extractLinks(html).slice(0, max);
  const results = await Promise.all(links.map(async (url) => ({ url, status: await checkUrl(url) })));
  const broken = results.filter((r) => r.status === "invalid").map((r) => r.url);
  let out = html;
  for (const url of broken) {
    const esc = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`<a\\b[^>]*href=["']${esc}["'][^>]*>([\\s\\S]*?)<\\/a>`, "gi"), "$1");
  }
  return { html: out, checked: results.length, broken, unknown: results.filter((r) => r.status === "unknown").map((r) => r.url) };
}

export function wordCount(html) {
  return String(html)
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// ---------- Verificación de cifras y citas ----------

const MULT = { mil: 1e3, k: 1e3, millon: 1e6, millones: 1e6, mill: 1e6, m: 1e6, million: 1e6, millions: 1e6, billion: 1e9, thousand: 1e3 };
const NUM_RE = /(\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(\s?%|\s?por ciento|\s?(?:mil|millones|millón|millon|mill|million|millions|billion|thousand|k|m)\b)?/gi;

function stripAccents(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Un mismo texto ("1.500" o "1,5") puede leerse con convención española o inglesa:
// devolvemos todas las interpretaciones posibles.
function interpretations(raw) {
  const s = raw.replace(/\s/g, "");
  const out = new Set();
  if (/^\d+$/.test(s)) out.add(Number(s));
  const es = s.replace(/\./g, "").replace(",", ".");
  const en = s.replace(/,/g, "");
  for (const v of [es, en]) if (/^\d+(\.\d+)?$/.test(v)) out.add(Number(v));
  return [...out];
}

function numbersIn(text) {
  const out = [];
  for (const m of text.matchAll(NUM_RE)) {
    const unit = stripAccents((m[2] || "").trim().toLowerCase());
    const mult = MULT[unit] || 1;
    const isPct = unit === "%" || unit === "por ciento";
    const values = interpretations(m[1]).flatMap((v) => (mult > 1 ? [v, v * mult] : [v]));
    out.push({ raw: m[0].trim(), values, isPct, index: m.index, bare: !m[2] });
  }
  return out;
}

function close(a, b) {
  return a === b || (Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9) < 0.005);
}

function sentenceAround(text, index) {
  const start = Math.max(text.lastIndexOf(".", index - 1) + 1, index - 200);
  const endDot = text.indexOf(".", index);
  const end = endDot === -1 ? Math.min(text.length, index + 200) : Math.min(endDot + 1, index + 200);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function normText(s) {
  return stripAccents(String(s).toLowerCase())
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Acepta URLs o {url, excerpt}. El extracto es el texto que Claude ya leyó de la fuente:
// sirve cuando la web bloquea las descargas automáticas (Cloudflare, muros de pago).
async function sourceTexts(sources) {
  const texts = [];
  const missing = [];
  await Promise.all(
    sources.map(async (src) => {
      const u = typeof src === "string" ? src : src.url;
      const parts = [];
      if (typeof src === "object" && src.excerpt) parts.push(src.excerpt);
      let t = sourceTextCache.get(u);
      if (!t) {
        try {
          await fetchReadable(u, { maxChars: 1000 });
          t = sourceTextCache.get(u);
        } catch {
          /* fuente no legible */
        }
      }
      if (t) parts.push(t);
      if (parts.length) texts.push(parts.join("\n"));
      else missing.push(u);
    })
  );
  return { texts, missing };
}

// Comprueba que cada cifra y cada cita textual del artículo aparece en alguna fuente.
// Se ignoran años sueltos y números pequeños sin unidad (listas, "3 consejos").
// Si no se pudo leer ninguna fuente, no se bloquea: se devuelve skipped = true.
export async function verifyAgainstSources(html, sources) {
  const text = htmlToText(
    String(html)
      .replace(/<h2[^>]*>\s*(fuentes|referencias|sources)\s*<\/h2>[\s\S]*$/i, "") // sección de fuentes
      .replace(/<(figcaption)[\s\S]*?<\/\1>/gi, " ")
  );
  const { texts, missing } = await sourceTexts(sources);
  if (!texts.length) {
    return { skipped: true, sourcesRead: 0, sourcesUnreadable: missing, unsupportedNumbers: [], unsupportedQuotes: [] };
  }
  const srcNumbers = texts.flatMap((t) => numbersIn(t)).flatMap((n) => n.values);
  const unsupportedNumbers = [];
  for (const n of numbersIn(text)) {
    const v = n.values[0];
    if (n.bare && Number.isInteger(v) && (v <= 12 || (v >= 1900 && v <= 2100))) continue;
    if (!n.values.some((a) => srcNumbers.some((b) => close(a, b)))) {
      unsupportedNumbers.push({ number: n.raw, context: sentenceAround(text, n.index) });
    }
  }

  const srcNorm = texts.map(normText);
  const unsupportedQuotes = [];
  for (const m of text.matchAll(/[“«"]([^”»"]{20,400})[”»"]/g)) {
    const q = normText(m[1]);
    if (q.split(" ").length < 6) continue;
    if (!srcNorm.some((s) => s.includes(q))) unsupportedQuotes.push(m[1].trim());
  }
  return { skipped: false, sourcesRead: texts.length, sourcesUnreadable: missing, unsupportedNumbers, unsupportedQuotes };
}

// ---------- Similitud de temas ----------

const STOP = new Set(
  ("a al ante con contra de del desde el en entre es la las lo los para por que se sin sobre su sus tu un una unos unas y o u " +
    "como cual cuales cuando donde mas muy mejor mejores guia completa todo todos lo-que hay ser son esta este estos estas " +
    "the a an of to in on for and or with your you how what why best guide").split(/\s+/)
);

function tokens(s) {
  return new Set(
    normText(s)
      .split(" ")
      .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d{4}$/.test(w))
      .map((w) => w.replace(/(es|s)$/, ""))
  );
}

export function similarity(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.min(A.size, B.size);
}

export function similarTitles(title, titles, threshold = 0.6) {
  return titles
    .map((t) => ({ title: t.title ?? t, link: t.link, score: Math.round(similarity(title, t.title ?? t) * 100) / 100 }))
    .filter((x) => x.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

// Comprobaciones básicas del título (inspiradas en Draft2Publish).
export function titleIssues(title, sourceTitles = []) {
  const issues = [];
  const t = title.trim();
  const words = t.split(/\s+/).length;
  if (t.length < 20) issues.push("título demasiado corto (< 20 caracteres)");
  if (t.length > 110) issues.push("título demasiado largo (> 110 caracteres)");
  if (words < 4) issues.push("título con menos de 4 palabras");
  if (/[\[\]{}]|lorem|TODO|XXX/i.test(t)) issues.push("el título contiene marcadores sin rellenar");
  if (/\b(de|para|con|a|y|en|the|for|with|to|and)$/i.test(t) || /[,;:]$/.test(t)) issues.push("el título termina a medias");
  const nt = normText(t);
  if (sourceTitles.some((s) => normText(s) === nt)) issues.push("el título es idéntico al de una fuente");
  return issues;
}

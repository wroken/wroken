// Búsqueda de imágenes de internet con licencia que permite uso comercial,
// devolviendo siempre los datos de atribución.

import { apiKey } from "./config.js";
import { getJson } from "./http.js";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function stripHtml(s) {
  return String(s ?? "").replace(/<[^>]+>/g, "").trim();
}

export function attributionHtml(img) {
  const who = img.creator
    ? img.creatorUrl
      ? `<a href="${escapeHtml(img.creatorUrl)}" rel="nofollow noopener" target="_blank">${escapeHtml(img.creator)}</a>`
      : escapeHtml(img.creator)
    : "Autor desconocido";
  const lic = img.licenseUrl
    ? `<a href="${escapeHtml(img.licenseUrl)}" rel="nofollow noopener" target="_blank">${escapeHtml(img.license)}</a>`
    : escapeHtml(img.license);
  const via = img.pageUrl
    ? `<a href="${escapeHtml(img.pageUrl)}" rel="nofollow noopener" target="_blank">${escapeHtml(img.providerName)}</a>`
    : escapeHtml(img.providerName);
  return `Foto: ${who} · ${lic} · vía ${via}`;
}

async function openverse(query, { count, orientation }) {
  const u = new URL("https://api.openverse.org/v1/images/");
  u.searchParams.set("q", query);
  u.searchParams.set("page_size", String(count));
  u.searchParams.set("license_type", "commercial");
  u.searchParams.set("mature", "false");
  if (orientation === "landscape") u.searchParams.set("aspect_ratio", "wide");
  if (orientation === "portrait") u.searchParams.set("aspect_ratio", "tall");
  const data = await getJson(u.toString());
  return (data.results || []).map((r) => ({
    provider: "openverse",
    providerName: `Openverse (${r.source || r.provider})`,
    id: r.id,
    title: r.title,
    imageUrl: r.url,
    thumbnail: r.thumbnail,
    width: r.width,
    height: r.height,
    pageUrl: r.foreign_landing_url,
    creator: r.creator,
    creatorUrl: r.creator_url,
    license: `${r.license === "cc0" || r.license === "pdm" ? r.license.toUpperCase() : "CC " + r.license.toUpperCase()} ${r.license_version || ""}`.trim(),
    licenseUrl: r.license_url,
    attributionRequired: !["cc0", "pdm"].includes(r.license),
  }));
}

const COMMONS_OK = /^(cc0|public domain|pd|cc by(-sa)? [\d.]+|cc by(-sa)?|attribution)/i;

async function wikimedia(query, { count }) {
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  const params = {
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: String(Math.min(count * 2, 50)),
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
    iiurlwidth: "1920",
  };
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const data = await getJson(u.toString());
  const pages = Object.values(data.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  const out = [];
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    const m = ii?.extmetadata || {};
    const license = stripHtml(m.LicenseShortName?.value);
    if (!ii || !COMMONS_OK.test(license) || /\bNC\b|noncommercial/i.test(license)) continue;
    out.push({
      provider: "wikimedia",
      providerName: "Wikimedia Commons",
      id: p.pageid,
      title: stripHtml(m.ObjectName?.value) || p.title.replace(/^File:/, ""),
      imageUrl: ii.thumburl || ii.url,
      originalUrl: ii.url,
      width: ii.thumbwidth || ii.width,
      height: ii.thumbheight || ii.height,
      pageUrl: ii.descriptionurl,
      creator: stripHtml(m.Artist?.value) || null,
      creatorUrl: null,
      license,
      licenseUrl: m.LicenseUrl?.value || null,
      attributionRequired: m.AttributionRequired?.value !== "false",
    });
    if (out.length >= count) break;
  }
  return out;
}

async function pexels(query, { count, orientation }) {
  const key = apiKey("PEXELS_API_KEY");
  if (!key) return null;
  const u = new URL("https://api.pexels.com/v1/search");
  u.searchParams.set("query", query);
  u.searchParams.set("per_page", String(count));
  if (orientation) u.searchParams.set("orientation", orientation);
  const data = await getJson(u.toString(), { headers: { Authorization: key } });
  return (data.photos || []).map((p) => ({
    provider: "pexels",
    providerName: "Pexels",
    id: p.id,
    title: p.alt,
    imageUrl: p.src?.large2x || p.src?.original,
    width: p.width,
    height: p.height,
    pageUrl: p.url,
    creator: p.photographer,
    creatorUrl: p.photographer_url,
    license: "Licencia Pexels",
    licenseUrl: "https://www.pexels.com/license/",
    attributionRequired: false,
  }));
}

const PROVIDERS = { openverse, wikimedia, pexels };

export async function searchImages(query, { providers = ["openverse", "wikimedia", "pexels"], count = 6, orientation = "landscape" } = {}) {
  const results = [];
  const errors = {};
  const skipped = [];
  await Promise.all(
    providers.map(async (name) => {
      const fn = PROVIDERS[name];
      if (!fn) {
        skipped.push(`${name} (proveedor desconocido)`);
        return;
      }
      try {
        const r = await fn(query, { count, orientation });
        if (r === null) skipped.push(`${name} (falta API key)`);
        else results.push(...r);
      } catch (e) {
        errors[name] = e.message;
      }
    })
  );
  for (const r of results) r.attributionHtml = attributionHtml(r);
  return { results, skipped, errors };
}

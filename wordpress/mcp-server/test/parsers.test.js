// Pruebas de los adaptadores de imágenes y de la lectura de páginas con fetch simulado.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { searchImages } from "../src/images.js";
import { fetchReadable, htmlToText, webSearch } from "../src/research.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(routes) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    const key = Object.keys(routes).find((k) => u.includes(k));
    if (!key) throw new Error("sin ruta simulada para " + u);
    const r = routes[key];
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), {
      status: r.status || 200,
      headers: { "content-type": r.type || "application/json" },
    });
  };
}

test("images_search normaliza Openverse y Wikimedia y filtra licencias NC", async () => {
  mockFetch({
    "api.openverse.org": {
      body: {
        results: [
          {
            id: "abc",
            title: "Cerro Alegre",
            url: "https://live.staticflickr.com/1.jpg",
            thumbnail: "https://api.openverse.org/thumb/abc",
            creator: "Ana",
            creator_url: "https://flickr.com/ana",
            license: "by-sa",
            license_version: "2.0",
            license_url: "https://creativecommons.org/licenses/by-sa/2.0/",
            foreign_landing_url: "https://flickr.com/photos/ana/1",
            source: "flickr",
            width: 2000,
            height: 1300,
          },
        ],
      },
    },
    "commons.wikimedia.org": {
      body: {
        query: {
          pages: {
            1: {
              pageid: 1,
              index: 1,
              title: "File:Valpo.jpg",
              imageinfo: [
                {
                  url: "https://upload.wikimedia.org/a.jpg",
                  thumburl: "https://upload.wikimedia.org/thumb/a.jpg",
                  thumbwidth: 1920,
                  thumbheight: 1080,
                  descriptionurl: "https://commons.wikimedia.org/wiki/File:Valpo.jpg",
                  extmetadata: {
                    LicenseShortName: { value: "CC BY-SA 4.0" },
                    Artist: { value: '<a href="//x">Pedro</a>' },
                    LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
                  },
                },
              ],
            },
            2: {
              pageid: 2,
              index: 2,
              title: "File:NC.jpg",
              imageinfo: [{ url: "https://upload.wikimedia.org/b.jpg", extmetadata: { LicenseShortName: { value: "CC BY-NC 2.0" } } }],
            },
          },
        },
      },
    },
  });
  const r = await searchImages("valparaiso", { providers: ["openverse", "wikimedia", "pexels"], count: 5 });
  assert.deepEqual(Object.keys(r.errors), []);
  assert.ok(r.skipped.some((s) => s.startsWith("pexels")));
  assert.equal(r.results.length, 2, "la imagen NC debe descartarse");
  const ov = r.results.find((x) => x.provider === "openverse");
  assert.equal(ov.license, "CC BY-SA 2.0");
  assert.match(ov.attributionHtml, /Ana.*CC BY-SA 2\.0.*Openverse \(flickr\)/);
  const wm = r.results.find((x) => x.provider === "wikimedia");
  assert.equal(wm.creator, "Pedro");
  assert.equal(wm.imageUrl, "https://upload.wikimedia.org/thumb/a.jpg");
});

test("research_fetch extrae metadatos y texto del artículo", async () => {
  mockFetch({
    "example.com": {
      type: "text/html; charset=utf-8",
      body: `<html lang="es"><head><title>Título &amp; más</title>
        <meta property="og:image" content="https://example.com/i.jpg">
        <meta property="article:published_time" content="2026-10-01">
        <meta name="description" content="Resumen"></head>
        <body><nav>menú</nav><article><h1>Encabezado</h1><p>${"Texto importante. ".repeat(40)}</p><script>x()</script></article><footer>pie</footer></body></html>`,
    },
  });
  const p = await fetchReadable("https://example.com/nota");
  assert.equal(p.title, "Título & más");
  assert.equal(p.image, "https://example.com/i.jpg");
  assert.equal(p.published, "2026-10-01");
  assert.equal(p.lang, "es");
  assert.match(p.text, /## Encabezado/);
  assert.doesNotMatch(p.text, /menú|pie|x\(\)/);
});

test("htmlToText decodifica entidades", () => {
  assert.equal(htmlToText("<p>Caf&eacute; &#233; &#xE9; &amp;lt;</p>"), "Café é é &lt;");
});

test("research_search sin claves pide usar la búsqueda de Claude", async () => {
  delete process.env.TAVILY_API_KEY;
  delete process.env.BRAVE_API_KEY;
  const r = await webSearch("algo");
  assert.equal(r.provider, "none");
});

test("research_search con Tavily", async () => {
  process.env.TAVILY_API_KEY = "tvly-x";
  mockFetch({
    "api.tavily.com": { body: { results: [{ title: "T", url: "https://www.spam.com/a", content: "c" }, { title: "U", url: "https://ok.cl/a", content: "d" }] } },
  });
  const r = await webSearch("algo", { blockedDomains: ["spam.com"] });
  delete process.env.TAVILY_API_KEY;
  assert.equal(r.provider, "tavily");
  assert.deepEqual(r.results.map((x) => x.url), ["https://ok.cl/a"]);
});

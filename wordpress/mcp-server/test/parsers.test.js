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

test("seo_keyword_ideas usa el autocompletado de Google y clasifica la intención", async () => {
  const { keywordIdeas } = await import("../src/seo.js");
  globalThis.fetch = async (url) => {
    const q = new URL(String(url)).searchParams.get("q");
    const map = {
      "termas de chillan": ["termas de chillan precios", "termas de chillan hotel"],
      "cómo termas de chillan": ["como llegar a termas de chillan"],
      "mejores termas de chillan": ["mejores termas de chillan vs puyehue"],
    };
    return new Response(JSON.stringify([q, map[q] || []]), { headers: { "content-type": "application/json" } });
  };
  const r = await keywordIdeas("termas de chillan", { language: "es-CL" });
  const kws = r.ideas.map((i) => i.keyword);
  assert.ok(kws.includes("como llegar a termas de chillan"));
  assert.equal(r.ideas.find((i) => i.keyword === "termas de chillan precios").intent, "transaccional");
  assert.equal(r.ideas.find((i) => i.keyword.includes("vs")).intent, "comparativa");
  assert.ok(r.questions.some((q) => q.keyword.startsWith("como")));
});

test("Search Console con cuenta de servicio: firma JWT y oportunidades", async () => {
  const crypto = await import("node:crypto");
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: "autoblog@proyecto.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    token_uri: "https://oauth2.test/token",
  });
  process.env.AUTOBLOG_GOOGLE_API_BASE = "https://gsc.test";
  let verified = false;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith("https://oauth2.test/token")) {
      const jwt = new URLSearchParams(opts.body).get("assertion");
      const [h, c, sig] = jwt.split(".");
      verified = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${c}`), publicKey, Buffer.from(sig, "base64url"));
      const claim = JSON.parse(Buffer.from(c, "base64url"));
      assert.equal(claim.scope, "https://www.googleapis.com/auth/webmasters.readonly");
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
    }
    assert.match(u, /gsc\.test\/webmasters\/v3\/sites\/sc-domain%3Aviajesok\.com\/searchAnalytics\/query/);
    assert.equal(opts.headers.Authorization, "Bearer tok");
    return new Response(
      JSON.stringify({
        rows: [
          { keys: ["que ver en valparaiso", "https://viajesok.com/valparaiso/"], clicks: 20, impressions: 900, ctr: 0.022, position: 7.4 },
          { keys: ["termas en chile", "https://viajesok.com/sur/"], clicks: 1, impressions: 400, ctr: 0.0025, position: 34 },
          { keys: ["mapa de santiago", "https://viajesok.com/santiago/"], clicks: 3, impressions: 500, ctr: 0.006, position: 2.1 },
        ],
      })
    );
  };
  const { opportunities } = await import("../src/seo.js");
  const r = await opportunities({ id: "viajesok", url: "https://viajesok.com" }, { minImpressions: 10 });
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.AUTOBLOG_GOOGLE_API_BASE;
  assert.equal(verified, true, "la firma JWT debe ser válida");
  assert.deepEqual(r.newArticleIdeas.map((x) => x.query), ["termas en chile"]);
  assert.deepEqual(r.improveExisting.map((x) => x.query), ["que ver en valparaiso"]);
  assert.deepEqual(r.improveTitles.map((x) => x.query), ["mapa de santiago"]);
});

test("seo_serp_analysis extrae longitud, encabezados, términos y preguntas", async () => {
  const { serpAnalysis } = await import("../src/seo.js");
  const page = (h2s, extra) =>
    `<html><head><title>T</title></head><body><article>${h2s.map((h) => `<h2>${h}</h2><p>El funicular del cerro alegre y los ascensores históricos de Valparaíso. ${extra}</p>`).join("")}</article></body></html>`;
  mockFetch({
    "a.test": { type: "text/html", body: page(["Cerro Alegre", "¿Cuánto cuesta el ascensor?"], "Museo a cielo abierto.") },
    "b.test": { type: "text/html", body: page(["Ascensores", "Dónde comer"], "Muelle Prat y paseo.") },
    "c.test": { type: "text/html", body: page(["Miradores"], "Cerro alegre de noche.") },
  });
  const r = await serpAnalysis("qué ver en valparaíso", { urls: ["https://a.test/1", "https://b.test/2", "https://c.test/3"] });
  assert.equal(r.analyzed, 3);
  assert.ok(r.wordCount.median > 0);
  assert.ok(r.terms.some((t) => t.term === "cerro alegre" && t.docs === 3));
  assert.ok(r.questions.includes("¿Cuánto cuesta el ascensor?"));
});

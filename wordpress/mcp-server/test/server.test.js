// Prueba de extremo a extremo: arranca el servidor MCP contra un WordPress simulado.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const USER = "autoblog";
const PASS = "abcd efgh ijkl mnop";

let wpServer;
let client;
let tmp;
let base;
const state = { posts: [], media: [], lock: null, kv: {}, mails: [], tags: [{ id: 50, name: "Chile", slug: "chile" }], categories: [{ id: 1, name: "Viajes", slug: "viajes" }] };

function startFakeWordPress() {
  return new Promise((resolve) => {
    wpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://x");
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks);
      const send = (code, body, headers = {}) => {
        res.writeHead(code, { "Content-Type": "application/json", ...headers });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === "/fuente/blanda") {
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end("<html><head><title>Página no encontrada</title></head><body></body></html>");
      }
      if (url.pathname.startsWith("/fuente/")) {
        res.writeHead(url.pathname.endsWith("404") ? 404 : 200, { "Content-Type": "text/html" });
        return res.end("<html><head><title>Fuente</title></head><body><article><p>El museo recibió 1.250 visitantes en 2025 y la entrada cuesta $5.000. El director dijo que la colección crecerá mucho este año.</p></article></body></html>");
      }
      const route = url.pathname.replace(/^\/wp-json\/?/, "");
      if (route === "") return send(200, { name: "Sitio de prueba", namespaces: ["wp/v2", "rankmath/v1", "autoblog/v1"] });
      const expected = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");
      if (req.headers.authorization !== expected) return send(401, { message: "No autorizado" });

      if (route === "autoblog/v1/lock") {
        if (req.method === "POST") {
          const { run_id } = JSON.parse(raw);
          if (state.lock) return send(200, { ok: false, held_by: state.lock, expires: Math.floor(Date.now() / 1000) + 600 });
          state.lock = run_id;
          return send(200, { ok: true, run_id });
        }
        if (state.lock === url.searchParams.get("run_id")) state.lock = null;
        return send(200, { ok: true });
      }
      const kv = route.match(/^autoblog\/v1\/state\/(.+)$/);
      if (kv) {
        if (req.method === "POST") {
          state.kv[kv[1]] = JSON.parse(raw).value;
          return send(200, { ok: true });
        }
        return send(200, { key: kv[1], value: state.kv[kv[1]] ?? null });
      }
      if (route === "autoblog/v1/notify") {
        state.mails.push(JSON.parse(raw));
        return send(200, { ok: true, to: "admin@example.com" });
      }
      if (route === "wp/v2/users/me") return send(200, { id: 7, username: USER, capabilities: { publish_posts: true, upload_files: true } });
      if (route === "wp/v2/categories" || route === "wp/v2/tags") {
        const tax = route.split("/")[2];
        if (req.method === "POST") {
          const { name } = JSON.parse(raw);
          const t = { id: 100 + state[tax].length, name, slug: name.toLowerCase() };
          state[tax].push(t);
          return send(201, t);
        }
        return send(200, state[tax], { "X-WP-TotalPages": "1" });
      }
      if (route === "wp/v2/media" && req.method === "POST") {
        const m = { id: 300 + state.media.length, source_url: "http://wp/uploads/" + /filename="([^"]+)"/.exec(req.headers["content-disposition"])[1], bytes: raw.length };
        state.media.push(m);
        return send(201, m);
      }
      const mm = route.match(/^wp\/v2\/media\/(\d+)$/);
      if (mm) {
        const m = state.media.find((x) => x.id === Number(mm[1]));
        Object.assign(m, JSON.parse(raw));
        return send(200, m);
      }
      if (route === "wp/v2/posts" && req.method === "POST") {
        const body = JSON.parse(raw);
        const p = { id: 500 + state.posts.length, ...body, title: { rendered: body.title }, link: "http://wp/?p=" + (500 + state.posts.length), author: 7, date: "2026-10-25T10:00:00", date_gmt: "2026-10-25T13:00:00" };
        state.posts.push(p);
        return send(201, p);
      }
      if (route === "wp/v2/posts") {
        const search = url.searchParams.get("search");
        let list = [...state.posts].reverse();
        if (search) list = list.filter((p) => p.title.rendered.toLowerCase().includes(search.toLowerCase()));
        return send(200, list);
      }
      send(404, { message: "ruta desconocida " + route });
    });
    wpServer.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${wpServer.address().port}`));
  });
}

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0].text;
  if (r.isError) throw new Error(text);
  return JSON.parse(text);
}

before(async () => {
  const wpUrl = await startFakeWordPress();
  base = wpUrl;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "autoblog-"));
  fs.mkdirSync(path.join(tmp, "sites"));
  fs.writeFileSync(
    path.join(tmp, "sites", "prueba.json"),
    JSON.stringify({
      name: "Prueba",
      niche: "Viajes por Chile",
      url: wpUrl + "/",
      content: { minSources: 1 },
      publishing: { hours: [0, 24] },
      notify: { onDraft: true },
      topics: { seedTopics: ["Qué ver en Valparaíso"] },
    })
  );
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(here, "..", "src", "index.js")],
      env: {
        ...process.env,
        AUTOBLOG_HOME: path.join(tmp, "home"),
        AUTOBLOG_SITES_DIR: path.join(tmp, "sites"),
        AUTOBLOG_PRUEBA_USER: USER,
        AUTOBLOG_PRUEBA_APP_PASSWORD: PASS,
        TAVILY_API_KEY: "",
        BRAVE_API_KEY: "",
      },
    })
  );
});

after(async () => {
  await client?.close();
  wpServer?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("lista herramientas", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const n of ["sites_list", "sites_due", "run_begin", "run_end", "research_fetch", "images_search", "wp_upload_media", "wp_create_post"]) {
    assert.ok(names.includes(n), `falta ${n}`);
  }
});

test("sitios y conexión", async () => {
  const list = await call("sites_list");
  assert.equal(list.sites[0].id, "prueba");
  assert.equal(list.sites[0].credentials, "ok");
  const check = await call("site_check", { site: "prueba" });
  assert.equal(check.canPublish, true);
  assert.equal(check.seoPlugin, "rankmath");
  assert.equal(check.bridgeInstalled, true);
  const due = await call("sites_due");
  assert.deepEqual(due.due, ["prueba"]);
});

test("flujo completo de publicación con salvaguardas", async () => {
  const run = await call("run_begin", { site: "prueba" });
  assert.equal(run.started, true);
  assert.equal(run.nextTopic.topic, "Qué ver en Valparaíso");
  const second = await call("run_begin", { site: "prueba" });
  assert.equal(second.started, false, "el bloqueo debe impedir una segunda ejecución");

  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8ffbf1e000502027f6b3b6b0000000049454e44ae426082", "hex");
  const media = await call("wp_upload_media", { site: "prueba", base64: png.toString("base64"), filename: "Valparaíso cerros", alt_text: "Cerros de Valparaíso" });
  assert.equal(media.id, 300);
  assert.match(media.url, /valparaiso-cerros\.png$/);
  assert.equal(state.media[0].alt_text, "Cerros de Valparaíso");

  const sources = ["a", "b", "c"].map((x) => ({ title: x, url: `${base}/fuente/${x}` }));
  const low = await call("wp_create_post", {
    site: "prueba",
    title: "Qué ver en Valparaíso: guía 2026",
    content: "```html\n<h1>Título</h1><p>Hola <a href=\"" + base + "/fuente/a\">bien</a> y <a href=\"" + base + "/fuente/404\">roto</a></p>\n```",
    categories: ["Viajes", "Inexistente"],
    tags: ["Chile", "Valparaíso"],
    featured_media: media.id,
    seo: { title: "Valparaíso", description: "Guía", focus_keyword: "qué ver en valparaíso" },
    sources,
    quality_score: 5,
  });
  assert.equal(low.status, "draft", "una puntuación baja no debe publicarse");
  const created = state.posts.at(-1);
  assert.equal(created.content, `<p>Hola <a href="${base}/fuente/a">bien</a> y roto</p>`, "limpia el HTML y quita el enlace roto");
  assert.ok(low.warnings.some((w) => w.includes("Enlaces rotos")));
  assert.deepEqual(created.categories, [1]);
  assert.equal(created.tags.length, 2);
  assert.equal(created.meta.rank_math_focus_keyword, "qué ver en valparaíso");
  assert.equal(JSON.parse(created.meta._autoblog_sources).length, 3);

  await assert.rejects(
    call("wp_create_post", { site: "prueba", title: "Qué ver en Valparaíso: guía 2026", content: "<p>x</p>", sources, quality_score: 9 }),
    /Ya existe/
  );

  const good = await call("wp_create_post", { site: "prueba", title: "Valparaíso en un día", content: "<p>x</p>", sources, quality_score: 8.5, featured_media: media.id });
  assert.equal(good.status, "publish");

  const fewSources = await call("wp_create_post", { site: "prueba", title: "Otro artículo sobre el puerto", content: "<p>x</p>", sources: [{ title: "rota", url: `${base}/fuente/404` }], quality_score: 9 });
  assert.equal(fewSources.status, "draft", "una fuente rota no cuenta para el mínimo");
  assert.equal(fewSources.distinctPublishers, 0);

  const supported = await call("wp_create_post", {
    site: "prueba",
    title: "El museo del puerto en cifras",
    content: "<p>Recibió 1.250 visitantes en 2025 y la entrada cuesta 5.000 pesos. “la colección crecerá mucho este año” según el director.</p>",
    sources,
    quality_score: 9,
  });
  assert.equal(supported.status, "publish", JSON.stringify(supported.warnings));
  assert.deepEqual(supported.unsupportedNumbers, []);

  const invented = await call("wp_create_post", {
    site: "prueba",
    title: "El museo del puerto rompe récords",
    content: "<p>Recibió 98.765 visitantes, un 47% más, con 3.210 socios. “Es el mejor museo de todo el país sin ninguna duda” dijo.</p>",
    sources,
    quality_score: 9,
  });
  assert.equal(invented.status, "draft", "cifras y citas inventadas deben bloquear la publicación");
  assert.equal(invented.unsupportedNumbers.length, 3);
  assert.equal(invented.unsupportedQuotes.length, 1);

  const v = await call("content_verify", { content: `<p>Son 1.250 visitantes y 31.337 socios. <a href="${base}/fuente/blanda">más</a></p>`, sources: [`${base}/fuente/a`], title: "Museo" });
  assert.deepEqual(v.unsupportedNumbers.map((n) => n.number), ["31.337"]);
  assert.ok(v.titleIssues.length > 0);
  assert.deepEqual(v.brokenLinks, [`${base}/fuente/blanda`], "detecta páginas 404 que responden 200");

  await call("run_end", { site: "prueba", run_id: run.runId, outcome: "published", topic: "Qué ver en Valparaíso", post_id: good.id, post_url: good.link });
  const next = await call("topics_next", { site: "prueba" });
  assert.equal(next.source, "none", "el tema usado no debe repetirse");
  const again = await call("run_begin", { site: "prueba" });
  assert.equal(again.started, true, "el bloqueo debe liberarse al terminar");
  await call("run_end", { site: "prueba", run_id: again.runId, outcome: "skipped" });
});

test("los borradores cuentan para la frecuencia (no reintenta cada 2 horas)", async () => {
  const due = await call("sites_due");
  assert.deepEqual(due.due, [], JSON.stringify(due.sites));
  assert.ok(due.sites[0].last.status, "debe informar el estado del último artículo");
});

test("bloqueo compartido en WordPress (PC y nube)", async () => {
  state.lock = "ejecucion-en-la-nube";
  const r = await call("run_begin", { site: "prueba" });
  assert.equal(r.started, false);
  assert.equal(r.lock.scope, "wordpress");
  state.lock = null;
  const r2 = await call("run_begin", { site: "prueba" });
  assert.equal(r2.started, true);
  assert.equal(r2.site.lockScope, "wordpress");
  await call("run_end", { site: "prueba", run_id: r2.runId, outcome: "draft", topic: "Tema de prueba", notes: "borrador" });
  assert.equal(state.lock, null, "libera el bloqueo remoto");
  assert.ok(state.kv.topics.used.some((t) => t.topic === "Tema de prueba"), "la cola se guarda en WordPress");
  assert.ok(state.kv.runs.length >= 1, "el historial se guarda en WordPress");
  assert.equal(state.mails.length, 1, "avisa por correo de los borradores (notify.onDraft)");
});

test("temas parecidos y enlaces relacionados", async () => {
  const sim = await call("topics_check_similar", { site: "prueba", topic: "Un día en Valparaíso" });
  assert.equal(sim.verdict, "muy_parecido");
  const nuevo = await call("topics_check_similar", { site: "prueba", topic: "Mejores termas del sur de Chile" });
  assert.equal(nuevo.verdict, "nuevo");
  const rel = await call("wp_find_related", { site: "prueba", keywords: ["Valparaíso", "museo"] });
  assert.ok(rel.length >= 2);
  const casi = await call("wp_create_post", {
    site: "prueba",
    title: "Valparaíso en un día completo",
    content: "<p>x</p>",
    sources: [{ title: "a", url: `${base}/fuente/a` }],
    quality_score: 9,
  });
  assert.equal(casi.status, "draft", "un artículo casi igual a uno publicado no se publica");
});

test("verificación con extractos cuando la fuente bloquea descargas", async () => {
  const v = await call("content_verify", {
    content: "<p>Llegaron 4.321 turistas y 8.765 cruceristas.</p>",
    sources: [{ title: "Bloqueada", url: `${base}/fuente/404`, excerpt: "En total llegaron 4.321 turistas al puerto." }],
  });
  assert.equal(v.sourcesRead, 1);
  assert.deepEqual(v.unsupportedNumbers.map((n) => n.number), ["8.765"]);
  const none = await call("content_verify", { content: "<p>Son 5.555 personas.</p>", sources: [`${base}/fuente/404`] });
  assert.equal(none.skipped, true, "si no se puede leer ninguna fuente no se bloquea");
});

test("puntuación SEO del contenido", async () => {
  const good = await call("seo_content_score", {
    keyword: "qué ver en valparaíso",
    title: "Qué ver en Valparaíso: 12 lugares imperdibles",
    seo_title: "Qué ver en Valparaíso: 12 lugares imperdibles",
    meta_description: "Qué ver en Valparaíso en uno o dos días: cerros, ascensores, miradores y museos, con horarios y precios actualizados para planificar tu visita.",
    slug: "que-ver-en-valparaiso",
    content:
      "<p>Si buscas qué ver en Valparaíso, empieza por sus cerros y ascensores históricos.</p>" +
      ["Cerro Alegre", "Ascensores", "Miradores", "Qué ver en Valparaíso de noche", "Preguntas frecuentes"]
        .map((h) => `<h2>${h}</h2><p>Texto breve sobre ${h} con <a href="https://a.cl">fuente</a> y <a href="https://b.cl">otra</a>.</p>`)
        .join("") +
      '<figure><img src="x.jpg" alt="Casas de colores en el cerro Alegre"/></figure>',
    terms: [{ term: "cerro alegre" }, { term: "ascensores" }, { term: "funicular" }],
    recommended_words: 80,
  });
  assert.ok(good.score >= 70, JSON.stringify(good));
  assert.deepEqual(good.missingTerms, ["funicular"]);
  const bad = await call("seo_content_score", { keyword: "termas de chillán", title: "Un viaje al sur", content: "<p>Hola.</p>" });
  assert.ok(bad.score < 40);
  assert.ok(bad.fixes.length > 3);
});

test("credenciales incorrectas dan un error claro", async () => {
  const r = await client.callTool({ name: "site_check", arguments: { site: "noexiste" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /No existe el sitio/);
});

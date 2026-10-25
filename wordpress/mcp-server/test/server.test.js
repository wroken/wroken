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
const state = { posts: [], media: [], tags: [{ id: 50, name: "Chile", slug: "chile" }], categories: [{ id: 1, name: "Viajes", slug: "viajes" }] };

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
    JSON.stringify({ name: "Prueba", url: wpUrl + "/", content: { minSources: 1 }, topics: { seedTopics: ["Qué ver en Valparaíso"] } })
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

  const v = await call("content_verify", { content: `<p>Son 1.250 visitantes y 31.337 socios. <a href="${base}/fuente/blanda">más</a></p>`, source_urls: [`${base}/fuente/a`], title: "Museo" });
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

test("credenciales incorrectas dan un error claro", async () => {
  const r = await client.callTool({ name: "site_check", arguments: { site: "noexiste" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /No existe el sitio/);
});

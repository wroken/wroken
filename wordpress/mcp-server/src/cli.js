#!/usr/bin/env node
// Utilidad de línea de comandos para los scripts de instalación.
// Los secretos se leen por la entrada estándar (no quedan en el historial de la consola).
//
//   node src/cli.js set-site <id>      stdin: {"user":"...","appPassword":"..."}
//   node src/cli.js set-key <NOMBRE>   stdin: valor
//   node src/cli.js check <id>
//   node src/cli.js list

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { autoblogHome, getCredentials, getSite, loadSites } from "./config.js";
import { checkSite } from "./wordpress.js";

const KEYS = ["TAVILY_API_KEY", "BRAVE_API_KEY", "PEXELS_API_KEY", "GOOGLE_SERVICE_ACCOUNT_JSON"];

async function stdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8").trim();
}

function updateCredentials(fn) {
  const home = autoblogHome();
  fs.mkdirSync(home, { recursive: true });
  const file = path.join(home, "credentials.json");
  let data = {};
  if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  fn(data);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  return file;
}

const [cmd, arg] = process.argv.slice(2);

try {
  if (cmd === "set-site") {
    getSite(arg);
    const { user, appPassword, appPasswordDpapi, store } = JSON.parse(await stdin());
    if (!user || !(appPassword || appPasswordDpapi || store === "keychain")) throw new Error("Faltan usuario o contraseña");
    let entry;
    if (appPasswordDpapi) entry = { user, store: "dpapi", appPasswordDpapi };
    else if (store === "keychain") entry = { user, store: "keychain" };
    else entry = { user, appPassword: appPassword.trim() };
    const file = updateCredentials((d) => (d[arg] = entry));
    const where = entry.store === "dpapi" ? " (cifrada con tu usuario de Windows)" : entry.store === "keychain" ? " (contraseña en el Llavero)" : "";
    console.log(`Credenciales de "${arg}" guardadas en ${file}${where}`);
  } else if (cmd === "set-key") {
    if (!KEYS.includes(arg)) throw new Error(`Clave desconocida. Válidas: ${KEYS.join(", ")}`);
    const value = await stdin();
    const file = updateCredentials((d) => {
      d._keys = d._keys || {};
      if (value) d._keys[arg] = value;
      else delete d._keys[arg];
    });
    console.log(`${arg} ${value ? "guardada" : "eliminada"} en ${file}`);
  } else if (cmd === "check") {
    const r = await checkSite(getSite(arg));
    console.log(JSON.stringify(r, null, 2));
    if (!r.canPublish || !r.canUpload) console.log("AVISO: el usuario necesita rol Autor, Editor o Administrador.");
    if (!r.bridgeInstalled) console.log("AVISO: instala el plugin Autoblog Bridge (SEO, bloqueo compartido, avisos y WebP).");
  } else if (cmd === "install-desktop") {
    // Registra el servidor en claude_desktop_config.json (con copia de seguridad).
    const file = arg;
    const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.js");
    const sites = path.resolve(path.dirname(entry), "..", "..", "sites");
    let cfg = {};
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, file + ".bak");
      const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim();
      cfg = raw ? JSON.parse(raw) : {};
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    cfg.mcpServers = cfg.mcpServers || {};
    cfg.mcpServers.autoblog = {
      command: process.execPath,
      args: [entry],
      env: { AUTOBLOG_SITES_DIR: sites },
    };
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
    console.log(`Autoblog registrado en ${file}`);
  } else if (cmd === "list") {
    for (const s of loadSites()) {
      console.log(`${s.id.padEnd(16)} ${s.enabled ? "activo  " : "inactivo"} ${getCredentials(s.id) ? "credenciales OK " : "SIN credenciales"} ${s.url}`);
    }
  } else {
    console.log("Uso: node src/cli.js set-site <id> | set-key <NOMBRE> | check <id> | list");
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error("Error: " + e.message);
  process.exit(1);
}

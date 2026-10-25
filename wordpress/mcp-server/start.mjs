#!/usr/bin/env node
// Arranque que instala las dependencias si faltan (útil en sesiones nuevas en la nube).
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
if (!fs.existsSync(path.join(here, "node_modules", "@modelcontextprotocol", "sdk"))) {
  execSync("npm ci --omit=dev --no-fund --no-audit --silent", { cwd: here, stdio: ["ignore", "ignore", "inherit"] });
}
await import(pathToFileURL(path.join(here, "src", "index.js")).href);

// Genera dist/autoblog.mcpb para instalar con doble clic en Claude Desktop.
// Uso: node mcpb/build.mjs   (desde la carpeta wordpress)
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const out = path.join(root, "dist", "mcpb");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "server"), { recursive: true });

const manifest = JSON.parse(fs.readFileSync(path.join(here, "manifest.json"), "utf8"));
manifest.version = JSON.parse(fs.readFileSync(path.join(root, "mcp-server", "package.json"), "utf8")).version;
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
fs.cpSync(path.join(root, "mcp-server", "src"), path.join(out, "server", "src"), { recursive: true });
for (const f of ["package.json", "package-lock.json"]) {
  const p = path.join(root, "mcp-server", f);
  if (fs.existsSync(p)) fs.copyFileSync(p, path.join(out, "server", f));
}
execSync("npm ci --omit=dev --no-fund --no-audit", { cwd: path.join(out, "server"), stdio: "inherit" });
const file = path.join(root, "dist", "autoblog.mcpb");
execSync(`npx -y @anthropic-ai/mcpb@2.1.2 pack "${out}" "${file}"`, { stdio: "inherit" });
console.log(`\nListo: ${file}`);

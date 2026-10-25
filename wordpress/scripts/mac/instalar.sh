#!/bin/bash
# Instala Autoblog en macOS: dependencias, Claude Desktop, Claude Code y skills.
# Uso: bash instalar.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SERVER="$ROOT/mcp-server"
SITES="$ROOT/sites"
mkdir -p "$HOME/.autoblog"

echo "==> Comprobando Node.js"
if ! command -v node >/dev/null; then
  if command -v brew >/dev/null; then brew install node; else
    echo "Instala Node.js 20 o superior desde https://nodejs.org y vuelve a ejecutar este script."; exit 1; fi
fi
MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$MAJOR" -ge 20 ] || { echo "Se necesita Node.js 20 o superior (tienes $(node -v))."; exit 1; }

echo "==> Instalando dependencias del servidor"
(cd "$SERVER" && npm install --omit=dev --no-fund --no-audit)

echo "==> Registrando en Claude Desktop"
node "$SERVER/src/cli.js" install-desktop "$HOME/Library/Application Support/Claude/claude_desktop_config.json"

echo "==> Registrando en Claude Code (si está instalado)"
if command -v claude >/dev/null; then
  claude mcp remove autoblog -s user >/dev/null 2>&1 || true
  claude mcp add autoblog -s user -e "AUTOBLOG_SITES_DIR=$SITES" -- node "$SERVER/src/index.js"
  mkdir -p "$HOME/.claude/skills" && cp -R "$ROOT/skills/"* "$HOME/.claude/skills/"
  echo "Skills copiadas a ~/.claude/skills"
else
  echo "Claude Code no está instalado; se omite."
fi

echo "==> Preparando las skills para Claude Desktop"
mkdir -p "$ROOT/dist"
for d in "$ROOT/skills"/*/; do
  name=$(basename "$d"); rm -f "$ROOT/dist/$name.zip"
  (cd "$ROOT/skills" && zip -qr "$ROOT/dist/$name.zip" "$name")
  echo "  $ROOT/dist/$name.zip"
done

cat <<MSG

Listo. Siguientes pasos:
  1. Reinicia Claude Desktop (Cmd+Q y ábrelo de nuevo).
  2. En Claude Desktop: Configuración > Capacidades > Skills > Subir, y sube los .zip de $ROOT/dist
  3. Configura cada sitio:   bash configurar-sitio.sh viajesok
  4. (Opcional) Claves:      bash configurar-claves.sh
  5. Instala el plugin wp-plugin/autoblog-bridge en cada WordPress.
  6. Prueba en Claude: "Ejecuta autoblog para viajesok".
MSG

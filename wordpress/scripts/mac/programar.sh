#!/bin/bash
# Programa Autoblog con launchd para que se ejecute cada N horas.
# Cada sitio publica según su frecuencia (frequency.everyHours); la tarea solo revisa a cuáles les toca.
# Uso: bash programar.sh 2               (todos los sitios, cada 2 h)
#      bash programar.sh 6 ladeportiva   (solo un sitio)
#      bash programar.sh quitar [sitio]
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ "${1:-}" = "quitar" ]; then SITE="${2:-}"; else HOURS="${1:-2}"; SITE="${2:-}"; fi
LABEL="com.autoblog${SITE:+.$SITE}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl unload "$PLIST" >/dev/null 2>&1 || true
if [ "${1:-}" = "quitar" ]; then rm -f "$PLIST"; echo "Tarea $LABEL eliminada."; exit 0; fi
command -v claude >/dev/null || { echo "Necesitas Claude Code: https://code.claude.com (instálalo y ejecuta 'claude' una vez para iniciar sesión)."; exit 1; }
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DIR/ejecutar-autoblog.sh</string><string>$SITE</string></array>
  <key>StartInterval</key><integer>$((HOURS * 3600))</integer>
  <key>RunAtLoad</key><false/>
</dict></plist>
PL
launchctl load "$PLIST"
echo "Tarea $LABEL creada: cada $HOURS h. Registros en ~/.autoblog/logs"
echo "El Mac debe estar encendido y con tu sesión iniciada."

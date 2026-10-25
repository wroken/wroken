#!/bin/bash
# Ejecuta Autoblog sin interfaz con Claude Code (lo usa la tarea programada).
# Uso: bash ejecutar-autoblog.sh [id-del-sitio]
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.claude/local:$PATH"
LOGS="$HOME/.autoblog/logs"; mkdir -p "$LOGS"
LOG="$LOGS/autoblog-$(date +%Y%m%d-%H%M).log"
if [ -n "${1:-}" ]; then PROMPT="Usa la skill autoblog con sitio=$1."
else PROMPT="Usa la skill autoblog para publicar en todos los sitios a los que les toca (sites_due)."; fi
TOOLS="mcp__autoblog,WebSearch,WebFetch,mcp__claude_ai_Magnific,mcp__claude_ai_Higgsfield,Read,Skill"
{ echo "[$(date -u +%FT%TZ)] Inicio: $PROMPT"
  claude -p "$PROMPT" --allowedTools "$TOOLS" 2>&1
  echo "[$(date -u +%FT%TZ)] Fin (código $?)"; } >> "$LOG"
ls -1t "$LOGS"/autoblog-*.log 2>/dev/null | tail -n +61 | xargs rm -f

#!/bin/bash
# Guarda claves opcionales: Tavily o Brave (búsqueda de fuentes) y Pexels (fotos).
# Deja en blanco para no cambiar una clave; escribe "borrar" para eliminarla.
set -euo pipefail
CLI="$(cd "$(dirname "$0")/../../mcp-server" && pwd)/src/cli.js"
for pair in "TAVILY_API_KEY|Tavily (https://tavily.com, plan gratuito)" "BRAVE_API_KEY|Brave Search API (https://brave.com/search/api)" "PEXELS_API_KEY|Pexels (https://www.pexels.com/api, gratis)" "GOOGLE_SERVICE_ACCOUNT_JSON|Search Console: ruta al archivo .json de la cuenta de servicio (ver README)"; do
  key="${pair%%|*}"; label="${pair#*|}"
  read -rp "$label: " val
  [ -z "$val" ] && continue
  [ "$val" = "borrar" ] && val=""
  printf '%s' "$val" | node "$CLI" set-key "$key"
done

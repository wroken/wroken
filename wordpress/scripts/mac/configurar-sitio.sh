#!/bin/bash
# Guarda las credenciales de WordPress de un sitio y prueba la conexión.
# Uso: bash configurar-sitio.sh viajesok
set -euo pipefail
[ $# -eq 1 ] || { echo "Uso: bash configurar-sitio.sh <id-del-sitio>"; exit 1; }
CLI="$(cd "$(dirname "$0")/../../mcp-server" && pwd)/src/cli.js"
echo "Credenciales de WordPress para '$1'"
echo "Crea una contraseña de aplicación en: WordPress > Usuarios > Perfil > Contraseñas de aplicación"
read -rp "Usuario de WordPress: " WPUSER
read -rsp "Contraseña de aplicación: " WPPASS; echo
# La contraseña se guarda en el Llavero de macOS, no en un archivo.
security add-generic-password -U -s autoblog -a "$1" -w "$WPPASS"
WPUSER="$WPUSER" node -e 'process.stdout.write(JSON.stringify({user:process.env.WPUSER,store:"keychain"}))' | node "$CLI" set-site "$1"
echo; echo "Probando conexión..."
node "$CLI" check "$1"

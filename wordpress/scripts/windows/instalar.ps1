# Instala Autoblog en Windows: dependencias, Claude Desktop, Claude Code y skills.
# Uso: clic derecho > "Ejecutar con PowerShell", o doble clic en instalar.bat

$ErrorActionPreference = 'Stop'
$Root   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Server = Join-Path $Root 'mcp-server'
$Entry  = Join-Path $Server 'src\index.js'
$Sites  = Join-Path $Root 'sites'
$AbHome = Join-Path $env:USERPROFILE '.autoblog'

function Paso($t) { Write-Host "`n==> $t" -ForegroundColor Cyan }

Paso 'Comprobando Node.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host 'Node.js no está instalado. Intentando instalarlo con winget...'
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    Write-Host 'Node.js instalado. Cierra esta ventana y vuelve a ejecutar el instalador.' -ForegroundColor Yellow
    exit 0
}
$ver = (& node -p 'process.versions.node')
if ([int]($ver.Split('.')[0]) -lt 20) { throw "Se necesita Node.js 20 o superior (tienes $ver). Actualiza desde https://nodejs.org" }
Write-Host "Node.js $ver"

Paso 'Instalando dependencias del servidor'
Push-Location $Server
try { npm install --omit=dev --no-fund --no-audit } finally { Pop-Location }

New-Item -ItemType Directory -Force -Path $AbHome | Out-Null

Paso 'Registrando en Claude Desktop'
$configs = @(Join-Path $env:APPDATA 'Claude\claude_desktop_config.json')
$store = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Packages') -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue
foreach ($p in $store) { $configs += Join-Path $p.FullName 'LocalCache\Roaming\Claude\claude_desktop_config.json' }
$done = $false
foreach ($c in $configs) {
    if ((Test-Path $c) -or (Test-Path (Split-Path $c))) { node (Join-Path $Server 'src\cli.js') install-desktop $c; $done = $true }
}
if (-not $done) { Write-Host 'No se encontró Claude Desktop (si lo instalas después, vuelve a ejecutar este script).' -ForegroundColor Yellow }

Paso 'Registrando en Claude Code (si está instalado)'
if (Get-Command claude -ErrorAction SilentlyContinue) {
    try { & claude mcp remove autoblog -s user 2>$null | Out-Null } catch { }
    & claude mcp add autoblog -s user -e "AUTOBLOG_SITES_DIR=$Sites" -- node $Entry
    $skillsDir = Join-Path $env:USERPROFILE '.claude\skills'
    New-Item -ItemType Directory -Force -Path $skillsDir | Out-Null
    Copy-Item -Recurse -Force (Join-Path $Root 'skills\*') $skillsDir
    Write-Host "Skills copiadas a $skillsDir"
} else {
    Write-Host 'Claude Code no está instalado; se omite.'
}

Paso 'Preparando las skills para Claude Desktop'
$dist = Join-Path $Root 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
foreach ($s in Get-ChildItem (Join-Path $Root 'skills') -Directory) {
    $zip = Join-Path $dist "$($s.Name).zip"
    if (Test-Path $zip) { Remove-Item $zip }
    Compress-Archive -Path $s.FullName -DestinationPath $zip
    Write-Host "  $zip"
}

Write-Host "`nListo. Siguientes pasos:" -ForegroundColor Green
Write-Host '  1. Reinicia Claude Desktop (ciérralo también desde la bandeja del sistema).'
Write-Host "  2. En Claude Desktop: Configuración > Capacidades > Skills > Subir, y sube los .zip de $dist"
Write-Host '  3. Configura cada sitio:   .\configurar-sitio.ps1 -Sitio viajesok'
Write-Host '  4. (Opcional) Claves:      .\configurar-claves.ps1'
Write-Host '  5. Instala el plugin wp-plugin\autoblog-bridge en cada WordPress.'
Write-Host '  6. Prueba en Claude: "Ejecuta autoblog para viajesok".'

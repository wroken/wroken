# Guarda las credenciales de WordPress de un sitio y prueba la conexión.
# Uso: .\configurar-sitio.ps1 -Sitio viajesok
param([Parameter(Mandatory = $true)][string]$Sitio)

$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$Cli = Join-Path $PSScriptRoot '..\..\mcp-server\src\cli.js'

Write-Host "Credenciales de WordPress para '$Sitio'"
Write-Host 'Crea una contraseña de aplicación en: WordPress > Usuarios > Perfil > Contraseñas de aplicación'
$user = Read-Host 'Usuario de WordPress'
$sec  = Read-Host 'Contraseña de aplicación' -AsSecureString
# Se guarda cifrada con DPAPI: solo tu usuario de Windows en este equipo puede descifrarla.
$enc  = ConvertFrom-SecureString $sec

@{ user = $user; store = 'dpapi'; appPasswordDpapi = $enc } | ConvertTo-Json -Compress | node $Cli set-site $Sitio
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "`nProbando conexión..."
node $Cli check $Sitio

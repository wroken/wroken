# Guarda claves opcionales: Tavily o Brave (búsqueda de fuentes) y Pexels (fotos).
# Deja en blanco para no cambiar una clave; escribe "borrar" para eliminarla.

$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$Cli = Join-Path $PSScriptRoot '..\..\mcp-server\src\cli.js'
$claves = [ordered]@{
    TAVILY_API_KEY = 'Tavily (https://tavily.com, plan gratuito)'
    BRAVE_API_KEY  = 'Brave Search API (https://brave.com/search/api)'
    PEXELS_API_KEY = 'Pexels (https://www.pexels.com/api, gratis)'
}
foreach ($k in $claves.Keys) {
    $v = Read-Host "$($claves[$k])"
    if ($v -eq '') { continue }
    if ($v -eq 'borrar') { $v = '' }
    $v | node $Cli set-key $k
}

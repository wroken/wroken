# Ejecuta Autoblog sin interfaz con Claude Code (lo usa la tarea programada).
param([string]$Sitio = '')

$AbHome = Join-Path $env:USERPROFILE '.autoblog'
$Logs = Join-Path $AbHome 'logs'
New-Item -ItemType Directory -Force -Path $Logs | Out-Null
$log = Join-Path $Logs ("autoblog-{0:yyyyMMdd-HHmm}.log" -f (Get-Date))

$prompt = if ($Sitio) { "Usa la skill autoblog con sitio=$Sitio." } else { 'Usa la skill autoblog para publicar en todos los sitios a los que les toca (sites_due).' }
$tools = 'mcp__autoblog,WebSearch,WebFetch,mcp__claude_ai_Magnific,mcp__claude_ai_Higgsfield,Read,Skill'

"[$(Get-Date -Format s)] Inicio: $prompt" | Out-File -Append -Encoding utf8 $log
& claude -p $prompt --allowedTools $tools *>&1 | Out-File -Append -Encoding utf8 $log
"[$(Get-Date -Format s)] Fin (código $LASTEXITCODE)" | Out-File -Append -Encoding utf8 $log

# Conserva solo los últimos 60 registros
Get-ChildItem $Logs -Filter 'autoblog-*.log' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 60 | Remove-Item -ErrorAction SilentlyContinue

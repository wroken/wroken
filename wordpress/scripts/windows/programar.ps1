# Crea una tarea en el Programador de tareas de Windows que ejecuta Autoblog cada N horas.
# Cada sitio publica según su propia frecuencia (frequency.everyHours); la tarea solo revisa
# a qué sitios les toca, así que conviene que se ejecute a menudo (cada 1-3 horas).
# Uso: .\programar.ps1 -CadaHoras 2          (todos los sitios)
#      .\programar.ps1 -CadaHoras 6 -Sitio ladeportiva
#      .\programar.ps1 -Quitar
param([int]$CadaHoras = 2, [string]$Sitio = '', [switch]$Quitar)

$ErrorActionPreference = 'Stop'
$nombre = if ($Sitio) { "Autoblog - $Sitio" } else { 'Autoblog' }

if ($Quitar) {
    Unregister-ScheduledTask -TaskName $nombre -Confirm:$false
    Write-Host "Tarea '$nombre' eliminada."
    exit 0
}
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    throw 'La ejecución automática en Windows necesita Claude Code: https://code.claude.com (instálalo, ejecuta "claude" una vez para iniciar sesión y vuelve a probar).'
}

$script = Join-Path $PSScriptRoot 'ejecutar-autoblog.ps1'
$arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
if ($Sitio) { $arg += " -Sitio $Sitio" }
$action   = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg
$trigger  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours $CadaHoras)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName $nombre -Action $action -Trigger $trigger -Settings $settings -Description 'Publica artículos con Claude (Autoblog)' -Force | Out-Null

Write-Host "Tarea '$nombre' creada: cada $CadaHoras h (primera en 5 minutos)." -ForegroundColor Green
Write-Host "Registros en $env:USERPROFILE\.autoblog\logs"
Write-Host 'El PC debe estar encendido y con tu sesión de Windows iniciada.'

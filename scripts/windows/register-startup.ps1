param(
  [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$TaskName = "Muhaseb API"
)

$ErrorActionPreference = "Stop"
$apiDir = Join-Path $ProjectDir "apps\api"
$node = (Get-Command node).Source
$tsx = Join-Path $ProjectDir "node_modules\tsx\dist\cli.mjs"
$entry = Join-Path $apiDir "src\index.ts"
$builtEntry = Join-Path $apiDir "dist\index.js"

if (-not (Test-Path $builtEntry) -and (-not (Test-Path $tsx) -or -not (Test-Path $entry))) {
  throw "API runtime not found. Run scripts\windows\install-server.ps1 first."
}

$argument = if (Test-Path $builtEntry) {
  "`"$builtEntry`""
} else {
  "`"$tsx`" `"$entry`""
}

$action = New-ScheduledTaskAction `
  -Execute $node `
  -Argument $argument `
  -WorkingDirectory $apiDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Force

Start-ScheduledTask -TaskName $TaskName
Write-Host "Muhaseb API startup task registered and started."

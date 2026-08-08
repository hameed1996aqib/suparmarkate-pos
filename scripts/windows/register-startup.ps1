param(
  [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$TaskName = "Muhaseb API",
  [ValidateSet("Docker", "Node")]
  [string]$Mode = "Docker",
  [string]$BackupDir = "D:\BelalBackups",
  [string]$LanIp = ""
)

$ErrorActionPreference = "Stop"
$principalCheck = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principalCheck.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this script as Administrator to register the Muhaseb startup task."
}

if ($Mode -eq "Docker") {
  $powerShell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $startScript = Join-Path $PSScriptRoot "start-docker-server.ps1"
  $taskArguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-File", "`"$startScript`"",
    "-ProjectDir", "`"$ProjectDir`"",
    "-BackupDir", "`"$BackupDir`"",
    "-ReuseImage"
  )
  if ($LanIp.Trim()) {
    $taskArguments += @("-LanIp", "`"$($LanIp.Trim())`"")
  }
  $taskArguments = $taskArguments -join " "
  $action = New-ScheduledTaskAction `
    -Execute $powerShell `
    -Argument $taskArguments `
    -WorkingDirectory $ProjectDir
  $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $trigger = @(
    New-ScheduledTaskTrigger -AtStartup
    New-ScheduledTaskTrigger -AtLogOn -User $currentUser
  )
  $principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType Interactive `
    -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Force

  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Muhaseb Docker startup task registered for $currentUser and started."
  exit 0
}

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

param(
  [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [ValidateSet("Docker", "Node")]
  [string]$Mode = "Docker",
  [string]$BackupDir = "D:\BelalBackups",
  [string]$LanIp = "",
  [switch]$SkipStartupRegistration,
  [switch]$ConfirmStableIp,
  [switch]$ConfirmUps,
  [switch]$ConfirmSeparateBackupDisk
)

$ErrorActionPreference = "Stop"
Set-Location $ProjectDir

if ($Mode -eq "Docker") {
  if (-not $ConfirmStableIp) {
    throw "Production installation requires a DHCP reservation or static IP. Configure it, then rerun with -ConfirmStableIp."
  }
  Write-Host "Installing the complete Muhaseb Docker server stack..."
  & (Join-Path $PSScriptRoot "start-docker-server.ps1") `
    -ProjectDir $ProjectDir `
    -BackupDir $BackupDir `
    -LanIp $LanIp `
    -ConfirmStableIp:$ConfirmStableIp `
    -ConfirmUps:$ConfirmUps `
    -ConfirmSeparateBackupDisk:$ConfirmSeparateBackupDisk
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  if (-not $SkipStartupRegistration) {
    & (Join-Path $PSScriptRoot "register-startup.ps1") `
      -ProjectDir $ProjectDir `
      -Mode Docker `
      -BackupDir $BackupDir `
      -LanIp $LanIp
  }

  Write-Host "Muhaseb Docker server installation completed."
  exit 0
}

Write-Warning "Installing the legacy Node server mode. Docker is recommended for production."
Write-Host "Installing Muhaseb server dependencies..."
npm install
npm run prisma:generate
npm run prisma:deploy
npm run seed:admin
npm run build:api

Write-Host ""
Write-Host "Checking PostgreSQL backup tools..."
$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
$pgRestore = Get-Command pg_restore -ErrorAction SilentlyContinue
if (-not $pgDump -or -not $pgRestore) {
  Write-Warning "pg_dump or pg_restore was not found in PATH. Set PG_DUMP_PATH and PG_RESTORE_PATH in apps/api/.env before using production backup."
} else {
  Write-Host "PostgreSQL backup tools are available."
}

Write-Host ""
Write-Host "Server build completed."
Write-Host "Run register-startup.ps1 -Mode Node as Administrator to start the API with Windows."

param(
  [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
)

$ErrorActionPreference = "Stop"
Set-Location $ProjectDir

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
Write-Host "Run register-startup.ps1 as Administrator to start the API with Windows."

param(
  [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [int]$ApiPort = 4000,
  [int]$PosWebSocketPort = 4001,
  [int]$SystemHealthWebSocketPort = 4002,
  [string]$BackupDir = "D:\BelalBackups"
)

$ErrorActionPreference = "Stop"

Set-Location $ProjectDir

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  throw "Please run this command from PowerShell as Administrator so Windows Firewall rules can be created."
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
  throw "Docker was not found. Install Docker Desktop first, start it, then run this command again."
}

$lanIp = (
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notlike "127.*" -and
      $_.IPAddress -notlike "169.254.*" -and
      $_.PrefixOrigin -ne "WellKnown"
    } |
    Sort-Object InterfaceMetric |
    Select-Object -First 1 -ExpandProperty IPAddress
)
if (-not $lanIp) {
  $lanIp = "127.0.0.1"
}
$lanApiBaseUrl = "http://$lanIp`:$ApiPort"
$lanWebUrl = $lanApiBaseUrl
$resolvedBackupDir = [System.IO.Path]::GetFullPath($BackupDir)
New-Item -ItemType Directory -Force -Path $resolvedBackupDir | Out-Null

$composeEnvPath = Join-Path $ProjectDir ".env"
if (-not (Test-Path $composeEnvPath)) {
  $jwtBytes = New-Object byte[] 48
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($jwtBytes)
  } finally {
    $rng.Dispose()
  }
  $jwtSecret = [Convert]::ToBase64String($jwtBytes)

  @"
JWT_SECRET=$jwtSecret
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
LAN_API_BASE_URL=$lanApiBaseUrl
PUBLIC_API_BASE_URL=$lanApiBaseUrl
WEB_APP_ENABLED=true
MUHASEB_BACKUP_DIR=$resolvedBackupDir
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=change-me-now
BACKUP_RETENTION_COUNT=7
BACKUP_SCHEDULE_ENABLED=true
"@ | Set-Content -Path $composeEnvPath -Encoding UTF8

  Write-Host "Created Docker environment file: $composeEnvPath"
} else {
  $composeEnvContent = Get-Content $composeEnvPath -Raw
  if ($composeEnvContent -notmatch "(?m)^LAN_API_BASE_URL=") {
    Add-Content -Path $composeEnvPath -Value "LAN_API_BASE_URL=$lanApiBaseUrl"
  }
  if ($composeEnvContent -notmatch "(?m)^PUBLIC_API_BASE_URL=") {
    Add-Content -Path $composeEnvPath -Value "PUBLIC_API_BASE_URL=$lanApiBaseUrl"
  }
  if ($composeEnvContent -notmatch "(?m)^WEB_APP_ENABLED=") {
    Add-Content -Path $composeEnvPath -Value "WEB_APP_ENABLED=true"
  }
  if ($composeEnvContent -notmatch "(?m)^MUHASEB_BACKUP_DIR=") {
    Add-Content -Path $composeEnvPath -Value "MUHASEB_BACKUP_DIR=$resolvedBackupDir"
  }
}

Write-Host "Muhaseb LAN API URL: $lanApiBaseUrl"
Write-Host "Muhaseb LAN Web URL: $lanWebUrl"
Write-Host "Muhaseb backup folder: $resolvedBackupDir"

Write-Host "Configuring Windows Firewall for Muhaseb LAN ports..."
& (Join-Path $PSScriptRoot "configure-firewall.ps1") `
  -ApiPort $ApiPort `
  -PosWebSocketPort $PosWebSocketPort `
  -SystemHealthWebSocketPort $SystemHealthWebSocketPort

Write-Host ""
Write-Host "Starting Muhaseb server stack with Docker Compose..."
$imageArchivePath = Join-Path $ProjectDir "muhaseb-api-local.tar"
if (Test-Path $imageArchivePath) {
  Write-Host "Loading prebuilt Muhaseb API image..."
  docker load -i $imageArchivePath
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Failed to load prebuilt API image."
    exit $LASTEXITCODE
  }
} else {
  Write-Host "No prebuilt API image found. Building Muhaseb API image locally..."
  docker compose build --pull --no-cache api
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Docker image build failed. Recent container state:"
    docker compose ps
    exit $LASTEXITCODE
  }
}

docker compose up -d api
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Docker Compose failed before the API could start. Recent container state:"
  docker compose ps
  Write-Host ""
  Write-Host "Try restarting Docker Desktop. If Docker reports a missing snapshot, remove the local API image/cache and run this script again."
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Waiting for Muhaseb API health..."
$deadline = (Get-Date).AddMinutes(4)
do {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$ApiPort/health" -TimeoutSec 3
    if ($health.status -eq "ok") {
      Write-Host "Muhaseb API is ready: http://127.0.0.1:$ApiPort"
      Write-Host "Muhaseb Web is ready: $lanWebUrl"
      exit 0
    }
  } catch {
    Start-Sleep -Seconds 3
  }
} while ((Get-Date) -lt $deadline)

Write-Host "API was not healthy before timeout. Showing recent logs..."
docker compose logs --tail=80 api
exit 1

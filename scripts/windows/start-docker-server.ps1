param(
  [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [int]$ApiPort = 4000,
  [int]$PosWebSocketPort = 4001,
  [int]$SystemHealthWebSocketPort = 4002,
  [string]$BackupDir = "D:\BelalBackups",
  [string]$LanIp = "",
  [switch]$ReuseImage,
  [switch]$ConfirmStableIp,
  [switch]$ConfirmUps,
  [switch]$ConfirmSeparateBackupDisk
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

$dockerService = Get-Service -Name "com.docker.service" -ErrorAction SilentlyContinue
if ($dockerService -and $dockerService.Status -ne "Running") {
  Write-Host "Starting Docker Desktop service..."
  Start-Service -Name "com.docker.service" -ErrorAction SilentlyContinue
}

Write-Host "Waiting for the Docker engine..."
$dockerDeadline = (Get-Date).AddMinutes(5)
$dockerReady = $false
do {
  docker info --format "{{.ServerVersion}}" *> $null
  if ($LASTEXITCODE -eq 0) {
    $dockerReady = $true
    break
  }
  Start-Sleep -Seconds 5
} while ((Get-Date) -lt $dockerDeadline)
if (-not $dockerReady) {
  throw "Docker Desktop is installed but its engine did not become ready within five minutes."
}

function Test-UsableLanIp([string]$Address) {
  [System.Net.IPAddress]$parsedAddress = $null
  return (
    [System.Net.IPAddress]::TryParse($Address, [ref]$parsedAddress) -and
    $parsedAddress.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and
    $Address -notlike "127.*" -and
    $Address -notlike "169.254.*" -and
    $Address -ne "0.0.0.0"
  )
}

$lanIp = $LanIp.Trim()
if ($lanIp) {
  if (-not (Test-UsableLanIp $lanIp)) {
    throw "The supplied -LanIp value is not a usable IPv4 address: $lanIp"
  }
  $assignedIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -eq $lanIp } |
    Select-Object -First 1
  if (-not $assignedIp) {
    throw "The supplied -LanIp address is not assigned to this computer: $lanIp"
  }
} else {
  $virtualInterfacePattern = "Loopback|vEthernet|WSL|Docker|Hyper-V|Default Switch|Tailscale|ZeroTier"
  $defaultRoutes = Get-NetRoute `
    -AddressFamily IPv4 `
    -DestinationPrefix "0.0.0.0/0" `
    -ErrorAction SilentlyContinue |
    Where-Object { $_.NextHop -ne "0.0.0.0" } |
    Sort-Object RouteMetric, InterfaceMetric

  foreach ($route in $defaultRoutes) {
    $candidate = Get-NetIPAddress `
      -AddressFamily IPv4 `
      -InterfaceIndex $route.InterfaceIndex `
      -ErrorAction SilentlyContinue |
      Where-Object {
        (Test-UsableLanIp $_.IPAddress) -and
        $_.InterfaceAlias -notmatch $virtualInterfacePattern -and
        -not $_.SkipAsSource
      } |
      Select-Object -First 1
    if ($candidate) {
      $lanIp = $candidate.IPAddress
      break
    }
  }

  if (-not $lanIp) {
    $lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object {
        (Test-UsableLanIp $_.IPAddress) -and
        $_.InterfaceAlias -notmatch $virtualInterfacePattern -and
        $_.PrefixOrigin -ne "WellKnown" -and
        -not $_.SkipAsSource
      } |
      Sort-Object InterfaceMetric |
      Select-Object -First 1 -ExpandProperty IPAddress
  }
}
if (-not $lanIp) {
  throw "No usable LAN IPv4 address was detected. Connect the server to the store LAN or pass -LanIp explicitly."
}
$lanApiBaseUrl = "http://$lanIp`:$ApiPort"
$lanWebUrl = $lanApiBaseUrl
$env:MUHASEB_CURRENT_LAN_IP = $lanIp
$resolvedBackupDir = [System.IO.Path]::GetFullPath($BackupDir)
New-Item -ItemType Directory -Force -Path $resolvedBackupDir | Out-Null

function New-RandomHex([int]$ByteCount) {
  $bytes = New-Object byte[] $ByteCount
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return ([System.BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
}

function Get-EnvFileValue([string]$Content, [string]$Name) {
  $match = [regex]::Match($Content, "(?m)^$([regex]::Escape($Name))=(.*)$")
  if (-not $match.Success) { return $null }
  return $match.Groups[1].Value.Trim().Trim('"')
}

function Set-EnvFileValue([string]$Path, [string]$Name, [string]$Value) {
  $content = if (Test-Path $Path) { Get-Content $Path -Raw } else { "" }
  $pattern = "(?m)^$([regex]::Escape($Name))=.*$"
  $line = "$Name=$Value"
  if ([regex]::IsMatch($content, $pattern)) {
    $content = [regex]::Replace($content, $pattern, $line)
  } else {
    $content = $content.TrimEnd() + [Environment]::NewLine + $line + [Environment]::NewLine
  }
  Set-Content -Path $Path -Value $content -Encoding UTF8
}

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
  $databasePassword = New-RandomHex 32
  $initialAdminPassword = New-RandomHex 12

  @"
POSTGRES_USER=supermarket
POSTGRES_PASSWORD=$databasePassword
POSTGRES_DB=supermarket_db
JWT_SECRET=$jwtSecret
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
LAN_API_BASE_URL=$lanApiBaseUrl
PUBLIC_API_BASE_URL=$lanApiBaseUrl
MUHASEB_SERVER_LAN_IP=$lanIp
WEB_APP_ENABLED=true
MUHASEB_BACKUP_DIR=$resolvedBackupDir
SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=$initialAdminPassword
BACKUP_RETENTION_COUNT=7
BACKUP_SCHEDULE_ENABLED=true
DHCP_RESERVATION_CONFIRMED=$($ConfirmStableIp.IsPresent.ToString().ToLowerInvariant())
UPS_CONFIRMED=$($ConfirmUps.IsPresent.ToString().ToLowerInvariant())
BACKUP_SECOND_DISK_CONFIRMED=$($ConfirmSeparateBackupDisk.IsPresent.ToString().ToLowerInvariant())
"@ | Set-Content -Path $composeEnvPath -Encoding UTF8

  Write-Host "Created Docker environment file: $composeEnvPath"
  Write-Host ""
  Write-Warning "Initial Admin credentials are shown once. Store them securely and change the password after first login."
  Write-Host "Initial Admin username: admin"
  Write-Host "Initial Admin password: $initialAdminPassword"
} else {
  $composeEnvContent = Get-Content $composeEnvPath -Raw
  $storedLanIp = Get-EnvFileValue $composeEnvContent "MUHASEB_SERVER_LAN_IP"
  if (-not $storedLanIp) {
    Add-Content -Path $composeEnvPath -Value "MUHASEB_SERVER_LAN_IP=$lanIp"
    $storedLanIp = $lanIp
  }
  if ($storedLanIp -ne $lanIp) {
    Write-Warning "SERVER IP CHANGED: stored=$storedLanIp current=$lanIp"
    Write-Warning "Desktop and mobile clients may still point to the old IP. Configure a DHCP reservation/static IP before reopening the store."
  }
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
  if ($composeEnvContent -notmatch "(?m)^JWT_SECRET=") {
    Write-Warning "JWT_SECRET is missing. It was not generated automatically because changing it would revoke active customer sessions."
  }
  if ($composeEnvContent -notmatch "(?m)^POSTGRES_PASSWORD=") {
    Write-Warning "This existing installation uses the legacy PostgreSQL credential fallback. Rotate it only in an approved maintenance window."
  }
  if ($ConfirmStableIp) {
    Set-EnvFileValue $composeEnvPath "DHCP_RESERVATION_CONFIRMED" "true"
  }
  if ($ConfirmUps) {
    Set-EnvFileValue $composeEnvPath "UPS_CONFIRMED" "true"
  }
  if ($ConfirmSeparateBackupDisk) {
    Set-EnvFileValue $composeEnvPath "BACKUP_SECOND_DISK_CONFIRMED" "true"
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
  docker image inspect muhaseb-api:local *> $null
  if ($ReuseImage -and $LASTEXITCODE -eq 0) {
    Write-Host "Reusing the installed Muhaseb API image for startup."
  } else {
    Write-Host "Loading prebuilt Muhaseb API image..."
    docker load -i $imageArchivePath
    if ($LASTEXITCODE -ne 0) {
      Write-Host ""
      Write-Host "Failed to load prebuilt API image."
      exit $LASTEXITCODE
    }
  }
} else {
  docker image inspect muhaseb-api:local *> $null
  if ($ReuseImage -and $LASTEXITCODE -eq 0) {
    Write-Host "Reusing the installed Muhaseb API image for startup."
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
}

docker compose up -d --wait postgres redis api
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
      if (-not $health.redis.connected) {
        Write-Warning "API is running, but Redis health is not connected."
        docker compose ps
        exit 1
      }
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

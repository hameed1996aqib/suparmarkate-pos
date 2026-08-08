param(
  [string]$BaseUrl = "http://localhost:4000",
  [Parameter(Mandatory = $true)]
  [string]$Token,
  [int]$RequestsPerPath = 100,
  [int]$Concurrency = 10,
  [string]$From = "",
  [string]$To = ""
)

$ErrorActionPreference = "Stop"

if ($PSVersionTable.PSVersion.Major -lt 7) {
  throw "This concurrent load test requires PowerShell 7 or newer (pwsh)."
}

if ($RequestsPerPath -lt 1 -or $Concurrency -lt 1) {
  throw "RequestsPerPath and Concurrency must be greater than zero."
}

if (-not $From) { $From = (Get-Date).AddDays(-30).ToString("yyyy-MM-dd") }
if (-not $To) { $To = (Get-Date).ToString("yyyy-MM-dd") }

$headers = @{ Authorization = "Bearer $Token" }
$paths = @(
  "/api/dashboard/summary?period=month",
  "/api/reports/management?from=$From&to=$To",
  "/api/accounting/journal-entries?page=1&limit=50&from=$From&to=$To",
  "/api/accounting/account-period-ledger?page=1&limit=50&from=$From&to=$To",
  "/api/products/pos-search?limit=60"
)

function Get-Percentile([long[]]$Values, [double]$Percentile) {
  if ($Values.Count -eq 0) { return 0 }
  $sorted = $Values | Sort-Object
  return $sorted[[Math]::Floor(($sorted.Count - 1) * $Percentile)]
}

$rows = foreach ($path in $paths) {
  $jobs = 1..$RequestsPerPath | ForEach-Object -Parallel {
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    $status = 0
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri "$using:BaseUrl$using:path" -Headers $using:headers
      $status = [int]$response.StatusCode
    } catch {
      if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    } finally {
      $timer.Stop()
    }
    [pscustomobject]@{ DurationMs = $timer.ElapsedMilliseconds; Status = $status }
  } -ThrottleLimit $Concurrency

  $durations = [long[]]@($jobs | ForEach-Object { $_.DurationMs })
  [pscustomobject]@{
    Path = $path
    Requests = $RequestsPerPath
    Failures = @($jobs | Where-Object { $_.Status -lt 200 -or $_.Status -ge 300 }).Count
    P50Ms = Get-Percentile $durations 0.50
    P95Ms = Get-Percentile $durations 0.95
    MaxMs = ($durations | Measure-Object -Maximum).Maximum
  }
}

$rows | Format-Table -AutoSize -Wrap

if (($rows | Measure-Object -Property Failures -Sum).Sum -gt 0) {
  exit 1
}

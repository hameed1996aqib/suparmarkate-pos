param(
  [string]$BaseUrl = "http://localhost:4000",
  [string]$Token = "",
  [int]$Requests = 100
)

$ErrorActionPreference = "Stop"
$headers = @{}
if ($Token) { $headers.Authorization = "Bearer $Token" }
$paths = @("/health", "/api/dashboard/summary?period=week", "/api/products/pos-search?limit=60", "/api/alerts")

$rows = foreach ($path in $paths) {
  $times = @()
  $failures = 0
  1..$Requests | ForEach-Object {
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    try { Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl$path" -Headers $headers | Out-Null }
    catch { $failures += 1 }
    finally { $timer.Stop(); $times += $timer.ElapsedMilliseconds }
  }
  $sorted = $times | Sort-Object
  [pscustomobject]@{
    Path = $path; Requests = $Requests; Failures = $failures
    P50Ms = $sorted[[Math]::Floor(($sorted.Count - 1) * 0.50)]
    P95Ms = $sorted[[Math]::Floor(($sorted.Count - 1) * 0.95)]
    MaxMs = $sorted[-1]
  }
}

$rows | Format-Table -AutoSize

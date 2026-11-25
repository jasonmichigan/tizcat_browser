# Finish tizcat.com's email forwarding once each destination is verified.
#
# Cloudflare Email Routing only accepts a forwarding rule after its
# destination address has been verified (its owner clicks the link in
# Cloudflare's verification email). This waits for that, checking every
# minute for up to two days, and creates each rule as soon as it can:
#   hamid@tizcat.com  -> hamid.ahady@gmail.com
#   ramona@tizcat.com -> jaberian.ramona@gmail.com
# Safe to run again: a rule that already exists is not made twice (and is
# not changed: to point one at another Gmail, use "wrangler email routing
# rules update", as was done for hamid@tizcat.com on 2026-11-18).
#
#   powershell -ExecutionPolicy Bypass -File servers\scripts\email-routing-watch.ps1
# Log: %LOCALAPPDATA%\TizCatServer\email-routing.log
$ErrorActionPreference = "Continue"
$routes = [ordered]@{
  "hamid@tizcat.com"  = "hamid.ahady@gmail.com"
  "ramona@tizcat.com" = "jaberian.ramona@gmail.com"
}
$logDir = Join-Path $env:LOCALAPPDATA "TizCatServer"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir "email-routing.log"
function Say([string]$text) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $text"
  Add-Content -Path $log -Value $line
  Write-Host $line
}
function Wrangler([string[]]$arguments) {
  # Plain text, no colors, so the output can be read.
  $env:FORCE_COLOR = "0"
  return (& npx --yes wrangler@4.157.0 @arguments 2>&1 | Out-String)
}

Say "watching for verified destinations"
$deadline = (Get-Date).AddDays(2)
$done = @{}
while ((Get-Date) -lt $deadline -and $done.Count -lt $routes.Count) {
  $addresses = Wrangler @("email", "routing", "addresses", "list")
  $rules = Wrangler @("email", "routing", "rules", "list", "tizcat.com")
  foreach ($from in $routes.Keys) {
    if ($done.ContainsKey($from)) { continue }
    $to = $routes[$from]
    if ($rules -match [regex]::Escape($from)) {
      Say "rule for $from already exists"
      $done[$from] = $true
      continue
    }
    $line = ($addresses -split "`n") | Where-Object { $_ -match [regex]::Escape($to) } | Select-Object -First 1
    if (-not $line) {
      Say "destination $to is not listed; add it with: wrangler email routing addresses create $to"
      continue
    }
    if ($line -match "pending") { continue }
    $out = Wrangler @("email", "routing", "rules", "create", "tizcat.com", "--name", "$from to Gmail",
      "--match-type", "literal", "--match-field", "to", "--match-value", $from,
      "--action-type", "forward", "--action-value", $to)
    if ($out -match "ERROR") {
      Say "creating the rule for $from failed: $(($out -split "`n" | Where-Object { $_ -match 'ERROR|code' }) -join ' ')"
    } else {
      Say "rule created: $from now forwards to $to"
      $done[$from] = $true
    }
  }
  if ($done.Count -lt $routes.Count) { Start-Sleep -Seconds 60 }
}
if ($done.Count -eq $routes.Count) { Say "all forwarding rules are in place" }
else { Say "stopped waiting after two days; run this script again once the addresses are verified" }

# Put one part of TizCat's servers (or all of them) live on Cloudflare.
#
#   powershell -ExecutionPolicy Bypass -File servers\scripts\deploy.ps1 <part>
#
# Parts: web, account, api, ads, rewards, wallet, sync; config (the live
# settings, no deploy); secrets (makes and sets the account part's secrets:
# the password pepper and the tests' secret, once); mail-key (asks for the
# outside email provider's API key and sets it, see SERVICES.md); health
# (asks every part how it is); all (everything, in the order the service
# bindings need: rewards, wallet, sync, account, ads, api, web, config).
#
# A part's database changes (migrations\*.sql) are applied before it is
# deployed. Wrangler is pinned (4.157.0) and run through npx, so nothing is
# installed in this synced folder. Logged in with `npx wrangler@4.157.0
# login` (the token stays in the Windows profile).
param([Parameter(Mandatory = $true)][string]$Part)
$ErrorActionPreference = "Stop"
$servers = Split-Path $PSScriptRoot -Parent
$wrangler = @("--yes", "wrangler@4.157.0")
$kvConfig = "95adc45d9019496786dd8681f45e33fc"
# Secrets are kept outside the synced project folder, in the Windows profile.
$secretDir = Join-Path $env:LOCALAPPDATA "TizCatServer"
$secretFile = Join-Path $secretDir "secrets.json"
$databases = @{ account = "tizcat-accounts"; ads = "tizcat-ads"; rewards = "tizcat-rewards"; sync = "tizcat-sync" }

function Wrangler([string]$dir, [string[]]$arguments) {
  Push-Location $dir
  try {
    & npx @wrangler @arguments
    if ($LASTEXITCODE -ne 0) { throw "wrangler $($arguments -join ' ') failed ($LASTEXITCODE) in $dir" }
  } finally { Pop-Location }
}

function Deploy-Part([string]$name) {
  $dir = Join-Path $servers $name
  if (-not (Test-Path (Join-Path $dir "wrangler.jsonc"))) { throw "no part named $name" }
  if ($name -eq "account") {
    # The account page stretches passwords with the same code the server
    # checks against: copy the one source into the page's files.
    $js = Join-Path $dir "site\js"
    foreach ($f in @("password.js", "crypto.js", "vault.js")) {
      Copy-Item (Join-Path $servers "shared\$f") $js -Force
    }
  }
  if ($databases.ContainsKey($name)) {
    "== $name : database changes"
    Wrangler $dir @("d1", "migrations", "apply", $databases[$name], "--remote")
  }
  "== $name : deploy"
  Wrangler $dir @("deploy")
}

function Push-Config {
  "== config"
  Wrangler (Join-Path $servers "config") @("kv", "key", "put", "config", "--path", "config.json", "--namespace-id", $kvConfig, "--remote")
}

# Sets one secret on the account part. Fed from a file through cmd, so the
# value arrives exactly, with no line break added and nothing printed.
function Put-Secret([string]$name, [string]$value) {
  New-Item -ItemType Directory -Force $secretDir | Out-Null
  $tmp = Join-Path $secretDir "secret.tmp"
  [IO.File]::WriteAllText($tmp, $value)
  try {
    Push-Location (Join-Path $servers "account")
    cmd /c "npx --yes wrangler@4.157.0 secret put $name < `"$tmp`""
    if ($LASTEXITCODE -ne 0) { throw "setting $name failed" }
  } finally {
    Pop-Location
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
}

function Set-Secrets {
  New-Item -ItemType Directory -Force $secretDir | Out-Null
  $secrets = if (Test-Path $secretFile) { Get-Content $secretFile -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
  # PASSWORD_PEPPER: made once; changing it would make every stored password
  # fail, so it is kept (back it up in a password manager).
  # TEST_SECRET: lets the tests make @test.tizcat.com accounts without email.
  foreach ($name in @("PASSWORD_PEPPER", "TEST_SECRET")) {
    if (-not $secrets.PSObject.Properties[$name]) {
      $bytes = New-Object byte[] 48
      [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
      $value = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
      $secrets | Add-Member -NotePropertyName $name -NotePropertyValue $value
      $secrets | ConvertTo-Json | Set-Content -Path $secretFile -Encoding utf8
      "made a new $name, kept in $secretFile"
    }
    Put-Secret $name $secrets.$name
  }
}

# The outside email provider's key (Resend or Brevo), typed in hidden: it is
# set on the account part only, never written to a file or shown.
function Set-MailKey {
  $provider = Read-Host "Email provider (resend or brevo)"
  $name = switch ($provider.Trim().ToLower()) {
    "resend" { "RESEND_API_KEY" }
    "brevo" { "BREVO_API_KEY" }
    default { throw "Type resend or brevo." }
  }
  $secure = Read-Host "Paste the $provider API key (hidden)" -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  if ($plain.Length -lt 10) { throw "That key looks too short." }
  Put-Secret $name $plain
  "Set $name. Now set config.json email.provider to `"$($provider.Trim().ToLower())`" and run: deploy.ps1 config"
}

function Show-Health {
  "== health"
  try {
    $h = Invoke-RestMethod -Uri "https://api.tizcat.com/v1/health" -TimeoutSec 20
    $h.parts.PSObject.Properties | ForEach-Object { "{0,-8} {1,-6} {2}" -f $_.Name, $_.Value.ok, $_.Value.version }
    "all ok: $($h.ok)"
  } catch {
    "health check failed: $($_.Exception.Message)"
  }
}

switch ($Part) {
  "all" {
    foreach ($p in @("rewards", "wallet", "sync", "account", "ads", "api", "web")) { Deploy-Part $p }
    Push-Config
    Show-Health
  }
  "config" { Push-Config }
  "secrets" { Set-Secrets }
  "mail-key" { Set-MailKey }
  "health" { Show-Health }
  default { Deploy-Part $Part }
}

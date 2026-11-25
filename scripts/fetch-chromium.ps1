# Download Chromium at the version in CHROMIUM_VERSION, without its git
# history (about 30 GB instead of over 100), then its tools and dependencies.
# Safe to run again: gclient picks up where it stopped.
#
#   powershell -ExecutionPolicy Bypass -File scripts\fetch-chromium.ps1
# Native tools write progress and warnings to stderr; success is judged by
# their exit codes, not by PowerShell's error stream.
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "env.ps1")

Set-Location $JibWork
# depot_tools fetches its own Python and tools the first time it runs.
gclient --version 2>&1 | Out-Host

# The checkout is pinned to a release tag, not to Chromium's moving main branch.
# checkout_pgo_profiles brings Chrome's speed profile for that version, which
# build\args.gn uses (chrome_pgo_phase = 2).
$gclient = @"
solutions = [
  {
    "name": "src",
    "url": "https://chromium.googlesource.com/chromium/src.git@refs/tags/$JibChromium",
    "managed": False,
    "custom_deps": {},
    "custom_vars": {"checkout_pgo_profiles": True},
  },
]
target_os = ["win"]
"@
Set-Content -Path (Join-Path $JibWork ".gclient") -Value $gclient -Encoding ascii

# Hundreds of repositories come down one by one, and a Wi-Fi drop of a few
# seconds fails the whole sync ("Could not resolve host", seen 2026-10-29
# half an hour in). What is already down stays, so trying again resumes.
$ok = $false
for ($try = 1; $try -le 6 -and -not $ok; $try++) {
  if ($try -gt 1) { "sync stopped; trying again ($try of 6) in 30 seconds"; Start-Sleep -Seconds 30 }
  gclient sync --nohooks --no-history --shallow -D --force
  $ok = ($LASTEXITCODE -eq 0)
}
if (-not $ok) { throw "gclient sync failed after 6 tries" }
# Half-made folders a failed try left behind, which gclient set aside.
Remove-Item (Join-Path $JibWork "_bad_scm") -Recurse -Force -ErrorAction SilentlyContinue
gclient runhooks
if ($LASTEXITCODE -ne 0) { throw "gclient runhooks failed ($LASTEXITCODE)" }
"Chromium $JibChromium is in $JibSrc"

# Build only the given GN targets (comma-separated labels without the
# leading //), to catch mistakes before a full build. Uses TizCat's build
# environment. Does not touch chrome.exe or chrome.dll unless asked to.
param([string]$Targets, [int]$Jobs = 4)
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "..\env.ps1")
Set-Location $JibSrc
Copy-Item (Join-Path $JibRoot "build\args.gn") (Join-Path $JibOut "args.gn") -Force
gn gen $JibOut 2>&1 | Select-Object -Last 3 | Out-Host
if ($LASTEXITCODE -ne 0) { "gn gen failed ($LASTEXITCODE)"; exit 1 }
$list = @($Targets.Split(",") | ForEach-Object { $_.Trim() })
autoninja -C $JibOut @list -j $Jobs 2>&1 | Out-Host
"exit $LASTEXITCODE"

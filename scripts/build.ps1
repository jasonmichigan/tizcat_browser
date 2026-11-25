# Compile Jib. The first build takes a few hours on this laptop; after that
# only what changed is rebuilt.
#
#   powershell -ExecutionPolicy Bypass -File scripts\build.ps1 [target] [-Jobs N]
# The default target, chrome, is the browser itself (out\Release\chrome.exe).
# -Jobs caps how many compilers run at once. Each can take 1 to 2 GB of
# memory: on 2026-10-29 the default (28 on this laptop) ran it out of memory
# with a browser and two editors open, and the build was stopped. With about
# 10 GB free, 8 is safe.
param([string]$Target = "chrome", [int]$Jobs = 0)
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "env.ps1")

if (-not (Test-Path $JibSrc)) { throw "No Chromium source in $JibSrc yet: run scripts\fetch-chromium.ps1 first." }
$atl = if ($JibVs) { Get-ChildItem "$JibVs\VC\Tools\MSVC\*\atlmfc\include\atlbase.h" -ErrorAction SilentlyContinue }
$sdk = Test-Path "${env:ProgramFiles(x86)}\Windows Kits\10\Include\10.0.28000.0\um"
if (-not $atl -or -not $sdk) { throw "Visual Studio 2026 with ATL, or the Windows SDK 10.0.28000, is missing: run scripts\install-build-tools.ps1 first." }

Set-Location $JibSrc
New-Item -ItemType Directory -Force -Path $JibOut | Out-Null
Copy-Item (Join-Path $JibRoot "build\args.gn") (Join-Path $JibOut "args.gn") -Force
gn gen $JibOut 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { throw "gn gen failed ($LASTEXITCODE)" }
$jobArgs = if ($Jobs -gt 0) { @("-j", "$Jobs") } else { @() }
autoninja -C $JibOut $Target @jobArgs 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { throw "build failed ($LASTEXITCODE)" }

# With patch 0002 in, this Jib loads Yuzal itself, from out\Release\yuzal
# (run.ps1 copies her there on every start). The marker tells run.ps1 which
# kind of Jib it is starting: one built before the patch still needs her
# loaded with --load-extension.
$marker = Join-Path $JibOut "yuzal-built-in"
$loader = Join-Path $JibSrc "chrome\browser\extensions\component_loader.cc"
if (Select-String -Path $loader -Pattern "AddJibYuzal" -Quiet) {
  Set-Content -Path $marker -Value "Built with patch 0002: Yuzal is part of this Jib."
  # Until 2026-11-23 Yuzal was called Lovona: her old marker and folder go.
  Remove-Item (Join-Path $JibOut "lovona-built-in") -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $JibOut "lovona") -Recurse -Force -ErrorAction SilentlyContinue
} else {
  Remove-Item $marker -ErrorAction SilentlyContinue
}
"Built: $(Join-Path $JibOut 'chrome.exe')"

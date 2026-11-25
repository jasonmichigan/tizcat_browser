# Compile only the given source files (siso's "file.cc^" targets), to catch
# mistakes before a full build. Uses TizCat's build environment.
param([string]$Files, [int]$Jobs = 4)   # comma-separated, from the source root
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "..\env.ps1")
Set-Location $JibSrc
Copy-Item (Join-Path $JibRoot "build\args.gn") (Join-Path $JibOut "args.gn") -Force
gn gen $JibOut 2>&1 | Select-Object -Last 3 | Out-Host
if ($LASTEXITCODE -ne 0) { "gn gen failed ($LASTEXITCODE)"; exit 1 }
# autoninja is a .bat file, and cmd.exe eats a single ^ as its escape mark.
$targets = @($Files.Split(",") | ForEach-Object { "../../" + $_.Trim() + "^^" })
autoninja -C $JibOut @targets -j $Jobs 2>&1 | Out-Host
"exit $LASTEXITCODE"

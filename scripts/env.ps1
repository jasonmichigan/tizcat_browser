# Jib build environment. Dot-source it first:  . .\scripts\env.ps1
#
# Jib's own files live here, in the project folder. Chromium's source and the
# build live in $JibWork (C:\tizcat by default), OUTSIDE Google Drive: the source
# alone is tens of gigabytes in hundreds of thousands of files, which Drive
# must never try to sync.

$JibRoot = Split-Path -Parent $PSScriptRoot
$JibWork = if ($env:JIB_WORK) { $env:JIB_WORK } else { "C:\tizcat" }
$JibSrc  = Join-Path $JibWork "src"
$JibOut  = Join-Path $JibSrc "out\Release"
$JibChromium = (Get-Content (Join-Path $JibRoot "CHROMIUM_VERSION") -Raw).Trim()

# depot_tools first on the PATH, as Chromium's Windows instructions require.
$env:Path = (Join-Path $JibWork "depot_tools") + ";" + $env:Path
# Use the Visual Studio on this machine; the packaged toolchain is Google-internal.
# Chromium 157 requires Visual Studio 2026 (folder "18"); Chromium's own
# scripts pick it before 2022 when both are installed.
$env:DEPOT_TOOLS_WIN_TOOLCHAIN = "0"
$JibVs = Get-ChildItem "C:\Program Files\Microsoft Visual Studio\18\*\VC" -ErrorAction SilentlyContinue |
  Select-Object -First 1 | ForEach-Object { $_.Parent.FullName }
if ($JibVs) { $env:vs2026_install = $JibVs }

# Git settings Chromium asks for, given to every git started from here only,
# so the global git configuration is left alone.
$env:GIT_CONFIG_COUNT = "4"
$env:GIT_CONFIG_KEY_0 = "core.autocrlf";     $env:GIT_CONFIG_VALUE_0 = "false"
$env:GIT_CONFIG_KEY_1 = "core.filemode";     $env:GIT_CONFIG_VALUE_1 = "false"
$env:GIT_CONFIG_KEY_2 = "core.longpaths";    $env:GIT_CONFIG_VALUE_2 = "true"
$env:GIT_CONFIG_KEY_3 = "core.preloadindex"; $env:GIT_CONFIG_VALUE_3 = "true"

New-Item -ItemType Directory -Force -Path (Join-Path $JibWork "logs") | Out-Null

# Start TizCat (code name Jib), as build.ps1 made it, with TizCat's own
# profile (so it never shares one with Chrome, Chromium or Jeep) and with
# Yuzal, its assistant. The TizCat shortcut on the Desktop runs this.
#
#   powershell -ExecutionPolicy Bypass -File scripts\run.ps1 [url]
#
# Yuzal is the extension in tizcat\yuzal, loaded unpacked for now. Its brain is
# Jeep's Python backend (ai_browser\web_dashboard.py), unchanged: started here
# if it is not already running, without Jeep's own window, and shared with
# Jeep if both are open. --silent-debugger-extension-api hides the "Yuzal
# started debugging this browser" bar that Chromium shows while Yuzal reads
# or drives a page.
param([string]$Url = "")
. (Join-Path $PSScriptRoot "env.ps1")
# The TizCat you use is the installed copy named in current.txt
# (scripts\install.ps1), never the build folder, so a build can run, even
# for hours, while TizCat stays open. Before the first install, the build
# folder itself is used.
$app = Join-Path $env:LOCALAPPDATA "TizCat\Application"
$currentFile = Join-Path $app "current.txt"
$dir = $JibOut
if (Test-Path $currentFile) {
  $installed = Join-Path $app ((Get-Content $currentFile -Raw).Trim())
  if (Test-Path (Join-Path $installed "chrome.exe")) { $dir = $installed }
}
$exe = Join-Path $dir "chrome.exe"
if (-not (Test-Path $exe)) { throw "TizCat is not built yet: run scripts\build.ps1, then scripts\install.ps1." }

$aiBrowser = Split-Path $JibRoot -Parent
$healthy = $false
try { $healthy = [bool](Invoke-RestMethod -Uri "http://127.0.0.1:5050/api/health" -TimeoutSec 2).ok } catch { }
if (-not $healthy) {
  $env:JEEP_NO_BROWSER = "1"
  Start-Process -FilePath "python" -ArgumentList "web_dashboard.py" -WorkingDirectory $aiBrowser -WindowStyle Hidden
}

# Until 2026-11-16 the browser was called Jib and its profile was in
# %LOCALAPPDATA%\Jib; it was copied to TizCat's folder then, and the old
# copy kept.
$userData = Join-Path $env:LOCALAPPDATA "TizCat\User Data"
$yuzal = Join-Path $JibRoot "yuzal"
if (Test-Path (Join-Path $dir "yuzal-built-in")) {
  # Built with patch 0002: TizCat loads Yuzal from beside chrome.exe and hides
  # the debugging bar for her itself. Refresh that copy from tizcat\yuzal.
  robocopy $yuzal (Join-Path $dir "yuzal") /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  $argv = @("--user-data-dir=`"$userData`"")
} elseif (Test-Path (Join-Path $dir "lovona-built-in")) {
  # A TizCat built before 2026-11-23, when Yuzal was called Lovona: it loads
  # her from <exe dir>\lovona, so her current files go there (same ID, so
  # her settings carry over either way).
  robocopy $yuzal (Join-Path $dir "lovona") /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  $argv = @("--user-data-dir=`"$userData`"")
} else {
  $argv = @(
    "--user-data-dir=`"$userData`"",
    "--load-extension=`"$yuzal`"",
    "--silent-debugger-extension-api"
  )
}
# TizCat's modules (tizcat\modules: TizCat Services, JibWallet, later
# others) are built in from beside chrome.exe by patch 0007, one folder each.
# Refresh that copy on every start, so a module changes with a restart, no
# rebuild. A TizCat built before patch 0007 ignores the folder.
$modules = Join-Path $JibRoot "modules"
if (Test-Path $modules) {
  robocopy $modules (Join-Path $dir "modules") /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
}
if ($Url) { $argv += $Url }
Start-Process -FilePath $exe -ArgumentList $argv

# Install the TizCat that build.ps1 made (out\Release) as the copy you use,
# in a folder of its own:
#   %LOCALAPPDATA%\TizCat\Application\<Chromium version>-<date and time>
# Builds write only to out\Release, so they never touch the TizCat you are
# using: it stays open and usable even through a 12-hour build. The install
# before the newest is kept, to go back to.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1            # install out\Release
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Rollback  # back to the one before
#
# Run the tests on out\Release first; install only a build that passed.
# run.ps1 (the TizCat shortcut) starts the install named in current.txt; a
# TizCat already open keeps running from its own folder until restarted.
# Windows' links to TizCat (the tizcat: scheme, "Open with", the browser
# registration, Win+R "chrome") are pointed at the installed copy, with the
# old values exported to registry-before-<stamp> first.
param([switch]$Rollback)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "env.ps1")

$App = Join-Path $env:LOCALAPPDATA "TizCat\Application"
$CurrentFile = Join-Path $App "current.txt"
$PreviousFile = Join-Path $App "previous.txt"
$Stamp = Get-Date -Format "yyyyMMdd-HHmm"
New-Item -ItemType Directory -Force -Path $App | Out-Null

# Chromium's sandbox runs web pages in app containers that may read only the
# program files granted to two capabilities, "chromeInstallFiles" and
# "lpacChromeInstallFiles" (sandbox\policy\win\lpac_capability.h). Chrome's
# and Brave's installers grant them read and run on their folders; without
# them TizCat cannot start ("Sandbox cannot access executable ... Access is
# denied"). These are the SIDs Windows derives from those two names
# (DeriveCapabilitySidsFromName; the same in Brave's install folder).
# Inherited, so every install inside gets them.
foreach ($sid in @(
    "S-1-15-3-1024-3424233489-972189580-2057154623-747635277-1604371224-316187997-3786583170-1043257646",
    "S-1-15-3-1024-2302894289-466761758-1166120688-1039016420-2430351297-4240214049-4028510897-3317428798")) {
  icacls $App /grant "*${sid}:(OI)(CI)(RX)" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not let TizCat's sandbox read $App (icacls $LASTEXITCODE)." }
}

function Read-Name([string]$file) {
  if (Test-Path $file) { (Get-Content $file -Raw).Trim() } else { "" }
}

# Points every value under TizCat's own registry keys that names an older
# TizCat folder (out\Release or an earlier install) at $newDir.
function Set-Registration([string]$newDir) {
  $keys = @("Software\Classes\tizcat",
            "Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe")
  $clients = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Software\Clients\StartMenuInternet")
  if ($clients) {
    foreach ($name in $clients.GetSubKeyNames()) {
      if ($name -like "TizCat*") {
        $suffix = $name.Substring(6)  # ".<user ID>" after "TizCat"
        $keys += "Software\Clients\StartMenuInternet\$name"
        $keys += "Software\Classes\TizCatHTM$suffix"
        $keys += "Software\Classes\TizCatPDF$suffix"
      }
    }
    $clients.Close()
  }
  $oldDirs = @($JibOut) + @(Get-ChildItem $App -Directory | Where-Object { $_.FullName -ne $newDir } |
    ForEach-Object { $_.FullName })
  $backup = Join-Path $App "registry-before-$Stamp"
  New-Item -ItemType Directory -Force -Path $backup | Out-Null
  $changed = 0
  $i = 0
  foreach ($sub in $keys) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($sub, $true)
    if (-not $key) { continue }
    $i++
    & reg.exe export "HKCU\$sub" (Join-Path $backup "$i.reg") /y | Out-Null
    $changed += Update-Key $key $oldDirs $newDir
    $key.Close()
  }
  "Windows links to TizCat updated: $changed value(s); old values in $backup"
}

function Update-Key($key, $oldDirs, [string]$newDir) {
  $n = 0
  foreach ($name in $key.GetValueNames()) {
    $kind = $key.GetValueKind($name)
    if ($kind -ne "String" -and $kind -ne "ExpandString") { continue }
    $value = $key.GetValue($name, $null, "DoNotExpandEnvironmentNames")
    $new = $value
    foreach ($old in $oldDirs) {
      $new = [regex]::Replace($new, [regex]::Escape($old), $newDir.Replace('$', '$$'),
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    }
    if ($new -ne $value) { $key.SetValue($name, $new, $kind); $n++ }
  }
  foreach ($subName in $key.GetSubKeyNames()) {
    $child = $key.OpenSubKey($subName, $true)
    $n += Update-Key $child $oldDirs $newDir
    $child.Close()
  }
  return $n
}

if ($Rollback) {
  $previous = Read-Name $PreviousFile
  if (-not $previous -or -not (Test-Path (Join-Path $App "$previous\chrome.exe"))) {
    throw "There is no earlier install to go back to."
  }
  $current = Read-Name $CurrentFile
  Set-Content $CurrentFile $previous
  Set-Content $PreviousFile $current
  Set-Registration (Join-Path $App $previous)
  "TizCat goes back to $previous from its next start ($current is kept)."
  return
}

if (Get-Process siso -ErrorAction SilentlyContinue) {
  throw "A build is running: out\Release is not finished. Install after it ends and its tests pass."
}

# What a TizCat needs to run: Chromium's own list
# (chrome\installer\mini_installer\chrome.release), laid out flat as in
# out\Release, plus TizCat's built-in extensions and modules.
$required = @("chrome.exe", "chrome.dll", "chrome_elf.dll", "resources.pak",
  "chrome_100_percent.pak", "icudtl.dat", "v8_context_snapshot.bin", "locales")
$optional = @("chrome_proxy.exe", "*.*.*.*.manifest", "chrome_child.dll", "chrome_renderer.dll",
  "chrome_wer.dll", "chrome_pwa_launcher.exe", "d3dcompiler_47.dll", "eventlog_provider.dll",
  "libEGL.dll", "libGLESv2.dll", "libLiteRtWebGpuAccelerator.dll", "notification_helper.exe",
  "optimization_guide_internal.dll", "vk_swiftshader.dll", "vk_swiftshader_icd.json",
  "vulkan-1.dll", "chrome_200_percent.pak", "ffmpeg.dll", "snapshot_blob.bin",
  "dxcompiler.dll", "dxil.dll", "Extensions", "MEIPreload", "IwaKeyDistribution",
  "yuzal-built-in")
foreach ($f in $required) {
  if (-not (Test-Path (Join-Path $JibOut $f))) { throw "out\Release has no ${f}: build TizCat first." }
}

$name = "$JibChromium-$Stamp"
$dir = Join-Path $App $name
if (Test-Path $dir) { throw "$dir already exists." }
New-Item -ItemType Directory -Path $dir | Out-Null
foreach ($pattern in $required + $optional) {
  foreach ($item in @(Get-Item (Join-Path $JibOut $pattern) -ErrorAction SilentlyContinue)) {
    Copy-Item $item.FullName -Destination $dir -Recurse -Force
  }
}
# Yuzal and the modules fresh from tizcat\ (run.ps1 refreshes them on every start too).
foreach ($part in @("yuzal", "modules")) {
  $from = Join-Path $JibRoot $part
  if (Test-Path $from) {
    robocopy $from (Join-Path $dir $part) /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Copying $part failed (robocopy $LASTEXITCODE)." }
  }
}
$global:LASTEXITCODE = 0

# Which saved version of TizCat's files this install was built from, so any
# installed TizCat can be traced back (and rebuilt): source.txt in the
# install, and a git tag "installed-<name>" uploaded to GitHub. A build made
# with unsaved changes is marked so, and gets no tag.
$ErrorActionPreference = "Continue"
$commit = git -C $JibRoot rev-parse --short HEAD 2>$null
$unsaved = git -C $JibRoot status --porcelain --untracked-files=no 2>$null
$source = "TizCat files: $commit" + $(if ($unsaved) { " plus unsaved changes" } else { "" })
Set-Content (Join-Path $dir "source.txt") "$source`r`nChromium: $JibChromium`r`nInstalled: $Stamp"
if ($commit -and -not $unsaved) {
  # Annotated, so a later push carries it if this upload fails (push.followTags).
  git -C $JibRoot tag -a "installed-$name" -m "Installed as $name ($JibChromium)" 2>$null
  git -C $JibRoot push -q origin "installed-$name" 2>$null
  if ($LASTEXITCODE -eq 0) { "Tagged installed-$name on GitHub." } else { "Tagged installed-$name here; uploading the tag failed (next push carries it)." }
}
$global:LASTEXITCODE = 0
$ErrorActionPreference = "Stop"

$current = Read-Name $CurrentFile
if ($current) { Set-Content $PreviousFile $current }
Set-Content $CurrentFile $name
Set-Registration $dir

# Keep the new install and the one before it; remove older ones not in use.
$keep = @($name, $current)
foreach ($old in Get-ChildItem $App -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+-\d{8}-\d{4}$' }) {
  if ($keep -notcontains $old.Name) {
    try { Remove-Item $old.FullName -Recurse -Force; "Removed old install $($old.Name)." }
    catch { "Kept $($old.Name): still in use." }
  }
}
$size = [math]::Round(((Get-ChildItem $dir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB))
"Installed $name ($size MB). TizCat uses it from its next start."

# Install the toolchain Chromium 157 requires (docs\windows_build_instructions.md
# in its source): Visual Studio 2026 (18.x) with "Desktop development with
# C++" and ATL/MFC, and the Windows 11 SDK 10.0.28000 with its debugging tools.
# Measured 2026-10-29: this laptop had VS 2022 and SDK 10.0.26100, and gn
# stopped at 'include\10.0.28000.0\um ... does not exist'.
#
# Installing needs administrator rights: it asks Windows once, then installs
# both from winget (Windows' package manager). Visual Studio 2026 goes next
# to 2022, which keeps working. Log: C:\tizcat\logs\tools.log
#   powershell -ExecutionPolicy Bypass -File scripts\install-build-tools.ps1
$log = "C:\tizcat\logs\tools.log"
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
  $p = Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -PassThru -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
  "Elevated install finished with code $($p.ExitCode); see $log"
  Get-Content $log -Tail 15
  exit $p.ExitCode
}

Start-Transcript -Path $log -Append | Out-Null
$common = @("--source", "winget", "--exact", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity")

"== Windows SDK 10.0.28000, every feature (headers, libraries, debugging tools)"
winget install --id Microsoft.WindowsSDK.10.0.28000 @common --override "/features + /quiet /norestart"
"winget exit $LASTEXITCODE"

"== Visual Studio Community 2026 with C++ and ATL/MFC"
winget install --id Microsoft.VisualStudio.Community @common --override ("--add Microsoft.VisualStudio.Workload.NativeDesktop " +
  "--add Microsoft.VisualStudio.Component.VC.ATLMFC --includeRecommended --passive --norestart --wait")
"winget exit $LASTEXITCODE"

"== What is installed now"
Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\Include" | ForEach-Object { "SDK " + $_.Name }
"debuggers: " + (Test-Path "${env:ProgramFiles(x86)}\Windows Kits\10\Debuggers\x64\cdb.exe")
Get-ChildItem "$env:ProgramFiles\Microsoft Visual Studio\18\*\VC\Tools\MSVC\*\atlmfc\include\atlbase.h" -ErrorAction SilentlyContinue | ForEach-Object { "ATL " + $_.FullName }
Stop-Transcript | Out-Null

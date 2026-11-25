# Building Jib

## This laptop, measured 2026-10-29

- Windows 11 Enterprise, an i7-14700HX (20 cores, 28 threads), 32 GB of RAM,
  365 GB free on C:. Chromium asks for at least 100 GB and 16 GB of RAM.
- Found: Visual Studio Community 2022 (17.14) and the Windows SDK 10.0.26100.
- Required by Chromium 157 (its `docs\windows_build_instructions.md`):
  - Visual Studio 2026 (18.x), with "Desktop development with C++" and
    ATL/MFC;
  - the Windows SDK 10.0.28000.2270 or newer, with "Debugging Tools for
    Windows".
- Until both were in place, `gn gen` stopped at
  `include\10.0.28000.0\um ... does not exist`.
- `scripts\install-build-tools.ps1` installs both from winget. Visual Studio
  2026 sits next to 2022.
- Your account is in the Administrators group but does not run elevated, so
  Windows asks for approval once.
- Long paths are enabled in Windows, which Chromium's deep folders need.

## Why the source is in C:\tizcat and not here

This folder is synced by Google Drive. The checkout is tens of gigabytes in
hundreds of thousands of files, and the build adds more. Drive would spend
days on it and slow every build down. So Jib's own files are kept here and
synced, and `C:\tizcat` is a working copy anyone can recreate with
`scripts\fetch-chromium.ps1`.

## Nothing global is changed

- `scripts\env.ps1` puts depot_tools first on the PATH, selects the local
  Visual Studio (`DEPOT_TOOLS_WIN_TOOLCHAIN=0`), and passes Chromium's
  recommended git settings to the git it starts (`GIT_CONFIG_*`). All of
  this applies only to that PowerShell window.
- depot_tools still prints "depot_tools recommends setting the following
  for optimal Chromium development: git config --global ...". This is only a
  suggestion, and those settings are already in effect for Jib's git through
  env.ps1.

## Moving Jib to a newer Chromium

TizCat stays open and usable throughout: builds write only to
`out\Release`, and the TizCat in use is the installed copy.

1. Put the new version in `CHROMIUM_VERSION`. Take it from
   <https://chromiumdash.appspot.com/releases?platform=Windows>, Stable.
2. Run `scripts\fetch-chromium.ps1`, then `scripts\apply-jib.ps1`. A patch
   that no longer applies is reported by name. Fix it and save it again.
   (fetch-chromium runs `gclient runhooks`, which also downloads the speed
   profiles for Chrome and for V8's built-in functions.)
3. Run `scripts\build.ps1` in its own window:
   `Start-Process powershell -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-File',<path to build.ps1>,'-Jobs','6'`.
4. Run the tests (`docs\DEVELOPMENT.md`), then `scripts\install.ps1`.

## Installing a build

`scripts\install.ps1` copies the files a TizCat needs to run (Chromium's own
list, `chrome\installer\mini_installer\chrome.release`, plus Yuzal and the
modules) from `out\Release` into
`%LOCALAPPDATA%\TizCat\Application\<version>-<date>`, names it in
`current.txt`, and points Windows' links to TizCat (the `tizcat:` scheme,
"Open with", the browser registration, Win+R "chrome") at it, exporting the
old values first. It keeps the previous install (`previous.txt`);
`install.ps1 -Rollback` goes back to it. It refuses while a build runs.

It also lets Chromium's sandbox read the folder: web pages run in app
containers that may read only program files granted to the capabilities
`chromeInstallFiles` and `lpacChromeInstallFiles`, as Chrome's and Brave's
installers grant them. Without that, TizCat closes at once ("Sandbox cannot
access executable ... Access is denied"). The build folder works without it
because Chromium's build grants it on `out\Release`.

## Seeing how far a build is

From another PowerShell window, after `. .\scripts\env.ps1`:
`siso ps -C C:\tizcat\src\out\Release`. It prints `[done/total]` and the
steps running now. A full build of the browser is 73,000 to 85,000 steps
(73,143 on 2026-11-20, after the developer checks were switched off); a
fix in one file is a handful.

## When a build stops at once

- **"x64-rl.profile ... missing and no known rule to make it"** (seen
  2026-11-20, when the developer checks were switched off): with them off,
  V8 optimizes its built-in functions with Google's profile, which
  `gclient runhooks` downloads when `checkout_pgo_profiles` is set. A
  checkout made before that setting lacks it: run, from `C:\tizcat`, after
  `. scripts\env.ps1`:
  `python3 src\v8\tools\builtins-pgo\download_profiles.py download --depot-tools C:\tizcat\depot_tools --check-v8-revision`.

## When something goes wrong

- **gn complains about Visual Studio or the SDK:**
  - Check that `C:\Program Files\Microsoft Visual Studio\18` exists. env.ps1
    points `vs2026_install` at it.
  - Check that the SDK has "Debugging Tools for Windows".
  - A newer Chromium may ask for a newer SDK. Its `build\vs_toolchain.py`
    says which one (`SDK_VERSION`).
- **The build runs out of memory while linking:** run
  `autoninja -C out\Release chrome -j 16` by hand to use fewer parallel jobs.
- **Windows Defender slows the build down:** an administrator can exclude
  `C:\tizcat` from real-time scanning. This can halve the build time.

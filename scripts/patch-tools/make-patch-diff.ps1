# Write tizcat\patches\<Name>.patch as a diff of the given files (from the
# source root) against their copies in patch-tools\<Base>, saved before the
# change (so after the earlier patches). A file with no saved copy is new.
# Without -Files, the files are the ones the patch already has, so updating
# a patch cannot leave one out:
#   make-patch-diff.ps1 -Name 0006-jib-profile-page -Base base6
#   make-patch-diff.ps1 -Name 0007-jib-built-in-modules -Base base7
# Give -Files (comma-separated, from the source root) to add a file.
param([string]$Name, [string]$Base, [string]$Files)
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "..\env.ps1")
if (-not $Files) {
  $existing = Join-Path $JibRoot "patches\$Name.patch"
  if (-not (Test-Path $existing)) { throw "No -Files given, and no $existing to take them from." }
  $Files = (Select-String -Path $existing -Pattern '^diff --git [ab]/(\S+) ' |
    ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -Unique) -join ","
}
$list = @($Files.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$work = Join-Path $env:TEMP "tizcat-patch-$Name"
if (Test-Path $work) { Remove-Item -Recurse -Force $work }
New-Item -ItemType Directory -Force (Join-Path $work "a"), (Join-Path $work "b") | Out-Null
foreach ($f in $list) {
  $old = Join-Path $PSScriptRoot "$Base\$f"
  if (Test-Path $old) {
    $to = Join-Path $work "a\$f"
    New-Item -ItemType Directory -Force (Split-Path $to) | Out-Null
    Copy-Item $old $to
  }
  $to = Join-Path $work "b\$f"
  New-Item -ItemType Directory -Force (Split-Path $to) | Out-Null
  Copy-Item (Join-Path $JibSrc $f) $to
}
Set-Location $work
$diff = git diff --no-index --no-prefix --no-color a b
$out = Join-Path $JibRoot "patches\$Name.patch"
[IO.File]::WriteAllText($out, (($diff -join "`n") + "`n"))
"wrote $out"
git diff --no-index --stat a b
Set-Location $PSScriptRoot
Remove-Item -Recurse -Force $work

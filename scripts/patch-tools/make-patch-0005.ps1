# Save the importer changes in C:\tizcat\src as patches\0005 (git diff, with
# the two new files included), using TizCat's git settings from env.ps1.
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "..\env.ps1")
Set-Location $JibSrc
$new = @("chrome/utility/importer/chromium_importer_win.h", "chrome/utility/importer/chromium_importer_win.cc")
$changed = @(
  "components/user_data_importer/common/importer_type.h",
  "chrome/common/importer/profile_import_process_param_traits_macros.h",
  "chrome/browser/importer/importer_list.cc",
  "chrome/browser/importer/importer_uma.cc",
  "chrome/utility/BUILD.gn",
  "chrome/utility/importer/importer_creator.cc"
)
git add -N -- @new
$out = Join-Path $JibRoot "patches\0005-jib-import-from-chromium-browsers.patch"
$diff = git diff --no-color -- @changed @new
[IO.File]::WriteAllText($out, (($diff -join "`n") + "`n"))
"wrote $out"
git diff --stat -- @changed @new

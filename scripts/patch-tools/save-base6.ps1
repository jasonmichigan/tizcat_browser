# Keep copies of the files patch 0006 changes, as they are before it (after
# patches 0001 to 0005), so 0006 can be written as a diff against them.
$src = "C:\tizcat\src"
$base = Join-Path $PSScriptRoot "base6"
$files = @(
  "chrome/app/settings_strings.grdp",
  "chrome/browser/ui/webui/settings/settings_localized_strings_provider.cc",
  "chrome/browser/resources/settings/route.ts",
  "chrome/browser/resources/settings/settings_menu/settings_menu.html",
  "chrome/browser/resources/settings/settings_main/settings_main.html",
  "chrome/browser/resources/settings/people_page/people_page.html.ts",
  "chrome/browser/resources/settings/people_page/people_page.ts",
  "chrome/browser/resources/settings/people_page/people_page.css",
  "chrome/browser/resources/settings/default_browser_page/default_browser_page.html.ts",
  "chrome/browser/resources/settings/on_startup_page/on_startup_page.html.ts",
  "chrome/browser/importer/importer_list.cc",
  "chrome/browser/resources/settings/BUILD.gn",
  "chrome/browser/resources/settings/router.ts",
  "chrome/browser/resources/settings/page_visibility.ts",
  "chrome/browser/resources/settings/settings_main/settings_main.ts"
)
# Patch 0007 (built-in modules) changes files that 0002 also changes.
$files7 = @(
  "chrome/browser/extensions/component_loader.h",
  "chrome/browser/extensions/component_loader.cc"
)
foreach ($f in $files7) {
  $to = Join-Path (Join-Path $PSScriptRoot "base7") $f
  if (Test-Path $to) { "kept $f (already saved, base7)"; continue }
  New-Item -ItemType Directory -Force (Split-Path $to) | Out-Null
  Copy-Item (Join-Path $src $f) $to
  "saved $f (base7)"
}
foreach ($f in $files) {
  $to = Join-Path $base $f
  if (Test-Path $to) { "kept $f (already saved)"; continue }
  New-Item -ItemType Directory -Force (Split-Path $to) | Out-Null
  Copy-Item (Join-Path $src $f) $to
  "saved $f"
}

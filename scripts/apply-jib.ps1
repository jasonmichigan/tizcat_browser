# Put TizCat (code name Jib) into the Chromium source: its name and icons
# over Chromium's, and every patch in patches\. Safe to run again: files are
# copied over, the strings are renamed afresh from Chromium's, and a patch
# that is already in is skipped.
#
#   powershell -ExecutionPolicy Bypass -File scripts\apply-jib.ps1
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "env.ps1")
if (-not (Test-Path $JibSrc)) { throw "No Chromium source in $JibSrc yet: run scripts\fetch-chromium.ps1 first." }

$brand = Join-Path $JibRoot "branding"
$icons = Join-Path $brand "icons"
$theme = Join-Path $JibSrc "chrome\app\theme"

# The name: Chromium's own branding file, read by the build for the window
# title, the executable's details and the installer.
Copy-Item (Join-Path $brand "BRANDING") (Join-Path $theme "chromium\BRANDING") -Force

# The icons, at every size Chromium keeps them.
$copies = @(
  @("product_logo_16.png",  "chromium\product_logo_16.png"),
  @("product_logo_24.png",  "chromium\product_logo_24.png"),
  @("product_logo_48.png",  "chromium\product_logo_48.png"),
  @("product_logo_64.png",  "chromium\product_logo_64.png"),
  @("product_logo_128.png", "chromium\product_logo_128.png"),
  @("product_logo_256.png", "chromium\product_logo_256.png"),
  @("product_logo.svg",     "chromium\product_logo.svg"),
  # Chromium's first-run pages show an animated logo; TizCat's is still.
  @("product_logo.svg",     "chromium\product_logo_animation.svg"),
  @("tizcat.ico",           "chromium\win\chromium.ico"),
  @("Logo.png",             "chromium\win\tiles\Logo.png"),
  @("SmallLogo.png",        "chromium\win\tiles\SmallLogo.png"),
  @("product_logo_16.png",  "default_100_percent\chromium\product_logo_16.png"),
  @("product_logo_32.png",  "default_100_percent\chromium\product_logo_32.png"),
  @("product_logo_32.png",  "default_200_percent\chromium\product_logo_16.png"),
  @("product_logo_64.png",  "default_200_percent\chromium\product_logo_32.png"),
  # The New Tab page's tab icon (a gray Chromium logo in Chromium).
  @("favicon_ntp_16.png",   "default_100_percent\common\favicon_ntp.png"),
  @("favicon_ntp_32.png",   "default_200_percent\common\favicon_ntp.png")
)
foreach ($c in $copies) {
  $to = Join-Path $theme $c[1]
  if (Test-Path $to) { Copy-Item (Join-Path $icons $c[0]) $to -Force; "icon  $($c[1])" }
  else { "MISSING in this Chromium: $($c[1])" }
}

# The logo at the top of Settings, History, Downloads and Extensions. In a
# dark theme those pages show this white Chrome-shaped logo instead of the
# product's own, so it becomes TizCat's too.
$darkLogo = Join-Path $JibSrc "ui\webui\resources\images\chrome_logo_dark.svg"
if (Test-Path $darkLogo) { Copy-Item (Join-Path $icons "product_logo.svg") $darkLogo -Force; "icon  ui\webui\resources\images\chrome_logo_dark.svg" }
else { "MISSING in this Chromium: ui\webui\resources\images\chrome_logo_dark.svg" }

# The one-color logo Chromium draws in the text color (black, or white in a
# dark theme): beside "TizCat" in the address bar on TizCat's own pages, on
# those pages in the address bar's suggestions, and on "About TizCat" in
# Settings. It is a Chrome-shaped drawing in Chromium; TizCat's is the traced
# cheetah from logo_black1.png (make_icons.py).
foreach ($name in "chrome_product.icon", "product_chrome_refresh_old.icon") {
  $to = Join-Path $JibSrc "components\omnibox\browser\vector_icons\$name"
  if (Test-Path $to) { Copy-Item (Join-Path $icons "product_mono.icon") $to -Force; "icon  components\omnibox\browser\vector_icons\$name" }
  else { "MISSING in this Chromium: components\omnibox\browser\vector_icons\$name" }
}
# In the pages it is the icon "cr:chrome-product", defined twice (for rounded
# and for older icons), both in 24-unit icon sets like the traced path.
$crIcons = Join-Path $JibSrc "ui\webui\resources\cr_elements\icons.html.ts"
$monoPath = [regex]::Match((Get-Content (Join-Path $icons "product_mono.svg") -Raw), ' d="([^"]+)"').Groups[1].Value
$text = [IO.File]::ReadAllText($crIcons)
$found = [regex]::Matches($text, '(?s)<g id="chrome-product"[^>]*>.*?</g>').Count
if ($found -ne 2 -or -not $monoPath) { "MISSING in this Chromium: the 2 chrome-product icons in ui\webui\resources\cr_elements\icons.html.ts (found $found)" }
else {
  $text = [regex]::Replace($text, '(?s)<g id="chrome-product"[^>]*>.*?</g>',
    "<g id=`"chrome-product`"><path fill-rule=`"evenodd`" d=`"$monoPath`"></path></g>")
  [IO.File]::WriteAllText($crIcons, $text)
  "icon  ui\webui\resources\cr_elements\icons.html.ts (cr:chrome-product)"
}

# The words: "Chromium" in the strings the user reads becomes the name in
# BRANDING (TizCat). The script first restores those files from git, so a new
# name replaces the old one.
python (Join-Path $brand "rename_strings.py") $JibSrc
if ($LASTEXITCODE -ne 0) { throw "renaming the strings failed" }

# Jib's changes to Chromium's own code.
Set-Location $JibSrc
foreach ($p in Get-ChildItem (Join-Path $JibRoot "patches") -Filter *.patch | Sort-Object Name) {
  git apply --check --reverse $p.FullName 2>$null
  if ($LASTEXITCODE -eq 0) { "patch $($p.Name): already in"; continue }
  git apply --whitespace=nowarn $p.FullName
  if ($LASTEXITCODE -ne 0) { throw "patch $($p.Name) does not apply to Chromium $JibChromium" }
  "patch $($p.Name): applied"
}
"TizCat is in $JibSrc"

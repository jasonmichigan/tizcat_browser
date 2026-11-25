# TizCat

TizCat is Jeep rebuilt on Chromium itself instead of Electron. It is a
Chromium fork, organized the way Brave is: this folder holds only what makes
TizCat TizCat (its branding, its patches to Chromium, its own code, and the
scripts), and Chromium's own source is downloaded next to it and built with
these applied.

**The name.** The name TizCat comes from the Persian word tiz, meaning sharp
and quick, and from the cheetah, the fastest animal on land. Like its
namesake, TizCat is quick, alert, and ready to move. Whether you're
researching, working, or just exploring, TizCat helps you move through the
web with speed and focus. (The same words are on its About page.)

**Jib** was its first name (2026-10-29 to 2026-11-16). Its folders were
renamed on 2026-11-16 too (`ai_browser\jib` to `ai_browser\tizcat`, `C:\jib`
to `C:\tizcat`). Jib is still the code name inside: the scripts' variables,
`apply-jib.ps1`, `jib-smoke.js` and the `Jib:` marks on its changes to
Chromium's code. What a person sees says TizCat.

**The logos** are in `visuals\`: `logo_d2.png`, the folded-gold cheetah, is
the browser's icon; `logo_ai2.png`, half cheetah and half network, is
Yuzal's, the AI assistant's; `logo_grey1.png`, the gray outline cheetah, is
the New Tab page's tab icon; `logo_black1.png`, the same cheetah in black, is
the one-color logo drawn in the text color (black, or white in a dark theme)
beside "TizCat" in the address bar on TizCat's own pages, in the address
bar's suggestions and on "About TizCat" in Settings, where Chromium draws a
one-color Chrome logo. `branding\make_icons.py` makes every icon size from
them, and traces the black one into a drawing (`product_mono.icon`,
`product_mono.svg`), since that logo is drawn, not pictured. (They replaced
`logo_d.png` and `logo_2.png` on 2026-11-16; to change a logo, name the new
file in `make_icons.py`, run it, then apply and build.)

**Settings, Profile** (the first item, where Chrome has "You and Google"):
laid out as Brave's "Get started": one card with "Profile name and icon",
"Import bookmarks and settings", the default browser and the On startup
choices (patch `0006`). Default browser and On startup are no longer items of their
own in the menu; their old addresses open Profile. Chrome's Google sign-in
and sync rows are gone, since TizCat has no Google API keys and sync can't
work without them; "Google services" (two Google search toggles) is still at
`chrome://settings/googleServices`. The card's first row is the TizCat
account ("Get started" opens account.tizcat.com through
`tizcat.com/go/account`), and the menu has a JibWallet page, a placeholder
until JibWallet is built (where Brave has "Web3").

**Import** (Settings, "Import bookmarks and settings"): besides Chromium's
own sources (Firefox, Internet Explorer, a bookmarks HTML file), TizCat
lists every Chromium-based browser installed for this Windows user, one
entry per profile, named as Brave names them ("Google Chrome Work",
"Microsoft Edge Profile 1", "Opera"): Google Chrome, Microsoft Edge, Brave,
Opera, Opera GX, Vivaldi, Perplexity Comet, Yandex and Chromium. They come
first in the list, so Chrome is the one chosen when the dialog opens (Brave
puts Internet Explorer first). It brings over bookmarks,
history, saved passwords, search engines the person added, and autofill
entries (patch `0005`). Passwords that Google Chrome or Edge lock to
themselves (their newer "app-bound" encryption, marked `v20`) can't be read
by another program; for those, export them from that browser's password
manager as a file and import the file in TizCat's.

Why the move (2026-10-29): Google refuses sign-in from browsers built on an
embedded framework like Electron ("This browser or app may not be secure").
Browsers built from the Chromium source as complete browsers (Brave, Vivaldi,
Opera, Edge) are not affected. Being Chromium also brings, for free, what Jeep
had to imitate piece by piece: extensions, the Web Store, video full screen,
tab dragging between windows, the password manager, printing, PDF.

The previous browser is archived in `..\jeep_archive\` (see its README).

## Where things are

| What | Where | Size |
|---|---|---|
| TizCat's own files (this folder, synced) | `ai_browser\tizcat` | small |
| Chromium source, tools, build output (NOT synced) | `C:\tizcat` | about 100 GB |
| Chromium version TizCat is based on | `CHROMIUM_VERSION` | 157.0.8103.27, Chrome stable on 2026-10-29 |
| Its profile (bookmarks, sign-ins, settings) | `%LOCALAPPDATA%\TizCat\User Data` | |
| The installed TizCat that the shortcut starts (newest and previous) | `%LOCALAPPDATA%\TizCat\Application` | about 640 MB each |
| Version history of this folder (outside Google Drive) | `C:\tizcat-git`, and the private GitHub repository | |

Inside `C:\tizcat`: `depot_tools\` (Google's download and build tools), `src\`
(Chromium), `src\out\Release\` (the built browser), `logs\`.

## Building, step by step

Run from this folder in PowerShell. Every step is safe to run again.

1. `scripts\install-build-tools.ps1`: once. Installs what Chromium 157
   requires and this laptop lacked: Visual Studio 2026 with C++ and ATL, and
   the Windows SDK 10.0.28000. Windows asks for approval.
2. `scripts\fetch-chromium.ps1`: downloads Chromium at `CHROMIUM_VERSION`
   without its history (about 30 GB, an hour or more).
3. `scripts\apply-jib.ps1`: puts TizCat's branding and patches into the
   source.
4. `scripts\build.ps1`: compiles into `C:\tizcat\src\out\Release`. The
   first build takes many hours; later ones only rebuild what changed.
5. The tests in `tests\` (see `docs\DEVELOPMENT.md`), then
   `scripts\install.ps1`: installs that build as the TizCat you use, in
   `%LOCALAPPDATA%\TizCat\Application`, keeping the one before
   (`install.ps1 -Rollback` goes back). Builds never touch the installed
   copy, so TizCat stays usable during even the longest build.
6. `scripts\run.ps1` (or the **TizCat** shortcut on the Desktop, which runs
   it): starts the installed TizCat with its own profile, and Yuzal with it
   (and Yuzal's backend, if it is not already running).

**How to change TizCat quickly** (which kind of change goes where, and
what each costs, from seconds to a full rebuild): `docs\DEVELOPMENT.md`.

To rename the browser again: change the names in `branding\BRANDING`, the
values in `patches\0001` (profile folder, Windows registration) and the
About text in `patches\0004`, then apply and build.

## What is in this folder

- `branding\`: the name (`BRANDING`) and the icons (`make_icons.py` makes
  them from `visuals\`), copied over Chromium's, over the white Chrome
  logo that Settings, History and Downloads show in a dark theme, and over
  the one-color Chrome logo of the address bar and Settings.
  `rename_strings.py` puts the name in place of "Chromium" in the words a
  person reads, but not in the About page's credit to the Chromium project.
- `visuals\`: the logo artwork.
- `patches\`: TizCat's changes to Chromium's own files, one `.patch` each:
  - `0001`: its own profile folder and Windows registration, apart from
    Chromium's.
  - `0002`: Yuzal built in, with no debugging bar over her.
  - `0003`: covered windows keep drawing, so Yuzal's screenshots work
    behind other windows and while the screen is locked (as in Jeep).
  - `0004`: the About page tells where the name TizCat comes from.
  - `0005`: import from other Chromium-based browsers (Chrome, Edge,
    Brave, Opera and others), which Chromium itself can't do.
  - `0006`: the Profile page in Settings, in place of "You and Google",
    with the TizCat account row, and the JibWallet page (a placeholder).
  - `0007`: TizCat loads every module in `modules\` (from beside
    chrome.exe), so modules change or arrive without a rebuild; a module's
    toolbar button is pinned the first time it arrives in a profile.
- `build\args.gn`: the build settings, including speed: profile-guided
  optimization with Chrome's own profile for this version (since
  2026-11-18), and Chromium's developer checks off, as in Chrome and Brave
  (since 2026-11-20).
- `modules\`: TizCat's built-in modules. `services\` is TizCat Services:
  the New Tab page, TizCat Rewards (its toolbar panel and notification ads),
  signing in to a TizCat account, and sync (bookmarks, settings, TizCat's
  own data and JibWallet's holder, encrypted on the device; `lib\sync\`).
  `wallet\` is JibWallet's placeholder: its toolbar button and a panel laid
  out like Brave Wallet's, which takes no password yet.
  `run.ps1` copies them in on every start.
- `servers\`: TizCat's servers on Cloudflare (www.tizcat.com,
  account.tizcat.com, api.tizcat.com). **`docs\SERVICES.md` is the map**:
  every part, how to update each one in seconds, the security design and the
  free plan's limits.
- `yuzal\`: Yuzal, TizCat's assistant, as a Chromium extension.
- `tests\`: `services-live.js` checks TizCat Services with the live servers
  (in Edge or TizCat); `sync-live.js` checks accounts and sync with two
  TizCat browsers; `sync-unit.test.mjs` checks sync's merge rules with no
  browser; `jib-smoke.js` checks that TizCat starts and is TizCat;
  `import-live.js` checks import from another Chromium browser with a fake
  profile; `yuzal-live.js` checks Yuzal in TizCat; `yuzal-unit.test.mjs`
  checks her safety rules with no browser. `TIZCAT_EXE` points them at a
  copy other than `out\Release`.
- `docs\DEVELOPMENT.md`: how to keep changes quick: where each kind of
  change goes, its cost, the rules, the tests before every install.
- `docs\PORTING.md`: every Jeep feature, and how it comes to TizCat.
- `docs\BUILDING.md`: details, troubleshooting, updating to a newer Chromium.
- `docs\YUZAL.md`: Yuzal in TizCat: how it maps from Jeep, what differs,
  tests.

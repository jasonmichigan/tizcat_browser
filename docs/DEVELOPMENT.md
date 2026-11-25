# Keeping TizCat quick to change

The user's rule (2026-11-20): TizCat must be fast and reliable, and a fix or
an update should not wait 12 to 16 hours. Most never need to. This page says
where each kind of change goes, what it costs, and how a long build no
longer stops anyone from using TizCat.

## Where a change goes, and what it costs

| Kind of change | Lives in | How it reaches TizCat | Time |
|---|---|---|---|
| Website, accounts, ads, Rewards, live settings, feature switches | `servers\`, `servers\config\config.json` | `deploy.ps1 <part>` (see `SERVICES.md`) | seconds |
| New Tab page, Rewards panel, notification ads, JibWallet's panel | `modules\<name>\` | restart TizCat (`run.ps1` copies modules in) | a restart |
| Yuzal | `yuzal\` | restart TizCat | a restart |
| TizCat's own change to one area of Chromium (the importer, the Profile page, the module loader) | `patches\`, edited in `C:\tizcat\src` | `build.ps1` recompiles only what changed, then the tests, then `install.ps1` | about 2 to 15 minutes |
| A build setting (`build\args.gn`), the compilers, a new Chromium version | `build\args.gn`, `CHROMIUM_VERSION` | a full rebuild in its own window, then the tests, then `install.ps1` | 11 to 16 hours, with TizCat open and usable throughout |

Example: on 2026-11-20 the import crash was found, fixed in
`chromium_importer_win.cc` and rebuilt in 2 minutes (7 build steps).

Yuzal, TizCat's AI agent, was called **Lovona** until 2026-11-23 (the
user's rename). Her extension ID stayed the same, so her settings carried
over. A TizCat built before that date loads her from `<exe dir>\lovona`
(marker `lovona-built-in`); `run.ps1` still serves those builds, so going
back to one with `install.ps1 -Rollback` works. www.tizcat.com/lovona
sends visitors to /yuzal (site.json "moved").

## The rules

1. **New features go in a module or on a server, not into Chromium.** The
   browser keeps small, permanent hooks that rarely change: Yuzal built in
   (patch 0002), the module loader (0007), the Settings rows that open
   TizCat's pages (0006). Everything that will change sits behind them.
2. **When Chromium itself must change, change files at the edge.** A `.cc`
   file inside one feature (`chrome\browser\...`, `chrome\utility\...`)
   rebuilds in minutes. A header that many files include (`base\`,
   `content\public\`, `chrome\common\`) or a build setting rebuilds
   thousands. Within a minute of starting any build, check its size with
   `siso ps -C C:\tizcat\src\out\Release`: a fix should be tens of steps,
   not tens of thousands.
3. **Build settings change rarely and together.** Each change to
   `build\args.gn` costs a full rebuild, so collect them and make them in
   one go, ideally with a Chromium update, which rebuilds everything anyway.
   Never move or rename `C:\tizcat`: the build's records are kept by full
   path, and moving it throws them away (a full rebuild, 2026-11-16).
4. **Builds never touch the TizCat in use.** `build.ps1` writes only to
   `C:\tizcat\src\out\Release`. The TizCat people use is an installed copy
   in `%LOCALAPPDATA%\TizCat\Application\<version>-<date>`, which `run.ps1`
   (the shortcut) starts. After a build: run the tests on `out\Release`,
   then `scripts\install.ps1`; TizCat uses the new copy from its next start.
   `install.ps1 -Rollback` goes back to the one before.
5. **Every fix comes with a test** in `tests\` that failed before the fix
   and passes after it (`import-live.js` is the model: it rebuilds the
   real-world case with made-up data).
6. **Every finished change is saved to the history**: committed with what
   changed and why, and pushed to the private GitHub repository.
7. **A part that can misbehave can be switched off without a rebuild.**
   Server-side parts and TizCat Services have `features` in `config.json`.
   A future Chromium-side feature of TizCat's should sit behind a
   `base::Feature`, so `run.ps1` can turn it off with
   `--disable-features=<name>` until a fix is installed.

## The version history runs by itself

The user's instruction (2026-11-20): keep GitHub up to date without being
asked. The history is `C:\tizcat-git` (outside Google Drive), uploaded to the
private repository `github.com/jasonmichigan/tizcat_browser`.

- **When:** after every finished and tested change, one saved version per
  change; before any risky change, a save point to come back to. Changes
  the user made in this folder are saved first, as a version of their own
  marked as theirs, never mixed into another change.
- **What:** only the files of that change, never everything in the folder
  blindly. `.gitignore` keeps out the Cloudflare password file, keys,
  recovery codes, test screenshots and tool caches.
- **The guard:** `scripts\git-hooks\pre-commit` runs before every save
  (`core.hooksPath`) and refuses passwords, keys, access tokens, recovery
  codes and files over 50 MB, by name and by content.
  `sh scripts/git-hooks/pre-commit --all` checks everything already saved.
- **Messages** say what changed, why, and which tests passed.
- **Chromium changes** are saved as patches first (`scripts\patch-tools\`),
  then committed with the change.
- **Installs** record their source: `install.ps1` writes `source.txt` into
  the install and tags the version `installed-<version>-<date>` on GitHub.
- **Never without asking the user:** rewriting or deleting anything already
  on GitHub (history, tags, branches).
- If an upload fails, the version stays saved here and goes with the next
  upload.

## Tests, before every install

Run on `out\Release` (the default), or on another copy with the
environment variable `TIZCAT_EXE` set to its `chrome.exe`:

| Test | Checks | Time |
|---|---|---|
| `node tests\jib-smoke.js` | TizCat starts and is TizCat (name, window, About page) | 1 minute |
| `node tests\import-live.js` | import from a Chromium browser, with a fake profile; TizCat survives it and keeps what it imported, bookmarks' site icons included | 2 minutes |
| `node tests\services-live.js tizcat` | TizCat Services with the live servers: New Tab, Rewards, sign-up and signing in | 2 minutes |
| `node tests\sync-live.js` | two TizCat browsers sync through a new account: bookmarks, settings, JibWallet's holder | 2 minutes |
| `node --test tests\sync-unit.test.mjs` | sync's merge rules, no browser | seconds |
| `node tests\yuzal-live.js` | Yuzal in TizCat, with one real AI answer when her backend runs | 3 minutes |
| `node --test tests\yuzal-unit.test.mjs` | Yuzal's safety rules, no browser | seconds |
| `node tests\wallet-live.js` | JibWallet's placeholder: built in, its button on the toolbar, its panel takes no password, its links work; a photo in `tests\out` | 1 minute |

## Chromium updates, every four weeks

Google releases a new Chromium every four weeks, with security fixes in
between. Each is a full rebuild; it is the one long build that keeps coming.
With the installed copy, it runs in the background (overnight is best) while
TizCat stays open: update `CHROMIUM_VERSION`, run `fetch-chromium.ps1`,
`apply-jib.ps1` and `build.ps1`, then the tests, then `install.ps1`. Details
in `BUILDING.md`.

If even that becomes too slow, the next step is renting a large cloud
computer for these builds (a 64-core machine would take an estimated 1 to 2
hours). It is not priced or set up yet.

## Fast and reliable: the build settings that matter

- `chrome_pgo_phase = 2`: Chrome's own speed profile for this version.
- `dcheck_always_on = false` (since 2026-11-20): Chromium's developer
  checks off, as in Chrome and Brave. With them on, one failing check
  closes the whole browser (the import crash of 2026-11-19).
- With both, V8 also optimizes its built-in functions with Google's profile
  (`v8\tools\builtins-pgo\profiles`, downloaded by `gclient runhooks`).

# Patch tools

How TizCat's changes to Chromium (`C:\tizcat\src`) are saved as the files in
`patches\`. Run from PowerShell; each loads `scripts\env.ps1` itself.

- **0005** (import from Chromium browsers), whose files no other patch
  changes: `make-patch-0005.ps1` (a `git diff` in the Chromium checkout,
  with its two new files included).
- **0006** (the Profile page):
  `make-patch-diff.ps1 -Name 0006-jib-profile-page -Base base6`, a diff
  against the copies in `base6\`, which hold its files as they were before
  0006 (after 0001 to 0005). Some are also changed by 0004, so a plain
  `git diff` would mix the two patches.
- **0007** (the module loader, and since 2026-11-23 the first-time pinning
  of a module's toolbar button in `toolbar_actions_model.cc`), whose loader
  files 0002 also changes:
  `make-patch-diff.ps1 -Name 0007-jib-built-in-modules -Base base7`
- Without `-Files`, `make-patch-diff.ps1` takes the file list from the
  patch itself, so an update cannot drop a file. (On 2026-11-20 an old
  0006 script with a shorter list would have dropped five files and the
  JibWallet page; it was deleted.) Add `-Files a,b,...` for a new file.
- Checked 2026-11-20: all three recreate the saved patches byte for byte.
- `save-base6.ps1` saved `base6\` and `base7\`. Save a new base the same way
  BEFORE changing files that an earlier patch also changes.
- `compile-check.ps1 -Files <file.cc,...>` compiles only those files, and
  `target-check.ps1 -Targets <gn labels>` builds only those targets: quick
  checks before a build.

After saving a patch, commit it with the change (the version history in
`docs\DEVELOPMENT.md`). These were kept in a temporary folder until
2026-11-20.

# Yuzal in TizCat

The browser has been called TizCat since 2026-11-16; Jib, its first name,
is its code name, and is what this page calls it. Yuzal was called Lovona
until 2026-11-23; her extension ID did not change, so her settings carried
over.
Her logo, on her toolbar button, in her panel and on Ai settings, is the
half-cheetah, half-network face (`visuals\logo_ai2.png`; in Jeep it was the
letters "Ai"). In the panel it is gray until her backend answers.

Yuzal is Jib's assistant, and phase 2 of the move from Jeep (see
PORTING.md). In Jeep she was part of the browser: the chat panel was drawn
by Jeep's own window, and Jeep's main process read and drove the pages. In
Jib she is a Chromium extension in `tizcat\yuzal`, whose panel is Chromium's
side panel. Her brain is unchanged: Jeep's Python backend
(`ai_browser\web_dashboard.py` and `files\`), over the same HTTP calls.

Started 2026-10-30. Tested first in Edge 156 while Jib was still compiling,
then in Jib itself, built in: every check of `tests\yuzal-live.js` passes.

## Using it

- `scripts\run.ps1` starts the backend (if it is not running already) and
  then Jib. Yuzal is part of Jib (see "Built into Jib" below); `run.ps1`
  refreshes her copy beside chrome.exe from `tizcat\yuzal` first, so a change
  to her files needs no rebuild, only a restart of Jib.
- Open her with the **Ai** button in the toolbar, or **Alt+L**.
- Right-click a page, a link, an image, a field or some selected text for
  **Ask Yuzal about ...**. The question is put in her prompt box, not sent,
  as in Jeep.
- **Ai settings** (the faders button in her header, or Ctrl+,) opens the AI,
  Voice and Memory settings in a tab. They are the same settings Jeep uses,
  stored by the backend, so the two browsers share them.
- **Chat history** is the 🕘 button in her header.

## Where everything is

| File | What it is | Jeep's original |
|---|---|---|
| `manifest.json` | The extension. Its `key` fixes the ID: `djfdkjchianaecdfdcafangjiggdlhon` | |
| `sw.js` | Toolbar button and Alt+L open the panel; the right-click entries | `pagemenu.js` (the Ask Yuzal items) |
| `panel.html`, `panel.css`, `panel.js` | The side panel: chat, engine, effort, read-only, voice, files, task lists, schedules, chat history | the Yuzal half of `renderer/index.html`, `ui.css`, `ui.js` |
| `settings.html`, `settings.css`, `settings.js` | Ai settings: AI, Voice, Memory | `openSettings("ai")` in `ui.js` |
| `mic.html`, `mic.js` | Asks for the microphone once (see below) | |
| `lib/agent.js` | The loop: read the page, ask the backend, act, repeat | `main/agent.js` |
| `lib/actuator.js` | Carries out each action; the read-only and never-submit gates | `main/actuator.js` |
| `lib/perception.js`, `lib/element_index.js` | The page as the backend sees it, with numbered elements; the screenshot | `main/perception.js`, `main/inject/element_index.js` |
| `lib/cdp.js` | The DevTools protocol, through `chrome.debugger` | `main/cdp.js` |
| `lib/tabs.js` | Yuzal's tab, kept apart from the tab on screen | `main/tabs.js` (the agent part) |
| `lib/backend.js` | The backend's HTTP calls | `main/backend.js` |
| `lib/localcmd.js` | Instant commands that need no model ("go to bbc", "scroll down") | `main/localcmd.js`, unchanged |

Wherever possible the code is Jeep's, line for line. What changed is how it
reaches the page: Jeep called `webContents.executeJavaScript` and
`webContents.debugger`; Yuzal calls `Runtime.evaluate` and the other CDP
commands through `chrome.debugger`, and moves tabs with `chrome.tabs`.

## What is different from Jeep, and why

- **Passwords.** Jeep's `login` action typed a saved password from Jeep's
  vault. Jib keeps passwords in Chromium's own password manager, which no
  extension can read. That is right, so `login` now tells the model to ask
  you to pick your saved account.
- **Attaching a file.** Jeep checked that a path was a real file before
  attaching it. An extension cannot look at the disk, so Chromium attaches
  whatever path the model names; a wrong path reaches the page as an empty
  file, and the receipt names the file.
- **Starting the backend.** Jeep started it itself. An extension may not start
  programs, so `run.ps1` does, and the panel says how if it is not running.
- **The "being debugged" bar.** While an extension reads or drives a page,
  Chromium normally shows "Yuzal started debugging this browser". Jib hides
  it for the built-in Yuzal (patch 0002); a Jib built before that needs
  `--silent-debugger-extension-api`, which `run.ps1` then passes. Yuzal also
  lets go of the page after every turn.
- **The microphone.** A side panel cannot show Chromium's "allow
  microphone?" question. The first time you press Voice, Yuzal opens a tab
  that asks once; from then on the panel can listen.
- **Saving files.** Generated files and the full-page PDF are saved through
  Chromium's own Save dialog and appear in its downloads.
- **An uploaded file** is shown in the chat but no longer offers to save a
  copy: the backend only serves files it generated, and you have the file.
- **Fixed on the way:** the task-list results CSV was escaped as HTML in Jeep
  (`&amp;` in a spreadsheet); it is CSV-quoted now.

## Testing

`node --test tizcat\tests\yuzal-unit.test.mjs` checks, in under a second and
with no browser, what read-only and never-submit refuse (and that a refused
action never reaches the page), what counts as a sign-in wall, and which
messages run without a model.

`node tizcat\tests\yuzal-live.js` starts Jib on a throwaway profile (or the
browser in `YUZAL_BROWSER`, loading Yuzal unpacked) and checks:
the extension loads with its fixed ID; it reads a page and numbers its
elements; it fills a field and presses a button by number; read-only and
never-submit refuse what they should; no debugging bar takes the page's
height while she is attached; it captures the screen; "go to <url>"
navigates and leaves a receipt; the debugger is let go after the turn; the
right-click question fills the prompt box; with the backend up, it answers a
question about the page; the settings page lists the engines. The profile is
deleted afterwards. The one model question costs one short call.

The debugging-bar check was seen to fail where it should: in Edge, loaded
without `--silent-debugger-extension-api`, the bar took the page from 808 to
761 pixels high. In Jib, built in and with no switch, the page stayed 805.

Traps found while writing it:
- CDP's `Runtime.evaluate` in an extension's service worker has no
  `chrome.*`. The test asks a page of Yuzal's own instead.
- `panel.html?window=<id>` makes the panel serve that window. Only the test
  uses it: opened as a tab, the panel would otherwise take itself for the
  page to work on.
- A covered window stops drawing in Chromium on Windows, and so does every
  window while the screen is locked. Yuzal's screenshot then waits for a
  frame that never comes: in Jib's first run of the test, with the laptop
  locked, the capture step got nothing while every other step passed. Jeep
  had the same bug and turned Chromium's occlusion tracking off; Jib does
  too, by default (`patches\0003-jib-draw-covered-windows.patch`). The test
  passes the same switch to any other Chromium. A background tab is not a
  problem (Chromium keeps it drawing while it takes the screenshot), but a
  minimized window still is: the capture gives up after 8 seconds and the
  turn goes on without a picture, as in Jeep.

## Built into Jib

Done on 2026-10-30 with `patches\0002-jib-yuzal-built-in.patch`, applied
after the first full build (the rebuild took 7 minutes):
- Jib loads Yuzal as a component extension from `<exe dir>\yuzal`, the
  way it loads its PDF viewer, so she cannot be removed or switched off by
  accident and needs no command-line switch. The fixed key keeps her ID.
- Jib hides the debugging bar for her itself, but only for the built-in
  copy. Anyone can give an unpacked extension her ID by copying her key, so
  the ID alone is not trusted.
- `build.ps1` leaves a `yuzal-built-in` marker beside chrome.exe. With it,
  `run.ps1` copies `tizcat\yuzal` there on every start instead of passing
  `--load-extension`, and the test does the same.

## Next

- **Starting the backend from Jib** (native messaging), so `run.ps1` is not
  the only way in.

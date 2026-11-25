# From Jeep to Jib

(Jib has been called TizCat since 2026-11-16; Jib stays its code name.)

Jeep was Electron: an app that shows web pages, around which we built a
browser by hand. Jib is Chromium: the browser already exists, and Jib is what
we add to it. So much of Jeep is not ported at all. It was an imitation of
something Chromium does natively, and the native version replaces it.

## Comes with Chromium (Jeep's version is retired)

| Jeep (Electron) | In Jib |
|---|---|
| Google sign-in work-arounds (`googlesignin.js`, `googlehelper.js`, `clienthints.js`) | Not needed: Jib is a full browser |
| Tabs, windows, tear-off tabs, the pale drag tab (`tabs.js`, `dragghost.js`) | Chromium's tab strip |
| Popup windows (`popupwin.js`) | Chromium's popups |
| Site permission prompts (`sitepermissions.js`, `permprompt.js`) | Chromium's permission bubbles |
| Extensions, Web Store, rule lists (`extensions.js`, `webstore.js`, `extapi.js`, `extaction.js`) | Native extension support |
| Downloads panel (`downloads.js`, `dlpanel.js`) | Chromium's downloads bubble |
| Printing and print preview (`printjob.js`) | Chromium's print preview |
| Video full screen and its exit button (`fullscreenui.js`) | Native |
| Page menu, spell check, zoom (`pagemenu.js`) | Native |
| Private tabs | Incognito windows |
| History, bookmarks, bookmark import (`history.js`, `bookmarks.js`, `bmimport.js`) | Native. Chromium imports only from Firefox, Internet Explorer and a bookmarks file; patch 0005 (2026-11-16) adds Chrome, Edge, Brave, Opera, Vivaldi, Comet and other Chromium-based browsers |
| Saved passwords (`vault.js`) | Chromium's password manager |
| Address bar suggestions, search engines (`omnibox.js`) | Chromium's omnibox |
| Tab sleeping | Memory Saver |
| Tab groups, by colour and name | Native tab groups |

## Rebuilt for Jib

1. **Jib's name and icon** (phase 1, now). `branding\` and `patches\`: Jib,
   not Chromium, in the window, the installer and the profile folder.
2. **Yuzal, the assistant** (phase 2). A built-in Jib extension:
   - Its panel is Chromium's side panel.
   - It reads and drives pages through `chrome.debugger`, the same DevTools
     protocol Jeep's agent used (`agent.js`, `actuator.js`, `perception.js`,
     `cdp.js`), so most of that logic carries over.
   - It talks to the Python backend (`web_dashboard.py`), which stays as it is.
   - The model dropdown, voice mode, memory and the AI settings move into the
     panel.
3. **Jeep's look** (phase 3): the khaki browser colour as Jib's default
   theme, the Jeep button, and Jeep's own settings.
4. **Groups each signed in on their own** (phase 4). Chromium's tab groups
   share one set of cookies. The first step is Chrome's own way: one profile
   per identity, which Chromium already has. A group-level session would
   need changes deep in Chromium's C++.
5. **The module platform and AI gateway** (phase 5): the gateway moves next
   to the backend. Signed module updates become updates of Jib itself, which
   needs an updater and an installer before the first public release.

## The order, and how each is checked

- **Phase 1:** Jib builds and starts as Jib, and Google sign-in works in it.
  First full build 2026-10-30; `tests\jib-smoke.js` passes (the program,
  its window and chrome://version all say Jib; Chromium 157, no Electron).
  Still to check by hand: signing in to Google.
- **Phase 2:** Yuzal answers in the side panel and can drive a tab, using
  the same backend Jeep used.
  Done on 2026-10-30, built into Jib (docs\YUZAL.md); every check of
  `tests\yuzal-live.js` passes in Jib.
- **Phase 3:** a fresh Jib looks like Jeep.
- **Phase 4:** two Gmail accounts open side by side.
- **Phase 5:** Jib installs and updates itself on another computer.

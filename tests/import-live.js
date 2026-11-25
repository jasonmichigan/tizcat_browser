// End-to-end test of TizCat's import from Chromium-based browsers (patch
// 0005), with no real data:
//   node tests\import-live.js
//
// 1. TizCat itself makes a fake "Chromium" browser profile in
//    %LOCALAPPDATA%\Chromium\User Data (only if that folder does not exist):
//    a made-up saved password, two bookmarks and one visited page.
// 2. The test then adds what real profiles have and a fresh one does not:
//    a history entry with no visit left (Chrome keeps these, for example for
//    bookmarked pages whose visits were cleared) and a bookmark with no date.
//    The first one crashed TizCat at the end of every import until
//    2026-11-20: history's check that every page has a visit time is fatal
//    in TizCat's builds. It also gives two bookmarks a site icon (in 16 and
//    32 pixels) and the third a broken one: until 2026-11-23 imported
//    bookmarks came without their icons (a globe until each page was
//    visited).
// 3. A throwaway TizCat profile imports everything from "Chromium" through
//    the same messages the Settings dialog sends, and must stay running.
// 4. It is closed and opened again: the bookmarks must still be there (what
//    the person saw missing after the crash) with their icons (the broken
//    one left out), the visited page in history, the no-visit entry left
//    out, and no crash report written.
// Both profiles are deleted at the end. Prints JSON; exits 1 on a failure.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { DatabaseSync } = require("node:sqlite");

// TIZCAT_EXE tests another TizCat, such as an installed copy.
const EXE = process.env.TIZCAT_EXE || "C:\\tizcat\\src\\out\\Release\\chrome.exe";
const FAKE_ROOT = path.join(process.env.LOCALAPPDATA, "Chromium");
const FAKE = path.join(FAKE_ROOT, "User Data");
const B = path.join(os.tmpdir(), "tizcat-import-test-b");
const NO_VISIT = "https://example.net/tizcat-no-visit-left";
const NO_DATE = "https://example.com/tizcat-bookmark-without-date";
const ON_BAR = "https://example.com/tizcat-import-test";
const NESTED = "https://example.org/tizcat-nested";
const ICON = "https://example.com/tizcat-test-icon.ico";
const BROKEN_ICON = "https://example.com/tizcat-broken-icon.ico";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A plain square PNG of one color, `size` pixels wide.
function solidPng(size, [r, g, b]) {
  const zlib = require("zlib");
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x++) row.set([r, g, b, 255], 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;  // bits per channel
  header[9] = 6;  // red, green, blue, alpha
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const out = { checks: {} };

async function talk(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const waits = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); }
  };
  // A browser that dies answers nothing: settle every open call.
  ws.onclose = () => { for (const r of waits.values()) r({ error: "browser closed" }); waits.clear(); };
  const cmd = (method, params, sessionId) => new Promise((r) => {
    const id = ++seq;
    waits.set(id, r);
    ws.send(JSON.stringify({ id, method, params: params || {}, sessionId }));
    setTimeout(() => { if (waits.has(id)) { waits.delete(id); r({ error: "timeout" }); } }, 45000);
  });
  return { cmd, close: () => ws.close() };
}

async function start(userData, port) {
  const child = spawn(EXE, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`,
    "--no-first-run", "--no-default-browser-check", "--window-position=40,40",
    "--window-size=1000,700", "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      return { child, port, b: await talk(v.webSocketDebuggerUrl) };
    } catch { }
  }
  throw new Error("TizCat did not start on port " + port);
}

async function alive(p) {
  if (p.child.exitCode !== null) return false;
  try { await (await fetch(`http://127.0.0.1:${p.port}/json/version`)).json(); return true; } catch { return false; }
}

// Open `url` in a new tab and evaluate `expr` (awaiting a promise) there.
async function onPage(b, url, expr, wait = 2500) {
  const { result, error } = await b.cmd("Target.createTarget", { url });
  if (error) return { error };
  const { result: att } = await b.cmd("Target.attachToTarget", { targetId: result.targetId, flatten: true });
  await sleep(wait);
  const r = await b.cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, att.sessionId);
  await b.cmd("Target.closeTarget", { targetId: result.targetId });
  if (r.error) return { error: r.error };
  if (r.result && r.result.exceptionDetails) return { error: r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description };
  return r.result && r.result.result ? r.result.result.value : r;
}

async function stop(p) {
  try { await p.b.cmd("Browser.close"); } catch { }
  p.b.close();
  for (let i = 0; i < 20 && p.child.exitCode === null; i++) await sleep(500);
  try { process.kill(p.child.pid); } catch { }
  await sleep(1500);
}

const findBookmarks = `(async () => {
  const hit = await chrome.bookmarks.search('TizCat');
  const paths = [];
  for (const n of hit) {
    let p = [n.title]; let id = n.parentId;
    while (id && id !== '0') { const [x] = await chrome.bookmarks.get(id); p.unshift(x.title); id = x.parentId; }
    paths.push(p.join(' > ') + (n.dateAdded ? '' : ' (no date)'));
  }
  return paths.sort();
})()`;

function crashReports(userData) {
  const dir = path.join(userData, "Crashpad", "reports");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".dmp")).length : 0;
}

(async () => {
  if (fs.existsSync(FAKE_ROOT)) throw new Error(FAKE_ROOT + " already exists; not touching it.");
  fs.rmSync(B, { recursive: true, force: true });
  let b = null;
  try {
    // 1. The fake source browser, made by TizCat itself.
    const a = await start(FAKE, 9450);
    out.addPassword = await onPage(a.b, "chrome://password-manager/passwords",
      `chrome.passwordsPrivate.addPassword({url: 'https://tizcat-import-test.example/', username: 'tizcat-test-user',
        password: 'made-up-pass-4417', note: '', useAccountStore: false}).then(() => 'ok')`);
    out.addBookmarks = await onPage(a.b, "chrome://bookmarks",
      `(async () => {
         await chrome.bookmarks.create({parentId: '1', title: 'TizCat import test', url: 'https://example.com/tizcat-import-test'});
         const f = await chrome.bookmarks.create({parentId: '2', title: 'TizCat test folder'});
         await chrome.bookmarks.create({parentId: f.id, title: 'TizCat nested test', url: 'https://example.org/tizcat-nested'});
         return 'ok';
       })()`);
    out.visit = await onPage(a.b, "https://example.com/", "document.title", 4000);
    await stop(a);

    // 2. What real profiles have: a page with no visit left, a bookmark with no date.
    const fakeHistory = new DatabaseSync(path.join(FAKE, "Default", "History"));
    fakeHistory.prepare("INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?, ?, 0, 0, 0, 0)")
      .run(NO_VISIT, "TizCat no visit left");
    fakeHistory.close();
    const bookmarksFile = path.join(FAKE, "Default", "Bookmarks");
    const bookmarks = JSON.parse(fs.readFileSync(bookmarksFile, "utf8"));
    bookmarks.roots.bookmark_bar.children.push({ type: "url", id: "9999", name: "TizCat no date", url: NO_DATE });
    fs.writeFileSync(bookmarksFile, JSON.stringify(bookmarks, null, 3));
    // Site icons as Chromium keeps them: one icon (16 and 32 pixels) shared
    // by two bookmarks, and a broken image for the third.
    const fakeIcons = new DatabaseSync(path.join(FAKE, "Default", "Favicons"));
    const addIcon = (url, bitmaps) => {
      const id = fakeIcons.prepare("INSERT INTO favicons (url, icon_type) VALUES (?, 1)").run(url).lastInsertRowid;
      for (const [data, size] of bitmaps) {
        fakeIcons.prepare("INSERT INTO favicon_bitmaps (icon_id, last_updated, image_data, width, height) VALUES (?, ?, ?, ?, ?)")
          .run(id, 13400000000000000, data, size, size);
      }
      return id;
    };
    const icon = addIcon(ICON, [[solidPng(16, [200, 30, 30]), 16], [solidPng(32, [200, 30, 30]), 32]]);
    const broken = addIcon(BROKEN_ICON, [[Buffer.from("not an image at all"), 16]]);
    for (const [page, id] of [[ON_BAR, icon], [NESTED, icon], [NO_DATE, broken]]) {
      fakeIcons.prepare("INSERT INTO icon_mapping (page_url, icon_id) VALUES (?, ?)").run(page, id);
    }
    fakeIcons.close();

    // 3. A fresh TizCat imports everything from it.
    b = await start(B, 9451);
    out.sources = await onPage(b.b, "chrome://settings/importData",
      `(async () => {
         const {sendWithPromise} = await import('chrome://resources/js/cr.js');
         const list = await sendWithPromise('initializeImportDialog');
         return list.map(p => p.name);
       })()`, 3000);
    out.importStatus = await onPage(b.b, "chrome://settings/importData",
      `(async () => {
         const {sendWithPromise, addWebUiListener} = await import('chrome://resources/js/cr.js');
         const list = await sendWithPromise('initializeImportDialog');
         const src = list.find(p => p.name.startsWith('Chromium'));
         if (!src) return 'no Chromium source';
         const done = new Promise(r => addWebUiListener('import-data-status-changed', s => { if (s !== 'inProgress') r(s); }));
         chrome.send('importData', [src.index, {import_dialog_history: true, import_dialog_bookmarks: true,
           import_dialog_saved_passwords: true, import_dialog_search_engine: true, import_dialog_autofill_form_data: true}]);
         return await Promise.race([done, new Promise(r => setTimeout(() => r('timeout'), 30000))]);
       })()`, 3000);
    await sleep(5000); // history is written on its own thread after the import ends
    out.checks.stillRunningAfterImport = await alive(b);
    out.bookmarksAfterImport = out.checks.stillRunningAfterImport ? await onPage(b.b, "chrome://bookmarks", findBookmarks) : null;
    out.passwordsAfterImport = out.checks.stillRunningAfterImport ? await onPage(b.b, "chrome://password-manager/passwords",
      `chrome.passwordsPrivate.getSavedPasswordList().then(l => l.map(p => p.username))`) : null;
    await stop(b);

    // 4. Closed and opened again: what was imported must have been kept.
    b = await start(B, 9452);
    out.bookmarksAfterRestart = await onPage(b.b, "chrome://bookmarks", findBookmarks);
    await stop(b);
    b = null;
    const hist = new DatabaseSync(path.join(B, "Default", "History"), { readOnly: true });
    const urls = hist.prepare("SELECT url FROM urls").all().map((r) => r.url);
    hist.close();
    out.historyAfterRestart = urls;
    const icons = new DatabaseSync(path.join(B, "Default", "Favicons"), { readOnly: true });
    out.iconsAfterRestart = icons.prepare(
      "SELECT m.page_url AS page, f.url AS icon, b.width AS width, length(b.image_data) AS bytes FROM icon_mapping m "
      + "JOIN favicons f ON f.id = m.icon_id JOIN favicon_bitmaps b ON b.icon_id = f.id "
      + "WHERE m.page_url IN (?, ?, ?)").all(ON_BAR, NESTED, NO_DATE);
    icons.close();
    out.crashReports = crashReports(B);

    const kept = Array.isArray(out.bookmarksAfterRestart) ? out.bookmarksAfterRestart.join("\n") : "";
    out.checks.importSucceeded = out.importStatus === "succeeded";
    out.checks.bookmarksKeptAfterRestart = ["TizCat import test", "TizCat nested test", "TizCat no date"]
      .every((t) => kept.includes(t));
    out.checks.bookmarkWithoutDateGetsOne = kept.includes("TizCat no date") && !kept.includes("(no date)");
    out.checks.visitedPageInHistory = urls.includes("https://example.com/");
    out.checks.noVisitEntryLeftOut = !urls.includes(NO_VISIT);
    const withIcon = (page) => out.iconsAfterRestart.some((r) => r.page === page && r.icon === ICON && r.bytes > 0);
    out.checks.bookmarkIconsImported = withIcon(ON_BAR) && withIcon(NESTED);
    out.checks.brokenIconLeftOut = !out.iconsAfterRestart.some((r) => r.page === NO_DATE);
    out.checks.passwordImported = Array.isArray(out.passwordsAfterImport) && out.passwordsAfterImport.includes("tizcat-test-user");
    out.checks.noCrashReport = out.crashReports === 0;
  } finally {
    if (b) await stop(b);
    // Only the folders this test made.
    fs.rmSync(FAKE_ROOT, { recursive: true, force: true });
    fs.rmSync(B, { recursive: true, force: true });
    out.cleanedUp = !fs.existsSync(FAKE_ROOT) && !fs.existsSync(B);
  }
  const failed = Object.entries(out.checks).filter(([, ok]) => !ok).map(([k]) => k);
  out.result = failed.length ? "FAILED: " + failed.join(", ") : `all ${Object.keys(out.checks).length} checks passed`;
  console.log(JSON.stringify(out, null, 1));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

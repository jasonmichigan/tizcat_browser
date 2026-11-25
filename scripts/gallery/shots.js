// Product Hunt gallery: a fresh TizCat (its own throwaway profile, never the
// user's), driven over CDP, its window photographed by capture.ps1.
//   node scripts\gallery\shots.js [output folder]     (default tests\out\gallery)
// SHOTS=1,2 takes only those: 1 New Tab, 2 Yuzal, 3 Rewards, 4 account and
// sync, 5 Settings, 6 About. YUZAL_LOCAL=1 asks the local model instead of
// the user's own choice. TIZCAT_EXE photographs another copy. The chosen
// images, as uploaded on 2026-11-20, are in visuals\producthunt.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const EXE = process.env.TIZCAT_EXE || "C:\\tizcat\\src\\out\\Release\\chrome.exe";
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "tests", "out", "gallery"));
const CAPTURE = path.join(__dirname, "capture.ps1");
const PORT = 9479;
const SVC = "genbfkjaiacbeljlbeodfphddkkdohcp";
const LOV = "djfdkjchianaecdfdcafangjiggdlhon";
const EXT = `chrome-extension://${SVC}`;
const SITE = "https://account.tizcat.com";
const TEST_SECRET = JSON.parse(fs.readFileSync(
  path.join(process.env.LOCALAPPDATA, "TizCatServer", "secrets.json"), "utf8").replace(/^\uFEFF/, "")).TEST_SECRET;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "tizcat-ph-shots");
const ONLY = (process.env.SHOTS || "1,2,3,4").split(",").filter(Boolean);
const want = (n) => !ONLY.length || ONLY.includes(String(n));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function talk(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const waits = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); }
  };
  const cmd = (method, params) => new Promise((r) => {
    const id = ++seq;
    waits.set(id, r);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const evaluate = async (expression, gesture = false) => {
    const m = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: gesture });
    if (m.result && m.result.exceptionDetails) {
      throw new Error(m.result.exceptionDetails.exception
        ? m.result.exceptionDetails.exception.description : m.result.exceptionDetails.text);
    }
    return m.result && m.result.result ? m.result.result.value : undefined;
  };
  return { cmd, evaluate, close: () => ws.close() };
}

const targets = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
async function attach(match, tries = 80) {
  for (let i = 0; i < tries; i++) {
    const t = (await targets().catch(() => [])).find(match);
    if (t && t.webSocketDebuggerUrl) {
      const p = await talk(t.webSocketDebuggerUrl);
      p.targetId = t.id;
      return p;
    }
    await sleep(250);
  }
  throw new Error("no target");
}
async function waitFor(page, expression, tries = 60, every = 500) {
  let v = null;
  for (let i = 0; i < tries; i++) {
    v = await page.evaluate(expression).catch(() => null);
    if (v) return v;
    await sleep(every);
  }
  return v;
}
const ask = (msg) => `new Promise((r) => chrome.runtime.sendMessage(${JSON.stringify(msg)}, r))`;

let child = null;
let root = null;
let ctl = null;       // a TizCat Services page in a minimized window of its own
let MAIN = null;      // the photographed window's id

function capture(name) {
  const file = path.join(OUT, name);
  const said = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", CAPTURE,
    "-ProcessId", String(child.pid), "-Out", file], { encoding: "utf8" }).trim();
  log("captured", name, said);
}

// A tab in the photographed window, opened by TizCat Services so it lands there.
async function tab(url, active = true) {
  const t = await ctl.evaluate(`chrome.tabs.create({ windowId: ${MAIN}, url: ${JSON.stringify(url)}, active: ${active} }).then((t) => t.id)`);
  await sleep(500);
  return t;
}
async function show(tabId) {
  await ctl.evaluate(`chrome.tabs.update(${tabId}, { active: true }).then(() => chrome.windows.update(${MAIN}, { focused: true })).then(() => true)`);
  await sleep(700);
}
async function pageFor(tabId, urlPart) {
  return attach((t) => t.type === "page" && t.url.includes(urlPart));
}
async function loaded(tabId, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await ctl.evaluate(`chrome.tabs.get(${tabId}).then((t) => t.status)`);
    if (s === "complete") return true;
    await sleep(300);
  }
  return false;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // The modules and Yuzal as they are in tizcat, beside the TizCat used (as the tests do).
  fs.cpSync(path.join(ROOT, "modules"), path.join(path.dirname(EXE), "modules"), { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, "yuzal"), path.join(path.dirname(EXE), "yuzal"), { recursive: true, force: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  // This throwaway profile only: decline the two extensions other programs
  // registered for Chrome on this laptop (Adobe Acrobat, a Google Drive
  // helper), which would otherwise put "Action required" on the toolbar, and
  // do not offer to save the demo account's password.
  fs.mkdirSync(path.join(PROFILE, "Default"), { recursive: true });
  fs.writeFileSync(path.join(PROFILE, "Default", "Preferences"), JSON.stringify({
    extensions: { external_uninstalls: ["efaidnbmnnnibpcajpcglclefindmkaj", "lmjegmlicamnimmfhcmpkclmigmmcbeh"] },
    credentials_enable_service: false,
    credentials_enable_autosignin: false,
    bookmark_bar: { show_on_all_tabs: true },
  }));
  child = spawn(EXE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    "--no-first-run", "--no-default-browser-check", "--lang=en-US",
    "--window-size=1270,760", "--window-position=40,40", "https://en.wikipedia.org/wiki/Cheetah"], { stdio: "ignore" });
  log("TizCat pid", child.pid);

  const v = await (async () => {
    for (let i = 0; i < 80; i++) {
      try { return await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(250); }
    }
    throw new Error("TizCat did not start");
  })();
  root = await talk(v.webSocketDebuggerUrl);
  await attach((t) => t.url === `${EXT}/sw.js`);
  const wiki = await attach((t) => t.type === "page" && t.url.includes("wikipedia.org"));
  MAIN = (await root.cmd("Browser.getWindowForTarget", { targetId: wiki.targetId })).result.windowId;

  // TizCat Services and Yuzal pages to work from, each in a minimized window.
  const { result: c1 } = await root.cmd("Target.createTarget", { url: `${EXT}/rewards.html`, newWindow: true });
  ctl = await attach((t) => t.id === c1.targetId);
  const { result: c2 } = await root.cmd("Target.createTarget", { url: `chrome-extension://${LOV}/mic.html`, newWindow: true });
  const lov = await attach((t) => t.id === c2.targetId);
  for (const id of [c1.targetId, c2.targetId]) {
    const w = (await root.cmd("Browser.getWindowForTarget", { targetId: id })).result.windowId;
    await root.cmd("Browser.setWindowBounds", { windowId: w, bounds: { windowState: "minimized" } });
  }
  await sleep(800);
  const wikiTab = await ctl.evaluate(`chrome.tabs.query({ windowId: ${MAIN} }).then((ts) => ts[0].id)`);

  // A browser that looks used: bookmarks on the bar, and sites visited.
  await ctl.evaluate(`(async () => {
    const bar = (await chrome.bookmarks.getTree())[0].children.find((r) => r.folderType === "bookmarks-bar");
    for (const [title, url] of [["Wikipedia", "https://www.wikipedia.org/"], ["GitHub", "https://github.com/"],
      ["YouTube", "https://www.youtube.com/"], ["Hacker News", "https://news.ycombinator.com/"],
      ["Product Hunt", "https://www.producthunt.com/"], ["TizCat", "https://www.tizcat.com/"]]) {
      await chrome.bookmarks.create({ parentId: bar.id, title, url });
    }
    await chrome.settingsPrivate.setPref("bookmark_bar.show_on_all_tabs", true);
    return true;
  })()`);
  const visits = ["https://www.wikipedia.org/", "https://github.com/", "https://www.youtube.com/",
    "https://news.ycombinator.com/", "https://www.producthunt.com/", "https://www.tizcat.com/",
    "https://www.bbc.com/news", "https://www.weather.gov/"];
  // Typed into the address bar, as a person would: only typed and bookmarked
  // visits count toward the New Tab page's shortcuts.
  const walker = await tab("about:blank", false);
  const walkerPage = await attach((t) => t.type === "page" && t.url === "about:blank");
  for (let round = 0; round < 2; round++) {
    for (const url of visits) {
      await walkerPage.cmd("Page.navigate", { url, transitionType: "typed" });
      await sleep(800);
      await loaded(walker, 20000);
    }
  }
  walkerPage.close();
  await ctl.evaluate(`chrome.tabs.remove(${walker}).then(() => true)`);
  log("browser prepared");

  const siteTab = await tab("https://www.tizcat.com/", false);
  await loaded(siteTab);

  // 1. The New Tab page.
  if (want(1)) {
    // Shortcuts come from the most visited sites, which TizCat works out a
    // minute or so after the visits.
    const sites = await waitFor(ctl, "chrome.topSites.get().then((s) => s.length >= 6 ? s.length : null)", 60, 2000);
    log("shortcuts:", sites);
    const ntp = await tab("chrome://newtab/");
    await sleep(4000);
    await show(ntp);
    const page = await attach((t) => t.type === "page" && t.url.includes("newtab"));
    // A click in the page's own search box, so the address bar lets go.
    const box = await page.evaluate("(() => { const r = document.querySelector('input').getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; })()");
    for (const type of ["mousePressed", "mouseReleased"]) {
      await page.cmd("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
    }
    await sleep(800);
    capture("1-new-tab.png");
  }

  // 2. Yuzal in the side panel, summarizing the page.
  if (want(2)) {
    await show(wikiTab);
    // Close Wikipedia's fundraising banner, as a reader would.
    const closed = await waitFor(wiki, `(() => {
      const n = document.getElementById('centralNotice');
      if (!n || !n.offsetHeight) return 'none';
      const b = [...n.querySelectorAll('button, a, [role=button]')].find((e) => /maybe later|close/i.test(e.textContent + ' ' + (e.getAttribute('aria-label') || '') + ' ' + e.className));
      if (b) { b.click(); return 'clicked'; }
      return null;
    })()`, 20);
    log("banner:", closed);
    await sleep(1000);
    await wiki.evaluate("(() => { const n = document.getElementById('centralNotice'); if (n && n.offsetHeight) n.style.display = 'none'; scrollTo(0, 0); return true; })()");
    const opened = await lov.evaluate(`chrome.sidePanel.open({ windowId: ${MAIN} }).then(() => "open", (e) => String(e))`, true);
    log("side panel:", opened);
    const panel = await attach((t) => t.url === `chrome-extension://${LOV}/panel.html`);
    await waitFor(panel, "!!(globalThis.__yuzal && __yuzal.tabs.state.agentTabId)", 60);
    // The free model on this laptop, chosen for this panel only: setting the
    // value without a change event keeps the user's saved choice as it is.
    const engine = !process.env.YUZAL_LOCAL ? "the user's own choice" : await waitFor(panel, `(() => { const s = document.getElementById('engine');
      const o = [...s.options].find((o) => o.value.startsWith('local-ai|') && o.value.includes('qwen3.5:9b'));
      if (!o) return null; s.value = o.value; return o.textContent; })()`, 30);
    log("engine:", engine);
    await panel.evaluate(`(() => { const i = document.getElementById('input');
      i.value = 'Summarize this page in three short bullet points, in plain text.'; i.dispatchEvent(new Event('input'));
      document.getElementById('btn-send').click(); return true; })()`);
    let last = "", same = 0;
    for (let i = 0; i < 180 && same < 5; i++) {
      await sleep(2000);
      const t = await panel.evaluate(`(() => { const b = [...document.querySelectorAll('.bubble.assistant')]; return b.length ? b[b.length - 1].textContent : ''; })()`).catch(() => "");
      if (t && t.length > 80 && t === last) same++; else same = 0;
      last = t;
    }
    log("Yuzal said:", last.slice(0, 400));
    // The question at the top, the answer under it.
    await panel.evaluate(`(() => { const u = [...document.querySelectorAll('.bubble.user')].pop(); if (u) u.scrollIntoView({ block: 'start' }); return !!u; })()`);
    await sleep(1500);
    capture("2-yuzal.png");
    await panel.evaluate("window.close()").catch(() => {});
    await sleep(800);
  }

  // 3. TizCat Rewards, opened from its toolbar button, over the website.
  if (want(3)) {
    await ctl.evaluate(ask({ type: "tizcat.setRewards", on: true }));
    await show(siteTab);
    const popup = await ctl.evaluate(`chrome.action.openPopup({ windowId: ${MAIN} }).then(() => "open", (e) => String(e))`, true);
    log("rewards popup:", popup);
    await sleep(2500);
    capture("3-rewards.png");
    await root.cmd("Target.getTargets").then(async ({ result }) => {
      const p = result.targetInfos.find((t) => t.url === `${EXT}/rewards.html` && t.targetId !== c1.targetId);
      if (p) await root.cmd("Target.closeTarget", { targetId: p.targetId });
    });
    await sleep(800);
  }

  // 4. The TizCat account, with sync on.
  let account = null;
  const email = `alex.${Date.now().toString(36).slice(-3)}@test.tizcat.com`;
  const password = crypto.randomBytes(12).toString("base64url");
  if (want(4)) {
    const accTab = await tab(`${SITE}/`);
    account = await pageFor(accTab, "account.tizcat.com");
    await waitFor(account, `location.origin === ${JSON.stringify(SITE)} && document.readyState === 'complete'`);
    await account.evaluate(`localStorage.setItem('tizcat-test-secret', ${JSON.stringify(TEST_SECRET)})`);
    await account.evaluate("location.hash = '#signup'; location.reload(); true").catch(() => {});
    await sleep(2500);
    await waitFor(account, "!document.getElementById('view-signup').hidden");
    await account.evaluate(`(() => {
      const f = document.getElementById('signup-form');
      f.email.value = ${JSON.stringify(email)};
      f.password.value = ${JSON.stringify(password)};
      f.password2.value = ${JSON.stringify(password)};
      f.agree.checked = true;
      f.requestSubmit();
      return true;
    })()`);
    const token = await waitFor(account, "!document.getElementById('view-check-email').hidden && document.body.dataset.testToken");
    if (!token) throw new Error("sign-up gave no test token");
    await account.evaluate(`location.hash = ${JSON.stringify("#verify=" + token)}; location.reload(); true`).catch(() => {});
    await sleep(2500);
    await waitFor(account, "!document.getElementById('view-login').hidden");
    await account.evaluate(`(() => {
      const f = document.getElementById('login-form');
      f.email.value = ${JSON.stringify(email)};
      f.password.value = ${JSON.stringify(password)};
      f.requestSubmit();
      return true;
    })()`);
    await waitFor(account, "!document.getElementById('view-account').hidden && !document.getElementById('sync-on').hidden");
    await account.evaluate("document.getElementById('sync-on').click()");
    const on = await waitFor(ctl, `${ask({ type: "tizcat.summary" })}.then((s) => s.sync && s.sync.on && s.sync.lastSyncAt ? true : null)`, 60);
    log("sync on:", on);
    await account.evaluate("location.reload(); true").catch(() => {});
    await sleep(2500);
    await waitFor(account, "document.querySelectorAll('#synced-list li').length >= 3");
    await sleep(1000);
    await show(accTab);
    capture("4-sync.png");
  }

  // 5. Settings, Profile. 6. About TizCat.
  if (want(5) || want(6)) {
    const setTab = await tab("chrome://settings/");
    await sleep(3000);
    await show(setTab);
    if (want(5)) capture("5-settings.png");
    if (want(6)) {
      await ctl.evaluate(`chrome.tabs.update(${setTab}, { url: "chrome://settings/help" }).then(() => true)`);
      await sleep(3000);
      capture("6-about.png");
    }
  }

  // The demo account goes away again.
  if (account) {
    await account.evaluate("document.getElementById('delete-open').click(); true");
    await account.evaluate(`(() => {
      const f = document.getElementById('delete-form');
      f.password.value = ${JSON.stringify(password)};
      f.requestSubmit();
      return true;
    })()`);
    const gone = await waitFor(account, "!document.getElementById('view-signup').hidden");
    log("demo account deleted:", !!gone);
  }
}

main().catch((e) => { console.error("ERROR", e); process.exitCode = 1; }).finally(async () => {
  try { await root.cmd("Browser.close"); } catch { /* closed */ }
  await sleep(2000);
  try { process.kill(child.pid); } catch { /* closed */ }
  await sleep(1000);
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* still locked */ }
  process.exit();
});

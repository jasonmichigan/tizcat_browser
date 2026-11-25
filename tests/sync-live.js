// Live test of TizCat accounts and sync, with two TizCat browsers (two
// throwaway profiles, like two computers) and the real servers:
//   node tests\sync-live.js
// TizCat A: creates an account on account.tizcat.com through the page,
// confirms it with the emailed link (a test address: the server hands the
// link's token to the page instead of emailing it), logs in, and turns on
// sync with bookmarks, a setting and JibWallet's holder already there.
// TizCat B ("the new computer"): logs in, turns on sync, and must get all of
// it, with a bookmark both had only once. Then a change in B reaches A, B
// signs out (keeping its bookmarks), and A deletes the account.
// Uses the tests' secret from %LOCALAPPDATA%\TizCatServer\secrets.json.
// Screenshots go to tests\out.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.dirname(__dirname);
const EXE = process.env.TIZCAT_EXE || "C:\\tizcat\\src\\out\\Release\\chrome.exe";
const ID = "genbfkjaiacbeljlbeodfphddkkdohcp";
const EXT = `chrome-extension://${ID}`;
const SITE = "https://account.tizcat.com";
const OUT = path.join(__dirname, "out");
const TEST_SECRET = JSON.parse(fs.readFileSync(
  path.join(process.env.LOCALAPPDATA, "TizCatServer", "secrets.json"), "utf8").replace(/^\uFEFF/, "")).TEST_SECRET;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

function record(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "pass" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}

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
  const evaluate = async (expression) => {
    const m = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (m.result && m.result.exceptionDetails) {
      throw new Error(m.result.exceptionDetails.exception
        ? m.result.exceptionDetails.exception.description : m.result.exceptionDetails.text);
    }
    return m.result && m.result.result ? m.result.result.value : undefined;
  };
  return { cmd, evaluate, close: () => ws.close() };
}

// One TizCat with its own profile and debugging port.
function browser(name, port) {
  const profile = path.join(process.env.LOCALAPPDATA, "Temp", `tizcat-sync-test-${name}`);
  let child = null;
  const targets = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const b = {
    name,
    async start() {
      fs.rmSync(profile, { recursive: true, force: true });
      child = spawn(EXE, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
        "--no-first-run", "--no-default-browser-check", "--window-size=1200,900", "about:blank"], { stdio: "ignore" });
      for (let i = 0; i < 60; i++) {
        await sleep(500);
        try {
          if ((await targets()).some((t) => t.url === `${EXT}/sw.js`)) return true;
        } catch { /* not up yet */ }
      }
      return false;
    },
    async open(url) {
      const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      const root = await talk(v.webSocketDebuggerUrl);
      const { result } = await root.cmd("Target.createTarget", { url });
      root.close();
      for (let i = 0; i < 40; i++) {
        const t = (await targets()).find((x) => x.id === result.targetId);
        if (t && t.webSocketDebuggerUrl) {
          const page = await talk(t.webSocketDebuggerUrl);
          await page.cmd("Page.enable");
          await page.cmd("Runtime.enable");
          return page;
        }
        await sleep(250);
      }
      throw new Error(`${name}: tab did not open: ${url}`);
    },
    async stop() {
      try {
        const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
        const root = await talk(v.webSocketDebuggerUrl);
        await root.cmd("Browser.close");
        root.close();
      } catch { /* already closed */ }
      await sleep(2000);
      try { process.kill(child.pid); } catch { /* closed */ }
      await sleep(1000);
      fs.rmSync(profile, { recursive: true, force: true });
    },
  };
  return b;
}

async function shot(page, name) {
  const m = await page.cmd("Page.captureScreenshot", { format: "png" });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(m.result.data, "base64"));
}

async function waitFor(page, expression, tries = 60, every = 500) {
  let value = null;
  for (let i = 0; i < tries; i++) {
    value = await page.evaluate(expression).catch(() => null);
    if (value) return value;
    await sleep(every);
  }
  return value;
}

const ask = (msg) => `new Promise((r) => chrome.runtime.sendMessage(${JSON.stringify(msg)}, r))`;

// The bookmarks under the bar and Other bookmarks, as "folder/title|url" lines.
const LIST_BOOKMARKS = `chrome.bookmarks.getTree().then(([t]) => {
  const out = [];
  const walk = (n, where) => (n.children || []).forEach((c) => {
    out.push(where + "/" + c.title + (c.url ? "|" + c.url : "/"));
    if (!c.url) walk(c, where + "/" + c.title);
  });
  for (const r of t.children) walk(r, r.folderType);
  return out.sort();
})`;

async function accountPage(b) {
  const page = await b.open(`${SITE}/`);
  await waitFor(page, `location.origin === ${JSON.stringify(SITE)} && document.readyState === 'complete'`);
  await page.evaluate(`localStorage.setItem('tizcat-test-secret', ${JSON.stringify(TEST_SECRET)})`);
  await page.cmd("Page.reload");
  await sleep(1500);
  return page;
}

async function login(page, email, password) {
  await waitFor(page, "!document.getElementById('view-login').hidden");
  await page.evaluate(`(() => {
    const f = document.getElementById('login-form');
    f.email.value = ${JSON.stringify(email)};
    f.password.value = ${JSON.stringify(password)};
    f.requestSubmit();
  })()`);
  return waitFor(page, "!document.getElementById('view-account').hidden && document.getElementById('account-email').textContent");
}

async function turnOnSync(b, page, panel) {
  await waitFor(page, "!document.getElementById('sync-on').hidden");
  await page.evaluate("document.getElementById('sync-on').click()");
  return waitFor(panel, `${ask({ type: "tizcat.summary" })}.then((s) => s.sync && s.sync.on && s.sync.lastSyncAt ? s : null)`, 60);
}

async function main() {
  // The module as it is in tizcat\modules, next to the TizCat tested.
  fs.cpSync(path.join(ROOT, "modules"), path.join(path.dirname(EXE), "modules"), { recursive: true, force: true });
  const A = browser("a", 9476);
  const B = browser("b", 9477);
  const email = `sync-${Date.now().toString(36)}@test.tizcat.com`;
  const password = "sync test password 123";
  try {
    record("TizCat A starts with TizCat Services", await A.start());
    const panelA = await A.open(`${EXT}/rewards.html`);
    await sleep(800);

    // A's own data, before it has an account.
    await panelA.evaluate(`(async () => {
      const bar = (await chrome.bookmarks.getTree())[0].children.find((r) => r.folderType === "bookmarks-bar");
      const other = (await chrome.bookmarks.getTree())[0].children.find((r) => r.folderType === "other");
      const travel = await chrome.bookmarks.create({ parentId: bar.id, title: "Travel" });
      await chrome.bookmarks.create({ parentId: travel.id, title: "Maps", url: "https://maps.example/" });
      await chrome.bookmarks.create({ parentId: travel.id, title: "Trains", url: "https://trains.example/" });
      await chrome.bookmarks.create({ parentId: bar.id, title: "Both have this", url: "https://both.example/" });
      await chrome.bookmarks.create({ parentId: other.id, title: "Reading", url: "https://reading.example/" });
      await chrome.settingsPrivate.setPref("browser.show_home_button", true);
      await chrome.settingsPrivate.setPref("homepage", "https://www.tizcat.com/");
      await chrome.settingsPrivate.setPref("homepage_is_newtabpage", false);
    })()`);
    const wallet = { schema: 1, accounts: [{ label: "sync test", network: "solana" }], settings: { currency: "USD" } };
    const held = await panelA.evaluate(ask({ type: "tizcat.holder.set", name: "wallet", doc: wallet }));
    record("JibWallet's holder takes a document", held && held.ok);

    // --- Create the account on A, through the page.
    const siteA = await accountPage(A);
    await waitFor(siteA, "!document.getElementById('view-login').hidden");
    await siteA.evaluate("location.hash = '#signup'");
    await waitFor(siteA, "!document.getElementById('view-signup').hidden");
    await siteA.evaluate(`(() => {
      const f = document.getElementById('signup-form');
      f.email.value = ${JSON.stringify(email)};
      f.password.value = ${JSON.stringify(password)};
      f.password2.value = ${JSON.stringify(password)};
      f.requestSubmit();
    })()`);
    let seen = await waitFor(siteA, "document.querySelector('#signup-form .message').textContent");
    record("sign-up asks to agree to the terms first", /Terms of Service/.test(seen || ""), seen);
    await siteA.evaluate(`(() => {
      const f = document.getElementById('signup-form');
      f.password.value = ${JSON.stringify(password)};
      f.password2.value = ${JSON.stringify(password)};
      f.agree.checked = true;
      f.requestSubmit();
    })()`);
    const token = await waitFor(siteA, "!document.getElementById('view-check-email').hidden && document.body.dataset.testToken");
    record("sign up shows 'Check your email'", !!token);
    await shot(siteA, "sync-1-check-email.png");

    // The link from the email, opened in a new tab.
    const linkTab = await A.open(`${SITE}/#verify=${token}`);
    seen = await waitFor(linkTab, "!document.getElementById('login-notice').hidden && document.getElementById('login-notice').textContent");
    record("the email's link activates the account", /account is active/.test(seen || ""), seen);
    record("the link's token leaves the address bar", !(await linkTab.evaluate("location.href")).includes(token));
    seen = await login(linkTab, email, password);
    record("log in on A", seen === email);
    seen = await waitFor(linkTab, "document.getElementById('sync-status').textContent.includes('off') && document.getElementById('sync-status').textContent");
    record("the account page sees TizCat with sync off", /Sync is off/.test(seen || ""), seen);
    await shot(linkTab, "sync-2-account-sync-off.png");

    const a1 = await turnOnSync(A, linkTab, panelA);
    record("turn on sync on A: first sync done", !!a1, a1 ? `${a1.email}` : "");
    record("A's sync had no errors", a1 && !a1.sync.error, a1 && a1.sync.error);
    await linkTab.cmd("Page.reload");
    seen = await waitFor(linkTab, "[...document.querySelectorAll('#synced-list li span:first-child')].map((s) => s.textContent).join(', ') || null");
    record("the account page lists what is synced", /Bookmarks/.test(seen || "") && /Settings/.test(seen || "") && /JibWallet/.test(seen || ""), seen);
    await shot(linkTab, "sync-3-account-sync-on.png");
    const syncPage = await A.open(`${EXT}/sync.html`);
    await waitFor(syncPage, "!document.getElementById('on').hidden");
    await shot(syncPage, "sync-4-sync-page.png");

    // --- B, the new computer, already has two bookmarks of its own.
    record("TizCat B starts", await B.start());
    const panelB = await B.open(`${EXT}/rewards.html`);
    await sleep(800);
    await panelB.evaluate(`(async () => {
      const bar = (await chrome.bookmarks.getTree())[0].children.find((r) => r.folderType === "bookmarks-bar");
      await chrome.bookmarks.create({ parentId: bar.id, title: "Both have this", url: "https://both.example/" });
      await chrome.bookmarks.create({ parentId: bar.id, title: "Only on B", url: "https://only-b.example/" });
    })()`);
    const siteB = await accountPage(B);
    seen = await login(siteB, email, password);
    record("log in on B", seen === email);
    const b1 = await turnOnSync(B, siteB, panelB);
    record("turn on sync on B: first sync done", !!b1 && !b1.sync.error, b1 && b1.sync.error);
    const bList = await panelB.evaluate(LIST_BOOKMARKS);
    for (const want of ["bookmarks-bar/Travel/", "bookmarks-bar/Travel/Maps|https://maps.example/",
      "bookmarks-bar/Travel/Trains|https://trains.example/", "other/Reading|https://reading.example/",
      "bookmarks-bar/Only on B|https://only-b.example/"]) {
      record(`B has ${want}`, bList.includes(want));
    }
    record("a bookmark both had is there once", bList.filter((x) => x === "bookmarks-bar/Both have this|https://both.example/").length === 1,
      bList.join("; "));
    const prefsB = await panelB.evaluate(`Promise.all(["browser.show_home_button", "homepage"].map((k) => chrome.settingsPrivate.getPref(k).then((p) => p.value)))`);
    record("B has A's settings (home button, home page)", prefsB[0] === true && prefsB[1] === "https://www.tizcat.com/", JSON.stringify(prefsB));
    const walletB = await panelB.evaluate(ask({ type: "tizcat.holder.get", name: "wallet" }));
    // Compared by content: Chrome's storage keeps object keys sorted.
    const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
    record("B has A's JibWallet holder", walletB && canon(walletB.doc) === canon(wallet), JSON.stringify(walletB));

    // --- A change on B reaches A.
    await panelB.evaluate(`(async () => {
      const [maps] = await chrome.bookmarks.search({ url: "https://maps.example/" });
      await chrome.bookmarks.update(maps.id, { title: "Maps (renamed on B)" });
      const [reading] = await chrome.bookmarks.search({ url: "https://reading.example/" });
      await chrome.bookmarks.remove(reading.id);
    })()`);
    const bSync = await panelB.evaluate(ask({ type: "tizcat.sync.now" }));
    record("B syncs its changes", bSync && bSync.ok && !bSync.sync.error, bSync && bSync.sync.error);
    const aSync = await panelA.evaluate(ask({ type: "tizcat.sync.now" }));
    record("A syncs", aSync && aSync.ok && !aSync.sync.error, aSync && aSync.sync.error);
    const aList = await panelA.evaluate(LIST_BOOKMARKS);
    record("A has B's rename", aList.includes("bookmarks-bar/Travel/Maps (renamed on B)|https://maps.example/"));
    record("A has B's delete", !aList.some((x) => x.includes("reading.example")));
    record("A has B's own bookmark", aList.includes("bookmarks-bar/Only on B|https://only-b.example/"));
    record("A still has the shared bookmark once", aList.filter((x) => x.includes("both.example")).length === 1);

    // --- B signs out: syncing stops; its bookmarks stay.
    const out = await panelB.evaluate(ask({ type: "tizcat.unlinkHere" }));
    const bAfter = await panelB.evaluate(LIST_BOOKMARKS);
    record("B signs out and keeps its bookmarks", out && out.linked === false && bAfter.includes("bookmarks-bar/Travel/"));

    // --- A deletes the account (asks for the password).
    await linkTab.evaluate("document.getElementById('delete-open').click()");
    await linkTab.evaluate(`(() => {
      const f = document.getElementById('delete-form');
      f.password.value = ${JSON.stringify(password)};
      f.requestSubmit();
    })()`);
    seen = await waitFor(linkTab, "!document.getElementById('view-signup').hidden");
    record("delete the account from its page", !!seen);
    const aAfter = await waitFor(panelA, `${ask({ type: "tizcat.summary" })}.then((s) => s.linked === false ? s : null)`, 20);
    record("A is signed out when the account is deleted", !!aAfter);
  } finally {
    await A.stop();
    await B.stop();
    const failed = results.filter((r) => !r.pass).length;
    console.log(`\n${results.length - failed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

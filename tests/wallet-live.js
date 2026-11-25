// JibWallet's placeholder (tizcat\modules\wallet) in TizCat, on a throwaway
// profile (deleted after):
//   node tests\wallet-live.js
// Checks that it is built in with its fixed ID, that its toolbar button is on
// the toolbar from the start (as Brave's wallet button), that its panel has
// Brave Wallet's parts (name, lock, Unlock, Restore) but takes no password,
// says it is not ready yet, and that its two links work. Photographs the
// panel open over the New Tab page into tests\out\wallet-panel.png.
// TIZCAT_EXE tests another TizCat, such as the installed copy.
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const ROOT = path.dirname(__dirname);
const EXE = process.env.TIZCAT_EXE || "C:\\tizcat\\src\\out\\Release\\chrome.exe";
const ID = "icnhcgjehlgijghlfmmijhoakpaehpag";
const PANEL = `chrome-extension://${ID}/panel.html`;
const PORT = 9481;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "tizcat-wallet-test");
const OUT = path.join(__dirname, "out");
const CAPTURE = path.join(ROOT, "scripts", "gallery", "capture.ps1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(name, pass, saw = "") {
  results.push({ name, pass: !!pass });
  console.log(`${pass ? "pass" : "FAIL"}  ${name}${saw !== "" ? "  (" + saw + ")" : ""}`);
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
  const evaluate = async (expression, userGesture = false) => {
    const m = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture });
    if (m.result && m.result.exceptionDetails) {
      throw new Error(m.result.exceptionDetails.exception
        ? m.result.exceptionDetails.exception.description : m.result.exceptionDetails.text);
    }
    return m.result && m.result.result ? m.result.result.value : undefined;
  };
  return { cmd, evaluate, close: () => ws.close() };
}

const targets = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
async function attach(match, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const t = (await targets().catch(() => [])).find(match);
    if (t && t.webSocketDebuggerUrl) {
      const p = await talk(t.webSocketDebuggerUrl);
      p.targetId = t.id;
      return p;
    }
    await sleep(250);
  }
  return null;
}
async function waitFor(page, expression, tries = 40, every = 250) {
  let v = null;
  for (let i = 0; i < tries; i++) {
    v = await page.evaluate(expression).catch(() => null);
    if (v) return v;
    await sleep(every);
  }
  return v;
}

(async () => {
  if (!fs.existsSync(EXE)) { console.log("TizCat is not built yet:", EXE); process.exit(2); }
  // The modules as they are in tizcat, beside the TizCat tested (run.ps1
  // does the same on every start).
  fs.cpSync(path.join(ROOT, "modules"), path.join(path.dirname(EXE), "modules"), { recursive: true, force: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  // This throwaway profile only: decline the two extensions other programs
  // registered for Chrome on this laptop, which would put "Action required"
  // on the toolbar of the photograph.
  fs.mkdirSync(path.join(PROFILE, "Default"), { recursive: true });
  fs.writeFileSync(path.join(PROFILE, "Default", "Preferences"), JSON.stringify({
    extensions: { external_uninstalls: ["efaidnbmnnnibpcajpcglclefindmkaj", "lmjegmlicamnimmfhcmpkclmigmmcbeh"] },
  }));
  const child = spawn(EXE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    "--no-first-run", "--no-default-browser-check", "--lang=en-US",
    "--window-size=1270,760", "--window-position=40,40", "chrome://newtab"], { stdio: "ignore" });
  console.log("TizCat pid", child.pid, EXE);

  let root = null;
  try {
    let version = null;
    for (let i = 0; i < 80 && !version; i++) {
      version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`).catch(() => null))?.json().catch(() => null);
      if (!version) await sleep(250);
    }
    if (!version) throw new Error("TizCat did not start");
    root = await talk(version.webSocketDebuggerUrl);
    const main = await attach((t) => t.type === "page" && /newtab|new-tab-page|\/newtab\.html/.test(t.url));
    const mainWindow = main
      ? (await root.cmd("Browser.getWindowForTarget", { targetId: main.targetId })).result.windowId : null;

    // The panel's page, opened as a tab in a window of its own, to look at
    // it and to work from (chrome.action is only for JibWallet's own pages).
    const { result: made } = await root.cmd("Target.createTarget", { url: PANEL, newWindow: true });
    const panel = await attach((t) => t.id === made.targetId);
    const title = panel && await waitFor(panel, "document.readyState === 'complete' && document.title");
    record("JibWallet is built in, with its fixed ID", title === "JibWallet", `${ID}: ${title}`);
    if (!panel) throw new Error("JibWallet's panel did not open");

    const onToolbar = await panel.evaluate("chrome.action.getUserSettings().then((s) => s.isOnToolbar)");
    record("its button is on the toolbar from the start", onToolbar === true, onToolbar);

    const parts = await panel.evaluate(`({
      name: document.querySelector('.wordmark').textContent.trim(),
      heading: document.querySelector('h1').textContent.trim(),
      lock: !!document.querySelector('svg.lock'),
      unlock: document.getElementById('unlock').textContent.trim(),
      restore: document.getElementById('restore').textContent.trim(),
    })`);
    record("the panel has Brave Wallet's parts: name, lock, Unlock, Restore",
      parts.name === "JibWallet" && parts.heading === "Unlock JibWallet" && parts.lock &&
      parts.unlock === "Unlock" && parts.restore === "Restore", JSON.stringify(parts));

    const said = await panel.evaluate(`document.getElementById('status').textContent.trim() + ' | ' +
      document.getElementById('note').textContent.replace(/\\s+/g, ' ').trim()`);
    record("it says JibWallet is not ready yet", /^Coming soon \| JibWallet is not ready yet\./.test(said), said);

    // Nothing takes a password: everything is switched off, and typing into
    // the field (focused or not) leaves it empty.
    const off = await panel.evaluate(`['password', 'show', 'unlock', 'restore'].every((id) => document.getElementById(id).disabled)`);
    await panel.evaluate("document.getElementById('password').focus(); true");
    await panel.cmd("Input.insertText", { text: "not-a-password" });
    const typed = await panel.evaluate("document.getElementById('password').value");
    record("nothing in it takes a password", off === true && typed === "", `disabled: ${off}, typed: "${typed}"`);

    const learn = await panel.evaluate("document.getElementById('learn').href");
    record("Learn more leads to tizcat.com/go/wallet", learn === "https://tizcat.com/go/wallet", learn);

    // Opened from the toolbar, over the New Tab page, as a person would.
    // The working window is minimized first, so only the main one is seen.
    const work = (await root.cmd("Browser.getWindowForTarget", { targetId: made.targetId })).result.windowId;
    await root.cmd("Browser.setWindowBounds", { windowId: work, bounds: { windowState: "minimized" } });
    await panel.evaluate(`chrome.windows.getAll({ windowTypes: ['normal'] }).then((ws) => {
      const w = ws.find((x) => x.state !== 'minimized');
      return chrome.windows.update(w.id, { focused: true });
    }).then(() => true)`);
    await sleep(700);
    const opened = await panel.evaluate(`chrome.windows.getAll({ windowTypes: ['normal'] })
      .then((ws) => chrome.action.openPopup({ windowId: ws.find((x) => x.state !== 'minimized').id }))
      .then(() => "open", (e) => String(e))`, true);
    const popup = await attach((t) => t.url === PANEL && t.id !== made.targetId, 40);
    const fit = popup && await waitFor(popup, `document.readyState === 'complete' &&
      ({ w: innerWidth, h: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight })`);
    record("it opens from the toolbar, whole, with no scrolling",
      opened === "open" && fit && fit.sw <= fit.w && fit.sh <= fit.h,
      `${opened}; ${JSON.stringify(fit)}; main window ${mainWindow}`);
    await sleep(1500);
    fs.mkdirSync(OUT, { recursive: true });
    const shot = path.join(OUT, "wallet-panel.png");
    const saidShot = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", CAPTURE,
      "-ProcessId", String(child.pid), "-Out", shot], { encoding: "utf8" }).trim();
    console.log("photographed", shot, saidShot);
    if (popup) await root.cmd("Target.closeTarget", { targetId: popup.targetId }).catch(() => {});

    // Last, as the panel closes itself after it: the settings button opens
    // Settings > JibWallet.
    await panel.evaluate("document.getElementById('settings').click(); true", true);
    const settings = await attach((t) => t.type === "page" && t.url.startsWith("chrome://settings/jibWallet"), 40);
    const coming = settings && await waitFor(settings, `(() => {
      let text = "";
      const walk = (n) => {
        if (n.nodeType === 3) { text += n.nodeValue; return; }
        if (n.shadowRoot) walk(n.shadowRoot);
        for (const c of n.childNodes || []) walk(c);
      };
      walk(document.documentElement);
      return /JibWallet is coming/.test(text) ? "JibWallet is coming" : null;
    })()`, 60);
    record("its settings button opens Settings > JibWallet", coming === "JibWallet is coming", coming || "no settings page");
  } catch (e) {
    record("no error", false, String((e && e.stack) || e));
  } finally {
    try { if (root) await root.cmd("Browser.close"); } catch { /* ignore */ }
    await sleep(2000);
    try { child.kill(); } catch { /* ignore */ }
    await sleep(500);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* still locked */ }
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();

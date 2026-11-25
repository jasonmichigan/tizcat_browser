// Live test of TizCat Services (tizcat\modules\services) with the real
// servers, on a throwaway profile:
//   node tests\services-live.js edge     (Edge, the module loaded unpacked)
//   node tests\services-live.js tizcat   (TizCat, the module built in)
// It makes a throwaway TizCat account (an address on tizcat.com that gets no
// mail), links the browser on account.tizcat.com, earns a point from a New
// Tab sponsored picture, shows one test notification ad, then deletes the
// account and the profile. Screenshots land in tests\out.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const which = process.argv[2] || "edge";
const ROOT = path.dirname(__dirname);
const MODULE = path.join(ROOT, "modules", "services");
const ID = "genbfkjaiacbeljlbeodfphddkkdohcp";
const EXT = `chrome-extension://${ID}`;
const PORT = 9473;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", `tizcat-services-test-${which}`);
const OUT = path.join(__dirname, "out");
const EXE = which === "edge"
  ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  : process.env.TIZCAT_EXE || "C:\\tizcat\\src\\out\\Release\\chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

function record(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "pass" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}

async function targets() {
  return (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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

// Opens a tab at url and returns a session on it.
async function open(url) {
  const browser = await talk((await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl);
  const { result } = await browser.cmd("Target.createTarget", { url });
  browser.close();
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
  throw new Error("tab did not open: " + url);
}

async function shot(page, name) {
  const m = await page.cmd("Page.captureScreenshot", { format: "png" });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(m.result.data, "base64"));
}

const ask = (msg) => `new Promise((r) => chrome.runtime.sendMessage(${JSON.stringify(msg)}, r))`;

async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const args = [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    "--no-first-run", "--no-default-browser-check", "--window-size=1280,860", "about:blank",
  ];
  if (which === "edge") {
    args.push(`--load-extension=${MODULE}`);
  }
  const child = spawn(EXE, args, { stdio: "ignore" });
  try {
    let worker = null;
    for (let i = 0; i < 60 && !worker; i++) {
      await sleep(500);
      try {
        worker = (await targets()).find((t) => t.url === `${EXT}/sw.js`);
      } catch { /* not up yet */ }
    }
    record("TizCat Services is loaded (its service worker runs)", !!worker);
    if (!worker) {
      return;
    }

    // The Rewards panel, as a tab: talk to the module from its own page.
    const panel = await open(`${EXT}/rewards.html`);
    await sleep(800);
    let s = await panel.evaluate(ask({ type: "tizcat.refresh" }));
    record("module reaches api.tizcat.com (settings and catalog)", s && s.ok && s.coin.name === "JibCoin");
    record("Rewards is off until turned on", s && s.rewardsOn === false);
    const catalog = await panel.evaluate("chrome.storage.local.get('catalog').then((x) => x.catalog)");
    record("ad catalog saved on the device", !!(catalog && catalog.ads.length >= 2),
      catalog ? catalog.ads.map((a) => a.id).join(", ") : "none");
    const cached = await panel.evaluate(
      "caches.open('tizcat-ads-v1').then((c) => c.keys()).then((k) => k.map((r) => r.url))");
    record("New Tab picture cached for an instant page", (cached || []).length >= 1);

    s = await panel.evaluate(ask({ type: "tizcat.setRewards", on: true }));
    record("Rewards turns on", s && s.rewardsOn === true);
    await panel.cmd("Page.reload");
    await sleep(800);
    await shot(panel, `${which}-rewards-panel.png`);

    // The New Tab page with its default picture, then a sponsored one.
    const t0 = Date.now();
    const ntp = await open(`${EXT}/newtab.html`);
    let plain = null;
    for (let i = 0; i < 20; i++) {
      await sleep(150);
      plain = await ntp.evaluate(
        "({search: !!document.getElementById('search-box'), clock: document.getElementById('clock').textContent, " +
        "rewards: !document.getElementById('rewards').hidden, sponsored: document.getElementById('background').classList.contains('sponsored')})");
      if (plain && plain.search && plain.clock && plain.rewards) break;
    }
    record("New Tab page renders", plain && plain.search && !!plain.clock && plain.rewards,
      `opened in ${Date.now() - t0} ms incl. tab`);
    await shot(ntp, `${which}-newtab.png`);
    await panel.evaluate("chrome.storage.local.set({ntpCount: 3})");
    await ntp.cmd("Page.reload");
    await sleep(1500);
    const sponsored = await ntp.evaluate(
      "({on: document.getElementById('background').classList.contains('sponsored'), credit: document.getElementById('credit').textContent})");
    record("every 4th New Tab shows the sponsored picture", sponsored && sponsored.on, sponsored && sponsored.credit);
    await shot(ntp, `${which}-newtab-sponsored.png`);
    s = await panel.evaluate(ask({ type: "tizcat.summary" }));
    record("an unlinked view is kept on the device", s && s.pendingEvents >= 1 && s.points >= 1,
      `${s && s.pendingEvents} pending, ${s && s.points} points`);

    // One notification ad now (shows in Windows' notifications).
    await panel.evaluate(ask({ type: "tizcat.test.notify" }));
    await sleep(1500);
    const notes = await panel.evaluate("chrome.notifications.getAll()");
    record("a notification ad is shown", notes && Object.keys(notes).some((k) => k.startsWith("tizcat-ad:")));
    await panel.evaluate("chrome.notifications.getAll().then((all) => Promise.all(Object.keys(all).map((k) => chrome.notifications.clear(k))))");

    // The account site: sign up through the page (a test address: the
    // server hands the emailed link's token to the page), confirm, log in,
    // then sign this browser in.
    const site = await open("https://account.tizcat.com/#signup");
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      await sleep(500);
      ready = await site.evaluate("location.origin === 'https://account.tizcat.com' && !!document.getElementById('signup-form')").catch(() => false);
    }
    if (!ready) {
      const seen = await site.evaluate("location.href + ' | ' + document.title + ' | ' + (document.body ? document.body.innerText.slice(0, 200) : '')");
      record("account site sign-up form appears", false, seen);
      await shot(site, `${which}-account-page.png`);
      return;
    }
    const secret = JSON.parse(fs.readFileSync(path.join(process.env.LOCALAPPDATA, "TizCatServer", "secrets.json"), "utf8")
      .replace(/^﻿/, "")).TEST_SECRET;
    await site.evaluate(`localStorage.setItem('tizcat-test-secret', ${JSON.stringify(secret)})`);
    const email = `module-test-${Date.now()}@test.tizcat.com`;
    const password = "module test password 123";
    await site.evaluate(`(() => {
      const f = document.getElementById('signup-form');
      f.email.value = ${JSON.stringify(email)};
      f.password.value = ${JSON.stringify(password)};
      f.password2.value = ${JSON.stringify(password)};
      f.agree.checked = true;
      f.requestSubmit();
    })()`);
    let token = null;
    for (let i = 0; i < 40 && !token; i++) {
      await sleep(500);
      token = await site.evaluate("document.body.dataset.testToken || null");
    }
    if (!token) {
      record("sign up gives a confirmation link", false,
        await site.evaluate("document.querySelector('#signup-form .message').textContent"));
      return;
    }
    await site.cmd("Page.navigate", { url: "about:blank" });
    await sleep(300);
    await site.cmd("Page.navigate", { url: `https://account.tizcat.com/#verify=${token}` });
    let account = null;
    for (let i = 0; i < 40 && !account; i++) {
      await sleep(500);
      account = await site.evaluate(`(() => {
        if (!document.getElementById('view-account').hidden) return document.getElementById('account-email').textContent;
        if (!document.getElementById('login-notice') || document.getElementById('login-notice').hidden) return null;
        const f = document.getElementById('login-form');
        if (!f.dataset.sent) {
          f.dataset.sent = "1";
          f.password.value = ${JSON.stringify(password)};
          f.requestSubmit();
        }
        return document.getElementById('view-account').hidden ? null : document.getElementById('account-email').textContent;
      })()`).catch(() => null);
    }
    record("sign up, confirm and log in on account.tizcat.com", account === email,
      account || JSON.stringify(await site.evaluate("document.body.innerText.slice(0, 300)").catch(() => "")));
    let status = "";
    for (let i = 0; i < 20; i++) {
      status = await site.evaluate("document.getElementById('sync-status').textContent");
      if (!/Checking/.test(status)) break;
      await sleep(300);
    }
    record("the account page finds TizCat Services", /Sync is off/.test(status), status);
    await site.evaluate("document.getElementById('sync-on').click()");
    let linked = false;
    for (let i = 0; i < 30 && !linked; i++) {
      await sleep(500);
      s = await panel.evaluate(ask({ type: "tizcat.summary" }));
      linked = s && s.linked;
    }
    record("this browser is linked to the account", linked && s.email === email);
    await sleep(1500);
    s = await panel.evaluate(ask({ type: "tizcat.refresh" }));
    record("the device's points moved to the account", s && s.pointsOnServer && s.points >= 1 && s.pendingEvents === 0,
      `${s && s.points} points on the server`);
    await site.cmd("Page.reload");
    await sleep(2500);
    await shot(site, `${which}-account-page.png`);

    // Clean up: delete the account (with its points) from its own page.
    await site.evaluate(`(() => {
      document.getElementById('delete-open').click();
      const f = document.getElementById('delete-form');
      f.password.value = ${JSON.stringify(password)};
      f.requestSubmit();
    })()`);
    let deleted = false;
    for (let i = 0; i < 30 && !deleted; i++) {
      await sleep(500);
      deleted = await site.evaluate("!document.getElementById('view-signup').hidden");
    }
    record("delete the test account", deleted);
    s = await panel.evaluate(ask({ type: "tizcat.refresh" }));
    record("the module notices the account is gone", s && s.linked === false);

    const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    const b = await talk(ver.webSocketDebuggerUrl);
    await b.cmd("Browser.close");
    b.close();
  } finally {
    await sleep(2500);
    try { process.kill(child.pid); } catch { /* closed */ }
    await sleep(1500);
    fs.rmSync(PROFILE, { recursive: true, force: true });
    const failed = results.filter((r) => !r.pass).length;
    console.log(`\n${results.length - failed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

// Yuzal, end to end, in a real Chromium: the extension loads, the panel
// reads a page, drives it, refuses what read-only forbids, fills its prompt
// box from the right-click menu, and (when the backend is up) answers.
//
// It starts its own browser on a throwaway profile, which it deletes after:
// Jib's chrome.exe when it has been built, Microsoft Edge until then (Edge
// is Chromium too, and unlike Google Chrome it still honours
// --load-extension). Set YUZAL_BROWSER to choose another.
//
//   node tizcat/tests/yuzal-live.js
//
// One step asks the real model a one-line question, through Jeep's backend
// on 127.0.0.1:5050. Without the backend that step is skipped, not failed.
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9444;
const CDP = "http://127.0.0.1:" + PORT;
const YUZAL = path.resolve(__dirname, "..", "yuzal");
const YUZAL_ID = "djfdkjchianaecdfdcafangjiggdlhon";
// TIZCAT_EXE tests another TizCat, such as an installed copy.
const JIB = process.env.TIZCAT_EXE || "C:\\tizcat\\src\\out\\Release\\chrome.exe";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BROWSER = process.env.YUZAL_BROWSER || (fs.existsSync(JIB) ? JIB : EDGE);
// A Jib built with patch 0002 loads Yuzal itself, from beside chrome.exe;
// loading her again with --load-extension would be a second copy.
const BUILT_IN = BROWSER === JIB && fs.existsSync(path.join(path.dirname(JIB), "yuzal-built-in"));

function serve(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler).listen(0, "127.0.0.1", () =>
      resolve({ port: s.address().port, close: () => { s.close(); s.closeAllConnections(); } }));
  });
}

async function talk(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const waits = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); } };
  const cmd = (method, params) => new Promise((r) => { const id = ++seq; waits.set(id, r); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  const ev = async (expression) => {
    const m = await cmd("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    const r = m.result || {};
    return r.exceptionDetails ? "THREW " + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text) : (r.result ? r.result.value : undefined);
  };
  return { ws, cmd, ev, close: () => ws.close() };
}

const list = async () => (await (await fetch(CDP + "/json/list")).json());
async function targetAt(part, type, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const t = (await list()).find((x) => x.url.includes(part) && (!type || x.type === type));
    if (t) return talk(t.webSocketDebuggerUrl);
    await sleep(250);
  }
  return null;
}
async function until(fn, ms = 10000, step = 200) {
  const end = Date.now() + ms;
  // An evaluation that threw comes back as a "THREW ..." string, which is
  // truthy: it is a reason to keep waiting, never an answer.
  while (Date.now() < end) {
    const v = await fn();
    if (v && !(typeof v === "string" && v.startsWith("THREW"))) return v;
    await sleep(step);
  }
  return null;
}

const out = { browser: BROWSER, failed: [] };
const ok = (name, cond, saw) => { out[name] = { pass: !!cond, saw }; if (!cond) out.failed.push(name); };

(async () => {
  const site = await serve((req, res) => {
    res.setHeader("Content-Type", "text/html");
    if (req.url.startsWith("/two")) return res.end("<title>Page two</title><h1>Second page</h1>");
    res.end(`<title>Yuzal test page</title>
      <h1>Order form</h1>
      <p>${"A long page. ".repeat(400)}</p>
      <label>Name <input id="name" placeholder="Your name"></label>
      <button id="go" onclick="document.title='clicked:'+document.getElementById('name').value">Place order</button>
      <a href="/two">Second page</a>`);
  });
  const base = `http://127.0.0.1:${site.port}/`;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "yuzal-test-"));
  if (BUILT_IN) fs.cpSync(YUZAL, path.join(path.dirname(JIB), "yuzal"), { recursive: true });
  out.yuzal = BUILT_IN ? "built into Jib" : "loaded with --load-extension";
  const proc = spawn(BROWSER, [
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    ...(BUILT_IN ? [] : [`--load-extension=${YUZAL}`, "--silent-debugger-extension-api"]),
    // Jib has this off already (patch 0003). Any other Chromium stops drawing
    // a covered window, and every window while the screen is locked, so the
    // screenshot step would wait for a frame that never comes.
    ...(BROWSER === JIB ? [] : ["--disable-features=CalculateNativeWinOcclusion"]),
    "--no-first-run", "--no-default-browser-check", "--disable-sync",
    "--window-size=1300,900", base,
  ], { stdio: "ignore" });

  let browserWs = null;
  try {
    const ver = await until(async () => { try { return await (await fetch(CDP + "/json/version")).json(); } catch { return null; } }, 20000);
    ok("browser started", !!ver, ver && ver.Browser);
    browserWs = await talk(ver.webSocketDebuggerUrl);

    // 1. The extension loaded, with the ID its fixed key gives it.
    const sw = await targetAt(`chrome-extension://${YUZAL_ID}/sw.js`, "service_worker", 80);
    ok("extension loaded with its fixed ID", !!sw, YUZAL_ID);
    if (!sw) throw new Error("Yuzal did not load");
    sw.close();

    // A page of Yuzal's own, in a window of its own, to ask Chromium about
    // tabs: evaluating in the service worker over CDP has no chrome.* in it.
    await browserWs.cmd("Target.createTarget", { url: `chrome-extension://${YUZAL_ID}/mic.html`, newWindow: true });
    const probe = await targetAt(`chrome-extension://${YUZAL_ID}/mic.html`, "page");

    // The window the test page is in: the panel will serve that one.
    const win = await until(() => probe.ev(`chrome.tabs.query({}).then(ts => {
      const t = ts.find(t => (t.url||'').startsWith(${JSON.stringify(base)}));
      return t ? { windowId: t.windowId, tabId: t.id } : null; })`));
    ok("found the test page's window", win && win.windowId, win);
    if (!win) throw new Error("no test page");
    // The page's height before Yuzal has touched it. The "started debugging
    // this browser" bar is Chromium's, out of the page's sight, but it takes
    // its height from every tab.
    const heightBefore = await probe.ev(`chrome.tabs.get(${win.tabId}).then(t => t.height)`);

    // 2. The panel, opened as a tab in a window of its own, serving that window.
    await browserWs.cmd("Target.createTarget", { url: `chrome-extension://${YUZAL_ID}/panel.html?window=${win.windowId}`, newWindow: true });
    const panel = await targetAt(`/panel.html?window=`, "page");
    ok("panel opened", !!panel);
    await until(() => panel.ev("!!(globalThis.__yuzal && __yuzal.tabs.state.agentTabId)"));
    const agentTab = await panel.ev("__yuzal.tabs.state.agentTabId");
    ok("Yuzal attached to the page on screen", agentTab === win.tabId, { agentTab, page: win.tabId });

    // 3. Perception: the page as the backend sees it.
    const ps = await panel.ev(`import('./lib/perception.js').then(m => m.buildPageState(${win.tabId})).then(p => ({
      url: p.url, title: p.title, n: (p.elements||[]).length, text: (p.text||'').slice(0, 40),
      els: (p.elements||[]).map(e => [e.index, e.role, (e.name||'').slice(0,20)]), err: p._error }))`);
    ok("reads the page (title, text, numbered elements)", ps && ps.title === "Yuzal test page" && ps.n >= 3, ps);

    // 4. The actuator: fill the field and press the button by index.
    const idx = (ps.els || []);
    const field = (idx.find((e) => e[1] === "input") || [])[0];
    const button = (idx.find((e) => e[1] === "button") || [])[0];
    const act = (a, extra = "") => panel.ev(`import('./lib/actuator.js').then(m => m.executeOne(${JSON.stringify(a)}, { tabId: ${win.tabId}, shot: {}, ${extra} })).then(r => r.line)`);
    const filled = await act({ name: "fill_index", args: { index: field, value: "Ada" } });
    ok("fills a field by index", /^✓ fill_index/.test(filled), filled);

    // 5. Read-only refuses a click; never-submit refuses "Place order".
    const ro = await act({ name: "click_index", args: { index: button } }, "readOnly: true");
    ok("read-only refuses a click", /^✗ click_index: refused: read-only/.test(ro), ro);
    const ns = await act({ name: "click", args: { text: "Place order" } }, "noSubmit: true");
    ok("never-submit refuses a click on Place order", /^✗ click: refused/.test(ns), ns);

    const clicked = await act({ name: "click_index", args: { index: button } });
    const title = await until(() => probe.ev(`chrome.tabs.get(${win.tabId}).then(t => t.title.startsWith('clicked:') ? t.title : null)`));
    ok("clicks a button by index, and the page sees the typed name", /^✓ click_index/.test(clicked) && title === "clicked:Ada", { clicked, title });

    // No debugging bar while she drives the page: built in, Jib hides it for
    // her (patch 0002); loaded, --silent-debugger-extension-api does.
    await sleep(1500);
    const bar = await probe.ev(`Promise.all([chrome.tabs.get(${win.tabId}), chrome.debugger.getTargets()])
      .then(([t, ts]) => ({ before: ${heightBefore}, during: t.height, attached: ts.some(x => x.attached && x.tabId === ${win.tabId}) }))`);
    ok("no 'being debugged' bar while she drives the page", bar && bar.attached && bar.during === bar.before, bar);

    // 6. A trusted mouse click through CDP, and a screenshot of what is on screen.
    const shot = await panel.ev(`import('./lib/perception.js').then(m => m.capture(${win.tabId})).then(s => ({ len: s.b64.length, region: s.region }))`);
    ok("captures the visible page", shot && shot.len > 1000 && shot.region, shot);

    // 7. The chat path, with no model: Efficient mode runs these locally.
    const send = (text) => panel.ev(`(() => { const i = document.getElementById('input'); i.value = ${JSON.stringify(text)}; document.getElementById('btn-send').click(); return true; })()`);
    await send(`go to ${base}two`);
    const nav = await until(() => probe.ev(`chrome.tabs.get(${win.tabId}).then(t => t.status === 'complete' && t.url.endsWith('/two') ? t.url : null)`), 15000);
    ok("'go to <url>' navigates Yuzal's tab", !!nav, nav);
    const receipts = await until(() => panel.ev(`[...document.querySelectorAll('.receipt')].map(r => r.textContent).filter(t => t.includes('navigate')).join(' | ') || null`));
    ok("shows a receipt for it", /✓ navigate/.test(receipts || ""), receipts);

    // 8. The page is handed back after the turn: nothing stays attached.
    const attached = await until(async () => {
      const v = await probe.ev(`chrome.debugger.getTargets().then(ts => ts.filter(t => t.attached && t.tabId === ${win.tabId}).length)`);
      return v === 0 ? "detached" : null;
    }, 5000);
    ok("detaches the debugger when the turn ends", attached === "detached", attached);

    // 9. "Ask Yuzal about this page" from the right-click menu fills the box.
    await probe.ev(`chrome.storage.session.set({ yuzalAsk: { text: "What is this page about?", moveTo: ${win.tabId}, windowId: ${win.windowId}, at: Date.now() } })`);
    const asked = await until(() => panel.ev(`document.getElementById('input').value || null`), 5000);
    ok("the right-click question fills the prompt box (not sent)", asked === "What is this page about?", asked);

    // 10. The model, if the backend is up: one short real turn.
    const health = await fetch("http://127.0.0.1:5050/api/health").then((r) => r.json()).catch(() => null);
    if (health && health.ok) {
      await panel.ev(`document.getElementById('input').value = ''`);
      await send("In one short sentence, what is the heading on this page?");
      const answer = await until(() => panel.ev(`(() => { const b = [...document.querySelectorAll('.bubble.assistant')]; const t = b.length ? b[b.length-1].textContent : ''; return /second page/i.test(t) || /error/i.test(t) ? t : null; })()`), 180000, 1000);
      ok("answers from the page through the backend", answer && /second page/i.test(answer), answer);
      const ready = await panel.ev(`document.querySelector('#panelhead .logo').classList.contains('ready')`);
      ok("the Ai mark is lit while the backend is up", ready === true, ready);
    } else {
      out["answers from the page through the backend"] = { pass: null, saw: "skipped: backend not running" };
    }

    // 11. The settings page reads the backend's settings.
    await browserWs.cmd("Target.createTarget", { url: `chrome-extension://${YUZAL_ID}/settings.html` });
    const set = await targetAt("/settings.html", "page");
    const engines = await until(() => set.ev(`document.querySelectorAll('#s-engine option').length || null`), 20000);
    ok("Ai settings lists the engines", engines >= 1, engines);
  } catch (e) {
    out.error = String((e && e.stack) || e);
    out.failed.push("error");
  } finally {
    try { if (browserWs) await browserWs.cmd("Browser.close"); } catch { /* ignore */ }
    await sleep(1500);
    try { proc.kill(); } catch { /* ignore */ }
    site.close();
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* still locked */ }
  }
  console.log(JSON.stringify(out, null, 1));
  process.exit(out.failed.length ? 1 : 0);
})();

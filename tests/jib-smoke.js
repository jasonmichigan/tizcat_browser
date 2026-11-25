// Phase 1: TizCat (code name Jib) starts, and it is TizCat.
//
//   node tizcat/tests/jib-smoke.js
//
// Starts out\Release\chrome.exe on a throwaway profile (deleted after) and
// checks what a person would see: the program is called TizCat, its window
// title says TizCat, chrome://version names it, its About page tells where
// the name comes from and still credits Chromium, and it is a whole browser (its own user agent is
// Chrome's, with no Electron in it). It never touches the real profile in
// %LOCALAPPDATA%\TizCat\User Data.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9446;
const CDP = "http://127.0.0.1:" + PORT;
// TIZCAT_EXE tests another TizCat, such as an installed copy in
// %LOCALAPPDATA%\TizCat\Application (scripts\install.ps1).
const JIB = process.env.TIZCAT_EXE || "C:\\tizcat\\src\\out\\Release\\chrome.exe";

async function talk(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const waits = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); } };
  const cmd = (method, params) => new Promise((r) => { const id = ++seq; waits.set(id, r); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  const ev = async (expression) => {
    const m = await cmd("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    const r = m.result || {};
    return r.exceptionDetails ? "THREW " + (r.exceptionDetails.text || "") : (r.result ? r.result.value : undefined);
  };
  return { cmd, ev, close: () => ws.close() };
}

async function until(fn, ms = 15000, step = 250) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const v = await fn(); if (v && !(typeof v === "string" && v.startsWith("THREW"))) return v; } catch { /* not yet */ }
    await sleep(step);
  }
  return null;
}

// What Windows says about a file or a window, through PowerShell.
function ps(script) {
  return execFileSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim();
}

const out = { failed: [] };
const ok = (name, cond, saw) => { out[name] = { pass: !!cond, saw }; if (!cond) out.failed.push(name); };

(async () => {
  if (!fs.existsSync(JIB)) { console.log("TizCat is not built yet:", JIB); process.exit(2); }

  // The program's own name, from its version resource (branding\BRANDING).
  const product = ps(`(Get-Item '${JIB}').VersionInfo.ProductName`);
  ok("chrome.exe calls itself TizCat", product === "TizCat", product);
  const desc = ps(`(Get-Item '${JIB}').VersionInfo.FileDescription`);
  ok("its description says TizCat", /TizCat/.test(desc), desc);

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "jib-smoke-"));
  const proc = spawn(JIB, [
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    "--no-first-run", "--no-default-browser-check", "about:blank",
  ], { stdio: "ignore" });

  let b = null;
  try {
    const ver = await until(async () => (await fetch(CDP + "/json/version")).json(), 30000);
    ok("TizCat starts", !!ver, ver && ver.Browser);
    b = await talk(ver.webSocketDebuggerUrl);
    const ua = ver["User-Agent"] || "";
    ok("a whole browser: Chrome's user agent, no Electron", /Chrome\/157\./.test(ua) && !/Electron|Jeep/.test(ua), ua);

    // chrome://version, as the person would read it.
    const { targetId } = (await b.cmd("Target.createTarget", { url: "chrome://version" })).result;
    const page = await until(async () => {
      const t = (await (await fetch(CDP + "/json/list")).json()).find((x) => x.id === targetId);
      return t && t.webSocketDebuggerUrl ? talk(t.webSocketDebuggerUrl) : null;
    });
    const version = await until(() => page.ev("document.body && document.body.innerText.includes('157.') ? document.body.innerText.slice(0, 400) : null"));
    ok("chrome://version names TizCat", /\bTizCat\b/.test(version || ""), version);
    const hints = await page.ev("navigator.userAgentData ? navigator.userAgentData.brands.map(b => b.brand).join(', ') : ''");
    ok("its brands are Chromium's (no embedded framework)", /Chromium/.test(hints) && !/Electron/.test(hints), hints);

    // The window title Windows shows, ending in the product name.
    const title = await until(() => {
      const t = ps(`(Get-Process -Id ${proc.pid} -ErrorAction SilentlyContinue).MainWindowTitle; ` +
        `Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${JIB}' -and $_.MainWindowTitle } | Select-Object -First 1 -ExpandProperty MainWindowTitle`);
      return t ? t.split(/\r?\n/).filter(Boolean)[0] : null;
    }, 15000, 1000);
    ok("the window title ends with TizCat", /TizCat$/.test(title || ""), title);

    // The About page (Settings > About TizCat) tells where the name comes
    // from. Settings is built of nested shadow roots, so the paragraph is
    // looked for through all of them.
    await page.cmd("Page.enable");
    await page.cmd("Page.navigate", { url: "chrome://settings/help" });
    const story = await until(() => page.ev(`(() => {
      let found = null;
      const walk = (n) => {
        if (found) return;
        if (n.id === "productStory") { found = n.innerText.trim(); return; }
        if (n.shadowRoot) walk(n.shadowRoot);
        for (const c of n.children || []) walk(c);
      };
      walk(document.documentElement);
      return found;
    })()`));
    ok("the About page tells where the name TizCat comes from",
      /Persian word tiz/.test(story || "") && /cheetah/.test(story || ""), story);

    // ... and still credits Chromium: the renaming must not reach the link
    // to the Chromium project (rename_strings.py leaves it alone).
    const credit = await until(() => page.ev(`(() => {
      let text = "";
      const walk = (n) => {
        if (n.nodeType === 3) { text += n.nodeValue; return; }
        if (n.shadowRoot) walk(n.shadowRoot);
        for (const c of n.childNodes || []) walk(c);
      };
      walk(document.documentElement);
      const m = text.replace(/\\s+/g, " ").match(/[^.]*made possible by[^.]*\\./);
      return m ? m[0].trim() : null;
    })()`));
    ok("the About page credits the Chromium open source project",
      /by the Chromium open source project/.test(credit || ""), credit);
  } catch (e) {
    out.error = String((e && e.stack) || e);
    out.failed.push("error");
  } finally {
    try { if (b) await b.cmd("Browser.close"); } catch { /* ignore */ }
    await sleep(2000);
    try { proc.kill(); } catch { /* ignore */ }
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* still locked */ }
  }
  console.log(JSON.stringify(out, null, 1));
  process.exit(out.failed.length ? 1 : 0);
})();

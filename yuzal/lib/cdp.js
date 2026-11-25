// The DevTools protocol, through chrome.debugger.
//
// Jeep owned its pages and spoke CDP through Electron's webContents.debugger.
// In Jib, Yuzal is an extension, and chrome.debugger is the same protocol
// with one difference: Chromium shows a "Yuzal started debugging this
// browser" bar while it is attached. run.ps1 starts Jib with
// --silent-debugger-extension-api, which turns that bar off.
//
// Everything here takes a tab id where Jeep's version took a webContents.

const attached = new Set();

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) attached.delete(source.tabId);
});

export async function attach(tabId) {
  if (attached.has(tabId)) return true;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (e) {
    // Attached already, by an earlier panel of ours that went away without
    // detaching. Anything else (a chrome:// page, the Web Store) is a page
    // an extension may not touch, and the caller has to hear about it.
    if (!/already attached/i.test(String(e && e.message))) throw e;
  }
  attached.add(tabId);
  return true;
}

export async function detach(tabId) {
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  try { await chrome.debugger.detach({ tabId }); } catch { /* tab gone */ }
}

export async function detachAll() {
  await Promise.all([...attached].map(detach));
}

export async function send(tabId, method, params = {}) {
  await attach(tabId);
  return await chrome.debugger.sendCommand({ tabId }, method, params);
}

// What webContents.executeJavaScript was in Jeep: run an expression in the
// page's own world and get its value back. Through CDP rather than
// chrome.scripting because a page's Content-Security-Policy does not apply to
// it, and because Jeep's actuator builds its scripts as source text.
export async function evaluate(tabId, expression, userGesture = true) {
  const r = await send(tabId, "Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true, userGesture,
  });
  if (r && r.exceptionDetails) {
    const ex = r.exceptionDetails;
    throw new Error((ex.exception && ex.exception.description) || ex.text || "script failed");
  }
  return r && r.result ? r.result.value : undefined;
}

// Put files into a file input WITHOUT opening a native picker. A page cannot
// set input.files from script; DOM.setFileInputFiles is the DevTools way.
export async function setFileInputFiles(tabId, backendNodeId, files) {
  await send(tabId, "DOM.setFileInputFiles", { files, backendNodeId });
}

export async function backendNodeFor(tabId, selector) {
  const { root } = await send(tabId, "DOM.getDocument", { depth: -1, pierce: true });
  const { nodeId } = await send(tabId, "DOM.querySelector", { nodeId: root.nodeId, selector });
  if (!nodeId) return null;
  const { node } = await send(tabId, "DOM.describeNode", { nodeId });
  return node ? node.backendNodeId : null;
}

// Real, trusted mouse click at viewport CSS coordinates. Reaches canvas and
// cross-origin iframes that synthetic DOM events can't.
export async function mouseClick(tabId, x, y, { button = "left", clickCount = 1 } = {}) {
  await send(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount });
  await send(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount });
}

// Tuned press, drag and release (Jeep's coordMouseCDP): the dwell and the
// multi-step glide make canvas chess boards register a "pick up, move, drop"
// instead of ignoring a too-fast flick.
export async function mouseDrag(tabId, x1, y1, x2, y2) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await send(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: x1, y: y1 });
  await sleep(70);
  await send(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x: x1, y: y1, button: "left", clickCount: 1 });
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    const x = x1 + ((x2 - x1) * i) / steps;
    const y = y1 + ((y2 - y1) * i) / steps;
    await send(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await sleep(8);
  }
  await sleep(90);
  await send(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: x2, y: y2, button: "left", clickCount: 1 });
}

// A screenshot must never hang the agent. Chromium only produces a frame when
// the page is being drawn, so a capture can wait forever (a minimized window);
// give up after this long and carry on without a picture.
const CAPTURE_TIMEOUT_MS = 8000;

// Resolve with `fallback` if `promise` rejects or takes longer than `ms`.
export function withTimeout(promise, ms, fallback = null) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// Screenshot of a page region -> base64 PNG (no prefix), or "" on failure.
// `clip` is in document CSS px (x/y include the scroll offset). Without
// captureBeyondViewport the shot is read from what is already rendered, so it
// is pixel-identical to the screen and the page is not re-laid-out.
export async function captureClip(tabId, clip) {
  try {
    const res = await withTimeout(
      send(tabId, "Page.captureScreenshot", { format: "png", clip: { ...clip, scale: 1 } }),
      CAPTURE_TIMEOUT_MS);
    return (res && res.data) || "";
  } catch {
    return "";
  }
}

// Full-page screenshot (captureBeyondViewport) -> base64 PNG, for the PDF
// snapshot. Falls back to the visible part.
export async function captureFullPage(tabId) {
  try {
    const metrics = await send(tabId, "Page.getLayoutMetrics");
    const css = metrics.cssContentSize || metrics.contentSize;
    const clip = css
      ? { x: 0, y: 0, width: Math.ceil(css.width), height: Math.ceil(css.height), scale: 1 }
      : undefined;
    const res = await withTimeout(send(tabId, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      ...(clip ? { clip } : {}),
    }), CAPTURE_TIMEOUT_MS);
    if (res && res.data) return res.data;
  } catch { /* fall back below */ }
  return captureViewport(tabId);
}

// The visible part of the page, as drawn.
export async function captureViewport(tabId) {
  try {
    const res = await withTimeout(send(tabId, "Page.captureScreenshot", { format: "png" }), CAPTURE_TIMEOUT_MS);
    return (res && res.data) || "";
  } catch {
    return "";
  }
}

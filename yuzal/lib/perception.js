// Perception: turn a live tab into the backend's `page_state` and a
// screenshot. Jeep's perception.js, reading through CDP instead of
// webContents.
import * as cdp from "./cdp.js";
import EXTRACTOR_SRC from "./element_index.js";

// Build page_state by running the extractor in the tab's main frame.
// Only the main frame is indexed, as in Jeep.
export async function buildPageState(tabId) {
  try {
    const ps = await cdp.evaluate(tabId, EXTRACTOR_SRC + "; window.__jeepExtract();", true);
    return ps || await emptyState(tabId);
  } catch (e) {
    return await emptyState(tabId, e);
  }
}

// What a page Yuzal may not read looks like: its address and title, and
// nothing else. chrome:// pages and the Web Store end up here, which still
// lets the model navigate away from them.
async function emptyState(tabId, err) {
  let url = "", title = "";
  try { const t = await chrome.tabs.get(tabId); url = t.url || t.pendingUrl || ""; title = t.title || ""; } catch { /* ignore */ }
  return {
    url, title, text: "", headings: [], links: [], buttons: [], inputs: [],
    images: [], elements: [], visual_buttons: [], overlays: [], dialogs: [],
    page_dims: { clientWidth: 1280, clientHeight: 800, scrollHeight: 800, devicePixelRatio: 1 },
    _error: err ? String((err && err.message) || err) : undefined,
  };
}

// A screenshot for vision: exactly what is on screen now (the visible part of
// the page). Returns { b64, region }, where region is the page area the image
// covers in document CSS px; the actuator maps click_xy / drag_xy through it.
// b64 is "" if no frame could be captured.
//
// Deliberately NOT a full-page shot: that re-lays-out the page without its
// scrollbar (text re-wraps, the scroll position jumps), so its pixels don't
// match the live page.
export async function capture(tabId) {
  const metrics = await cdp.withTimeout(cdp.send(tabId, "Page.getLayoutMetrics"), 3000);
  const lv = metrics && (metrics.cssLayoutViewport || metrics.layoutViewport);
  if (lv && lv.clientWidth && lv.clientHeight) {
    const region = { x: lv.pageX || 0, y: lv.pageY || 0, width: lv.clientWidth, height: lv.clientHeight };
    const b64 = await cdp.captureClip(tabId, region);
    if (b64) return { b64, region };
  }
  return { b64: "", region: null };
}

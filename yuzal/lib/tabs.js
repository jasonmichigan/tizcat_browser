// Which tab Yuzal works on, kept apart from the tab on screen.
//
// Jeep's tab manager tracked both, because you can look at one page while
// Yuzal works on another. Chromium owns the tabs now, so this is the same
// bookkeeping over chrome.tabs: the panel's window, the tab Yuzal is
// attached to, and the moves the actuator makes on it.

const listeners = new Set();

export const state = {
  windowId: null,     // the window this panel belongs to
  agentTabId: null,   // Yuzal's tab, or null until it is given one
  activeId: null,     // the tab on screen in that window
  busy: false,        // a turn is running
};

function changed() {
  for (const cb of listeners) { try { cb(state); } catch { /* ignore */ } }
}

export function onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }

export async function init() {
  // panel.html?window=<id> serves that window. Only the tests open it that
  // way: they load the panel as a tab of its own, and without this it would
  // take its own tab for the page to work on.
  const forced = Number(new URLSearchParams(location.search).get("window"));
  state.windowId = forced || (await chrome.windows.getCurrent()).id;
  const [t] = await chrome.tabs.query({ active: true, windowId: state.windowId });
  state.activeId = t ? t.id : null;

  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    if (windowId !== state.windowId) return;
    state.activeId = tabId;
    changed();
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === state.agentTabId) state.agentTabId = null;
    changed();
  });
  // A tab dragged into another window takes Yuzal with it only if it was
  // already there; the bar just needs redrawing.
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (tabId === state.agentTabId && (info.title || info.status)) changed();
  });
  changed();
}

export function setBusy(on) {
  if (state.busy === !!on) return;
  state.busy = !!on;
  changed();
}

export function setAgentTab(id) {
  state.agentTabId = id;
  changed();
}

export async function getTab(id) {
  if (id == null) return null;
  try { return await chrome.tabs.get(id); } catch { return null; }
}

// Yuzal's tab, ready to use. Nothing attached yet, or the attached tab was
// closed: take the tab on screen.
export async function agentTab() {
  let tab = await getTab(state.agentTabId);
  if (!tab && state.activeId != null) {
    setAgentTab(state.activeId);
    tab = await getTab(state.activeId);
  }
  if (!tab) return null;
  // A discarded tab (Memory Saver) has no document to read until it is
  // reloaded.
  if (tab.discarded) {
    await waitFor(tab.id, () => chrome.tabs.reload(tab.id), 15000);
    tab = await getTab(tab.id);
  }
  return tab;
}

export async function agentTabId() {
  const t = await agentTab();
  return t ? t.id : null;
}

// Run `start`, then wait until the tab finishes loading (or `ms` passes:
// a page that never stops loading must not hang the agent).
export function waitFor(tabId, start, ms = 8000) {
  return new Promise((resolve) => {
    let done = false;
    let sawLoading = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpd);
      clearTimeout(timer);
      setTimeout(resolve, 150);
    };
    const onUpd = (id, info) => {
      if (id !== tabId) return;
      if (info.status === "loading") sawLoading = true;
      if (info.status === "complete" && sawLoading) finish();
    };
    chrome.tabs.onUpdated.addListener(onUpd);
    const timer = setTimeout(finish, ms);
    Promise.resolve().then(start).catch(finish);
  });
}

// An address the model gave, made into one a tab can load.
export function normalizeUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "about:blank";
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  if (/^[^\s]+\.[a-z]{2,}(\/.*)?$/i.test(s)) return "https://" + s;
  return "https://www.google.com/search?q=" + encodeURIComponent(s);
}

export async function agentNavigate(url) {
  const id = await agentTabId();
  if (id == null) return;
  await waitFor(id, () => chrome.tabs.update(id, { url: normalizeUrl(url) }));
}

export async function agentBack() {
  const id = await agentTabId();
  if (id != null) await waitFor(id, () => chrome.tabs.goBack(id), 4000);
}

export async function agentForward() {
  const id = await agentTabId();
  if (id != null) await waitFor(id, () => chrome.tabs.goForward(id), 4000);
}

export async function agentReload() {
  const id = await agentTabId();
  if (id != null) await waitFor(id, () => chrome.tabs.reload(id));
}

export async function createTab(url, { background = false } = {}) {
  const t = await chrome.tabs.create({
    url: normalizeUrl(url), active: !background, windowId: state.windowId,
  });
  return t ? t.id : null;
}

export async function closeTab(id) {
  try { await chrome.tabs.remove(id); } catch { /* already gone */ }
}

export async function switchTab(id) {
  try { await chrome.tabs.update(id, { active: true }); } catch { /* gone */ }
}

// The tabs of this window, left to right: what "tab 3" means.
export async function listTabs() {
  const all = await chrome.tabs.query({ windowId: state.windowId });
  return all.sort((a, b) => a.index - b.index);
}

// The agent fills fields from script, which Memory Saver does not count as
// typing, so a form Yuzal spent twenty steps on could be discarded while it
// sat in the background. This is Jeep's markEdited, the Chromium way.
export async function markEdited() {
  const id = state.agentTabId;
  if (id == null) return;
  try { await chrome.tabs.update(id, { autoDiscardable: false }); } catch { /* ignore */ }
}

// Yuzal's background worker. It does three small things; the assistant
// itself lives in the side panel (panel.html), which is where Jeep's chat
// panel was.
//
// 1. The toolbar button (and Alt+L) opens the side panel.
// 2. The page's right-click menu gets Jeep's "Ask Yuzal about ..." entries.
// 3. A question asked that way is handed to the panel, which FILLS the prompt
//    box rather than sending it: the menu knows what you are asking about but
//    not what you want to know.

function setup() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.contextMenus.removeAll(() => {
    const add = (id, title, contexts) => chrome.contextMenus.create({ id, title, contexts });
    add("ask-selection", "Ask Yuzal about “%s”", ["selection"]);
    add("ask-link", "Ask Yuzal about this link", ["link"]);
    add("ask-image", "Ask Yuzal about this image", ["image"]);
    add("ask-field", "Ask Yuzal to fill this in", ["editable"]);
    add("ask-page", "Ask Yuzal about this page", ["page"]);
  });
}

chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;
  // The same wording Jeep's page menu used (pagemenu.js). `moveTo` is set
  // when the question needs Yuzal on this page to answer it.
  let ask = null;
  switch (info.menuItemId) {
    case "ask-selection": {
      const sel = String(info.selectionText || "").trim().replace(/\s+/g, " ");
      ask = { text: `Explain this, from ${info.pageUrl}:\n\n“${clip(sel, 1500)}”`, moveTo: null };
      break;
    }
    case "ask-link":
      ask = { text: `What is at this link, and is it worth reading?\n\n${info.linkUrl}`, moveTo: null };
      break;
    case "ask-image":
      ask = { text: `What is in this image?\n\n${info.srcUrl}`, moveTo: tab.id };
      break;
    case "ask-field":
      ask = { text: "Fill in the field I just right-clicked on this page. Ask me first if you "
                  + "are not sure what it wants.", moveTo: tab.id };
      break;
    case "ask-page":
      ask = { text: "What is this page about?", moveTo: tab.id };
      break;
  }
  if (!ask) return;
  // Opening the panel has to happen inside the click, before any await, or
  // Chromium no longer counts it as something the user did.
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  chrome.storage.session.set({ yuzalAsk: { ...ask, windowId: tab.windowId, at: Date.now() } });
});

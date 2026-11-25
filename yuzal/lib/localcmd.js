// Instant, rule-based parser for trivial page commands — the heart of the
// "Efficient" engines. When a user message is a simple navigation/scroll/tab
// command, we execute it directly (no LLM call at all), which is the biggest
// latency win for local AI. Anything it doesn't recognize returns null and falls
// through to the model. Ported in spirit from the extension's parseLocalCommand.

const KNOWN_SITES = {
  youtube: "https://www.youtube.com", yt: "https://www.youtube.com",
  google: "https://www.google.com", gmail: "https://mail.google.com",
  maps: "https://maps.google.com", drive: "https://drive.google.com",
  bbc: "https://www.bbc.com", cnn: "https://www.cnn.com",
  github: "https://github.com", reddit: "https://www.reddit.com",
  wikipedia: "https://www.wikipedia.org", wiki: "https://www.wikipedia.org",
  amazon: "https://www.amazon.com", twitter: "https://twitter.com",
  x: "https://x.com", facebook: "https://www.facebook.com",
  instagram: "https://www.instagram.com", linkedin: "https://www.linkedin.com",
  netflix: "https://www.netflix.com", chatgpt: "https://chat.openai.com",
};

function resolveUrl(raw) {
  const s = (raw || "").trim().replace(/[.?!]+$/, "");
  if (!s) return null;
  const key = s.toLowerCase();
  if (KNOWN_SITES[key]) return KNOWN_SITES[key];
  // A real URL/domain is a SINGLE token (no spaces). This guards against treating
  // a multi-step instruction like "go to google.com, search for X and list Y" as a
  // URL — that must fall through to the model, not become a broken navigate.
  if (/\s/.test(s)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\/[^\s]+$/i.test(s)) return s;            // full URL
  if (/^[^\s]+\.[a-z]{2,}(\/[^\s]*)?$/i.test(s)) return "https://" + s; // bare domain
  return null;
}

// Returns { actions:[{name,args}], message } or null.
function parse(text) {
  const t = (text || "").trim();
  const low = t.toLowerCase();
  if (!t) return null;

  // scroll
  if (/^(scroll|page)\s+(down)\b/.test(low) || low === "scroll" || low === "page down")
    return { actions: [{ name: "scroll", args: { direction: "down" } }], message: "Scrolling down." };
  if (/^(scroll|page)\s+up\b/.test(low) || low === "page up")
    return { actions: [{ name: "scroll", args: { direction: "up" } }], message: "Scrolling up." };
  if (/^scroll\s+(to\s+)?(top|up to top|the top)\b/.test(low) || low === "top")
    return { actions: [{ name: "scroll", args: { direction: "top" } }], message: "Going to the top." };
  if (/^scroll\s+(to\s+)?(bottom|the bottom|down to bottom)\b/.test(low) || low === "bottom")
    return { actions: [{ name: "scroll", args: { direction: "bottom" } }], message: "Going to the bottom." };

  // history / reload
  if (/^(go\s+)?back\b/.test(low) || low === "previous page")
    return { actions: [{ name: "back", args: {} }], message: "Going back." };
  if (/^(go\s+)?forward\b/.test(low))
    return { actions: [{ name: "forward", args: {} }], message: "Going forward." };
  if (/^(reload|refresh)\b/.test(low))
    return { actions: [{ name: "reload", args: {} }], message: "Reloading." };

  // tabs
  if (/^close (this )?tab\b/.test(low))
    return { actions: [{ name: "close_tab", args: {} }], message: "Closing the tab." };
  let m = low.match(/^(switch to|go to) tab (\d+)\b/);
  if (m) return { actions: [{ name: "switch_tab", args: { index: parseInt(m[2], 10) - 1 } }], message: `Switching to tab ${m[2]}.` };
  m = low.match(/^(open|new) tab\b\s*(.*)$/);
  if (m) {
    const url = resolveUrl(m[2]);
    return { actions: [{ name: "new_tab", args: { url: url || "about:blank" } }],
             message: url ? `Opening ${url} in a new tab.` : "Opening a new tab." };
  }

  // navigation:  "go to X" / "open X" / "navigate to X" / "visit X" / bare site
  m = t.match(/^(?:go to|open|navigate to|visit|goto)\s+(.+)$/i);
  if (m) {
    const url = resolveUrl(m[1]);
    if (url) return { actions: [{ name: "navigate", args: { url } }], message: `Opening ${url}.` };
  }
  const direct = resolveUrl(t);
  if (direct && (KNOWN_SITES[low] || /\./.test(t)) && !t.includes(" "))
    return { actions: [{ name: "navigate", args: { url: direct } }], message: `Opening ${direct}.` };

  // search:  "search for X" / "google X"
  m = t.match(/^(?:search(?: for)?|google)\s+(.+)$/i);
  if (m) {
    const q = m[1].trim();
    const url = "https://www.google.com/search?q=" + encodeURIComponent(q);
    return { actions: [{ name: "navigate", args: { url } }], message: `Searching for “${q}”.` };
  }

  return null; // not a trivial command -> let the model handle it
}

export { parse, resolveUrl, KNOWN_SITES };

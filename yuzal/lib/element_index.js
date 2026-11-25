// Injected into a page (through cdp.evaluate) to produce the
// `page_state` the Python backend expects, INCLUDING the numbered interactive-
// element index (Jeep's coordinate-free action technique, ported from the
// extension's indexInteractiveInFrame/buildElementIndex). Each interactive
// element is tagged with data-jeep-idx="<index>" so the actuator can resolve
// click_index/fill_index back to the exact node.
//
// Exported as a STRING of source that defines window.__jeepExtract(); the
// caller appends "; __jeepExtract()" so executeJavaScript returns its value.
// Must be fully self-contained and return only JSON-serializable data.

export default String.raw`
(function () {
  if (window.__jeepExtract) return;

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || +st.opacity === 0) return false;
    if (r.bottom < 0 || r.right < 0 || r.top > (innerHeight + 2000) || r.left > innerWidth) return false;
    return true;
  }

  function nameFor(el) {
    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const ph = el.getAttribute && el.getAttribute("placeholder");
    const val = el.value;
    const txt = (el.innerText || el.textContent || "").trim();
    const title = el.getAttribute && el.getAttribute("title");
    const alt = el.getAttribute && el.getAttribute("alt");
    return (txt || ph || val || title || alt || "").trim().slice(0, 120);
  }

  function cssPath(el) {
    if (el.id) return "#" + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let sel = node.nodeName.toLowerCase();
      if (node.classList && node.classList.length) {
        sel += "." + [...node.classList].slice(0, 2).map((c) => CSS.escape(c)).join(".");
      }
      const parent = node.parentNode;
      if (parent) {
        const sibs = [...parent.children].filter((c) => c.nodeName === node.nodeName);
        if (sibs.length > 1) sel += ":nth-of-type(" + (sibs.indexOf(node) + 1) + ")";
      }
      parts.unshift(sel);
      node = node.parentNode;
    }
    return parts.join(" > ");
  }

  const INTERACTIVE = "a[href], button, input, textarea, select, summary, " +
    "[role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], " +
    "[role=radio], [role=switch], [role=combobox], [contenteditable=''], " +
    "[contenteditable=true], [onclick]";

  window.__jeepExtract = function () {
    // Clear any previous tags so indices are fresh each turn.
    document.querySelectorAll("[data-jeep-idx]").forEach((e) => e.removeAttribute("data-jeep-idx"));

    const elements = [];
    let idx = 0;
    const seen = new Set();
    document.querySelectorAll(INTERACTIVE).forEach((el) => {
      if (seen.has(el) || !visible(el)) return;
      seen.add(el);
      const r = el.getBoundingClientRect();
      const tag = el.nodeName.toLowerCase();
      let role = el.getAttribute("role") ||
        (tag === "a" ? "link" : tag === "button" ? "button" :
         (tag === "input" || tag === "textarea" || tag === "select") ? "input" : tag);
      el.setAttribute("data-jeep-idx", String(idx));
      elements.push({
        index: idx, role, type: el.getAttribute("type") || "",
        name: nameFor(el),
        x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
        w: Math.round(r.width), h: Math.round(r.height),
        selector: cssPath(el),
      });
      idx++;
      if (idx >= 150) return;
    });

    const links = [...document.querySelectorAll("a[href]")].filter(visible).slice(0, 60).map((a) => ({
      text: (a.innerText || "").trim().slice(0, 100), href: a.href, selector: cssPath(a),
    }));
    const buttons = [...document.querySelectorAll("button, [role=button], input[type=submit], input[type=button]")]
      .filter(visible).slice(0, 40).map((b) => ({ text: nameFor(b), selector: cssPath(b) }));
    const inputs = [...document.querySelectorAll("input, textarea, select")]
      .filter(visible).slice(0, 40).map((i) => ({
        type: i.getAttribute("type") || i.nodeName.toLowerCase(),
        name: i.getAttribute("name") || "", placeholder: i.getAttribute("placeholder") || "",
        selector: cssPath(i),
      }));
    const headings = [...document.querySelectorAll("h1,h2,h3")].filter(visible).slice(0, 25)
      .map((h) => ({ tag: h.nodeName.toLowerCase(), text: (h.innerText || "").trim().slice(0, 160) }));
    const images = [...document.images].filter(visible).slice(0, 15)
      .map((im) => ({ alt: im.alt || "", src: im.currentSrc || im.src || "" }));

    // Visual buttons (icon/graphical clickables) with on-page coords for the
    // backend's status.csv (matches the extension's visual_buttons).
    const visual_buttons = elements
      .filter((e) => e.role === "button" || e.role === "link")
      .slice(0, 60)
      .map((e) => ({ kind: e.role, text: e.name, x: e.x, y: e.y, w: e.w, h: e.h, selector: e.selector }));

    return {
      url: location.href,
      title: document.title,
      text: (document.body ? document.body.innerText : "").slice(0, 8000),
      headings, links, buttons, inputs, images, elements, visual_buttons,
      overlays: [], dialogs: [],
      page_dims: {
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
      },
    };
  };
})();
`;

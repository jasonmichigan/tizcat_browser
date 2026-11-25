// Actuator: execute the backend decision's `actions[]` on Yuzal's tab.
// Jeep's actuator.js, acting through CDP and chrome.tabs instead of a
// webContents. Index actions are the preferred, coordinate-free path (resolve
// data-jeep-idx in the page); click_xy/drag_xy use trusted CDP mouse input for
// canvas and games. Returns a "✓/✗ name: detail" receipt per action (the
// contract the backend logs and feeds back as last_results).
import * as cdp from "./cdp.js";
import * as backend from "./backend.js";
import * as perception from "./perception.js";
import * as tabs from "./tabs.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run a DOM operation against the element tagged data-jeep-idx="<index>".
async function domActByIndex(tabId, index, op, value) {
  const src = `(function(){
    const el = document.querySelector('[data-jeep-idx="${Number(index)}"]');
    if (!el) return { ok:false, detail:'index ${Number(index)} not found (page may have changed, so re-read it)' };
    el.scrollIntoView({block:'center', inline:'center'});
    const op = ${JSON.stringify(op)}, value = ${JSON.stringify(value ?? "")};
    try {
      if (op === 'click') { el.click(); return { ok:true, detail:(el.innerText||el.value||'').slice(0,60) }; }
      if (op === 'fill') {
        el.focus();
        const proto = el.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto,'value');
        if (setter && setter.set) setter.set.call(el, value); else el.value = value;
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
        return { ok:true, detail:'filled '+value.slice(0,40) };
      }
      if (op === 'select') { el.value = value; el.dispatchEvent(new Event('change',{bubbles:true})); return { ok:true, detail:'selected '+value }; }
      if (op === 'hover')  { el.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})); return { ok:true, detail:'hovered' }; }
      if (op === 'submit') { const f = el.form || el.closest('form'); if (f){ f.submit(); return {ok:true, detail:'submitted'}; } return {ok:false, detail:'no form'}; }
      return { ok:false, detail:'unknown op '+op };
    } catch(e){ return { ok:false, detail:String(e) }; }
  })();`;
  return await cdp.evaluate(tabId, src, true);
}

// Generic DOM action by selector/text (fallbacks when not in the index).
function domActBySelectorOrText({ selector, text, op, value, key, direction, x, y }) {
  return `(function(){
    function find(){
      ${selector ? `const bySel = document.querySelector(${JSON.stringify(selector)}); if (bySel) return bySel;` : ""}
      ${text ? `
        const t = ${JSON.stringify(text)}.toLowerCase();
        const cands = [...document.querySelectorAll('a,button,[role=button],input,summary,[onclick]')];
        return cands.find(e => ((e.innerText||e.value||e.getAttribute('aria-label')||'').trim().toLowerCase() === t))
            || cands.find(e => ((e.innerText||e.value||e.getAttribute('aria-label')||'').trim().toLowerCase().includes(t))) || null;` : "return null;"}
    }
    const op = ${JSON.stringify(op)};
    try {
      if (op === 'scroll') {
        const d = ${JSON.stringify(direction || "")};
        if (d === 'top') scrollTo(0,0);
        else if (d === 'bottom') scrollTo(0, document.body.scrollHeight);
        else if (d === 'up') scrollBy(0, -Math.round(innerHeight*0.85));
        else if (d === 'down') scrollBy(0, Math.round(innerHeight*0.85));
        else scrollTo(${Number(x) || 0}, ${Number(y) || 0});
        return { ok:true, detail:'scroll '+(d||'xy') };
      }
      if (op === 'key') {
        const k = ${JSON.stringify(key || "Enter")};
        const ae = document.activeElement || document.body;
        ae.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true}));
        ae.dispatchEvent(new KeyboardEvent('keyup',{key:k,bubbles:true}));
        if (k === 'Enter' && ae.form) { try { ae.form.requestSubmit ? ae.form.requestSubmit() : ae.form.submit(); } catch(e){} }
        return { ok:true, detail:'key '+k };
      }
      if (op === 'type') {
        const ae = document.activeElement;
        if (!ae) return { ok:false, detail:'no focused element' };
        const v = ${JSON.stringify(value || "")};
        const proto = ae.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto,'value');
        if (setter && setter.set) setter.set.call(ae, (ae.value||'')+v); else ae.value=(ae.value||'')+v;
        ae.dispatchEvent(new Event('input',{bubbles:true}));
        return { ok:true, detail:'typed '+v.slice(0,40) };
      }
      const el = find();
      if (!el) return { ok:false, detail:'target not found' };
      el.scrollIntoView({block:'center'});
      if (op === 'click') { el.click(); return { ok:true, detail:(el.innerText||el.value||'').slice(0,60) }; }
      if (op === 'fill') {
        el.focus();
        const proto = el.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto,'value');
        if (setter && setter.set) setter.set.call(el, ${JSON.stringify(value || "")}); else el.value=${JSON.stringify(value || "")};
        el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
        return { ok:true, detail:'filled' };
      }
      if (op === 'select') { el.value = ${JSON.stringify(value || "")}; el.dispatchEvent(new Event('change',{bubbles:true})); return { ok:true, detail:'selected '+el.value }; }
      if (op === 'submit') { const f = el.form || el.closest('form'); if (f){ f.submit(); return {ok:true, detail:'submitted'}; } return {ok:false, detail:'no form'}; }
      if (op === 'hover') { el.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})); return { ok:true, detail:'hovered' }; }
      if (op === 'extract') { return { ok:true, detail:(el.innerText||'').slice(0,300) }; }
      return { ok:false, detail:'unknown op '+op };
    } catch(e){ return { ok:false, detail:String(e) }; }
  })();`;
}

// Turn screenshot-pixel points [[x, y], ...] into viewport CSS points for CDP
// mouse input. ctx.visionImage is the pixel size of the image the model saw
// (echoed by the backend, after any downscale) and ctx.shot.region is the page
// area it covers (document CSS px). So page point = region origin + pixel *
// region size / image size, at any display scaling and any downscale. If the
// point is no longer on screen we scroll to it, then subtract the scroll.
// No screenshot this turn: the coordinates are viewport CSS px already.
async function toViewportPoints(tabId, ctx, pts) {
  const img = ctx.visionImage, reg = ctx.shot && ctx.shot.region;
  if (!img || !img.width || !img.height || !reg || !reg.width || !reg.height) return pts;
  const page = pts.map(([px, py]) => [reg.x + (px * reg.width) / img.width, reg.y + (py * reg.height) / img.height]);
  const xs = page.map((p) => p[0]), ys = page.map((p) => p[1]);
  const view = await cdp.evaluate(tabId, `(function(){
    const minX = ${Math.min(...xs)}, maxX = ${Math.max(...xs)}, minY = ${Math.min(...ys)}, maxY = ${Math.max(...ys)};
    const w = document.documentElement.clientWidth, h = document.documentElement.clientHeight;
    let moved = false;
    if (minX < scrollX || maxX > scrollX + w || minY < scrollY || maxY > scrollY + h) {
      scrollTo({ left: (minX + maxX - w) / 2, top: (minY + maxY - h) / 2, behavior: "instant" });
      moved = true;
    }
    return { x: scrollX, y: scrollY, moved };
  })()`, true);
  if (view.moved) await sleep(150);
  return page.map(([x, y]) => [x - view.x, y - view.y]);
}

// ---------------------------------------------------------------------------
// What each action does, and the read-only gate (unchanged from Jeep)
//
//   read      cannot change anything, anywhere
//   navigate  changes what is on screen, not what is in the world
//   mutate    can change something a stranger would see
//
// Read-only refuses `mutate` and allows the other two. The check lives in
// executeOne because every action passes through it: telling the model not to
// click is a request; refusing at the only door is enforcement.
// ---------------------------------------------------------------------------
export const ACTION_CLASS = {
  wait: "read", extract: "read", scroll: "read", highlight: "read",
  hover: "read", hover_index: "read", capture_screenshot: "read",
  report_only: "read", ask_user: "read", switch_tab: "read",

  navigate: "navigate", back: "navigate", forward: "navigate",
  reload: "navigate", new_tab: "navigate", close_tab: "navigate",

  click: "mutate", click_index: "mutate", click_xy: "mutate", drag_xy: "mutate",
  fill: "mutate", fill_index: "mutate", select: "mutate", select_index: "mutate",
  type: "mutate", key: "mutate", submit: "mutate", submit_index: "mutate",
  dismiss_overlay: "mutate", generate_file: "mutate",
  // A memory write is influenced by untrusted page text, so read-only refuses it.
  remember: "mutate",
  // Puts a document from the user's disk onto someone else's server.
  upload_file: "mutate",
  // Turns "a page the agent can read" into "an account it can act inside".
  login: "mutate",
};

// An action nobody classified is an action nobody thought about: "no".
export function classOf(name) { return ACTION_CLASS[name] || "mutate"; }

const COMMITTING = new Set(["submit", "submit_index"]);

// Button wording that commits. A click on one of these is a submit wearing a
// different hat, and the gate has to see through that.
const COMMIT_WORDS = /\b(submit|apply now|send application|finish|complete application|pay|purchase|buy|place order|confirm (and|&) (pay|submit)|sign (and|&) submit)\b/i;

let _readOnlyDefault = false;
let _noSubmitDefault = false;

export function setReadOnly(on) { _readOnlyDefault = !!on; }
export function isReadOnly() { return _readOnlyDefault; }
export function setNoSubmit(on) { _noSubmitDefault = !!on; }
export function isNoSubmit() { return _noSubmitDefault; }

/** Would this action commit something? */
export function commits(name, args = {}) {
  if (COMMITTING.has(name)) return true;
  if (name === "login" && args.submit) return true;
  const label = [args.text, args.value, args.selector].filter(Boolean).join(" ");
  if (/^click/.test(name) && label && COMMIT_WORDS.test(label)) return true;
  return false;
}

// Execute one action. ctx = { tabId, shot, visionImage, pageDims, emit,
// readOnly, noSubmit }. ctx.readOnly wins when present so one turn can be
// stricter than the saved setting.
export async function executeOne(action, ctx) {
  const tabId = ctx.tabId;
  const name = action.name;
  const a = action.args || {};

  const noSubmit = ctx.noSubmit === undefined ? _noSubmitDefault : !!ctx.noSubmit;
  if (noSubmit && commits(name, a)) {
    return bad(name, "refused: “fill but never submit” is on. Everything up to "
                   + "the final button is allowed; pressing it is yours to do.");
  }

  const readOnly = ctx.readOnly === undefined ? _readOnlyDefault : !!ctx.readOnly;
  if (readOnly && classOf(name) === "mutate") {
    return bad(name, "refused: read-only is on and this action can change the page. "
                   + "Turn read-only off in the panel if you want it to act.");
  }

  if (classOf(name) === "mutate") await tabs.markEdited();

  const run = (src) => cdp.evaluate(tabId, src, true);

  try {
    switch (name) {
      // These act on YUZAL's tab, not the one on screen.
      case "navigate": await tabs.agentNavigate(a.url); return ok(name, a.url);
      case "back": await tabs.agentBack(); return ok(name, "");
      case "forward": await tabs.agentForward(); return ok(name, "");
      case "reload": await tabs.agentReload(); return ok(name, "");
      case "new_tab": {
        // If you are watching Yuzal work, a tab it opens comes to the front.
        // If it is working on a page you are not looking at, the new tab
        // stays in the background: the agent gets it, you keep your screen.
        const watching = tabs.state.agentTabId == null || tabs.state.agentTabId === tabs.state.activeId;
        const id = await tabs.createTab(a.url || "about:blank", { background: !watching });
        if (id != null) tabs.setAgentTab(id);
        await sleep(400);
        return id != null ? ok(name, a.url || "") : bad(name, "could not open a tab");
      }
      case "close_tab": await tabs.closeTab(tabs.state.agentTabId ?? tabs.state.activeId); return ok(name, "");
      case "switch_tab": {
        const list = await tabs.listTabs();
        const t = list[a.index];
        if (!t) return bad(name, "no tab " + a.index);
        const watching = tabs.state.agentTabId == null || tabs.state.agentTabId === tabs.state.activeId;
        tabs.setAgentTab(t.id);
        if (watching) await tabs.switchTab(t.id);
        return ok(name, "tab " + a.index);
      }
      case "wait": await sleep(Math.min(Number(a.ms) || 500, 5000)); return ok(name, (a.ms || 500) + "ms");

      case "click_index": return receipt(name, await domActByIndex(tabId, a.index, "click"));
      case "fill_index": return receipt(name, await domActByIndex(tabId, a.index, "fill", a.value));
      case "select_index": return receipt(name, await domActByIndex(tabId, a.index, "select", a.value));
      case "hover_index": return receipt(name, await domActByIndex(tabId, a.index, "hover"));
      case "submit_index": return receipt(name, await domActByIndex(tabId, a.index, "submit"));

      case "click": return receipt(name, await run(domActBySelectorOrText({ selector: a.selector, text: a.text, op: "click" })));
      case "fill": return receipt(name, await run(domActBySelectorOrText({ selector: a.selector, op: "fill", value: a.value })));
      case "type": return receipt(name, await run(domActBySelectorOrText({ op: "type", value: a.value })));
      case "key": return receipt(name, await run(domActBySelectorOrText({ op: "key", key: a.key })));
      case "submit": return receipt(name, await run(domActBySelectorOrText({ selector: a.selector, op: "submit" })));
      case "select": return receipt(name, await run(domActBySelectorOrText({ selector: a.selector, op: "select", value: a.value })));
      case "hover": return receipt(name, await run(domActBySelectorOrText({ selector: a.selector, op: "hover" })));
      case "extract": return receipt(name, await run(domActBySelectorOrText({ selector: a.selector, op: "extract" })));
      case "scroll": return receipt(name, await run(domActBySelectorOrText({ op: "scroll", direction: a.direction, x: a.x, y: a.y })));
      case "highlight": return ok(name, "(noop)");
      case "dismiss_overlay": return receipt(name, await run(domActBySelectorOrText({ selector: a.selector, op: "click" })));

      case "click_xy": {
        const pt = [Number(a.x), Number(a.y)];
        if (pt.some(Number.isNaN)) return bad(name, "needs numeric x and y");
        const [[x, y]] = await toViewportPoints(tabId, ctx, [pt]);
        await cdp.mouseClick(tabId, x, y); await sleep(300);
        return ok(name, `(${a.x},${a.y})`);
      }
      case "drag_xy": {
        const pts = [[Number(a.x1), Number(a.y1)], [Number(a.x2), Number(a.y2)]];
        if (pts.flat().some(Number.isNaN)) return bad(name, "needs numeric x1, y1, x2 and y2");
        const [[x1, y1], [x2, y2]] = await toViewportPoints(tabId, ctx, pts);
        await cdp.mouseDrag(tabId, x1, y1, x2, y2); await sleep(300);
        return ok(name, `(${a.x1},${a.y1})->(${a.x2},${a.y2})`);
      }

      case "capture_screenshot": {
        // A picture of the visible part of the page, saved in the chat folder,
        // with a Save button for the user.
        const b64 = (await perception.capture(tabId)).b64 || await cdp.captureViewport(tabId);
        if (!b64) return bad(name, "could not capture the page");
        let fn = (a.filename || "").trim();
        if (!/\.(png|jpe?g)$/i.test(fn)) fn = `capture_${Date.now()}.png`;
        try {
          const res = await backend.postGenerateFile({ filename: fn, content: b64, encoding: "base64", mime: "image/png" });
          if (res && res.ok) {
            const dlName = res.original_name || res.name;
            if (ctx.emit) ctx.emit({ type: "download", name: dlName, path: res.path, mime: res.mime, size: res.size });
            return ok(name, "captured " + dlName);
          }
          return bad(name, (res && res.error) || "save failed");
        } catch (e) { return bad(name, String(e)); }
      }

      case "upload_file": {
        // A page cannot set input.files from script; CDP can. The file never
        // passes through the model: it names a path, Chromium reads it.
        // Jeep refused a path that was not a file on disk. An extension cannot
        // look at the disk, so that check is Chromium's now: a missing file
        // reaches the page as an empty one, and the receipt says which.
        const paths = (Array.isArray(a.paths) ? a.paths : [a.path]).filter(Boolean);
        if (!paths.length) return bad(name, "no file given");
        const selector = a.selector || "input[type=file]";
        try {
          const nodeId = await cdp.backendNodeFor(tabId, selector);
          if (!nodeId) return bad(name, `no file field matched ${selector}`);
          await cdp.setFileInputFiles(tabId, nodeId, paths);
          const shown = paths.map((f) => f.split(/[\\/]/).pop()).join(", ");
          return ok(name, `attached ${shown}`);
        } catch (e) {
          return bad(name, String((e && e.message) || e));
        }
      }

      case "login":
        // TizCat keeps passwords in Chromium's own password manager, which no
        // extension can read, and that is as it should be. The model is told
        // so, and the person signs in with one click on their saved account.
        return bad(name, "TizCat keeps passwords in its own password manager, which Yuzal "
                       + "cannot see. Ask the user to click the sign-in field and pick their "
                       + "saved account, then continue.");

      case "remember": {
        const text = (a.text || a.fact || a.note || "").trim();
        if (!text) return bad(name, "nothing to remember");
        // "note" for anything tied to a date, "fact" for what stays true.
        const kind = a.kind === "fact" ? "fact" : "note";
        try {
          const page = await tabs.getTab(tabs.state.agentTabId ?? tabs.state.activeId);
          const where = (page && page.url) || "";
          // When the model says where a fact came from, believe it. When it
          // does not, record where it was recorded, and say exactly that.
          const source = a.source || (where ? `recorded while on ${where}` : "recorded in chat");
          const res = await backend.postMemory({ text, kind, source: source.slice(0, 300) });
          if (res && res.ok) return ok(name, `${kind}: ${text.slice(0, 60)}`);
          return bad(name, (res && res.error) || "not stored");
        } catch (e) {
          return bad(name, String(e.message || e));
        }
      }

      case "report_only": return ok(name, (a.message || "").slice(0, 80));
      case "ask_user": return ok(name, (a.question || "").slice(0, 80));
      case "generate_file": {
        try {
          const res = await backend.postGenerateFile({
            filename: a.filename, content: a.content,
            encoding: a.encoding || "text", mime: a.mime || "",
          });
          if (res && res.ok) {
            const dlName = res.original_name || res.name;
            if (ctx.emit) ctx.emit({ type: "download", name: dlName, path: res.path, mime: res.mime, size: res.size });
            return ok(name, "created " + dlName);
          }
          return bad(name, (res && res.error) || "generate failed");
        } catch (e) {
          return bad(name, String(e));
        }
      }
      default: return bad(name, "unknown action");
    }
  } catch (e) {
    return bad(name, String((e && e.message) || e));
  }
}

export function ok(name, detail) { return { name, ok: true, detail: detail || "", line: `✓ ${name}${detail ? ": " + detail : ""}` }; }
export function bad(name, detail) { return { name, ok: false, detail: detail || "", line: `✗ ${name}: ${detail || ""}` }; }
function receipt(name, res) { return (res && res.ok) ? ok(name, res.detail) : bad(name, (res && res.detail) || "failed"); }

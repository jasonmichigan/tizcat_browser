// Yuzal's side panel in Jib. This is the Yuzal half of Jeep's renderer
// (renderer/ui.js): the chat, the engine and effort pickers, voice, files,
// the CSV task runner and schedules. The code is Jeep's wherever it could
// be; what Jeep's main process did behind window.jeep is done here instead,
// through Chromium's extension APIs (see `jeep` below).
import * as agent from "./lib/agent.js";
import * as actuator from "./lib/actuator.js";
import * as tabs from "./lib/tabs.js";
import * as cdp from "./lib/cdp.js";
import * as backend from "./lib/backend.js";

const $ = (sel) => document.querySelector(sel);

const els = {
  chat: $("#chat"),
  status: $("#status"),
  statusText: $("#status-text"),
  timer: $("#status-timer"),
  input: $("#input"),
  engine: $("#engine"),
  effort: $("#effort"),
  readonly: $("#readonly"),
  langBadge: $("#lang-badge"),
  backendLight: $("#backend-light"),
  panel: $("#panel"),
};

let busy = false;
let backendUrl = backend.BACKEND_URL;

// ---- CSV task runner: drive Yuzal through a list of tasks ----
let pendingTasks = null;   // {name, ext, text} of the most recently uploaded task list (csv/txt/md/docx)
let taskRunning = false;   // a CSV task run is in progress
let taskAbort = false;     // Stop pressed during a run
let taskCapture = null;    // accumulates the current task's reply/receipts/downloads
let scheduleJob = null;    // {timer, everyMs, task, csvName, runs, ticking, linkShown}

// ---- Voice (single toggle). ON: you talk OR type and Yuzal speaks back.
//      OFF: text-only chat, no mic, no spoken replies. ----
let voiceMode = false;            // the one Voice toggle
let ttsSpeaking = false;          // Yuzal is currently talking
let ttsAudio = null;
// FULL-DUPLEX: the mic keeps listening even while Yuzal talks. Yuzal's own
// voice is removed by the browser's echo canceller and by a content guard
// that drops any transcript matching what Yuzal just said.
let recentSpeechLower = "";       // normalized text Yuzal is currently/just spoke
let recentSpeechUntil = 0;        // guard stays active until this time after speech ends
const ECHO_TAIL_MS = 1600;        // keep the echo guard live this long after TTS ends

// Local speech-to-text: record while you talk, then the backend transcribes
// it with Whisper.
let mediaRecorder = null, recChunks = [], recording = false;
let lastVoiceTs = 0, segStartTs = 0;
let transcribing = false, segTimer = null;   // one-at-a-time guard + hard length cap
let pendingClips = [];    // utterances captured while Yuzal was busy -> processed in order
// Adaptive VAD: track the ambient noise floor and trigger on speech that rises
// clearly above it.
let noiseFloor = 0.02;            // running estimate of ambient level (EMA)
let segCapturedWhileSpeaking = false;  // tag clips recorded during TTS (stricter echo check)
const FLOOR_ALPHA = 0.05;         // how fast the noise-floor estimate adapts
const SILENCE_MS = 650;           // trailing silence that ends an utterance
const MIN_SPEECH_MS = 350;        // ignore blips shorter than this
const MAX_SEG_MS = 15000;         // safety cap only (real boundary is silence now)

// ---------------------------------------------------------------------------
// What Jeep's preload offered, done here
//
// In Jeep these went over IPC to the main process, which owned the tabs, the
// agent and the file dialogs. In Jib the agent runs in this page, Chromium
// owns the tabs, and saving goes through Chromium's own download dialog.
// ---------------------------------------------------------------------------
const jeep = {
  send: (text, opts) => agent.run({ text, opts }, onAgentEvent),
  stop: () => agent.requestStop(),
  attachAgent,
  snapshot,
  saveGenerated,
  keepAwake(on) {
    try { if (on) chrome.power.requestKeepAwake("display"); else chrome.power.releaseKeepAwake(); } catch { /* ignore */ }
  },
  // The actuator holds the read-only and never-submit defaults.
  applySettings(s) {
    actuator.setReadOnly(!!s.read_only);
    actuator.setNoSubmit(s.no_submit !== false);
  },
};

// Move Yuzal to a tab (the one on screen unless told otherwise). A run in
// flight is stopped first: the point of moving it is that you want it on the
// new page. `ifUnset` is how opening the panel asks: attach to what you are
// looking at, but never take Yuzal off a page it is already on.
async function attachAgent({ id = null, ifUnset = false } = {}) {
  const st = tabs.state;
  if (ifUnset && st.agentTabId != null) return st.agentTabId;
  const target = id != null ? id : st.activeId;
  if (target == null) return st.agentTabId;
  if (st.agentTabId !== target && st.busy) agent.requestStop();
  tabs.setAgentTab(target);
  return target;
}

// A file name Chromium's download API accepts.
function safeName(name, fallback) {
  const n = String(name || "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return n || fallback;
}

// Chromium's own Save dialog, for something already in memory.
async function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename: name, saveAs: true });
    return { ok: true, name };
  } catch (e) {
    const msg = String((e && e.message) || e);
    return /cancel/i.test(msg) ? { ok: false, canceled: true } : { ok: false, error: msg };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

// A Yuzal-generated file the backend already wrote: Save it where you choose.
async function saveGenerated({ path, name }) {
  if (!path) return { ok: false, error: "no file path" };
  try {
    await chrome.downloads.download({
      url: backend.downloadUrl(path), filename: safeName(name, "file"), saveAs: true,
    });
    return { ok: true, name };
  } catch (e) {
    const msg = String((e && e.message) || e);
    return /cancel/i.test(msg) ? { ok: false, canceled: true } : { ok: false, error: msg };
  }
}

// Full-page screenshot -> PDF, of the tab on screen. The backend builds the
// PDF in memory; Chromium's Save dialog decides where it goes.
async function snapshot() {
  const tabId = tabs.state.activeId;
  if (tabId == null) return { ok: false, error: "no active tab" };
  try {
    const b64 = await cdp.captureFullPage(tabId);
    if (!b64) return { ok: false, error: "could not capture the page" };
    const dims = await cdp.evaluate(tabId,
      "({clientWidth:document.documentElement.clientWidth," +
      "clientHeight:document.documentElement.clientHeight," +
      "scrollWidth:document.documentElement.scrollWidth," +
      "scrollHeight:document.documentElement.scrollHeight," +
      "devicePixelRatio:window.devicePixelRatio})", false);
    const t = await tabs.getTab(tabId);
    const res = await backend.postSnapshot({
      captures: [{ image: b64, y_offset: 0 }],
      page_dims: dims,
      page_info: { url: (t && t.url) || "", title: (t && t.title) || "" },
    });
    if (!res || !res.ok || !res.pdf_b64) return { ok: false, error: (res && res.error) || "could not build PDF" };
    const bytes = Uint8Array.from(atob(res.pdf_b64), (c) => c.charCodeAt(0));
    return await downloadBlob(new Blob([bytes], { type: "application/pdf" }),
                              safeName(res.suggested_name, "webpage.pdf"));
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    if (!tabs.state.busy) cdp.detach(tabId);
  }
}

// ---------------------------------------------------------------------------
// Starting up
// ---------------------------------------------------------------------------
window.addEventListener("load", init);

async function init() {
  setYuzalReady(false);         // the Ai mark starts GRAY until the backend is live
  await tabs.init();
  tabs.onChange(renderAgentBar);
  // Opening the panel attaches Yuzal to the page you are looking at, unless
  // it is already on one.
  await attachAgent({ ifUnset: true });
  populateMicDevices();
  loadSettings().catch(() => {}); // best-effort; re-runs once the backend is up
  pollBackendReady();            // flips the Ai mark gray -> lit when Yuzal is ready
  takePendingAsk();
}

// Settings saved in the Ai settings tab reach this panel straight away.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "yuzal-settings") loadSettings().catch(() => {});
});

// Everything the settings window can change, kept in one place so the panel,
// the send path and the startup apply all read the same object.
let settings = {};
let maxSteps = 6;
let _voiceAutoStarted = false;   // 'Voice on at startup' fires once, not on every reload

// Load persisted settings (settings.json, created with defaults if missing).
async function loadSettings() {
  try {
    const r = await fetch(backendUrl + "/api/settings");
    const d = await r.json();
    const s = (d && d.settings) || {};
    settings = s;
    loadEngines().catch(() => {});   // real models, not the four static ones
    if (s.mic_device_id != null) selectedMicId = s.mic_device_id;
    if (s.tts_voice) selectedVoice = s.tts_voice;
    if (s.language) setLangBadge(s.language);
    applySettings(s);
  } catch { /* ignore */ }
}

// Apply the visual + behavioral settings to the live panel. Safe to call twice.
function applySettings(s) {
  if (!s || typeof s !== "object") return;
  applyLook(s);   // theme, density, font size, browser color
  if (s.max_steps) maxSteps = Math.max(1, Math.min(30, Number(s.max_steps) || 6));
  if (els.readonly && s.read_only != null) els.readonly.checked = !!s.read_only;
  if (s.default_engine && [...els.engine.options].some((o) => o.value === s.default_engine)) {
    els.engine.value = s.default_engine;
  }
  syncEffort(s.effort || "");
  jeep.applySettings(s);

  // "Turn Voice on when Yuzal starts". Done by clicking the real button so
  // the mic capture, the voice bar and the label all come up through the one
  // path that already handles them. Only on the first load.
  if (s.speak_replies && !voiceMode && !_voiceAutoStarted) {
    _voiceAutoStarted = true;
    const b = $("#btn-voice");
    if (b) b.click();
  }
}

// Themes whose chrome is light, so a color knows which of its two sets to use.
const LIGHT_THEMES = new Set(["light", "sepia"]);

function applyLook({ theme, density, font_size, chrome_color, tint_panel }) {
  const r = document.documentElement;
  if (theme) {
    r.setAttribute("data-theme", theme);
    r.toggleAttribute("data-lightui", LIGHT_THEMES.has(theme));
  }
  if (density) r.setAttribute("data-density", density);
  if (font_size) r.style.setProperty("--ui-font", font_size + "px");
  // "khaki" is the ABSENCE of a color: setting it on the root would override
  // the theme it is supposed to be following.
  const c = chrome_color || "khaki";
  if (c === "khaki") r.removeAttribute("data-chrome");
  else r.setAttribute("data-chrome", c);
  if (c !== "khaki" && tint_panel !== false) r.setAttribute("data-tint", c);
  else r.removeAttribute("data-tint");
}

// ---------- "Ask Yuzal about this" from the page's right-click menu ----------
// The composer is FILLED, not sent: the menu knows what you are asking about
// but not what you want to know.
let _lastAskAt = 0;

async function takePendingAsk() {
  try {
    const { yuzalAsk } = await chrome.storage.session.get("yuzalAsk");
    if (yuzalAsk) handleAsk(yuzalAsk);
  } catch { /* ignore */ }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.yuzalAsk && changes.yuzalAsk.newValue) {
    handleAsk(changes.yuzalAsk.newValue);
  }
});

function handleAsk(ask) {
  if (!ask || ask.windowId !== tabs.state.windowId || ask.at <= _lastAskAt) return;
  _lastAskAt = ask.at;
  chrome.storage.session.remove("yuzalAsk").catch(() => {});
  // Page-level questions need Yuzal on that page to answer them.
  if (ask.moveTo != null) attachAgent({ id: ask.moveTo });
  els.input.value = ask.text;
  autoGrowInput();
  els.input.focus();
  els.input.setSelectionRange(els.input.value.length, els.input.value.length);
  els.input.scrollTop = els.input.scrollHeight;
}

// ---------- file attachments (ask Yuzal about uploaded files) ----------
$("#btn-attach").onclick = () => $("#file-input").click();
$("#file-input").onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = "";               // allow re-selecting the same file later
  for (const f of files) await uploadFile(f);
};

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

const TASKLIST_EXTS = /\.(csv|txt|md|docx)$/i;

async function uploadFile(file) {
  setStatus("attaching " + file.name + "…");
  const extMatch = (file.name.match(/\.([a-z0-9]+)$/i) || [])[1] || "";
  const isTaskFile = TASKLIST_EXTS.test(file.name);
  try {
    const dataUrl = await fileToDataURL(file);
    const r = await fetch(backendUrl + "/api/attach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, data_b64: dataUrl }),
    });
    const res = await r.json();
    if (res.ok) {
      addUploadBubble(res.name || file.name);
      // A CSV / TXT / MD / DOCX can be a TASK LIST run through the agent.
      if (isTaskFile && res.content) {
        pendingTasks = { name: res.name || file.name, ext: extMatch.toLowerCase(), text: res.content };
        addNoteBubble('Tip: say "run these tasks in the browser, step by step" to have '
          + 'Yuzal do them on the page. (For web research only, say "…give me the results CSV".)');
      }
    } else {
      addBubble("assistant", "📎 Couldn't attach " + file.name + ": " + (res.error || res.status || "unsupported"));
    }
  } catch (err) {
    addBubble("assistant", "📎 Attach failed: " + err.message);
  }
  setStatus("");
}

// An uploaded file, shown in the conversation. In Jeep clicking it saved a
// copy; the backend only serves files it generated, and you already have
// this one, so in Jib it is a label.
function addUploadBubble(name) {
  const b = document.createElement("div");
  b.className = "bubble user";
  b.textContent = "📎 Uploaded: " + name;
  els.chat.appendChild(b);
  els.chat.scrollTop = els.chat.scrollHeight;
}

// ---------- Yuzal's tab ----------
// The bar appears only when Yuzal is somewhere other than where you are.
async function renderAgentBar() {
  const bar = $("#agent-tab-bar");
  if (!bar) return;
  const st = tabs.state;
  const away = st.agentTabId != null && st.agentTabId !== st.activeId;
  bar.classList.toggle("hidden", !away);
  bar.classList.toggle("busy", st.busy);
  if (!away) return;
  const t = await tabs.getTab(st.agentTabId);
  bar.querySelector(".atb-text").textContent =
    (st.busy ? "Working on: " : "Reading: ") + ((t && (t.title || t.url)) || "another tab");
}

$("#btn-agent-move").onclick = () => attachAgent({});

// ---------- Yuzal readiness (gray Ai mark -> lit) ----------
// Yuzal's backend (its brain) may still be warming up. The Ai mark stays
// GRAY until the backend answers /api/health, then turns RED.
let yuzalReady = false;
let _settingsReloaded = false;
let _offlineSince = Date.now();
let _offlineNoted = false;

function setYuzalReady(ready, info) {
  yuzalReady = ready;
  const mark = $("#panelhead .logo");
  if (mark) mark.classList.toggle("ready", ready);
  if (els.backendLight) {
    els.backendLight.className = ready ? "light ok" : "light loading";
    els.backendLight.title = ready
      ? "Yuzal online" + (info && info.claude_cli ? " · claude CLI detected" : " · claude CLI NOT found")
      : "Yuzal is starting up…";
  }
}

async function pollBackendReady() {
  const info = await backend.health();
  if (info && info.ok) {
    if (!yuzalReady) setYuzalReady(true, info);
    _offlineSince = 0;
    if (!_settingsReloaded) { _settingsReloaded = true; loadSettings().catch(() => {}); }
    setTimeout(pollBackendReady, 15000);   // slow heartbeat once ready
  } else {
    if (yuzalReady) setYuzalReady(false);
    if (!_offlineSince) _offlineSince = Date.now();
    // Jeep started the backend itself. TizCat cannot (an extension may not
    // start programs), so after a while say how it gets started, once.
    if (!_offlineNoted && Date.now() - _offlineSince > 8000) {
      _offlineNoted = true;
      addNoteBubble("Yuzal's brain (Jeep's Python backend) is not running. Start TizCat from "
        + "its desktop shortcut (or tizcat\\scripts\\run.ps1) and it starts with it, or run: "
        + "python web_dashboard.py with JEEP_NO_BROWSER=1.");
    }
    setTimeout(pollBackendReady, 1000);    // poll quickly until ready
  }
}

// ---------- chat / agent ----------
$("#btn-send").onclick = () => send();
$("#btn-stop").onclick = () => stopEverything();
$("#btn-aiset").onclick = () => chrome.runtime.openOptionsPage();
$("#btn-threads").onclick = () => openThreads();

// Full-page screenshot -> PDF. Independent of the chat busy state.
$("#btn-snap").onclick = async () => {
  setStatus("capturing full-page PDF…");
  try {
    const res = await jeep.snapshot();
    if (res && res.ok) {
      addReceipt("✓ saved PDF: " + (res.name || "webpage"), true);
    } else if (res && res.canceled) {
      setStatus("snapshot canceled");
      setTimeout(() => setStatus(""), 1500);
      return;
    } else {
      addReceipt("✗ snapshot: " + ((res && res.error) || "failed"), false);
    }
  } catch (e) {
    addReceipt("✗ snapshot: " + e.message, false);
  }
  setStatus("");
};

// ---------------------------------------------------------------------------
// Sizing the composer
//
// The field grows with what you type, and can be dragged taller by its top
// edge. (The panel's width is Chromium's to set now.)
// ---------------------------------------------------------------------------
const INPUT_MIN_H = 44;

// A height you chose by dragging wins over the automatic one, until you drag
// it back to the bottom.
let _inputManualH = Number(localStorage.getItem("jeepInputH")) || 0;

// Never more than this, or the box swallows the conversation it belongs to.
function inputMaxH() {
  const panelH = els.panel.getBoundingClientRect().height || window.innerHeight;
  return Math.max(120, Math.round(panelH * 0.55));
}

function autoGrowInput() {
  const ta = els.input;
  if (!ta) return;
  const ceiling = inputMaxH();
  ta.style.maxHeight = ceiling + "px";
  if (_inputManualH) {
    ta.style.height = Math.min(_inputManualH, ceiling) + "px";
    return;
  }
  // Measured from nothing, so it shrinks again when the text is deleted.
  ta.style.height = "auto";
  const want = Math.max(ta.scrollHeight, INPUT_MIN_H);
  ta.style.height = Math.min(want, inputMaxH()) + "px";
}

els.input.addEventListener("input", autoGrowInput);

function setInputHeight(h, persist) {
  const v = Math.round(Math.max(INPUT_MIN_H, Math.min(h, inputMaxH())));
  _inputManualH = v;
  els.input.style.height = v + "px";
  if (persist) localStorage.setItem("jeepInputH", String(v));
  return v;
}

function clearInputHeight() {
  _inputManualH = 0;
  localStorage.removeItem("jeepInputH");
  autoGrowInput();
}

let _inputDrag = null;
const _inputGrip = document.getElementById("input-grip");
if (_inputGrip) {
  _inputGrip.addEventListener("mousedown", (e) => {
    e.preventDefault();
    _inputDrag = { startY: e.clientY, startH: els.input.offsetHeight };
    document.body.classList.add("row-resizing");
  });
  _inputGrip.addEventListener("dblclick", clearInputHeight);
}

window.addEventListener("mousemove", (e) => {
  if (!_inputDrag) return;
  // Up is taller, because the box grows upwards from the buttons.
  setInputHeight(_inputDrag.startH + (_inputDrag.startY - e.clientY), false);
});

function endInputDrag() {
  if (!_inputDrag) return;
  _inputDrag = null;
  document.body.classList.remove("row-resizing");
  if (els.input.offsetHeight <= INPUT_MIN_H + 2) clearInputHeight();
  else setInputHeight(els.input.offsetHeight, true);
}

window.addEventListener("mouseup", endInputDrag);
window.addEventListener("blur", endInputDrag);
window.addEventListener("resize", autoGrowInput);
autoGrowInput();

els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});

// The shortcut every other app uses for settings.
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === ",") {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  }
});

// An option's value is "engine|mode|model"; a saved two-part value from an
// older settings.json still parses, with an empty model meaning "let the
// backend pick".
function currentEngineMode() {
  const [engine, mode, model] = (els.engine.value || "claude|fast").split("|");
  return { engine, mode: mode || "fast", model: model || "" };
}

// How a model is described in the dropdown, in characters, because nothing
// inside an <option> can be styled:
//   strength  biceps. Three is the strongest thing on the list.
//   price     one dollar per step, and NOTHING for a model on this PC
//   speed     lightning. Three bolts is the quickest on the list.
const BICEP = "\u{1F4AA}";
const BOLT = "\u{26A1}";
const LEVEL_WORDS = ["low", "medium", "high"];
const meterStep = (v) => (v >= 85 ? 2 : v >= 55 ? 1 : 0);
const glyphs = (g, v) => g.repeat(meterStep(v) + 1);

function engineOptionText(e) {
  const bits = [e.label];
  if (Number.isFinite(e.strength) && e.strength > 0) bits.push(glyphs(BICEP, e.strength));
  const money = "$".repeat(Math.max(0, Math.min(3, Number(e.price) || 0)));
  if (money) bits.push(money);
  if (Number.isFinite(e.speed) && e.speed > 0) bits.push(glyphs(BOLT, e.speed));
  return bits.join("  ");
}

// Counted glyphs say which is bigger, not how big, so each option spells
// itself out on hover.
function engineOptionTitle(e) {
  const parts = [e.label];
  const rung = (v) => `${LEVEL_WORDS[meterStep(v)]} (${meterStep(v) + 1} of 3)`;
  if (Number.isFinite(e.strength) && e.strength > 0) parts.push(`strength: ${rung(e.strength)}`);
  if (Number.isFinite(e.speed) && e.speed > 0) parts.push(`speed: ${rung(e.speed)}`);
  const p = Math.max(0, Math.min(3, Number(e.price) || 0));
  parts.push(p ? `cost: ${"$".repeat(p)}` : "cost: nothing (runs on this PC)");
  if (e.note) parts.push(e.note);
  if (e.vision === true) parts.push("can see the page");
  else if (e.vision === false) parts.push("text only - a visual question runs on a model that can see");
  if (e.thinking) parts.push("can think before answering - switch it on under Effort");
  if (!e.available && e.reason) parts.push(e.reason);
  return parts.join("\n");
}

// Start loading a local model the moment it is picked, so reading its weights
// off disk happens while you type rather than after you press Send.
function warmLocal(value) {
  const [engine, , model] = (value || "").split("|");
  if (engine !== "local-ai" || !model) return;
  fetch(backendUrl + "/api/local-warm", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  }).catch(() => { /* it will load on the first question instead */ });
}

async function loadEngines(refresh) {
  let list = [];
  try {
    const r = await fetch(backendUrl + "/api/engines" + (refresh ? "?refresh=1" : ""));
    const d = await r.json();
    list = (d && d.engines) || [];
  } catch { return; }
  if (!list.length) return;

  const keep = els.engine.value;
  els.engine.innerHTML = "";
  let group = null, groupName = null;
  for (const e of list) {
    if (e.group !== groupName) {
      groupName = e.group;
      group = document.createElement("optgroup");
      group.label = groupName;
      els.engine.appendChild(group);
    }
    const o = document.createElement("option");
    o.value = `${e.engine}|${e.mode}|${e.model}`;
    o.textContent = engineOptionText(e);
    o.title = engineOptionTitle(e);
    // An unavailable entry is shown, not hidden.
    o.disabled = !e.available;
    group.appendChild(o);
  }

  // Restore the previous choice, from the live dropdown OR the saved setting.
  // A value saved before the dropdown listed real models has only two parts,
  // so fall back to matching on the engine and mode. Failing that, prefer the
  // quick Claude entry over the first in the list, the most expensive one.
  const saved = (settings && settings.default_engine) || "";
  const opts = [...els.engine.options].filter((o) => !o.disabled);
  const exact = opts.find((o) => o.value === keep)
    || (saved ? opts.find((o) => o.value === saved) : null);
  const want = saved || keep;
  const byPrefix = !exact && want
    ? opts.find((o) => o.value.startsWith(want.split("|").slice(0, 2).join("|") + "|"))
    : null;
  const pick = exact || byPrefix
    || opts.find((o) => o.value.startsWith("claude|fast|"))
    || opts[0];
  if (pick) {
    els.engine.value = pick.value;
    warmLocal(pick.value);
  }
  syncEffort(settings.effort || "");
}

// ---- Effort: how hard the model thinks before answering ----
// Claude takes five named levels. A local model has one dial: anything above
// "low" turns thinking on. The list is rebuilt whenever the engine changes.
const EFFORT_CHOICES = {
  claude: [
    ["", "default"], ["low", "low"], ["medium", "medium"],
    ["high", "high"], ["xhigh", "xhigh"], ["max", "max"],
  ],
  "local-ai": [
    ["", "fast, no thinking"],
    ["high", "thorough, with thinking"],
  ],
};

function syncEffort(desired) {
  const { engine } = currentEngineMode();
  const sel = els.effort;
  if (!sel) return;
  const choices = EFFORT_CHOICES[engine] || EFFORT_CHOICES.claude;
  const before = desired !== undefined ? desired : sel.value;
  const offered = choices.map((c) => c[0]);
  const keep = offered.includes(before)
    ? before
    : before && before !== "low" && offered.includes("high") ? "high" : "";

  sel.innerHTML = "";
  for (const [value, label] of choices) {
    const o = document.createElement("option");
    o.value = value; o.textContent = label;
    sel.appendChild(o);
  }
  sel.value = keep;
  sel.title = engine !== "claude"
    ? (keep === "high"
        ? "Thinking on: slower, better reasoning"
        : "Thinking off: two to three times quicker on this machine")
    : !keep
      ? "Each model's own default"
      : `Claude runs at ${keep} effort`;
  if (keep !== before && desired === undefined) saveSettings({ effort: keep });
}

if (els.effort) els.effort.onchange = () => { saveSettings({ effort: els.effort.value }); syncEffort(els.effort.value); };
if (els.readonly) {
  els.readonly.onchange = () => {
    saveSettings({ read_only: els.readonly.checked });
    actuator.setReadOnly(els.readonly.checked);
    note(els.readonly.checked
      ? "Read-only is ON. Yuzal can read and navigate, but anything that would change a page is refused."
      : "Read-only is OFF. Yuzal can click, type and submit on your behalf.");
  };
}

$("#btn-clear").onclick = () => newChat();

// Build the effort list immediately, so the dropdown is usable before the
// backend answers.
syncEffort("");

// When the user switches the AI engine, record it in the logs and the chat
// history (the backend does the recording) and show a small note inline.
els.engine.onchange = async () => {
  const { engine, mode, model } = currentEngineMode();
  syncEffort();
  warmLocal(els.engine.value);
  saveSettings({ default_engine: els.engine.value });
  try {
    const r = await fetch(backendUrl + "/api/engine-change", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine, mode, model }),
    });
    const d = await r.json();
    if (d && d.text) addNoteBubble(d.text);
  } catch { /* ignore */ }
};

async function send(opts = {}) {
  const text = (opts.text ?? els.input.value).trim();
  if (!text || busy || taskRunning || (scheduleJob && scheduleJob.ticking)) return;

  // "switch to Persian/English/Spanish": handled here, not sent to the AI.
  const lc = parseLangCommand(text);
  if (lc) {
    els.input.value = ""; autoGrowInput();
    addBubble("user", text);
    setActiveLang(lc);
    announceLang(lc);
    return;
  }

  // "change to Full Claude" / "switch the engine to Ollama".
  const ec = parseEngineCommand(text);
  if (ec) { els.input.value = ""; autoGrowInput(); addBubble("user", text); await applyEngine(ec); return; }

  // "stop the schedule": end a running recurring job.
  if (scheduleJob && /\b(stop|cancel|end|halt|kill)\b.*\b(schedul|recurring|timer|loop|every|job)\b/i.test(text)) {
    els.input.value = ""; autoGrowInput(); addBubble("user", text); stopSchedule(); return;
  }

  // "every 10 minutes for 3 hours, check … and add a row to a CSV".
  const sch = parseSchedule(text);
  if (sch) { els.input.value = ""; autoGrowInput(); addBubble("user", text); startSchedule(sch.everyMs, sch.task, sch.durationMs); return; }

  // "run these tasks in the browser, step by step" with a task list attached.
  if (isAgentRunRequest(text)) {
    els.input.value = ""; autoGrowInput();
    addBubble("user", text);
    runTaskCsv(text);
    return;
  }

  busy = true;
  els.input.value = ""; autoGrowInput();
  addBubble("user", text);
  setStatus("…");
  startElapsed();

  const { engine, mode, model } = currentEngineMode();
  try {
    await jeep.send(text, {
      engine, mode, model,
      effort: els.effort ? els.effort.value : "",
      read_only: !!(els.readonly && els.readonly.checked),
      no_submit: settings.no_submit !== false,
      max_steps: maxSteps,
      voice_mode: voiceMode,
      reply_in: langCode(),
    });
  } catch (e) {
    addBubble("assistant", "Something went wrong: " + ((e && e.message) || e));
  }
  stopElapsed();
  busy = false;
}

function onAgentEvent(ev) {
  switch (ev.type) {
    case "status": setStatus(ev.text); break;
    case "message":
      if (ev.user_display) replaceLastUser(ev.user_display);
      addBubble("assistant", ev.text, ev.reply_lang);
      if (voiceMode && !taskRunning && ev.text) speak(ev.text, ev.reply_lang || "en");
      if (ev.reply_lang) setLangBadge(ev.reply_lang);
      if (taskCapture && ev.text) taskCapture.lastMessage = ev.text;
      break;
    case "receipt":
      addReceipt(ev.line, ev.ok);
      if (taskCapture) taskCapture.receipts.push(ev.line);
      break;
    case "receipts":
      (ev.results || []).forEach((l) => addReceipt(l, !l.startsWith("✗")));
      if (taskCapture) (ev.results || []).forEach((l) => taskCapture.receipts.push(l));
      break;
    case "download":
      addDownloadButton(ev);
      if (taskCapture) taskCapture.downloads.push(ev.name);
      break;
    case "done": setStatus(""); stopElapsed(); if (!taskRunning) busy = false; drainQueue(); break;
  }
}

// ===================== CSV TASK RUNNER =====================
// Upload a list of tasks and have Yuzal execute EACH one on the page, then
// save a results report.

function isAgentRunRequest(text) {
  if (!pendingTasks) return false;
  const m = text.toLowerCase();
  const verb = /\b(run|execute|perform|do|carry out|go through|complete|start|automate)\b/.test(m);
  const browserish = /(in the browser|on the page|step by step|task by task|one by one|each task|each step|control jeep|drive jeep|on jeep|control jib|drive jib|on jib|control tizcat|drive tizcat|on tizcat|live|interactively|these tasks|the tasks)/.test(m);
  return verb && browserish;
}

// Parse a TASK LIST from any supported file. CSV uses its columns; TXT/MD/DOCX
// treat each non-empty line as one task (stripping "1." / "-" list markers).
function parseTaskList(name, text) {
  if (/\.csv$/i.test(name || "")) return parseCsvInstructions(text);
  const out = [];
  for (const raw of (text || "").split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    line = line.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, "");
    if (!line) continue;
    out.push({ id: String(out.length + 1), instruction: line });
  }
  return out;
}

// Minimal CSV parser (handles quoted fields, commas, and newlines in quotes).
function parseCsvRows(text) {
  const rows = []; let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseCsvInstructions(text) {
  const rows = parseCsvRows(text).filter((r) => r.some((c) => (c || "").trim()));
  if (!rows.length) return [];
  const header = rows[0].map((h) => (h || "").trim().toLowerCase());
  const instrKeys = ["instruction", "instructions", "task", "tasks", "command", "prompt", "step"];
  const idKeys = ["id", "#", "no", "num", "number"];
  let start = 0, instrCol = 0, idCol = -1;
  if (header.some((h) => instrKeys.includes(h))) {
    start = 1;
    instrCol = header.findIndex((h) => instrKeys.includes(h));
    idCol = header.findIndex((h) => idKeys.includes(h));
  }
  const out = [];
  for (let i = start; i < rows.length; i++) {
    const cells = rows[i];
    const instr = ((cells[instrCol] || "") + "").trim();
    if (!instr) continue;
    const id = (idCol >= 0 ? (cells[idCol] || "").trim() : "") || String(out.length + 1);
    out.push({ id, instruction: instr });
  }
  return out;
}

// Run ONE task and wait for the whole run, capturing the final reply, the
// action receipts and any files it produced.
async function runOneTask(instruction) {
  taskCapture = { lastMessage: "", receipts: [], downloads: [] };
  addBubble("user", instruction);
  startElapsed();
  const { engine, mode, model } = currentEngineMode();
  try {
    await jeep.send(instruction, {
      engine, mode, model,
      effort: els.effort ? els.effort.value : "",
      read_only: !!(els.readonly && els.readonly.checked),
      no_submit: settings.no_submit !== false,
      max_steps: maxSteps,
      voice_mode: false, reply_in: langCode(),
    });
  } catch { /* ignore */ }
  const cap = taskCapture; taskCapture = null;
  return cap;
}

// Does a row (or the run command) ask to save the results to a file?
function isResultsRequest(text) {
  const t = (text || "").toLowerCase();
  return /\bresults?\s*(csv|file|spreadsheet)\b/.test(t)
    || /\b(save|compile|export|write|put|store|give|send|make)\b[^.]*\b(results?|answers?|findings?|output)\b[^.]*\b(csv|file|spreadsheet|sheet)\b/.test(t)
    || /\bresults?\s*(to|into|in)\s*(a\s*)?csv\b/.test(t);
}

// A row is a control DIRECTIVE (schedule / change engine / save) or a TASK.
function classifyRow(text) {
  const sc = parseSchedule(text);
  if (sc) return { type: "schedule", everyMs: sc.everyMs, durationMs: sc.durationMs, task: sc.task };
  const ec = parseEngineCommand(text);
  if (ec) return { type: "engine", value: ec };
  if (isResultsRequest(text)) return { type: "save" };
  return { type: "task", text: text.trim() };
}

async function runTaskCsv(commandText) {
  if (taskRunning || !pendingTasks) return;
  const { name, text } = pendingTasks;
  const rows = parseTaskList(name, text);
  if (!rows.length) { addBubble("assistant", "I couldn't find any tasks in " + name + "."); return; }

  // Only produce a results CSV if it's explicitly requested.
  let saveResults = isResultsRequest(commandText || "");
  let pendingScheduleDirective = null;   // started AFTER the loop (so it isn't blocked by busy)

  taskRunning = true; taskAbort = false; busy = true;
  $("#btn-stop").classList.add("on");
  addNoteBubble(`▶ Running ${name} through TizCat, step by step. Press ■ to stop.`);

  const report = [];
  for (let i = 0; i < rows.length; i++) {
    if (taskAbort) { addNoteBubble("⏹ Stopped."); break; }
    const cls = classifyRow(rows[i].instruction);
    if (cls.type === "schedule") {
      pendingScheduleDirective = cls;
      addNoteBubble("Directive: a scheduled job will start when the other tasks finish");
      continue;
    }
    if (cls.type === "engine") {
      addNoteBubble("Directive: change AI engine");
      await applyEngine(cls.value);
      continue;
    }
    if (cls.type === "save") {
      saveResults = true;
      addNoteBubble("Directive: I'll save the results to a CSV when finished");
      continue;
    }
    addNoteBubble(`Task ${report.length + 1}`);
    setStatus(`running task ${report.length + 1}…`);
    const cap = await runOneTask(cls.text);
    report.push({
      id: rows[i].id,
      instruction: cls.text,
      result: cap.lastMessage || "(no reply)",
      steps: cap.receipts.join(" | "),
      files: cap.downloads.join(" | "),
      finished_at: new Date().toISOString(),
    });
  }

  taskRunning = false; busy = false;
  $("#btn-stop").classList.remove("on");
  setStatus("");
  if (saveResults && report.length) {
    await saveTaskReport(name, report);
  } else if (report.length) {
    addNoteBubble(`✅ Done. Performed ${report.length} task(s). `
      + `(No results CSV was requested, so none was created.)`);
  }
  if (pendingScheduleDirective && !taskAbort) {
    const s = pendingScheduleDirective;
    await startSchedule(s.everyMs, s.task, s.durationMs);
  }
}

// ---- change the AI engine by prompt (typed, voice, or a CSV directive) ----
function parseEngineCommand(text) {
  const m = " " + (text || "").toLowerCase() + " ";
  const hasVerb = /\b(change|switch|set|use|turn|select|activate|go)\b/.test(m);
  const mentionsEngine = /\b(engine|model)\b/.test(m);
  const named = /(full\s*claude|efficient\s*claude|full\s*local|efficient\s*local|opus\b|ollama\b)/.test(m);
  if (!((mentionsEngine && hasVerb) || (named && hasVerb))) return null;
  if (/full\s*claude|opus|\bstrong\b/.test(m)) return "claude|strong";
  if (/efficient\s*claude|fast\s*claude/.test(m)) return "claude|fast";
  if (/efficient\s*local/.test(m)) return "local-ai|efficient";
  if (/full\s*local|ollama/.test(m)) return "local-ai|fast";
  if (/\bclaude\b/.test(m)) return "claude|fast";
  if (/\blocal\b/.test(m)) return "local-ai|fast";
  return null;
}

// Apply an engine value: update the dropdown AND record the change.
async function applyEngine(value) {
  const opt = [...els.engine.options].find((o) => o.value === value);
  if (!opt) return;
  els.engine.value = value;
  const { engine, mode, model } = currentEngineMode();
  try {
    const r = await fetch(backendUrl + "/api/engine-change", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine, mode, model }),
    });
    const d = await r.json();
    addNoteBubble((d && d.text) || ("🔧 AI engine: " + opt.textContent));
  } catch {
    addNoteBubble("🔧 AI engine: " + opt.textContent);
  }
}

// ---- scheduled (recurring) instructions ----
function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  if (s >= 3600 && s % 3600 === 0) return (s / 3600) + "h";
  if (s >= 60 && s % 60 === 0) return (s / 60) + " min";
  return s + "s";
}

function _durToMs(n, unit) {
  if (/sec/.test(unit)) return n * 1000;
  if (/hour|hr/.test(unit)) return n * 3600000;
  return n * 60000;   // minutes
}

function parseSchedule(text) {
  const low = (text || "").toLowerCase();
  const mt = low.match(/\bevery\s+(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/);
  if (!mt) return null;
  const everyMs = Math.max(_durToMs(parseInt(mt[1], 10), mt[2]), 15000);   // floor 15s
  let durationMs = 0;
  const dm = low.match(/\b(?:for|over|during)\s+(?:the\s+)?(?:next\s+)?(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/);
  if (dm) durationMs = _durToMs(parseInt(dm[1], 10), dm[2]);
  // The task = the prompt minus the scheduling phrases and the "append to a CSV" bit.
  let task = (text || "")
    .replace(/\bevery\s+\d+\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/i, "")
    .replace(/\b(for|over|during)\s+(the\s+)?(next\s+)?\d+\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/i, "")
    .replace(/(^|[.;])\s*(and\s+)?(append|add|put|save|update|record|log|write|store|compile|export)\b[^.;]*\b(row|rows|csv|file|spreadsheet|sheet)\b[^.;]*/i, "$1")
    .replace(/^[\s,;]+|[\s,;.]+$/g, "")
    .trim();
  if (!task) task = text;
  return { everyMs, durationMs, task };
}

async function appendScheduleRow(name, ts, result) {
  try {
    const r = await fetch(backendUrl + "/api/csv_append", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: name, header: ["timestamp", "result"], row: [ts, result] }),
    });
    return await r.json();
  } catch { return null; }
}

async function startSchedule(everyMs, task, durationMs) {
  if (scheduleJob) stopSchedule(true);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
  const maxRuns = durationMs ? Math.max(1, Math.round(durationMs / everyMs)) : 0;
  const startAt = Date.now();
  scheduleJob = {
    everyMs, task, durationMs, maxRuns, startAt,
    endAt: durationMs ? startAt + durationMs : 0,
    csvName: "scheduled_" + stamp + ".csv", runs: 0, ticking: false, linkShown: false,
    nextAt: startAt, timer: null,
  };
  // Keep the machine awake so the schedule keeps firing.
  jeep.keepAwake(true);
  showClock();
  const forPart = durationMs ? ` for ${fmtDur(durationMs)} (~${maxRuns} runs)` : "";
  addNoteBubble(`⏱ Scheduled: every ${fmtDur(everyMs)}${forPart} I'll run "${task}" and append a row to ${scheduleJob.csvName}. `
    + `I'm keeping the PC awake so it won't sleep through a run. Keep this panel open; say "stop the schedule" (or press ■) to end it early.`);

  const tick = async () => {
    if (!scheduleJob) return;
    if (scheduleJob.ticking || busy || taskRunning) return;   // skip if busy; the timer retries
    scheduleJob.ticking = true;
    const n = ++scheduleJob.runs;
    addNoteBubble(`⏱ Scheduled run #${n}${scheduleJob.maxRuns ? " / " + scheduleJob.maxRuns : ""} at ${new Date().toLocaleTimeString()}`);
    updateClock();
    busy = true;
    const cap = await runOneTask(scheduleJob.task);
    busy = false;
    if (!scheduleJob) return;   // stopped during the run
    const res = await appendScheduleRow(scheduleJob.csvName, new Date().toISOString(), cap.lastMessage || "(no reply)");
    if (res && res.ok && !scheduleJob.linkShown) {
      scheduleJob.linkShown = true;
      addNoteBubble("Scheduled results (this file grows each run):");
      addDownloadButton({ name: res.name, path: res.path });
    }
    scheduleJob.ticking = false;
    if ((scheduleJob.maxRuns && scheduleJob.runs >= scheduleJob.maxRuns) ||
        (scheduleJob.endAt && Date.now() >= scheduleJob.endAt)) {
      addNoteBubble(`✅ Schedule complete: ${scheduleJob.runs} run(s)${scheduleJob.durationMs ? " over " + fmtDur(scheduleJob.durationMs) : ""}. Results: ${scheduleJob.csvName}`);
      stopSchedule(true);
    }
  };

  // Wall-clock self-correcting timer: each fire is aligned to
  // startAt + k*everyMs, so it never drifts.
  const armNext = () => {
    if (!scheduleJob) return;
    const j = scheduleJob;
    const k = Math.ceil((Date.now() - j.startAt) / j.everyMs);
    let target = j.startAt + k * j.everyMs;
    if (target <= Date.now()) target += j.everyMs;
    j.nextAt = target;
    updateClock();
    j.timer = setTimeout(async () => { await tick(); armNext(); }, Math.max(250, target - Date.now()));
  };

  await tick();          // run once immediately
  armNext();
}

function stopSchedule(quiet) {
  if (!scheduleJob) return;
  if (scheduleJob.timer) clearTimeout(scheduleJob.timer);
  if (!quiet) addNoteBubble(`⏹ Stopped the schedule after ${scheduleJob.runs} run(s). Results are in ${scheduleJob.csvName}.`);
  scheduleJob = null;
  jeep.keepAwake(false);
  hideClock();
}

// ---- on-screen clock while a schedule is active ----
let _clockTimer = null;
function showClock() {
  const c = $("#sched-clock"); if (c) c.classList.remove("hidden");
  if (!_clockTimer) _clockTimer = setInterval(updateClock, 1000);
  updateClock();
}
function hideClock() {
  const c = $("#sched-clock"); if (c) c.classList.add("hidden");
  if (_clockTimer) { clearInterval(_clockTimer); _clockTimer = null; }
}
function updateClock() {
  const c = $("#sched-clock");
  if (!c) return;
  if (!scheduleJob) { hideClock(); return; }
  if (scheduleJob.ticking) { c.textContent = "⏱ running…"; c.title = "Scheduled task running now"; return; }
  const left = Math.max(0, (scheduleJob.nextAt || Date.now()) - Date.now());
  const mm = String(Math.floor(left / 60000)).padStart(2, "0");
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  const total = scheduleJob.maxRuns ? "/" + scheduleJob.maxRuns : "";
  c.textContent = `⏱ ${scheduleJob.runs}${total} · next ${mm}:${ss}`;
  c.title = `Scheduled task: ${scheduleJob.runs}${total} runs done · next in ${mm}:${ss}`;
}

async function saveTaskReport(srcName, report) {
  // CSV quoting. (Jeep's copy escaped these as HTML by mistake, which put
  // &amp; and &quot; into the spreadsheet.)
  const esc = (s) => {
    s = (s == null ? "" : String(s)).replace(/\r?\n/g, " ⏎ ");
    return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const cols = ["id", "instruction", "result", "steps", "files", "finished_at"];
  const lines = [cols.join(",")];
  for (const r of report) lines.push(cols.map((c) => esc(r[c])).join(","));
  const csv = lines.join("\n");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
  const fn = "agent_results_" + stamp + ".csv";
  try {
    const r = await fetch(backendUrl + "/api/generate_file", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: fn, content: csv, encoding: "text", mime: "text/csv" }),
    });
    const d = await r.json();
    if (d && d.ok) {
      addNoteBubble(`✅ Task run complete: ${report.length} task(s). Results saved:`);
      addDownloadButton({ name: d.original_name || d.name, path: d.path });
    } else {
      addNoteBubble("⚠ Could not save the results file: " + ((d && d.error) || "unknown error"));
    }
  } catch (e) {
    addNoteBubble("⚠ Could not save the results file: " + e.message);
  }
}

// ---------- chat helpers ----------
function addBubble(role, text, lang) {
  const b = document.createElement("div");
  b.className = "bubble " + role + (lang === "fa" ? " rtl" : "");
  b.textContent = text;
  els.chat.appendChild(b);
  els.chat.scrollTop = els.chat.scrollHeight;
  return b;
}

// A small, centered system note (e.g. an AI-engine change).
function addNoteBubble(text) {
  const b = document.createElement("div");
  b.className = "bubble note";
  b.textContent = text;
  els.chat.appendChild(b);
  els.chat.scrollTop = els.chat.scrollHeight;
  return b;
}

// Show a notice made here AND record it in the logs, so the saved transcript
// matches what's shown in the chat box.
function note(text, lang) {
  addBubble("assistant", text, lang);
  fetch(backendUrl + "/api/log-note", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "assistant", text }),
  }).catch(() => {});
}

function addReceipt(line, ok) {
  const r = document.createElement("div");
  r.className = "receipt" + (ok ? "" : " bad");
  r.textContent = line;
  els.chat.appendChild(r);
  els.chat.scrollTop = els.chat.scrollHeight;
}

// A "Save" button for a file Yuzal generated.
function addDownloadButton(ev) {
  const row = document.createElement("div");
  row.className = "dl-row";
  const btn = document.createElement("button");
  btn.className = "dl-btn";
  const baseLabel = "⬇ Save " + (ev.name || "file");
  btn.textContent = baseLabel;
  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = "Saving…";
    const res = await jeep.saveGenerated({ path: ev.path, name: ev.name });
    if (res && res.ok) {
      btn.textContent = "✓ Saved " + (res.name || ev.name);
    } else if (res && res.canceled) {
      btn.disabled = false; btn.textContent = baseLabel;
    } else {
      btn.disabled = false; btn.textContent = baseLabel + " (failed)";
    }
  };
  row.appendChild(btn);
  els.chat.appendChild(row);
  els.chat.scrollTop = els.chat.scrollHeight;
}

function replaceLastUser(text) {
  const users = els.chat.querySelectorAll(".bubble.user");
  const last = users[users.length - 1];
  if (last) { last.textContent = text; last.classList.add("rtl"); }
}

// The status line holds what Yuzal is doing and the clock.
let _statusText = "";
function setStatus(t) {
  _statusText = t || "";
  if (els.statusText) els.statusText.textContent = _statusText;
  else els.status.textContent = _statusText;
}

// ---- How long you have been waiting ----
// A model running on this PC takes tens of seconds, and without a clock there
// is nothing to tell a slow answer apart from a hung one.
let _elapsedStart = 0;
let _elapsedTick = null;
let _elapsedClear = null;

function fmtElapsed(ms) {
  const total = Math.floor(ms / 1000);
  if (total < 60) return total + "s";
  const mins = Math.floor(total / 60);
  return mins + "m " + String(total % 60).padStart(2, "0") + "s";
}

function drawElapsed() {
  if (!els.timer) return;
  els.timer.textContent = fmtElapsed(Date.now() - _elapsedStart);
}

function startElapsed() {
  if (!els.timer) return;
  if (_elapsedTick) return;
  if (_elapsedClear) { clearTimeout(_elapsedClear); _elapsedClear = null; }
  _elapsedStart = Date.now();
  els.timer.classList.remove("hidden", "settled");
  els.timer.classList.add("running");
  drawElapsed();
  _elapsedTick = setInterval(drawElapsed, 1000);
}

// Safe to call twice.
function stopElapsed() {
  if (!_elapsedTick) return;
  clearInterval(_elapsedTick);
  _elapsedTick = null;
  if (!els.timer) return;
  drawElapsed();
  els.timer.classList.remove("running");
  els.timer.classList.add("settled");
  _elapsedClear = setTimeout(() => {
    els.timer.classList.add("hidden");
    _elapsedClear = null;
  }, 6000);
}

// ---------- language badge ----------
let activeLang = "en";
function langCode() { return activeLang; }
function setLangBadge(code) {
  activeLang = code;
  els.langBadge.textContent = { en: "EN", fa: "فا", es: "ES" }[code] || "EN";
}

// ======================= VOICE (single toggle) =======================
// ON  -> mic listens continuously AND replies are spoken (you can talk or type).
// OFF -> text-only chat (no mic, no spoken replies).

function normalize(t) { return (t || "").toLowerCase().trim().replace(/\s+/g, " ").replace(/[.!,،؟?]+$/g, ""); }
const STOP_WORDS = {
  en: ["stop", "stop it", "quiet", "cancel"],
  fa: ["بس است", "بسه", "توقف", "کافیه", "ساکت"],
  es: ["para", "alto", "detente", "silencio", "cancela"],
};
function isStopUtterance(t) { const s = normalize(t); return Object.values(STOP_WORDS).some((a) => a.includes(s)); }

// ----- language switching (English / Persian / Spanish) -----
const LANG_NAME = { en: "English", fa: "Persian", es: "Spanish" };
const _LANG_WORDS = {
  en: ["english", "انگلیسی", "inglés", "ingles"],
  fa: ["persian", "farsi", "فارسی", "persa"],
  es: ["spanish", "hispanic", "español", "espanol", "اسپانیایی"],
};
function parseLangCommand(text) {
  const n = normalize(text);
  if (!n) return null;
  const isCmd =
    /\b(change|switch|talk|speak|chat|answer|respond|reply|converse|conversation|write|set|use|continue|from now)\b/.test(n) ||
    (/\b(in|to|en)\b/.test(n) && /(persian|farsi|english|spanish|hispanic|español|espanol|فارسی|انگلیسی|اسپانیایی)/.test(n)) ||
    /(تغییر|عوض|به فارسی|به انگلیسی|به اسپانیایی|صحبت|حرف بزن|گفتگو|جواب|پاسخ|بگو)/.test(n) ||
    /(cambia|cambiar|habla|hablar|responde|contesta|conversa|charla|en español|en inglés)/.test(n);
  const words = n.split(" ");
  for (const code of ["en", "fa", "es"]) {
    for (const w of _LANG_WORDS[code]) {
      if (n.includes(w) && (isCmd || words.length <= 2)) return code;
    }
  }
  return null;
}
function setActiveLang(code) { if (LANG_NAME[code]) setLangBadge(code); }
function announceLang(code) {
  const msg = {
    en: "Okay, I'll talk with you in English now.",
    fa: "باشه، از این به بعد با شما فارسی صحبت می‌کنم.",
    es: "De acuerdo, ahora hablaré contigo en español.",
  }[code] || "";
  if (msg) { addBubble("assistant", msg, code); if (voiceMode) speak(msg, code); }
}

function setVoiceBtn() {
  const b = $("#btn-voice");
  b.classList.toggle("on", voiceMode);
  b.textContent = voiceMode ? (ttsSpeaking ? "🔊 …" : (recording ? "🎤 ●" : "🎤 Voice")) : "🎤 Voice";
}

$("#btn-voice").onclick = () => {
  voiceMode = !voiceMode;
  setVoiceBtn();
  const vb = $("#voicebar");
  if (voiceMode) {
    if (vb) vb.classList.remove("hidden");
    startMeter();   // captures the mic; the VAD inside drawMeter records utterances
    setStatus("voice on, talk or type");
    setTimeout(() => { if (_statusText === "voice on, talk or type") setStatus(""); }, 2000);
  } else {
    if (vb) vb.classList.add("hidden");
    stopSegment();
    stopMeter();
    stopSpeaking();
    pendingClips = [];
    setStatus("");
  }
};

// ----- voice capture: record an utterance, transcribe it in the backend -----
function pickMime() {
  const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  for (const m of cands) { try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; } catch { /* ignore */ } }
  return "";
}

// Voice-activity detection driven by the meter level (0..1), with an
// adaptive noise floor so a noisy room does not make every clip run to the cap.
function vadTick(level) {
  if (!voiceMode) return;
  const now = Date.now();
  if (!recording) noiseFloor = (1 - FLOOR_ALPHA) * noiseFloor + FLOOR_ALPHA * level;
  const startThresh = Math.max(0.045, noiseFloor * 3 + 0.012);
  const keepThresh = Math.max(0.028, noiseFloor * 1.8 + 0.006);
  if (level > (recording ? keepThresh : startThresh)) {
    lastVoiceTs = now;
    if (!recording) startSegment();
  }
  if (recording) {
    const dur = now - segStartTs;
    if ((now - lastVoiceTs > SILENCE_MS && dur > MIN_SPEECH_MS) || dur > MAX_SEG_MS) stopSegment();
  }
}

function startSegment() {
  if (!audioStream || recording) return;
  try {
    recChunks = [];
    const mime = pickMime();
    mediaRecorder = mime ? new MediaRecorder(audioStream, { mimeType: mime }) : new MediaRecorder(audioStream);
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    mediaRecorder.onstop = onSegmentStop;
    mediaRecorder.start();
    recording = true; segStartTs = Date.now(); lastVoiceTs = Date.now();
    segCapturedWhileSpeaking = ttsSpeaking || Date.now() < recentSpeechUntil;
    if (segTimer) clearTimeout(segTimer);
    segTimer = setTimeout(() => { if (recording) stopSegment(); }, MAX_SEG_MS);
    setStatus("🎤 listening…"); setVoiceBtn();
  } catch { /* ignore */ }
}

function stopSegment() {
  if (segTimer) { clearTimeout(segTimer); segTimer = null; }
  if (mediaRecorder && recording) { try { mediaRecorder.stop(); } catch { /* ignore */ } }
  recording = false; setVoiceBtn();
}

async function onSegmentStop() {
  const chunks = recChunks; recChunks = [];
  const whileSpeaking = segCapturedWhileSpeaking;
  segCapturedWhileSpeaking = false;
  if (!voiceMode || !chunks.length) return;
  const blob = new Blob(chunks, { type: chunks[0].type || "audio/webm" });
  if (blob.size < 1500) return;   // too short -> noise
  // If Yuzal is busy, QUEUE this utterance and handle it in order later.
  if (busy || transcribing || ttsSpeaking) {
    pendingClips.push({ blob, whileSpeaking });
    setStatus(`queued (${pendingClips.length})…`);
    return;
  }
  await transcribeAndSend(blob, whileSpeaking);
}

async function sttOnce(dataUrl, lang) {
  try {
    const r = await fetch(backendUrl + "/api/stt", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio_b64: dataUrl, lang }),
    });
    const res = await r.json();
    return ((res && res.text) || "").trim();
  } catch { return ""; }
}

async function transcribeAndSend(blob, whileSpeaking) {
  transcribing = true;
  setStatus("transcribing…");
  const cur = langCode();
  let text = "", switchCode = null;
  try {
    const dataUrl = await blobToDataURL(blob);
    text = await sttOnce(dataUrl, cur);
    switchCode = parseLangCommand(text);
    // A switch command spoken in ANOTHER language gets garbled when decoded
    // as the current one, so a short clip is decoded once more in the other
    // main language, only to look for a switch.
    if (!switchCode && text.split(/\s+/).filter(Boolean).length <= 6) {
      const altLang = cur === "en" ? "fa" : "en";
      const altText = await sttOnce(dataUrl, altLang);
      const altCode = parseLangCommand(altText);
      if (altCode) { switchCode = altCode; text = altText; }
    }
  } catch { /* ignore */ }
  transcribing = false;
  setStatus("");
  if (switchCode) {
    if (switchCode !== cur) { setActiveLang(switchCode); announceLang(switchCode); }
    drainQueue();
    return;
  }
  if (text && isLikelyEcho(text, whileSpeaking)) {
    setStatus("(ignored echo)");
    setTimeout(() => { if (_statusText === "(ignored echo)") setStatus(""); }, 800);
    drainQueue();
    return;
  }
  if (!text) { drainQueue(); return; }
  if (isStopUtterance(text)) { pendingClips = []; stopEverything(); return; }
  await send({ text });
  drainQueue();
}

// Is this transcript actually Yuzal's own voice echoing back into the mic?
function isLikelyEcho(text, whileSpeaking) {
  const guardLive = ttsSpeaking || Date.now() < recentSpeechUntil;
  if (!recentSpeechLower || (!whileSpeaking && !guardLive)) return false;
  const t = normalize(text);
  if (!t) return false;
  if (t.length >= 4 && recentSpeechLower.includes(t)) return true;
  const toks = t.split(" ").filter((w) => w.length > 2);
  if (!toks.length) return false;
  const hit = toks.filter((w) => recentSpeechLower.includes(w)).length;
  return hit / toks.length >= 0.7;
}

function drainQueue() {
  if (busy || transcribing || ttsSpeaking) return;
  const item = pendingClips.shift();
  if (item) transcribeAndSend(item.blob, item.whileSpeaking);
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// ---- speech-out (neural TTS via the backend) ----
function sanitizeForSpeech(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " (code) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " a link ")
    .replace(/[*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

async function speak(text, lang) {
  const clean = sanitizeForSpeech(text);
  if (!clean) return;
  if (ttsAudio) { try { ttsAudio.onended = null; ttsAudio.onerror = null; ttsAudio.pause(); } catch { /* ignore */ } ttsAudio = null; }
  ttsSpeaking = true;
  recentSpeechLower = normalize(text);   // arm the echo guard with what we're saying
  recentSpeechUntil = Number.MAX_SAFE_INTEGER;
  setVoiceBtn();
  try {
    const r = await fetch(backendUrl + "/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean, lang: lang || "en", voice: selectedVoice || undefined }),
    });
    if (!r.ok) throw new Error("tts " + r.status);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    ttsAudio = audio;
    audio.onended = () => { URL.revokeObjectURL(url); if (ttsAudio === audio) ttsAudio = null; afterSpeech(); };
    audio.onerror = () => { URL.revokeObjectURL(url); if (ttsAudio === audio) ttsAudio = null; afterSpeech(); };
    await audio.play();
  } catch {
    afterSpeech();
  }
}

function afterSpeech() {
  ttsSpeaking = false;
  recentSpeechUntil = Date.now() + ECHO_TAIL_MS;
  setVoiceBtn();
  setTimeout(drainQueue, 120);
}

function stopSpeaking() {
  if (ttsAudio) { try { ttsAudio.onended = null; ttsAudio.onerror = null; ttsAudio.pause(); ttsAudio.src = ""; } catch { /* ignore */ } ttsAudio = null; }
  ttsSpeaking = false;
  recentSpeechUntil = Date.now() + ECHO_TAIL_MS;
  setVoiceBtn();
}

// Global stop / barge-in: cancel talking AND any in-flight agent work.
function stopEverything() {
  stopSpeaking();
  jeep.stop();
  busy = false;
  taskAbort = true;    // stop a running task list after the current task
  stopSchedule();      // end any recurring scheduled job
  pendingClips = [];
  stopElapsed();
  setStatus("stopped");
  setTimeout(() => { if (_statusText === "stopped") setStatus(""); }, 1200);
}

// ---- microphone level meter + device picker ----
let audioStream = null, audioCtx = null, analyser = null, meterRaf = 0;
let selectedMicId = "", selectedVoice = "";

async function populateMicDevices() {
  const sel = $("#mic-device");
  if (!sel) return;
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const mics = devs.filter((d) => d.kind === "audioinput");
    sel.innerHTML = "";
    mics.forEach((m, i) => {
      const o = document.createElement("option");
      o.value = m.deviceId;
      o.textContent = m.label || ("Microphone " + (i + 1));
      sel.appendChild(o);
    });
    if (selectedMicId && [...sel.options].some((o) => o.value === selectedMicId)) sel.value = selectedMicId;
    selectedMicId = sel.value || selectedMicId || "";
  } catch { /* ignore */ }
}

// Mic constraints with the browser's voice processing ON. echoCancellation is
// what lets us listen while Yuzal talks without hearing her own voice.
function micConstraints() {
  const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  if (selectedMicId) audio.deviceId = { exact: selectedMicId };
  return { audio };
}

function startMeter() {
  stopMeter();
  noiseFloor = 0.02;
  navigator.mediaDevices.getUserMedia(micConstraints()).then((stream) => {
    audioStream = stream;
    populateMicDevices();
    audioCtx = new AudioContext();
    const src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    src.connect(analyser);
    drawMeter();
  }).catch((e) => {
    const fill = $("#mic-meter-fill");
    if (fill) fill.style.width = "0%";
    // A side panel cannot show Chromium's "allow microphone?" question. The
    // permission is asked for once in a tab of Yuzal's own (mic.html), and
    // the panel has it from then on.
    if (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) {
      addNoteBubble("Yuzal needs your permission to use the microphone. Allow it in the tab "
        + "that just opened, then press Voice again.");
      chrome.tabs.create({ url: chrome.runtime.getURL("mic.html") });
      voiceMode = true;
      $("#btn-voice").click();   // back off; the next press starts cleanly
    }
  });
}

function drawMeter() {
  if (!analyser) return;
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (const v of data) { const x = (v - 128) / 128; sum += x * x; }
  const level = Math.min(1, Math.sqrt(sum / data.length) * 5);   // RMS -> 0..1
  const fill = $("#mic-meter-fill");
  if (fill) fill.style.width = (level * 100).toFixed(1) + "%";
  vadTick(level);
  meterRaf = requestAnimationFrame(drawMeter);
}

function stopMeter() {
  if (meterRaf) { cancelAnimationFrame(meterRaf); meterRaf = 0; }
  if (audioStream) { try { audioStream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ } audioStream = null; }
  if (audioCtx) { try { audioCtx.close(); } catch { /* ignore */ } audioCtx = null; }
  analyser = null;
  const fill = $("#mic-meter-fill");
  if (fill) fill.style.width = "0%";
}

if ($("#mic-device")) {
  $("#mic-device").onchange = () => {
    const sel = $("#mic-device");
    selectedMicId = sel.value;
    if (voiceMode) startMeter();
    const label = (sel.options[sel.selectedIndex] || {}).textContent || "";
    saveSettings({ mic_device_id: selectedMicId, mic_device_label: label });
  };
}
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", populateMicDevices);
}

async function saveSettings(patch) {
  try {
    await fetch(backendUrl + "/api/settings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch || {}),
    });
  } catch { /* ignore */ }
}

// ======================= CHAT HISTORY (🕘) =======================
// Pick a past conversation (saved in chat_history/) and keep chatting where
// you left off. Selecting a thread reloads its messages into the chat AND the
// backend conversation context.
function langOf(text) { return /[؀-ۿ]/.test(text || "") ? "fa" : undefined; }

async function newChat() {
  try { await fetch(backendUrl + "/api/threads/new", { method: "POST" }); } catch { /* ignore */ }
  els.chat.innerHTML = "";
  addBubble("assistant", "New chat started. What would you like to do?");
}

async function loadThread(id) {
  try {
    const r = await fetch(backendUrl + "/api/threads/select", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const d = await r.json();
    if (!d || !d.ok || !d.thread) return;
    els.chat.innerHTML = "";
    for (const m of (d.thread.messages || [])) {
      if (m.role === "note") { addNoteBubble(m.content || ""); continue; }
      addBubble(m.role === "user" ? "user" : "assistant", m.content || "", langOf(m.content));
    }
    const files = d.files || [];
    if (files.length) {
      addBubble("assistant", "📎 Files generated in this chat:");
      for (const f of files) addDownloadButton({ name: f.name, path: f.path });
    }
  } catch { /* ignore */ }
}

async function openThreads() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal threads-modal">' +
    '  <div class="modal-msg">Chat history</div>' +
    '  <button class="dl-btn th-new">➕ New chat</button>' +
    '  <div id="th-list" class="thread-list"></div>' +
    '  <div class="modal-btns"><button class="modal-cancel">Close</button></div>' +
    '</div>';
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector(".modal-cancel").onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  overlay.querySelector(".th-new").onclick = async () => { await newChat(); close(); };

  let threads = [];
  try { const r = await fetch(backendUrl + "/api/threads"); const d = await r.json(); threads = d.threads || []; } catch { /* ignore */ }
  const list = overlay.querySelector("#th-list");
  if (!threads.length) {
    list.innerHTML = '<div class="th-empty">No saved chats yet. Start chatting and they\'ll appear here.</div>';
    return;
  }
  for (const t of threads) {
    const item = document.createElement("div");
    item.className = "thread-item";
    const main = document.createElement("div");
    main.className = "th-main";
    const title = document.createElement("div");
    title.className = "th-title";
    title.textContent = t.title || "Chat";
    const meta = document.createElement("div");
    meta.className = "th-meta";
    meta.textContent = (t.count || 0) + " messages · " + (t.updated || "").replace("T", " ");
    main.appendChild(title); main.appendChild(meta);
    main.onclick = async () => { await loadThread(t.id); close(); };
    const del = document.createElement("span");
    del.className = "th-del";
    del.textContent = "🗑";
    del.title = "Delete";
    del.onclick = async (e) => {
      e.stopPropagation();
      try {
        await fetch(backendUrl + "/api/threads/delete", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: t.id }),
        });
      } catch { /* ignore */ }
      item.remove();
    };
    item.appendChild(main); item.appendChild(del);
    list.appendChild(item);
  }
}

// Closing the panel gives the page back.
window.addEventListener("pagehide", () => { agent.requestStop(); cdp.detachAll(); });

// For the tests: lets them read what the panel has without poking its DOM.
globalThis.__yuzal = { tabs, settings: () => settings };

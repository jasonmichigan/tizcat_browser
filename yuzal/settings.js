// Ai settings: Jeep's AI, Voice and Memory tabs (openSettings("ai") in
// renderer/ui.js), as Yuzal's options page. Everything is stored where
// Jeep stored it, in the backend's settings.json, so Jeep and Jib share it.
import { BACKEND_URL as backendUrl } from "./lib/backend.js";

const q = (sel) => document.querySelector(sel);
let settings = {};

const LIGHT_THEMES = new Set(["light", "sepia"]);
function applyLook({ theme, density, font_size }) {
  const r = document.documentElement;
  if (theme) {
    r.setAttribute("data-theme", theme);
    r.toggleAttribute("data-lightui", LIGHT_THEMES.has(theme));
  }
  if (density) r.setAttribute("data-density", density);
  if (font_size) r.style.setProperty("--ui-font", font_size + "px");
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- tabs ----
for (const btn of document.querySelectorAll(".settab")) {
  btn.onclick = () => {
    document.querySelectorAll(".settab").forEach((b) => b.classList.toggle("on", b === btn));
    document.querySelectorAll(".setpane").forEach((p) =>
      p.classList.toggle("hidden", p.dataset.pane !== btn.dataset.tab));
    if (btn.dataset.tab === "memory") loadMemory();
    if (btn.dataset.tab === "voice") startSetMeter(q("#set-mic").value);
    else stopSetMeter();
  };
}

async function load() {
  try {
    const d = await (await fetch(backendUrl + "/api/settings")).json();
    settings = (d && d.settings) || {};
  } catch {
    q("#s-saved").textContent = "The backend is not running, so nothing can be saved yet.";
    q("#s-saved").style.color = "var(--warn)";
  }
  const s = settings;
  applyLook(s);
  q("#s-effort").value = s.effort || "";
  q("#s-maxsteps").value = s.max_steps || 6;
  q("#s-readonly").checked = !!s.read_only;
  q("#s-nosubmit").checked = s.no_submit !== false;
  q("#s-speak").checked = !!s.speak_replies;
  q("#s-memon").checked = s.memory_enabled !== false;
  q("#s-memauto").checked = s.memory_auto !== false;
  const slider = (id, value, unit) => {
    q(id).value = value;
    q(id + "-val").textContent = value + " " + unit;
    q(id).oninput = () => { q(id + "-val").textContent = q(id).value + " " + unit; };
  };
  slider("#s-memfacts", s.memory_facts_kb || 10, "KB");
  slider("#s-memnotes", s.memory_notes_kb || 40, "KB");
  slider("#s-memttl", s.memory_note_ttl_days || 45, "days");
  slider("#s-memcloud", s.memory_budget_cloud_kb || 8, "KB");
  slider("#s-memlocal", s.memory_budget_local_kb || 3, "KB");

  await loadEngines(s.default_engine || "");
  await refreshSetMicOptions();
  if (s.mic_device_id) q("#set-mic").value = s.mic_device_id;
  await loadVoiceOptions(q("#set-voice"), s.tts_voice || "");
  q("#set-lang").value = s.language || "en";
  q("#set-mic").onchange = () => startSetMeter(q("#set-mic").value);
  q("#set-test").onclick = () => testVoice(q("#set-voice").value);
}

// The same list the panel shows, from the same backend call.
async function loadEngines(current) {
  const eng = q("#s-engine");
  let list = [];
  try { list = ((await (await fetch(backendUrl + "/api/engines")).json()).engines) || []; } catch { /* ignore */ }
  eng.innerHTML = "";
  if (!list.length) {
    for (const [v, t] of [["claude|fast", "Efficient (Claude)"], ["claude|strong", "Full Claude (opus + vision)"],
                          ["local-ai|efficient", "Efficient local (Ollama, fast)"], ["local-ai|fast", "Full local (Ollama)"]]) {
      const o = document.createElement("option"); o.value = v; o.textContent = t; eng.appendChild(o);
    }
  }
  let group = null, groupName = null;
  for (const e of list) {
    if (e.group !== groupName) {
      groupName = e.group;
      group = document.createElement("optgroup");
      group.label = groupName;
      eng.appendChild(group);
    }
    const o = document.createElement("option");
    o.value = `${e.engine}|${e.mode}|${e.model}`;
    o.textContent = e.label;
    o.disabled = !e.available;
    group.appendChild(o);
  }
  // The panel's rule (loadEngines in panel.js): a value saved before the list
  // named real models has two parts ("claude|fast"), so match on engine and
  // mode. Without this the first entry, Opus, showed as the default, and
  // pressing Done would have saved it.
  const opts = [...eng.options].filter((o) => !o.disabled);
  const pick = opts.find((o) => o.value === current)
    || (current ? opts.find((o) => o.value.startsWith(current.split("|").slice(0, 2).join("|") + "|")) : null)
    || opts.find((o) => o.value.startsWith("claude|fast|"))
    || opts[0];
  if (pick) eng.value = pick.value;
}

// ---- voice ----
let setStream = null, setCtx = null, setAnalyser = null, setRaf = 0;

async function refreshSetMicOptions() {
  const sel = q("#set-mic");
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const mics = devs.filter((d) => d.kind === "audioinput");
    const cur = sel.value;
    sel.innerHTML = "";
    mics.forEach((m, i) => {
      const o = document.createElement("option");
      o.value = m.deviceId;
      o.textContent = m.label || ("Microphone " + (i + 1));
      sel.appendChild(o);
    });
    if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
  } catch { /* ignore */ }
}

async function loadVoiceOptions(selectEl, current) {
  let voices = [];
  try { voices = ((await (await fetch(backendUrl + "/api/tts/voices")).json()).voices) || []; } catch { /* ignore */ }
  selectEl.innerHTML = "";
  for (const [g, label] of [["male", "Men"], ["female", "Women"]]) {
    const og = document.createElement("optgroup");
    og.label = label;
    voices.filter((v) => v.gender === g).forEach((v) => {
      const o = document.createElement("option");
      o.value = v.id;
      o.textContent = v.label;
      og.appendChild(o);
    });
    if (og.children.length) selectEl.appendChild(og);
  }
  if (current) selectEl.value = current;
}

async function testVoice(voiceId) {
  const sample = "Hi, I'm Yuzal. This is how I'll sound when I talk with you.";
  try {
    const r = await fetch(backendUrl + "/api/tts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: sample, lang: "en", voice: voiceId }),
    });
    if (!r.ok) return;
    const url = URL.createObjectURL(await r.blob());
    const a = new Audio(url);
    a.onended = () => URL.revokeObjectURL(url);
    a.play().catch(() => {});
  } catch { /* ignore */ }
}

// This is a tab, so unlike the side panel it can ask for the microphone.
function startSetMeter(deviceId) {
  stopSetMeter();
  const constraints = deviceId ? { audio: { deviceId: { exact: deviceId } } } : { audio: true };
  navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
    setStream = stream;
    refreshSetMicOptions();   // labels appear once permission is granted
    setCtx = new AudioContext();
    const src = setCtx.createMediaStreamSource(stream);
    setAnalyser = setCtx.createAnalyser();
    setAnalyser.fftSize = 256;
    setAnalyser.smoothingTimeConstant = 0.7;
    src.connect(setAnalyser);
    drawSetMeter();
  }).catch(() => {
    const f = q("#set-meter-fill"); if (f) f.style.width = "0%";
  });
}

function drawSetMeter() {
  if (!setAnalyser) return;
  const data = new Uint8Array(setAnalyser.frequencyBinCount);
  setAnalyser.getByteTimeDomainData(data);
  let sum = 0;
  for (const v of data) { const x = (v - 128) / 128; sum += x * x; }
  const level = Math.min(1, Math.sqrt(sum / data.length) * 5);
  const f = q("#set-meter-fill"); if (f) f.style.width = (level * 100).toFixed(1) + "%";
  setRaf = requestAnimationFrame(drawSetMeter);
}

function stopSetMeter() {
  if (setRaf) { cancelAnimationFrame(setRaf); setRaf = 0; }
  if (setStream) { try { setStream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ } setStream = null; }
  if (setCtx) { try { setCtx.close(); } catch { /* ignore */ } setCtx = null; }
  setAnalyser = null;
}

// ---- memory ----
async function loadMemory() {
  const host = q("#s-memlist");
  host.textContent = "Loading…";
  let d = null;
  try { d = await (await fetch(backendUrl + "/api/memory")).json(); } catch { /* offline */ }
  if (!d || !d.ok) {
    host.innerHTML = '<div class="bmempty">The backend is not up yet.</div>';
    return;
  }
  const st = d.stats || {};
  q("#s-memstatus").textContent = `${st.facts || 0} facts, ${st.notes || 0} notes`;
  const entries = d.entries || [];
  if (!entries.length) {
    host.innerHTML = '<div class="bmempty">Nothing stored yet. Yuzal adds to this when '
                   + 'something is worth carrying into a later conversation, and you can '
                   + 'ask it to remember something directly.</div>';
    return;
  }
  host.innerHTML = "";
  for (const e of entries) {
    const row = document.createElement("div");
    row.className = "memrow";
    row.innerHTML =
      `<span class="memkind ${e.kind === "fact" ? "fact" : "note"}">${e.kind === "fact" ? "fact" : escapeHtml(e.date)}</span>`
      + `<span class="memtext">${escapeHtml(e.text)}</span>`;
    const del = document.createElement("button");
    del.className = "abtn"; del.textContent = "\u{1F5D1}"; del.title = "Forget this";
    del.onclick = async () => {
      try {
        await fetch(backendUrl + "/api/memory/delete", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: e.id }),
        });
      } catch { /* ignore */ }
      loadMemory();
    };
    row.appendChild(del);
    host.appendChild(row);
  }
}
q("#s-memrefresh").onclick = () => loadMemory();
q("#s-memclear").onclick = async () => {
  if (!confirm("Forget everything Yuzal has stored about you?")) return;
  try {
    await fetch(backendUrl + "/api/memory/delete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clear: "" }),
    });
  } catch { /* ignore */ }
  loadMemory();
};

// ---- Cancel / Done ----
function closeTab() {
  stopSetMeter();
  chrome.tabs.getCurrent((t) => { if (t) chrome.tabs.remove(t.id); else window.close(); });
}

q("#s-cancel").onclick = closeTab;
q("#s-done").onclick = async () => {
  const micSel = q("#set-mic");
  const patch = {
    default_engine: q("#s-engine").value,
    effort: q("#s-effort").value,
    max_steps: Number(q("#s-maxsteps").value),
    read_only: q("#s-readonly").checked,
    no_submit: q("#s-nosubmit").checked,
    speak_replies: q("#s-speak").checked,
    memory_enabled: q("#s-memon").checked,
    memory_auto: q("#s-memauto").checked,
    memory_facts_kb: Number(q("#s-memfacts").value),
    memory_notes_kb: Number(q("#s-memnotes").value),
    memory_note_ttl_days: Number(q("#s-memttl").value),
    memory_budget_cloud_kb: Number(q("#s-memcloud").value),
    memory_budget_local_kb: Number(q("#s-memlocal").value),
    mic_device_id: micSel.value || "",
    mic_device_label: (micSel.options[micSel.selectedIndex] || {}).textContent || "",
    tts_voice: q("#set-voice").value,
    language: q("#set-lang").value,
  };
  try {
    const r = await fetch(backendUrl + "/api/settings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(String(r.status));
  } catch (e) {
    q("#s-saved").textContent = "Not saved: the backend did not answer.";
    q("#s-saved").style.color = "var(--warn)";
    return;
  }
  // Open panels pick the new settings up at once.
  chrome.runtime.sendMessage({ type: "yuzal-settings" }).catch(() => {});
  closeTab();
};

load();

// The agent loop: perceive -> POST /api/chat -> execute actions -> (optional)
// follow-up. Jeep's agent.js, running in Yuzal's side panel instead of
// Electron's main process. The backend still owns the model calls.
import * as backend from "./backend.js";
import * as perception from "./perception.js";
import * as actuator from "./actuator.js";
import * as localcmd from "./localcmd.js";
import * as tabs from "./tabs.js";
import * as cdp from "./cdp.js";

const MAX_AUTO_ITERATIONS = 6;   // default when nothing is configured
const MAX_STEPS_CAP = 30;        // hard ceiling the settings cannot exceed

// Words that switch on vision in Efficient mode.
const VISION_HINT_RE = /\b(see|look|image|picture|photo|screenshot|chart|graph|map|board|chess|color|colour|visual|diagram|video|canvas)\b/i;

// Sign-in / verification pages we must NOT try to drive. This must trigger
// ONLY on a real auth wall: nearly every site has a "Log in" link in its
// header, so that text alone is not enough.
const AUTH_URL_RE = /(accounts\.google\.com|login\.live\.com|appleid\.apple\.com|\/signin\b|\/login\b|\/auth\b|oauth|\/sso\b|\/saml\b|\/challenge\b|two[-_]?factor|2fa|mfa|\/verify\b|captcha|recaptcha)/i;
const AUTH_STRONG_RE = /(two[- ]step verification|2-step verification|enter the (one-time |verification )?code|one-time passcode|i'?m not a robot|recaptcha|complete the captcha|verify your identity to continue)/i;
const AUTH_FORM_RE = /\b(sign in|signin|log in|login|enter your password|password)\b/i;

function hasPasswordField(ps) {
  const hit = (arr) => Array.isArray(arr) && arr.some((e) => (((e && e.type) || "") + "").toLowerCase() === "password");
  return hit(ps.inputs) || hit(ps.elements);
}

export function isAuthPage(ps) {
  if (!ps) return false;
  if (AUTH_URL_RE.test(ps.url || "")) return true;
  const body = ((ps.title || "") + " " + (ps.text || "")).slice(0, 800);
  if (AUTH_STRONG_RE.test(body)) return true;
  if (hasPasswordField(ps) && AUTH_FORM_RE.test(body)) return true;
  return false;
}

let _stop = false;
export function requestStop() { _stop = true; }

// new_tab and switch_tab move Yuzal to a different page. The rest of the
// batch has to act on the new one.
function retarget(ctx) {
  if (tabs.state.agentTabId != null && tabs.state.agentTabId !== ctx.tabId) ctx.tabId = tabs.state.agentTabId;
}

// Run one user turn. `emit(ev)` streams status/messages/receipts to the panel.
// opts: { engine, mode, model, voice_mode, reply_in, effort, read_only,
//         no_submit, max_steps }
export async function run({ text, opts }, emit) {
  _stop = false;
  tabs.setBusy(true);
  try {
    await runTurn(text, opts || {}, emit);
  } finally {
    tabs.setBusy(false);
    // Hand the page back. While attached, Chromium shows its debugging bar
    // unless Jib was started with --silent-debugger-extension-api.
    await cdp.detachAll();
  }
}

async function runTurn(text, opts, emit) {
  const engine = opts.engine || "claude";
  let mode = opts.mode || "fast";
  const model = opts.model || "";
  const voice_mode = !!opts.voice_mode;
  const reply_in = opts.reply_in || "en";
  const effort = opts.effort || "";
  const readOnly = opts.read_only;
  const noSubmit = opts.no_submit;
  const maxSteps = Math.max(1, Math.min(MAX_STEPS_CAP, Number(opts.max_steps) || MAX_AUTO_ITERATIONS));

  // EFFICIENT engines run trivial page commands instantly with no model call.
  const isEfficient = mode === "efficient" || (engine === "claude" && mode === "fast");
  if (isEfficient) {
    const cmd = localcmd.parse(text);
    if (cmd) {
      const tabId = await tabs.agentTabId();
      if (cmd.message) emit({ type: "message", role: "assistant", text: cmd.message, reply_lang: reply_in });
      const results = [];
      const ctx = { tabId, shot: {}, pageDims: {}, emit, readOnly, noSubmit };
      for (const action of cmd.actions) {
        if (_stop) break;
        emit({ type: "status", text: `doing: ${action.name}` });
        const res = await actuator.executeOne(action, ctx);
        retarget(ctx);
        results.push(res);
        emit({ type: "receipt", line: res.line, ok: res.ok });
      }
      backend.postActionResult(results);
      emit({ type: "done" });
      return;
    }
  }

  let wantVision;
  if (engine === "local-ai") {
    wantVision = VISION_HINT_RE.test(text);
  } else {
    if (mode !== "strong" && VISION_HINT_RE.test(text)) mode = "moderate";
    wantVision = mode === "moderate" || mode === "strong";
  }

  let lastResults = [];
  let userMsg = text;

  for (let iter = 0; iter < maxSteps; iter++) {
    if (_stop) { emit({ type: "status", text: "stopped" }); emit({ type: "done" }); return; }

    const tabId = await tabs.agentTabId();
    if (tabId == null) { emit({ type: "message", role: "assistant", text: "No page to work on." }); emit({ type: "done" }); return; }

    emit({ type: "status", text: iter === 0 ? "reading the page…" : "re-reading the page…" });
    const pageState = await perception.buildPageState(tabId);

    // An auto-continue step that lands on a sign-in / 2FA / CAPTCHA page
    // stops: we can't (and shouldn't) authenticate for the user.
    if (iter > 0 && isAuthPage(pageState)) {
      emit({ type: "message", role: "assistant",
             text: "🔒 This page needs you to sign in / verify your identity, which I can't do for you. Please complete the sign-in or verification yourself, then send me a message and I'll continue." });
      emit({ type: "done" });
      return;
    }

    // Screenshot every turn so the backend's before/after page memory stays
    // current, and awaited, so /api/chat reads THIS page's status.
    if (wantVision) emit({ type: "status", text: "capturing the page…" });
    const shot = pageState._error ? { b64: "", region: null } : await perception.capture(tabId);
    await backend.postVisionStatus(shot.b64, pageState);
    const useVision = wantVision && !!shot.b64;
    if (wantVision && !useVision) {
      emit({ type: "status", text: "couldn't capture the page, answering from its text" });
    }

    emit({ type: "status", text: engine === "local-ai" ? "thinking (local)…" : "thinking…" });
    let decision;
    try {
      decision = await backend.postChat({
        message: userMsg,
        page_state: pageState,
        last_results: lastResults.map((r) => r.line),
        is_auto_followup: iter > 0,
        voice_mode, reply_in, engine, mode, model, effort,
        // The screenshot was already stored by postVisionStatus; re-sending it
        // would rotate vision_previous.png again and erase the comparison.
        use_vision: useVision,
        screenshot_b64: "",
      });
    } catch (e) {
      emit({ type: "message", role: "assistant", text: `Backend error: ${e.message}` });
      emit({ type: "done" });
      return;
    }

    const msg = decision.message_to_user || "";
    if (msg) {
      emit({
        type: "message", role: "assistant", text: msg,
        reply_lang: decision.reply_lang || reply_in,
        user_display: decision.user_display || "",
      });
    }

    const actions = Array.isArray(decision.actions) ? decision.actions : [];
    if (actions.length) {
      const ctx = { tabId, shot, visionImage: decision.vision_image || null, pageDims: pageState.page_dims, emit, readOnly, noSubmit };
      const results = [];
      for (const action of actions) {
        if (_stop) break;
        // ask_user pauses the loop and waits for the user's next message.
        if (action.name === "ask_user") {
          emit({ type: "message", role: "assistant", text: action.args?.question || "Could you clarify?" });
          results.push(actuator.ok("ask_user", "asked"));
          emit({ type: "receipts", results: results.map((r) => r.line) });
          backend.postActionResult(results);
          emit({ type: "done" });
          return;
        }
        emit({ type: "status", text: `doing: ${action.name}` });
        const res = await actuator.executeOne(action, ctx);
        retarget(ctx);
        results.push(res);
        emit({ type: "receipt", line: res.line, ok: res.ok });
      }
      lastResults = results;
      backend.postActionResult(results);
    } else {
      lastResults = [];
    }

    if (!decision.needs_followup) { emit({ type: "done" }); return; }
    userMsg = "(auto-continue: the previous step finished; re-read the page and continue the original request, then stop)";
  }

  emit({ type: "status", text: `reached the ${maxSteps}-step limit` });
  emit({ type: "done" });
}

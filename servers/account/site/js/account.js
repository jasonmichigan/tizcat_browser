// The TizCat account page: create an account (confirmed by email), log in
// and out, forgot and change password, and, inside TizCat, turn on sync by
// handing TizCat Services a device token and the account's sync key.
//
// The password never leaves this page. It becomes two keys here
// (password.js, copied from servers\shared by deploy.ps1): authKey, sent to
// log in, and wrapKey, which unlocks the account's sync key (vault.js) and
// is never sent. So the server stores what TizCat syncs without being able
// to read it.
import { accountKeys, MIN_PASSWORD_LENGTH, validEmail } from "./password.js";
import { newVaultKey, unwrapVaultKey, wrapVaultKey } from "./vault.js";

// TizCat Services, the built-in module that syncs. Its ID is fixed by the
// key in tizcat\modules\services\manifest.json.
const SERVICES_ID = "genbfkjaiacbeljlbeodfphddkkdohcp";
const KINDS = {
  bookmarks: "Bookmarks",
  settings: "Settings",
  tizcat: "TizCat Rewards and New Tab choices",
  wallet: "JibWallet",
};

const $ = (selector, root = document) => root.querySelector(selector);
const views = ["wait", "login", "signup", "check-email", "forgot", "reset", "account"];
let account = null;       // the logged-in account
let vaultKey = null;      // its sync key, unlocked, in this page's memory only
let pendingEmail = "";    // the address waiting for its confirmation email
let resetToken = null;

function show(view) {
  for (const v of views) {
    $(`#view-${v}`).hidden = v !== view;
  }
  const focus = $(`#view-${view} input`);
  if (focus && view !== "account") {
    focus.focus();
  }
}

// The automated tests put a secret here to use @test.tizcat.com addresses
// (no email is sent to them; the server checks the secret).
function testHeaders() {
  try {
    const secret = localStorage.getItem("tizcat-test-secret");
    return secret ? { "x-tizcat-test": secret } : {};
  } catch {
    return {};
  }
}

async function call(method, path, body) {
  const options = { method, headers: testHeaders(), credentials: "same-origin" };
  if (body) {
    options.headers["content-type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  try {
    const response = await fetch(path, options);
    const data = await response.json().catch(() => ({ ok: false, error: { message: "No answer." } }));
    return { status: response.status, ...data };
  } catch {
    return { status: 0, ok: false, error: { code: "offline", message: "Could not reach TizCat. Check your connection and try again." } };
  }
}

const problem = (result) => (result.error && result.error.message) || "That did not work. Please try again.";

// TizCat Services answers only inside TizCat (externally_connectable).
function services(message) {
  return new Promise((resolve) => {
    const runtime = globalThis.chrome && globalThis.chrome.runtime;
    if (!runtime || !runtime.sendMessage) {
      resolve(null);
      return;
    }
    try {
      runtime.sendMessage(SERVICES_ID, message, (reply) => {
        resolve(runtime.lastError ? null : reply || null);
      });
    } catch {
      resolve(null);
    }
  });
}

function say(where, text, ok = false) {
  const box = where.classList && where.classList.contains("message") ? where : $(".message", where);
  box.textContent = text;
  box.classList.toggle("ok", ok);
}

function notice(text) {
  const box = $("#login-notice");
  box.textContent = text;
  box.hidden = !text;
}

async function busy(button, work) {
  button.disabled = true;
  try {
    return await work();
  } finally {
    button.disabled = false;
  }
}

function checkNewPassword(form, password, again) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    say(form, `Please use at least ${MIN_PASSWORD_LENGTH} characters.`);
    return false;
  }
  if (password !== again) {
    say(form, "The two passwords are not the same.");
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Create an account, confirm it

async function signup(form) {
  const email = form.email.value.trim();
  if (!validEmail(email)) {
    say(form, "Please enter your email address.");
    return;
  }
  if (!checkNewPassword(form, form.password.value, form.password2.value)) {
    return;
  }
  if (!form.agree.checked) {
    say(form, "Please agree to the Terms of Service and Privacy Policy to continue.");
    return;
  }
  say(form, "Securing your password...", true);
  const keys = await accountKeys(form.password.value, email);
  // The account's sync key, made here and locked with the password.
  const locked = await wrapVaultKey(keys.wrapKey, newVaultKey());
  const result = await call("POST", "/v1/account/signup", { email, authKey: keys.authKey, vaultKey: locked });
  if (!result.ok) {
    say(form, problem(result));
    return;
  }
  form.reset();
  say(form, "");
  pendingEmail = result.email;
  if (result.test) {
    document.body.dataset.testToken = result.test.token;
  }
  $("#check-email-address").textContent = result.email;
  say($("#view-check-email"), "");
  location.hash = "#check-email";
  show("check-email");
}

async function resend(where, email) {
  const result = await call("POST", "/v1/account/resend-verification", { email });
  if (result.test) {
    document.body.dataset.testToken = result.test.token;
  }
  say(where, result.ok ? "If your account is waiting to be confirmed, a new link is on its way." : problem(result), result.ok);
}

async function confirmEmail(token) {
  show("wait");
  const result = await call("POST", "/v1/account/verify-email", { token });
  show("login");
  if (result.ok) {
    $("#login-form").email.value = result.email;
    notice("Your email is confirmed and your TizCat account is active. Log in to start.");
    $("#login-form").password.focus();
  } else {
    notice(problem(result));
  }
}

// ---------------------------------------------------------------------------
// Log in, out

async function login(form) {
  const email = form.email.value.trim();
  const password = form.password.value;
  $("#resend-button").hidden = true;
  if (!validEmail(email)) {
    say(form, "Please enter your email address.");
    return;
  }
  if (!password) {
    say(form, "Please enter your password.");
    return;
  }
  say(form, "Securing your password...", true);
  const keys = await accountKeys(password, email);
  const result = await call("POST", "/v1/account/login", { email, authKey: keys.authKey });
  if (!result.ok) {
    say(form, problem(result));
    if (result.error && result.error.code === "not_verified") {
      pendingEmail = email;
      $("#resend-button").hidden = false;
    }
    return;
  }
  vaultKey = result.vaultKey ? await unwrapVaultKey(keys.wrapKey, result.vaultKey).catch(() => null) : null;
  form.reset();
  say(form, "");
  notice("");
  location.hash = "";
  await showAccount(result.account);
}

async function logout() {
  await call("POST", "/v1/account/logout");
  account = null;
  vaultKey = null;
  location.hash = "#login";
  show("login");
}

// ---------------------------------------------------------------------------
// Forgot and reset the password

async function forgot(form) {
  const email = form.email.value.trim();
  if (!validEmail(email)) {
    say(form, "Please enter your email address.");
    return;
  }
  const result = await call("POST", "/v1/account/forgot-password", { email });
  if (result.test) {
    document.body.dataset.testToken = result.test.token;
  }
  say(form, result.ok ? "If there is a TizCat account with that address, a link to reset its password is on its way. It works for an hour." : problem(result), result.ok);
}

async function reset(form) {
  const email = form.email.value.trim();
  if (!validEmail(email)) {
    say(form, "Please enter your account's email address.");
    return;
  }
  if (!checkNewPassword(form, form.password.value, form.password2.value)) {
    return;
  }
  say(form, "Securing your password...", true);
  const keys = await accountKeys(form.password.value, email);
  // The old sync key cannot be unlocked without the old password: a new one.
  const locked = await wrapVaultKey(keys.wrapKey, newVaultKey());
  const result = await call("POST", "/v1/account/reset-password",
    { token: resetToken, email, authKey: keys.authKey, vaultKey: locked });
  if (!result.ok) {
    say(form, problem(result));
    return;
  }
  resetToken = null;
  form.reset();
  say(form, "");
  location.hash = "#login";
  show("login");
  $("#login-form").email.value = result.email;
  notice("Your password is changed. Log in with your new password, then turn on sync again in your TizCat browsers.");
  $("#login-form").password.focus();
}

// ---------------------------------------------------------------------------
// The account page

async function showAccount(who) {
  account = who;
  $("#account-email").textContent = who.email;
  say($("#account-message"), "");
  show("account");
  await Promise.all([refreshDevices(), refreshSync(), refreshSynced()]);
}

function ago(time) {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(time).toLocaleDateString();
}

async function refreshSync() {
  const status = $("#sync-status");
  const here = await services({ type: "tizcat.hello" });
  const on = $("#sync-on");
  const openSettings = $("#sync-open");
  const off = $("#sync-off");
  const unlockForm = $("#sync-unlock");
  for (const el of [on, openSettings, off, unlockForm, $("#sync-about")]) {
    el.hidden = true;
  }
  if (!here) {
    status.textContent = "Open this page in TizCat to sync your bookmarks and settings and to earn TizCat Rewards in it.";
    $("#sync-about").hidden = false;
    return;
  }
  if (here.linked && here.email && account && here.email !== account.email) {
    status.textContent = `This TizCat is signed in as ${here.email}. Sign it out first to use this account here.`;
    off.hidden = false;
    return;
  }
  if (here.linked) {
    const sync = here.sync || {};
    let text = "Sync is on in this TizCat.";
    if (sync.error) {
      text += ` ${sync.error}`;
    } else if (sync.lastSyncAt) {
      text += ` Last synced ${ago(sync.lastSyncAt)}.`;
    }
    status.textContent = text;
    openSettings.hidden = false;
    off.hidden = false;
    return;
  }
  status.textContent = "Sync is off in this TizCat.";
  $("#sync-about").hidden = false;
  on.hidden = false;
  unlockForm.hidden = !!vaultKey;
}

function deviceName() {
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || "Windows";
  return `TizCat on ${platform}`;
}

async function turnOnSync() {
  const message = $("#sync-message");
  say(message, "");
  let key = vaultKey;
  if (!key) {
    // The page was reloaded since logging in: the password unlocks the key again.
    const form = $("#sync-unlock");
    form.hidden = false;
    if (!form.password.value) {
      say(message, "Enter your password to turn on sync.");
      form.password.focus();
      return;
    }
    say(message, "Securing your password...", true);
    const keys = await accountKeys(form.password.value, account.email);
    const result = await call("POST", "/v1/account/unlock", { authKey: keys.authKey });
    if (!result.ok || !result.vaultKey) {
      say(message, problem(result));
      return;
    }
    key = await unwrapVaultKey(keys.wrapKey, result.vaultKey).catch(() => null);
    if (!key) {
      say(message, "Your sync key could not be unlocked. Please try again.");
      return;
    }
    vaultKey = key;
    form.reset();
  }
  say(message, "Turning on sync...", true);
  const made = await call("POST", "/v1/account/devices", { name: deviceName() });
  if (!made.ok) {
    say(message, problem(made));
    return;
  }
  const reply = await services({
    type: "tizcat.link", token: made.token, deviceId: made.device.id, email: account.email, vaultKey: key,
  });
  if (!reply || !reply.ok) {
    await call("DELETE", `/v1/account/devices/${made.device.id}`);
    say(message, "TizCat did not answer. Please try again.");
    return;
  }
  say(message, "Sync is on. Your bookmarks and settings are syncing now.", true);
  await Promise.all([refreshDevices(), refreshSync()]);
  // The first sync runs in TizCat; show what it saved once it is done.
  setTimeout(() => Promise.all([refreshSync(), refreshSynced()]), 4000);
}

async function signOutHere() {
  const here = await services({ type: "tizcat.hello" });
  if (here && here.deviceId) {
    await call("DELETE", `/v1/account/devices/${here.deviceId}`);
  }
  await services({ type: "tizcat.unlink" });
  say($("#sync-message"), "This TizCat is signed out. Your bookmarks and settings stay in it.", true);
  await Promise.all([refreshDevices(), refreshSync()]);
}

async function refreshSynced() {
  const list = $("#synced-list");
  const result = await call("GET", "/v1/account/sync");
  list.textContent = "";
  const kinds = result.ok ? result.collections : [];
  $("#synced-clear").hidden = !kinds.length;
  if (!kinds.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = result.ok ? "Nothing yet. Turn on sync in TizCat to start." : "Could not be read just now.";
    list.append(li);
    return;
  }
  for (const kind of kinds) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = KINDS[kind.name] || kind.name;
    const when = document.createElement("span");
    when.className = "muted";
    when.textContent = `updated ${ago(kind.updatedAt)}`;
    li.append(name, when);
    list.append(li);
  }
}

async function clearSynced() {
  if (!confirm("Delete your synced data from TizCat's servers? Your TizCat browsers keep theirs, and those still signed in upload it again.")) {
    return;
  }
  const result = await call("POST", "/v1/account/sync/clear");
  say($("#account-message"), result.ok ? "Your synced data was deleted from TizCat's servers." : problem(result), result.ok);
  await refreshSynced();
}

async function refreshDevices() {
  const list = $("#device-list");
  const result = await call("GET", "/v1/account/devices");
  list.textContent = "";
  if (!result.ok || !result.devices.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "None yet.";
    list.append(li);
    return;
  }
  const here = await services({ type: "tizcat.hello" });
  for (const device of result.devices) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    const thisOne = here && here.deviceId === device.id ? " (this one)" : "";
    name.textContent = `${device.name}${thisOne}, signed in ${new Date(device.linkedAt).toLocaleDateString()}`;
    const out = document.createElement("button");
    out.type = "button";
    out.className = "secondary";
    out.textContent = "Sign out";
    out.addEventListener("click", () => busy(out, async () => {
      await call("DELETE", `/v1/account/devices/${device.id}`);
      if (thisOne) {
        await services({ type: "tizcat.unlink" });
      }
      await Promise.all([refreshDevices(), refreshSync()]);
    }));
    li.append(name, out);
    list.append(li);
  }
}

async function changePassword(form) {
  if (!form.current.value) {
    say(form, "Please enter your current password.");
    return;
  }
  if (!checkNewPassword(form, form.password.value, form.password2.value)) {
    return;
  }
  say(form, "Securing your password...", true);
  const current = await accountKeys(form.current.value, account.email);
  const unlocked = await call("POST", "/v1/account/unlock", { authKey: current.authKey });
  if (!unlocked.ok) {
    say(form, problem(unlocked));
    return;
  }
  // The same sync key, locked again with the new password: nothing is lost.
  const key = unlocked.vaultKey
    ? await unwrapVaultKey(current.wrapKey, unlocked.vaultKey).catch(() => null)
    : null;
  const next = await accountKeys(form.password.value, account.email);
  const locked = await wrapVaultKey(next.wrapKey, key || newVaultKey());
  const result = await call("POST", "/v1/account/change-password",
    { authKey: current.authKey, newAuthKey: next.authKey, vaultKey: locked });
  if (!result.ok) {
    say(form, problem(result));
    return;
  }
  vaultKey = key || vaultKey;
  form.reset();
  say(form, "");
  form.hidden = true;
  $("#password-open").hidden = false;
  say($("#account-message"), "Your password is changed. Your TizCat browsers stay signed in.", true);
}

async function deleteAccount(form) {
  if (!form.password.value) {
    say(form, "Please enter your password.");
    return;
  }
  say(form, "Securing your password...", true);
  const keys = await accountKeys(form.password.value, account.email);
  const result = await call("DELETE", "/v1/account/me", { authKey: keys.authKey });
  if (!result.ok) {
    say(form, problem(result));
    return;
  }
  const here = await services({ type: "tizcat.hello" });
  if (here && here.linked && here.email === account.email) {
    await services({ type: "tizcat.unlink" });
  }
  account = null;
  vaultKey = null;
  form.reset();
  location.hash = "#signup";
  show("signup");
}

// ---------------------------------------------------------------------------
// Start

function route() {
  if (account && !$("#view-account").hidden) {
    return;
  }
  const hash = location.hash;
  if (hash === "#signup") show("signup");
  else if (hash === "#forgot") show("forgot");
  else if (hash === "#check-email" && pendingEmail) show("check-email");
  else if (hash === "#reset" && resetToken) show("reset");
  else show("login");
}

function onSubmit(id, handler) {
  const form = $(id);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    busy($("button[type=submit]", form), () => handler(form));
  });
}

async function start() {
  onSubmit("#login-form", login);
  onSubmit("#signup-form", signup);
  onSubmit("#forgot-form", forgot);
  onSubmit("#reset-form", reset);
  onSubmit("#password-form", changePassword);
  onSubmit("#delete-form", deleteAccount);
  $("#sync-unlock").addEventListener("submit", (e) => {
    e.preventDefault();
    busy($("#sync-on"), turnOnSync);
  });
  for (const button of document.querySelectorAll(".show-password")) {
    button.addEventListener("click", () => {
      const input = $("input", button.parentElement);
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      button.textContent = showing ? "Show" : "Hide";
      button.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    });
  }
  $("#resend-button").addEventListener("click", (e) => busy(e.target, () => resend($("#login-form"), pendingEmail)));
  $("#check-resend").addEventListener("click", (e) => busy(e.target, () => resend($("#view-check-email"), pendingEmail)));
  $("#sync-on").addEventListener("click", (e) => busy(e.target, turnOnSync));
  $("#sync-off").addEventListener("click", (e) => busy(e.target, signOutHere));
  $("#sync-open").addEventListener("click", () => services({ type: "tizcat.openSync" }));
  $("#synced-clear").addEventListener("click", (e) => busy(e.target, clearSynced));
  $("#logout-button").addEventListener("click", (e) => busy(e.target, logout));
  for (const [openId, formId] of [["#password-open", "#password-form"], ["#delete-open", "#delete-form"]]) {
    $(openId).addEventListener("click", () => {
      $(formId).hidden = false;
      $(openId).hidden = true;
      $("input", $(formId)).focus();
    });
    $(".cancel", $(formId)).addEventListener("click", () => {
      $(formId).reset();
      say($(formId), "");
      $(formId).hidden = true;
      $(openId).hidden = false;
    });
  }
  window.addEventListener("hashchange", route);

  // Links from the emails: #verify=<token>, #reset=<token>&email=<address>.
  // The token is taken out of the address bar (and the history) at once.
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("verify")) {
    const token = hash.get("verify");
    history.replaceState(null, "", "/#login");
    await confirmEmail(token);
    return;
  }
  if (hash.get("reset")) {
    resetToken = hash.get("reset");
    history.replaceState(null, "", "/#reset");
    const form = $("#reset-form");
    form.email.value = hash.get("email") || "";
    show("reset");
    (form.email.value ? form.password : form.email).focus();
    return;
  }

  const me = await call("GET", "/v1/account/me");
  if (me.ok) {
    await showAccount(me.account);
  } else {
    route();
  }
}

start();

// tizcat-account: TizCat accounts, like Brave's and Firefox's account sites.
//
// Website (account.tizcat.com): the page in ..\site (log in, create an
// account, confirm the email, forgot password, the account page), served
// with strict security headers.
// API (/v1/account/..., on this site and through api.tizcat.com):
//   POST   /v1/account/signup               {email, authKey, vaultKey} -> a confirmation email
//   POST   /v1/account/verify-email         {token}  the link in that email activates the account
//   POST   /v1/account/resend-verification  {email}
//   POST   /v1/account/login                {email, authKey} -> session cookie + the locked sync key
//   POST   /v1/account/logout
//   POST   /v1/account/forgot-password      {email} -> a reset email
//   POST   /v1/account/reset-password       {token, authKey, vaultKey}
//   POST   /v1/account/change-password      {authKey, newAuthKey, vaultKey} (session)
//   POST   /v1/account/unlock               {authKey} -> the locked sync key (session)
//   GET    /v1/account/me                   session cookie or device token
//   DELETE /v1/account/me                   {authKey}: deletes the account (session)
//   GET    /v1/account/devices              the TizCat browsers signed in (session)
//   POST   /v1/account/devices              {name} -> a device token (session)
//   DELETE /v1/account/devices/<id>         sign one out (session, or that device)
//   GET    /v1/account/sync                 what is synced, by kind (session)
//   POST   /v1/account/sync/clear           delete the synced copy (session)
// Every answer is {ok: true, ...} or {ok: false, error: {code, message}}.
// Passwords never arrive here: only keys made from them in the page
// (shared\password.js). Synced data is locked with a key the server never
// sees (shared\vault.js).
//
// RPC for the other servers (service binding only, never the internet):
//   resolveDevice(token) -> {deviceId, accountId} or null;  health()
import { WorkerEntrypoint } from "cloudflare:workers";
import { liveConfig } from "../../shared/config.js";
import { randomToken, sha256, fromBase64Url, sameBytes } from "../../shared/crypto.js";
import { passwordChangedEmail, resetEmail, verifyEmail } from "../../shared/emails.js";
import { csp, error, httpsRedirect, json, readJson, secure } from "../../shared/http.js";
import { sendMail } from "../../shared/mailer.js";
import { KDF, normalizeEmail, validEmail, verifierFor } from "../../shared/password.js";
import { check } from "../../shared/validate.js";

export const VERSION = "0.2.0";
const ORIGIN = "https://account.tizcat.com";
const COOKIE = "__Host-tz_session";
const SESSION_DAYS = 30;
const VERIFY_HOURS = 48;
const RESET_MINUTES = 60;
const LINKS_PER_HOUR = 5;           // emails of one kind to one account
// Addresses for automated tests: no mail is ever sent to them; with the
// TEST_SECRET header, the link's token comes back in the answer instead.
const TEST_DOMAIN = "@test.tizcat.com";
// The pages: their own scripts only, and Turnstile's once it is switched on.
const PAGE_POLICY = csp({
  scripts: ["https://challenges.cloudflare.com"],
  frames: ["https://challenges.cloudflare.com"],
});

export default class AccountService extends WorkerEntrypoint {
  async fetch(request) {
    const redirect = httpsRedirect(request);
    if (redirect) {
      return redirect;
    }
    const url = new URL(request.url);
    if (url.pathname.startsWith("/v1/account")) {
      try {
        return await api(request, url, this.env);
      } catch (e) {
        console.error("account api", e && e.stack ? e.stack : e);
        return error(500, "server_error", "Something went wrong. Please try again.");
      }
    }
    if (url.pathname === "/health") {
      return json(await this.health());
    }
    // Pages and their files.
    const page = await this.env.ASSETS.fetch(request);
    return secure(page, PAGE_POLICY);
  }

  // Which account a TizCat browser's device token belongs to.
  async resolveDevice(token) {
    return deviceFor(this.env, token);
  }

  async health() {
    let db = false;
    try {
      db = !!(await this.env.DB.prepare("SELECT 1 AS ok").first());
    } catch {
      db = false;
    }
    return { part: "account", version: VERSION, ok: db, db };
  }
}

const ROUTES = {
  "POST /v1/account/signup": signup,
  "POST /v1/account/verify-email": verifyAddress,
  "POST /v1/account/resend-verification": resendVerification,
  "POST /v1/account/login": login,
  "POST /v1/account/logout": logout,
  "POST /v1/account/forgot-password": forgotPassword,
  "POST /v1/account/reset-password": resetPassword,
  "POST /v1/account/change-password": changePassword,
  "POST /v1/account/unlock": unlock,
  "GET /v1/account/me": me,
  "DELETE /v1/account/me": deleteAccount,
  "GET /v1/account/devices": listDevices,
  "POST /v1/account/devices": linkDevice,
  "GET /v1/account/sync": syncSummary,
  "POST /v1/account/sync/clear": syncClear,
};

async function api(request, url, env) {
  const path = url.pathname.replace(/\/+$/, "");
  const config = await liveConfig(env);
  const handler = ROUTES[`${request.method} ${path}`];
  if (handler) {
    return handler(request, env, config);
  }
  const unlink = path.match(/^\/v1\/account\/devices\/(d_[A-Za-z0-9_-]{8,40})$/);
  if (unlink && request.method === "DELETE") {
    return unlinkDevice(request, env, unlink[1]);
  }
  return error(404, "not_found", "No such account call.");
}

// Reads and checks a body for a page-only call; answers {body} or {fail}.
async function pageBody(request, env, config, contract, where) {
  if (!sameOrigin(request)) {
    return { fail: error(403, "bad_origin", `${where} on account.tizcat.com.`) };
  }
  const body = await readJson(request);
  const reason = check(contract, body);
  if (reason) {
    return { fail: error(400, "bad_request", reason) };
  }
  return { body };
}

// ---------------------------------------------------------------------------
// Sign up and confirm the email

async function signup(request, env, config) {
  if (!config.features.signup) {
    return error(403, "signup_closed", "New accounts are not open yet.");
  }
  const { body, fail } = await pageBody(request, env, config, "account.signup", "Create accounts");
  if (fail) {
    return fail;
  }
  if (!validEmail(body.email)) {
    return error(400, "bad_email", "That email address does not look right.");
  }
  if (!(await limited(env.EMAIL_LIMITER, request))) {
    return error(429, "too_many", "Too many tries. Wait a minute and try again.");
  }
  if (!(await turnstileOk(env, config, body.turnstile, request))) {
    return error(403, "bot_check", "Please complete the check and try again.");
  }
  const email = normalizeEmail(body.email);
  const now = Date.now();
  const salt = randomToken(16);
  const verifier = await verifierFor(pepper(env), salt, body.authKey);
  const existing = await env.DB.prepare("SELECT id, email_verified FROM users WHERE email = ?1")
    .bind(email).first();
  if (existing && existing.email_verified) {
    return error(409, "email_taken", "There is already an account with that email. Log in instead.");
  }
  let id = existing && existing.id;
  if (id) {
    // Not confirmed yet: this sign-up's password becomes the one to check
    // (earlier links still activate their own, see email_tokens).
    await env.DB.prepare(
      "UPDATE users SET salt = ?2, verifier = ?3, kdf = ?4, vault_key = ?5, updated_at = ?6 " +
      "WHERE id = ?1 AND email_verified = 0",
    ).bind(id, salt, verifier, KDF, body.vaultKey, now).run();
  } else {
    id = "u_" + randomToken(12);
    const inserted = await env.DB.prepare(
      "INSERT INTO users (id, email, salt, verifier, kdf, vault_key, email_verified, created_at, updated_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?7) ON CONFLICT(email) DO NOTHING",
    ).bind(id, email, salt, verifier, KDF, body.vaultKey, now).run();
    if (!inserted.meta.changes) {
      return error(409, "email_taken", "There is already an account with that email. Log in instead.");
    }
  }
  if (await tooManyLinks(env, id, "verify")) {
    return error(429, "too_many", "We already sent several emails. Please check your inbox and spam folder, or try again in an hour.");
  }
  const token = await newEmailToken(env, id, "verify", VERIFY_HOURS * 3600_000,
    { salt, verifier, kdf: KDF, vault_key: body.vaultKey });
  const sent = await deliver(request, env, config, email, "verify", token);
  if (!sent.ok) {
    return error(503, "email_failed",
      "We could not send the confirmation email just now. Please try again in a few minutes.");
  }
  return json({ ok: true, pending: true, email, ...testPart(sent) }, 201);
}

async function verifyAddress(request, env, config) {
  const { body, fail } = await pageBody(request, env, config, "account.verify", "Confirm your email");
  if (fail) {
    return fail;
  }
  const now = Date.now();
  const link = await env.DB.prepare(
    "SELECT t.token_hash, t.user_id, t.salt, t.verifier, t.kdf, t.vault_key, u.email, u.email_verified " +
    "FROM email_tokens t JOIN users u ON u.id = t.user_id " +
    "WHERE t.token_hash = ?1 AND t.kind = 'verify' AND t.used_at IS NULL AND t.expires_at > ?2",
  ).bind(await sha256(body.token), now).first();
  if (!link) {
    return error(400, "bad_link",
      "This link has expired or was already used. If your account is not active yet, sign up again or ask for a new link.");
  }
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET salt = ?2, verifier = ?3, kdf = ?4, vault_key = ?5, email_verified = 1, " +
      "verified_at = ?6, updated_at = ?6 WHERE id = ?1 AND email_verified = 0",
    ).bind(link.user_id, link.salt, link.verifier, link.kdf, link.vault_key, now),
    env.DB.prepare("DELETE FROM email_tokens WHERE user_id = ?1 AND kind = 'verify'").bind(link.user_id),
  ]);
  return json({ ok: true, email: link.email });
}

async function resendVerification(request, env, config) {
  const { body, fail } = await pageBody(request, env, config, "account.email", "Ask for a new link");
  if (fail) {
    return fail;
  }
  if (!(await limited(env.EMAIL_LIMITER, request))) {
    return error(429, "too_many", "Too many tries. Wait a minute and try again.");
  }
  // The same answer whether or not there is such an account.
  const answer = { ok: true, message: "If that address has an account waiting to be confirmed, a new link is on its way." };
  const email = normalizeEmail(body.email);
  const user = await env.DB.prepare(
    "SELECT id FROM users WHERE email = ?1 AND email_verified = 0").bind(email).first();
  if (!user || (await tooManyLinks(env, user.id, "verify"))) {
    return json(answer);
  }
  // The newest sign-up's password, as the account row holds it.
  const creds = await env.DB.prepare(
    "SELECT salt, verifier, kdf, vault_key FROM users WHERE id = ?1").bind(user.id).first();
  const token = await newEmailToken(env, user.id, "verify", VERIFY_HOURS * 3600_000, creds);
  const sent = await deliver(request, env, config, email, "verify", token);
  return json({ ...answer, ...testPart(sent) });
}

// ---------------------------------------------------------------------------
// Log in, log out

async function login(request, env, config) {
  const { body, fail } = await pageBody(request, env, config, "account.login", "Log in");
  if (fail) {
    return fail;
  }
  const email = normalizeEmail(body.email);
  if (!(await limited(env.LOGIN_LIMITER, request, email))) {
    return error(429, "too_many", "Too many tries. Wait a minute and try again.");
  }
  if (!(await turnstileOk(env, config, body.turnstile, request))) {
    return error(403, "bot_check", "Please complete the check and try again.");
  }
  const user = await env.DB.prepare(
    "SELECT id, email, salt, verifier, email_verified, created_at, vault_key FROM users WHERE email = ?1",
  ).bind(email).first();
  if (!(await passwordMatches(env, user, body.authKey))) {
    return error(401, "wrong_login", "That email and password do not match an account.");
  }
  if (!user.email_verified) {
    return error(403, "not_verified",
      "Please confirm your email first: open the link we sent you when you signed up.");
  }
  return startSession(env, user, 200);
}

async function startSession(env, user, status) {
  const token = randomToken(32);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
  ).bind(await sha256(token), user.id, now, now + SESSION_DAYS * 86400_000).run();
  return json({ ok: true, account: accountView(user), vaultKey: user.vault_key || null }, status, {
    "set-cookie": `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`,
  });
}

async function logout(request, env) {
  const token = cookieToken(request);
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await sha256(token)).run();
  }
  return json({ ok: true }, 200, { "set-cookie": clearCookie() });
}

// ---------------------------------------------------------------------------
// Passwords: forgot (reset by email), change, unlock

async function forgotPassword(request, env, config) {
  const { body, fail } = await pageBody(request, env, config, "account.email", "Reset passwords");
  if (fail) {
    return fail;
  }
  if (!(await limited(env.EMAIL_LIMITER, request))) {
    return error(429, "too_many", "Too many tries. Wait a minute and try again.");
  }
  const answer = { ok: true, message: "If there is a TizCat account with that address, a link to reset its password is on its way." };
  const email = normalizeEmail(body.email);
  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?1").bind(email).first();
  if (!user || (await tooManyLinks(env, user.id, "reset"))) {
    return json(answer);
  }
  const token = await newEmailToken(env, user.id, "reset", RESET_MINUTES * 60_000);
  const sent = await deliver(request, env, config, email, "reset", token);
  return json({ ...answer, ...testPart(sent) });
}

// A reset: the old password is unknown, so the old sync key cannot be
// unlocked. The page made a new one; the synced copy (locked with the old
// key) is deleted, and every session and TizCat browser is signed out. They
// upload their data again when signed in with the new password.
async function resetPassword(request, env, config) {
  const { body, fail } = await pageBody(request, env, config, "account.reset", "Reset passwords");
  if (fail) {
    return fail;
  }
  const now = Date.now();
  const link = await env.DB.prepare(
    "SELECT t.user_id, u.email FROM email_tokens t JOIN users u ON u.id = t.user_id " +
    "WHERE t.token_hash = ?1 AND t.kind = 'reset' AND t.used_at IS NULL AND t.expires_at > ?2",
  ).bind(await sha256(body.token), now).first();
  if (!link) {
    return error(400, "bad_link", "This link has expired or was already used. Ask for a new one.");
  }
  // The email salts the password's keys: a different one here would make
  // a password that never works.
  if (normalizeEmail(body.email) !== link.email) {
    return error(400, "wrong_email", "That is not the email address of the account this link is for.");
  }
  await env.SYNC.wipe(link.user_id);
  const salt = randomToken(16);
  const verifier = await verifierFor(pepper(env), salt, body.authKey);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET salt = ?2, verifier = ?3, kdf = ?4, vault_key = ?5, email_verified = 1, " +
      "verified_at = COALESCE(verified_at, ?6), password_changed_at = ?6, updated_at = ?6 WHERE id = ?1",
    ).bind(link.user_id, salt, verifier, KDF, body.vaultKey, now),
    // The link proves the inbox, so any waiting sign-up links go too.
    env.DB.prepare("DELETE FROM email_tokens WHERE user_id = ?1").bind(link.user_id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(link.user_id),
    env.DB.prepare("UPDATE devices SET revoked_at = ?2 WHERE user_id = ?1 AND revoked_at IS NULL")
      .bind(link.user_id, now),
  ]);
  return json({ ok: true, email: link.email });
}

// A change: the page unlocked the sync key with the current password and
// locked it again with the new one, so nothing is lost and the TizCat
// browsers stay signed in. Other website sessions are logged out.
async function changePassword(request, env, config) {
  const { body, fail } = await pageBody(request, env, config, "account.changePassword", "Change passwords");
  if (fail) {
    return fail;
  }
  const user = await sessionUser(request, env, true);
  if (!user) {
    return error(401, "logged_out", "Not logged in.");
  }
  if (!(await limited(env.LOGIN_LIMITER, request, user.email))) {
    return error(429, "too_many", "Too many tries. Wait a minute and try again.");
  }
  if (!(await passwordMatches(env, user, body.authKey))) {
    return error(401, "wrong_password", "Your current password is not right.");
  }
  const now = Date.now();
  const salt = randomToken(16);
  const verifier = await verifierFor(pepper(env), salt, body.newAuthKey);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET salt = ?2, verifier = ?3, kdf = ?4, vault_key = ?5, password_changed_at = ?6, " +
      "updated_at = ?6 WHERE id = ?1",
    ).bind(user.id, salt, verifier, KDF, body.vaultKey, now),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1 AND token_hash != ?2")
      .bind(user.id, await sha256(cookieToken(request))),
    env.DB.prepare("DELETE FROM email_tokens WHERE user_id = ?1 AND kind = 'reset'").bind(user.id),
  ]);
  await deliver(request, env, config, user.email, "changed", null);
  return json({ ok: true });
}

// The locked sync key again, for a page that no longer has it (to turn on
// sync in a TizCat after the page was reloaded): the password is asked again.
async function unlock(request, env, config) {
  const { body, fail } = await pageBody(request, env, config, "account.password", "Unlock");
  if (fail) {
    return fail;
  }
  const user = await sessionUser(request, env, true);
  if (!user) {
    return error(401, "logged_out", "Not logged in.");
  }
  if (!(await limited(env.LOGIN_LIMITER, request, user.email))) {
    return error(429, "too_many", "Too many tries. Wait a minute and try again.");
  }
  if (!(await passwordMatches(env, user, body.authKey))) {
    return error(401, "wrong_password", "That password is not right.");
  }
  return json({ ok: true, vaultKey: user.vault_key || null });
}

// ---------------------------------------------------------------------------
// The account and its TizCat browsers

async function me(request, env) {
  const session = await sessionUser(request, env);
  if (session) {
    return json({ ok: true, account: accountView(session) });
  }
  const device = await deviceFor(env, bearer(request));
  if (device) {
    const user = await env.DB.prepare(
      "SELECT id, email, email_verified, created_at FROM users WHERE id = ?1",
    ).bind(device.accountId).first();
    if (user) {
      return json({ ok: true, account: accountView(user), device: { id: device.deviceId } });
    }
  }
  return error(401, "logged_out", "Not logged in.");
}

async function deleteAccount(request, env, config) {
  const { body, fail } = await pageBody(request, env, config, "account.password", "Delete the account");
  if (fail) {
    return fail;
  }
  const user = await sessionUser(request, env, true);
  if (!user) {
    return error(401, "logged_out", "Not logged in.");
  }
  if (!(await limited(env.LOGIN_LIMITER, request, user.email))) {
    return error(429, "too_many", "Too many tries. Wait a minute and try again.");
  }
  if (!(await passwordMatches(env, user, body.authKey))) {
    return error(401, "wrong_password", "That password is not right.");
  }
  // Rewards points and synced data first: if either fails, the account is
  // still there to try again, rather than data left with no account.
  await env.REWARDS.forget(user.id);
  await env.SYNC.wipe(user.id);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM email_tokens WHERE user_id = ?1").bind(user.id),
    env.DB.prepare("DELETE FROM devices WHERE user_id = ?1").bind(user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(user.id),
    env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(user.id),
  ]);
  return json({ ok: true }, 200, { "set-cookie": clearCookie() });
}

async function listDevices(request, env) {
  const user = await sessionUser(request, env);
  if (!user) {
    return error(401, "logged_out", "Not logged in.");
  }
  const rows = await env.DB.prepare(
    "SELECT id, name, created_at, last_seen_at FROM devices " +
    "WHERE user_id = ?1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 50",
  ).bind(user.id).all();
  return json({
    ok: true,
    devices: rows.results.map((d) => ({
      id: d.id, name: d.name, linkedAt: d.created_at, lastSeenAt: d.last_seen_at,
    })),
  });
}

// Called by the account page inside TizCat: the token goes straight to
// TizCat Services, which keeps it; only its hash stays here.
async function linkDevice(request, env, config) {
  const { body, fail } = await pageBody(request, env, config, "account.device", "Sign in TizCat");
  if (fail) {
    return fail;
  }
  const user = await sessionUser(request, env);
  if (!user) {
    return error(401, "logged_out", "Not logged in.");
  }
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM devices WHERE user_id = ?1 AND revoked_at IS NULL",
  ).bind(user.id).first();
  if (count && count.n >= 20) {
    return error(409, "too_many_devices", "Sign out a TizCat you no longer use first.");
  }
  const token = "tzd_" + randomToken(32);
  const id = "d_" + randomToken(12);
  const now = Date.now();
  const name = body.name.trim() || "TizCat";
  await env.DB.prepare(
    "INSERT INTO devices (id, token_hash, user_id, name, created_at, last_seen_at) " +
    "VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
  ).bind(id, await sha256(token), user.id, name, now).run();
  return json({ ok: true, device: { id, name }, token }, 201);
}

async function unlinkDevice(request, env, id) {
  const user = sameOrigin(request) ? await sessionUser(request, env) : null;
  const device = user ? null : await deviceFor(env, bearer(request));
  const owner = user ? user.id : device && device.deviceId === id ? device.accountId : null;
  if (!owner) {
    return error(401, "logged_out", "Not logged in.");
  }
  await env.DB.prepare(
    "UPDATE devices SET revoked_at = ?1 WHERE id = ?2 AND user_id = ?3 AND revoked_at IS NULL",
  ).bind(Date.now(), id, owner).run();
  return json({ ok: true });
}

async function syncSummary(request, env) {
  const user = await sessionUser(request, env);
  if (!user) {
    return error(401, "logged_out", "Not logged in.");
  }
  return json({ ok: true, ...(await env.SYNC.summary(user.id)) });
}

async function syncClear(request, env) {
  if (!sameOrigin(request)) {
    return error(403, "bad_origin", "Clear synced data on account.tizcat.com.");
  }
  const user = await sessionUser(request, env);
  if (!user) {
    return error(401, "logged_out", "Not logged in.");
  }
  await env.SYNC.wipe(user.id);
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Email links

async function newEmailToken(env, userId, kind, lifetime, creds = {}) {
  const token = randomToken(32);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO email_tokens (token_hash, user_id, kind, created_at, expires_at, salt, verifier, kdf, vault_key) " +
    "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
  ).bind(await sha256(token), userId, kind, now, now + lifetime,
    creds.salt || null, creds.verifier || null, creds.kdf || null, creds.vault_key || null).run();
  return token;
}

async function tooManyLinks(env, userId, kind) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM email_tokens WHERE user_id = ?1 AND kind = ?2 AND created_at > ?3",
  ).bind(userId, kind, Date.now() - 3600_000).first();
  return !!row && row.n >= LINKS_PER_HOUR;
}

// Sends one of the account emails, or, for a test address with the test
// secret, hands the token back instead.
async function deliver(request, env, config, email, kind, token) {
  if (email.endsWith(TEST_DOMAIN)) {
    return testCaller(request, env) ? { ok: true, test: token } : { ok: false, reason: "test address" };
  }
  if (!config.features.email) {
    return { ok: false, reason: "email is switched off" };
  }
  const message = kind === "verify" ? verifyEmail(`${ORIGIN}/#verify=${token}`, VERIFY_HOURS)
    : kind === "reset" ? resetEmail(`${ORIGIN}/#reset=${token}&email=${encodeURIComponent(email)}`, RESET_MINUTES)
      : passwordChangedEmail();
  return sendMail(env, config, { to: email, ...message });
}

function testCaller(request, env) {
  const given = request.headers.get("x-tizcat-test") || "";
  const secret = env.TEST_SECRET || "";
  if (secret.length < 32 || given.length !== secret.length) {
    return false;
  }
  const enc = new TextEncoder();
  return sameBytes(enc.encode(given), enc.encode(secret));
}

function testPart(sent) {
  return sent && sent.test ? { test: { token: sent.test } } : {};
}

// ---------------------------------------------------------------------------
// Helpers

function accountView(user) {
  return { email: user.email, verified: !!user.email_verified, createdAt: user.created_at };
}

function pepper(env) {
  if (!env.PASSWORD_PEPPER || env.PASSWORD_PEPPER.length < 32) {
    throw new Error("PASSWORD_PEPPER is not set");
  }
  return env.PASSWORD_PEPPER;
}

// The same work whether or not the account exists, so timing tells nothing.
async function passwordMatches(env, user, authKey) {
  const salt = user ? user.salt : randomToken(16);
  const verifier = await verifierFor(pepper(env), salt, authKey);
  return !!user && sameBytes(fromBase64Url(verifier), fromBase64Url(user.verifier));
}

async function limited(limiter, request, extra = "") {
  if (!limiter) {
    return true;
  }
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const { success } = await limiter.limit({ key: `${ip}|${extra}` });
  return success;
}

// Cookie-based calls must come from the account site's own pages.
function sameOrigin(request) {
  return request.headers.get("origin") === ORIGIN;
}

function clearCookie() {
  return `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function cookieToken(request) {
  const cookies = request.headers.get("cookie") || "";
  for (const part of cookies.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) {
      const value = rest.join("=");
      return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
    }
  }
  return null;
}

function bearer(request) {
  const header = request.headers.get("authorization") || "";
  const m = header.match(/^Bearer (tzd_[A-Za-z0-9_-]{43})$/);
  return m ? m[1] : null;
}

// The logged-in account (with its password verifier and locked sync key
// when `full`), or null.
async function sessionUser(request, env, full = false) {
  const token = cookieToken(request);
  if (!token) {
    return null;
  }
  const fields = full
    ? "u.id, u.email, u.email_verified, u.created_at, u.salt, u.verifier, u.vault_key"
    : "u.id, u.email, u.email_verified, u.created_at";
  return env.DB.prepare(
    `SELECT ${fields} FROM sessions s JOIN users u ON u.id = s.user_id ` +
    "WHERE s.token_hash = ?1 AND s.expires_at > ?2",
  ).bind(await sha256(token), Date.now()).first();
}

async function deviceFor(env, token) {
  if (!token || !/^tzd_[A-Za-z0-9_-]{43}$/.test(token)) {
    return null;
  }
  const row = await env.DB.prepare(
    "SELECT id, user_id, last_seen_at FROM devices WHERE token_hash = ?1 AND revoked_at IS NULL",
  ).bind(await sha256(token)).first();
  if (!row) {
    return null;
  }
  // Note when it was last seen, at most once an hour (D1's free plan allows
  // 100,000 written rows a day).
  const now = Date.now();
  if (now - row.last_seen_at > 3600_000) {
    await env.DB.prepare("UPDATE devices SET last_seen_at = ?1 WHERE id = ?2").bind(now, row.id).run();
  }
  return { deviceId: row.id, accountId: row.user_id };
}

// Turnstile (Cloudflare's free bot check), once switched on in config.json
// with its secret set; until then every request passes.
async function turnstileOk(env, config, token, request) {
  if (!config.features.turnstile) {
    return true;
  }
  if (!token || !env.TURNSTILE_SECRET) {
    return false;
  }
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  form.append("remoteip", request.headers.get("cf-connecting-ip") || "");
  const answer = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  const result = await answer.json().catch(() => ({}));
  return result.success === true;
}

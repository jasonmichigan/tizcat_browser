// Live check of TizCat's servers, from outside, as TizCat and visitors use
// them. It makes a throwaway account on a test address (@test.tizcat.com:
// no email is ever sent there; the tests' secret makes the server hand the
// link's token back instead), confirms it, logs in, links a pretend
// browser, syncs, sends one ad view, changes and resets the password, then
// deletes the account.
//   node servers\tests\smoke.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomToken } from "../shared/crypto.js";
import { accountKeys } from "../shared/password.js";
import { newVaultKey, openCollection, sealCollection, unwrapVaultKey, wrapVaultKey } from "../shared/vault.js";

const TEST_SECRET = JSON.parse(readFileSync(
  join(process.env.LOCALAPPDATA, "TizCatServer", "secrets.json"), "utf8").replace(/^﻿/, "")).TEST_SECRET;

const API = "https://api.tizcat.com";
const ACCOUNT = "https://account.tizcat.com";
const WWW = "https://www.tizcat.com";
const results = [];

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "pass" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}

async function get(url, options = {}) {
  const response = await fetch(url, { redirect: "manual", ...options });
  const type = response.headers.get("content-type") || "";
  const body = type.includes("json") ? await response.json() : await response.text();
  return { response, body };
}

function cookieFrom(response) {
  const raw = response.headers.get("set-cookie") || "";
  const m = raw.match(/(__Host-tz_session=[^;]+)/);
  return m ? m[1] : "";
}

async function main() {
  // --- The API front door and the parts behind it
  let r = await get(`${API}/v1/health`);
  record("api health: every part answers ok", r.body.ok === true,
    Object.entries(r.body.parts || {}).map(([k, v]) => `${k} ${v.ok}`).join(", "));

  r = await get(`${API}/v1/config`);
  record("api config: JibCoin placeholder", r.body.ok && r.body.config.coin.name === "JibCoin" &&
    r.body.config.coin.mint === null && r.body.config.coin.payouts === false);

  r = await get(`${API}/v1/ads/catalog`);
  const ads = (r.body && r.body.ads) || [];
  record("ads catalog: the two house ads", ads.length >= 2, ads.map((a) => a.id).join(", "));
  const ntp = ads.find((a) => a.placement === "ntp");
  if (ntp) {
    const img = await fetch(ntp.image);
    record("ads picture served", img.ok && (img.headers.get("content-type") || "").startsWith("image/"),
      `${img.status} ${img.headers.get("content-type")}`);
  }

  r = await get(`${API}/v1/wallet/info`);
  record("wallet info: JibWallet coming", r.body.ok && r.body.wallet.name === "JibWallet");
  r = await get(`${API}/v1/wallet/send`, { method: "POST" });
  record("wallet placeholder answers 501", r.response.status === 501);

  r = await get(`${API}/v1/nothing`);
  record("unknown API call is 404", r.response.status === 404);

  // --- The website
  r = await get(`${WWW}/`);
  const h = r.response.headers;
  record("www home page", r.response.status === 200 && /<title>TizCat, the fast browser that keeps your secrets at home<\/title>/.test(r.body));
  record("www security headers", !!h.get("strict-transport-security") && !!h.get("content-security-policy") &&
    h.get("x-content-type-options") === "nosniff" && h.get("x-frame-options") === "DENY");
  r = await get(`${WWW}/whitepaper`);
  record("www whitepaper", r.response.status === 200 && r.body.includes("Version 0.1") && r.body.includes("Howey"));
  r = await get(`${WWW}/team`);
  record("www team page: both people and their addresses", r.response.status === 200 &&
    ["Ramona", "Business Manager", "ramona@tizcat.com", "Hamid", "Developer Manager", "hamid@tizcat.com"].every((s) => r.body.includes(s)));
  for (const photo of ["/img/team/ramona.jpg?v=2", "/img/team/hamid.jpg?v=4"]) {
    const img = await fetch(WWW + photo);
    record(`team photo ${photo.split("/").pop().split("?")[0]}`, img.ok && (img.headers.get("content-type") || "").startsWith("image/"));
  }
  r = await get(`${WWW}/sitemap.xml`);
  record("sitemap lists every page", r.response.status === 200 && (r.body.match(/<loc>/g) || []).length >= 14);
  r = await get("https://tizcat.com/about");
  record("tizcat.com sends to www", r.response.status === 301 &&
    r.response.headers.get("location") === `${WWW}/about`);
  r = await get("https://tizcat.com/go/account");
  record("go/account leads to the account site", r.response.status === 302 &&
    r.response.headers.get("location") === `${ACCOUNT}/`);
  r = await get(`${WWW}/pages/home.html`);
  record("page files are not served on their own", r.response.status === 404);
  r = await get(`${WWW}/no-such-page`);
  record("missing page is 404 in the layout", r.response.status === 404 && r.body.includes("Page not found"));

  // --- An account, end to end
  const email = `smoke-${randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, "x")}@test.tizcat.com`;
  const password = `smoke ${randomToken(12)}`;
  const keys = await accountKeys(password, email);
  const authKey = keys.authKey;
  const vaultKey = newVaultKey();
  const site = { origin: ACCOUNT, "content-type": "application/json", "x-tizcat-test": TEST_SECRET };
  const post = (path, body, extra = {}) => get(`${ACCOUNT}/v1/account/${path}`,
    { method: "POST", headers: { ...site, ...extra }, body: JSON.stringify(body) });
  r = await get(`${ACCOUNT}/`);
  record("account site page", r.response.status === 200 && r.body.includes("Log in to TizCat") &&
    r.body.includes("Forgot your password?") && !!r.response.headers.get("content-security-policy"));

  r = await get(`${ACCOUNT}/v1/account/signup`, {
    method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ email, authKey, vaultKey: await wrapVaultKey(keys.wrapKey, vaultKey) }),
  });
  record("sign-up from another site is refused", r.response.status === 403);

  r = await post("signup", { email, authKey, vaultKey: await wrapVaultKey(keys.wrapKey, vaultKey) },
    { "x-tizcat-test": "wrong" });
  record("a test address gets no email without the tests' secret", r.response.status === 503);

  r = await post("signup", { email, authKey, vaultKey: await wrapVaultKey(keys.wrapKey, vaultKey) });
  const verifyToken = r.body.test && r.body.test.token;
  record("sign up: waits for the email to be confirmed", r.response.status === 201 && r.body.pending === true &&
    !!verifyToken && !cookieFrom(r.response));

  r = await post("login", { email, authKey });
  record("an unconfirmed account cannot log in", r.response.status === 403 && r.body.error.code === "not_verified");

  r = await post("signup", { email, authKey, vaultKey: await wrapVaultKey(keys.wrapKey, vaultKey) });
  record("signing up again before confirming sends a new link", r.response.status === 201 && !!r.body.test);

  r = await post("verify-email", { token: "A".repeat(43) });
  record("a made-up confirmation link is refused", r.response.status === 400 && r.body.error.code === "bad_link");
  r = await post("verify-email", { token: verifyToken });
  record("the emailed link activates the account", r.body.ok === true && r.body.email === email);
  r = await post("verify-email", { token: verifyToken });
  record("the link works only once", r.response.status === 400);

  r = await post("signup", { email, authKey, vaultKey: await wrapVaultKey(keys.wrapKey, vaultKey) });
  record("an active account's address cannot sign up again", r.response.status === 409);

  r = await post("login", { email, authKey: (await accountKeys("wrong password!", email)).authKey });
  record("wrong password is refused", r.response.status === 401);

  r = await post("login", { email, authKey });
  let cookie = cookieFrom(r.response);
  const unlocked = r.body.vaultKey ? await unwrapVaultKey(keys.wrapKey, r.body.vaultKey) : null;
  record("log in", r.response.status === 200 && r.body.account.email === email && r.body.account.verified === true && !!cookie);
  record("log in hands back the sync key, which only the password unlocks", unlocked === vaultKey);

  r = await get(`${ACCOUNT}/v1/account/devices`, {
    method: "POST", headers: { ...site, cookie }, body: JSON.stringify({ name: "smoke test" }),
  });
  const token = r.body.token;
  const deviceId = r.body.device && r.body.device.id;
  record("link a device", r.response.status === 201 && /^tzd_/.test(token || ""));

  r = await get(`${API}/v1/account/me`, { headers: { authorization: `Bearer ${token}` } });
  record("device token works through api.tizcat.com", r.body.ok && r.body.account.email === email);

  const eventId = randomToken(16);
  const event = { eventId, adId: ntp ? ntp.id : "house-ntp-1", placement: "ntp", kind: "view" };
  const send = () => get(`${API}/v1/ads/events`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(event),
  });
  r = await send();
  record("ad view earns a point", r.body.ok && r.body.credited === true && r.body.points === 1, JSON.stringify(r.body));
  r = await send();
  record("the same event twice counts once", r.body.ok && r.body.credited === false, r.body.reason);

  r = await get(`${API}/v1/rewards/balance`, { headers: { authorization: `Bearer ${token}` } });
  record("points balance", r.body.ok && r.body.points === 1 && r.body.coin.name === "JibCoin");

  r = await get(`${API}/v1/ads/events`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...event, eventId: randomToken(16) }),
  });
  record("an unlinked browser earns nothing on the server", r.body.ok && r.body.credited === false &&
    r.body.reason === "not_linked");

  r = await get(`${API}/v1/rewards/balance`, {
    headers: { "x-tizcat-account": "u_forged", authorization: "Bearer tzd_" + "A".repeat(43) },
  });
  record("forged account header is ignored", r.response.status === 401);

  // --- Sync: encrypted on the device, stored as is
  const auth = { authorization: `Bearer ${token}` };
  const bookmarks = { schema: 1, items: { a: { title: "Smoke", url: "https://example.com/" } } };
  const sealed = await sealCollection(vaultKey, "bookmarks", bookmarks);
  r = await get(`${API}/v1/sync/bookmarks`, { headers: auth });
  record("sync: nothing synced yet", r.response.status === 404);
  r = await get(`${API}/v1/sync/bookmarks`, { method: "PUT", headers: { ...auth, "if-match": "0", "content-type": "text/plain" }, body: sealed });
  const v1 = r.body.version;
  record("sync: upload a collection (a new one starts at the time, never at a reused number)",
    r.body.ok === true && v1 > Date.now() - 600_000, JSON.stringify(r.body));
  r = await get(`${API}/v1/sync/bookmarks`, { method: "PUT", headers: { ...auth, "if-match": "0", "content-type": "text/plain" }, body: sealed });
  record("sync: an upload made from an old copy is refused", r.response.status === 412 && r.body.version === v1);
  r = await get(`${API}/v1/sync/bookmarks`, { method: "PUT", headers: { ...auth, "if-match": String(v1), "content-type": "text/plain" }, body: sealed });
  record("sync: an upload made from the current copy is next", r.body.ok === true && r.body.version === v1 + 1);
  r = await get(`${API}/v1/sync/bookmarks`, { headers: auth });
  const back = r.response.ok ? await openCollection(vaultKey, "bookmarks", r.body) : null;
  record("sync: download and decrypt it", r.response.headers.get("x-tizcat-version") === String(v1 + 1) &&
    back && back.items.a.title === "Smoke");
  r = await get(`${API}/v1/sync/bookmarks`, { headers: { authorization: "Bearer tzd_" + "A".repeat(43) } });
  record("sync: a made-up token reads nothing", r.response.status === 401);
  r = await get(`${API}/v1/sync`, { headers: auth });
  record("sync: list of collections", r.body.ok && r.body.collections.length === 1 && r.body.collections[0].name === "bookmarks");
  r = await get(`${ACCOUNT}/v1/account/sync`, { headers: { origin: ACCOUNT, cookie } });
  record("account page sees what is synced (not what it says)", r.body.ok && r.body.collections[0].name === "bookmarks");

  // --- Change the password: same sync key, browsers stay signed in
  const next = await accountKeys(`${password} changed`, email);
  r = await post("change-password", { authKey: (await accountKeys("not it at all", email)).authKey, newAuthKey: next.authKey,
    vaultKey: await wrapVaultKey(next.wrapKey, vaultKey) }, { cookie });
  record("change password needs the current one", r.response.status === 401);
  r = await post("change-password", { authKey, newAuthKey: next.authKey, vaultKey: await wrapVaultKey(next.wrapKey, vaultKey) }, { cookie });
  record("change password", r.body.ok === true);
  r = await post("login", { email, authKey });
  record("the old password no longer works", r.response.status === 401);
  r = await post("unlock", { authKey: next.authKey }, { cookie });
  record("the new password unlocks the same sync key", r.body.ok && await unwrapVaultKey(next.wrapKey, r.body.vaultKey) === vaultKey);
  r = await get(`${API}/v1/sync/bookmarks`, { headers: auth });
  record("the browser still syncs after a password change", r.response.status === 200);

  // --- Forgot the password: reset by email link
  r = await post("forgot-password", { email: `nobody-${randomToken(4)}@test.tizcat.com` });
  record("forgot password: the same answer for an unknown address", r.body.ok === true && !r.body.test);
  r = await post("forgot-password", { email });
  const resetToken = r.body.test && r.body.test.token;
  record("forgot password: a reset link", r.body.ok === true && !!resetToken);
  const reset = await accountKeys(`${password} reset`, email);
  const newVault = newVaultKey();
  r = await post("reset-password", { token: resetToken, email: "other@test.tizcat.com", authKey: reset.authKey,
    vaultKey: await wrapVaultKey(reset.wrapKey, newVault) });
  record("reset: the email must be the account's", r.response.status === 400 && r.body.error.code === "wrong_email");
  r = await post("reset-password", { token: resetToken, email, authKey: reset.authKey, vaultKey: await wrapVaultKey(reset.wrapKey, newVault) });
  record("reset the password", r.body.ok === true);
  r = await get(`${API}/v1/account/me`, { headers: auth });
  record("a reset signs out the browsers", r.response.status === 401);
  r = await post("login", { email, authKey: reset.authKey });
  cookie = cookieFrom(r.response);
  record("log in with the new password, a new sync key", r.response.status === 200 &&
    await unwrapVaultKey(reset.wrapKey, r.body.vaultKey) === newVault);
  r = await get(`${ACCOUNT}/v1/account/sync`, { headers: { origin: ACCOUNT, cookie } });
  record("a reset clears the synced copy it can no longer unlock", r.body.ok && r.body.collections.length === 0);

  // --- Clean up
  r = await get(`${ACCOUNT}/v1/account/me`, { method: "DELETE", headers: { ...site, cookie }, body: JSON.stringify({ authKey: authKey }) });
  record("deleting the account needs the password", r.response.status === 401);
  r = await get(`${ACCOUNT}/v1/account/me`, { method: "DELETE", headers: { ...site, cookie }, body: JSON.stringify({ authKey: reset.authKey }) });
  record("delete the test account", r.body.ok === true);
  r = await post("login", { email, authKey: reset.authKey });
  record("a deleted account can no longer log in", r.response.status === 401);

  const failed = results.filter((x) => !x.pass).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

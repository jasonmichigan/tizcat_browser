// Tests for the servers' own logic, with no network and no Cloudflare:
//   node --test servers\tests\servers.test.mjs
// (Node 20 or newer; Web Crypto is the same as in Workers.)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { fromBase64Url, randomToken, sameBytes, toBase64Url } from "../shared/crypto.js";
import { accountKeys, normalizeEmail, ROUNDS, validAuthKey, validEmail, verifierFor } from "../shared/password.js";
import { check } from "../shared/validate.js";
import {
  newVaultKey, openCollection, sealCollection, unwrapVaultKey, validWrappedKey, wrapVaultKey,
} from "../shared/vault.js";
import { overDailyLimit, pointsFor, utcDay } from "../rewards/src/rules.js";
import { passwordChangedEmail, resetEmail, verifyEmail } from "../shared/emails.js";

const config = JSON.parse(readFileSync(new URL("../config/config.json", import.meta.url)));
const authKeyOf = async (password, email) => (await accountKeys(password, email)).authKey;

test("base64url round trip", () => {
  const bytes = crypto.getRandomValues(new Uint8Array(33));
  assert.deepEqual(fromBase64Url(toBase64Url(bytes)), bytes);
  assert.match(randomToken(32), /^[A-Za-z0-9_-]{43}$/);
  const big = crypto.getRandomValues(new Uint8Array(65536)).map((b, i) => (i % 3 ? b : 255 - b));
  const bigger = new Uint8Array(200_001);
  for (let i = 0; i < bigger.length; i += big.length) bigger.set(big.subarray(0, Math.min(big.length, bigger.length - i)), i);
  assert.deepEqual(fromBase64Url(toBase64Url(bigger)), bigger, "large data (sliced encoding)");
});

test("password: two keys, of the agreed form, that depend on the email", async () => {
  assert.equal(ROUNDS, 600000);
  const a = await accountKeys("correct horse battery", "Hamid@Example.com ");
  const b = await accountKeys("correct horse battery", "hamid@example.com");
  const c = await accountKeys("correct horse battery", "other@example.com");
  assert.ok(validAuthKey(a.authKey) && validAuthKey(a.wrapKey));
  assert.deepEqual(a, b, "the email is normalized before it salts the keys");
  assert.notEqual(a.authKey, c.authKey);
  assert.notEqual(a.authKey, a.wrapKey, "the key sent to the server is not the one that locks the data");
});

test("password: the server's verifier needs the right key, salt and pepper", async () => {
  const pepper = randomToken(48);
  const salt = randomToken(16);
  const key = await authKeyOf("a long password", "x@example.com");
  const stored = await verifierFor(pepper, salt, key);
  const again = await verifierFor(pepper, salt, key);
  assert.ok(sameBytes(fromBase64Url(stored), fromBase64Url(again)));
  const wrongKey = await verifierFor(pepper, salt, await authKeyOf("another password", "x@example.com"));
  const wrongPepper = await verifierFor(randomToken(48), salt, key);
  const wrongSalt = await verifierFor(pepper, randomToken(16), key);
  for (const other of [wrongKey, wrongPepper, wrongSalt]) {
    assert.ok(!sameBytes(fromBase64Url(stored), fromBase64Url(other)));
  }
});

test("emails", () => {
  assert.equal(normalizeEmail("  A@B.Com "), "a@b.com");
  assert.ok(validEmail("someone@tizcat.com"));
  assert.ok(!validEmail("someone@tizcat"));
  assert.ok(!validEmail("no spaces@tizcat.com"));
});

test("contracts accept good bodies and refuse bad ones", () => {
  const key = "A".repeat(43);
  const vaultKey = `v1.${"B".repeat(16)}.${"C".repeat(64)}`;
  assert.equal(check("account.signup", { email: "a@b.com", authKey: key, vaultKey }), null);
  assert.match(check("account.signup", { email: "a@b.com", authKey: key }), /vaultKey is missing/);
  assert.match(check("account.signup", { email: "a@b.com", vaultKey }), /authKey is missing/);
  assert.match(check("account.signup", { email: "a@b.com", authKey: key, vaultKey, password: "x" }), /not allowed/);
  assert.match(check("account.signup", { email: "a@b.com", authKey: key, vaultKey: "v1x" + vaultKey.slice(3) }), /wrong form/);
  assert.match(check("account.login", { email: "a@b.com", authKey: "short" }), /wrong form/);
  assert.equal(check("account.verify", { token: key }), null);
  assert.equal(check("account.email", { email: "a@b.com" }), null);
  assert.equal(check("account.reset", { token: key, email: "a@b.com", authKey: key, vaultKey }), null);
  assert.match(check("account.reset", { token: key, authKey: key, vaultKey }), /email is missing/);
  assert.equal(check("account.changePassword", { authKey: key, newAuthKey: key, vaultKey }), null);
  assert.match(check("account.changePassword", { authKey: key, vaultKey }), /newAuthKey is missing/);
  assert.equal(check("account.password", { authKey: key }), null);
  const event = { eventId: randomToken(16), adId: "house-ntp-1", placement: "ntp", kind: "view" };
  assert.equal(check("ads.event", event), null);
  assert.match(check("ads.event", { ...event, kind: "hover" }), /one of view, click/);
  assert.match(check("ads.event", { ...event, at: 1.5 }), /whole number/);
});

test("rewards rules come from the live config", () => {
  assert.equal(pointsFor(config, "ntp", "view"), 1);
  assert.equal(pointsFor(config, "notification", "click"), 5);
  assert.equal(pointsFor(config, "ntp", "click"), 0, "no points for what the config does not list");
  assert.equal(utcDay(Date.UTC(2026, 10, 18, 23, 59)), "2026-11-18");
  assert.ok(!overDailyLimit(config, config.rewards.dailyEventsPerDevice - 1));
  assert.ok(overDailyLimit(config, config.rewards.dailyEventsPerDevice));
});

test("the account page and TizCat Services use the same key code as the server", () => {
  for (const name of ["password.js", "crypto.js", "vault.js"]) {
    const shared = readFileSync(new URL(`../shared/${name}`, import.meta.url), "utf8");
    const page = readFileSync(new URL(`../account/site/js/${name}`, import.meta.url), "utf8");
    assert.equal(page, shared, `account/site/js/${name} is out of date: run deploy.ps1 account`);
  }
  for (const name of ["crypto.js", "vault.js"]) {
    const shared = readFileSync(new URL(`../shared/${name}`, import.meta.url), "utf8");
    const module = readFileSync(new URL(`../../modules/services/lib/${name}`, import.meta.url), "utf8");
    assert.equal(module, shared, `modules/services/lib/${name} is out of date: copy it from servers/shared`);
  }
});

test("vault: the sync key is locked with the password's wrapKey", async () => {
  const { wrapKey } = await accountKeys("a long password", "x@example.com");
  const other = (await accountKeys("not the password", "x@example.com")).wrapKey;
  const vaultKey = newVaultKey();
  const wrapped = await wrapVaultKey(wrapKey, vaultKey);
  assert.ok(validWrappedKey(wrapped), wrapped);
  assert.equal(await unwrapVaultKey(wrapKey, wrapped), vaultKey);
  await assert.rejects(unwrapVaultKey(other, wrapped), "a wrong password cannot unlock it");
  // A changed password locks the same key again: nothing synced is lost.
  const rewrapped = await wrapVaultKey(other, await unwrapVaultKey(wrapKey, wrapped));
  assert.equal(await unwrapVaultKey(other, rewrapped), vaultKey);
});

test("vault: collections are sealed for one key and one name", async () => {
  const key = newVaultKey();
  const value = { schema: 1, items: { a: { title: "Ünïcødé ✓", url: "https://example.com/" } }, n: [1, 2, 3] };
  const sealed = await sealCollection(key, "bookmarks", value);
  assert.match(sealed, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(await openCollection(key, "bookmarks", sealed), value);
  assert.ok(!sealed.includes("example"), "nothing readable on the server");
  await assert.rejects(openCollection(newVaultKey(), "bookmarks", sealed), "another key cannot open it");
  await assert.rejects(openCollection(key, "settings", sealed), "it cannot pass for another collection");
  // Large and repetitive data shrinks before it is encrypted.
  const many = { items: Array.from({ length: 5000 }, (_, i) => ({ title: `Bookmark ${i}`, url: `https://example.com/page/${i}` })) };
  const big = await sealCollection(key, "bookmarks", many);
  assert.ok(big.length < JSON.stringify(many).length / 3, `${big.length} characters for ${JSON.stringify(many).length}`);
  assert.deepEqual(await openCollection(key, "bookmarks", big), many);
});

test("account emails: subject, link and plain words", () => {
  const link = "https://account.tizcat.com/#verify=abc";
  for (const mail of [verifyEmail(link, 48), resetEmail(link.replace("verify", "reset"), 60), passwordChangedEmail()]) {
    assert.ok(mail.subject && mail.text && mail.html);
    assert.ok(!/[–—]/.test(mail.subject + mail.text + mail.html), "no long dashes");
  }
  assert.ok(verifyEmail(link, 48).html.includes(link) && verifyEmail(link, 48).text.includes(link));
  assert.ok(verifyEmail('https://x/"><script>', 48).html.includes("&quot;&gt;&lt;script&gt;"), "links are escaped");
});

test("every page in site.json exists, and /go/ links stay on tizcat.com", () => {
  const site = JSON.parse(readFileSync(new URL("../web/site/site.json", import.meta.url)));
  for (const page of site.pages) {
    readFileSync(new URL(`../web/site/pages/${page.file}`, import.meta.url));
  }
  const footerPaths = site.footer.flatMap((col) => (typeof col === "string" ? [col] : col.links));
  for (const path of [...site.menu, ...footerPaths]) {
    assert.ok(site.pages.some((p) => p.path === path), `${path} is in a menu but not a page`);
  }
  // Every picture a page uses must exist in the site's files.
  for (const page of site.pages) {
    const html = readFileSync(new URL(`../web/site/pages/${page.file}`, import.meta.url), "utf8");
    for (const [, src] of html.matchAll(/src="(\/img\/[^"?]+)/g)) {
      readFileSync(new URL(`../web/site${src}`, import.meta.url));
    }
    assert.ok(!/style="/.test(html), `${page.file} has an inline style (the CSP blocks it)`);
    assert.ok(!/[–—]/.test(html), `${page.file} has a long dash`);
  }
  // The website does not say what TizCat is built from (the user's choice,
  // 2026-11-18). Naming other browsers as import sources or for extension
  // compatibility is fine; naming the engine is not. Figures: make_figures.py --web.
  const shared = ["layout.html", "site.json"].map((f) => readFileSync(new URL(`../web/site/${f}`, import.meta.url), "utf8"));
  for (const [i, text] of [...shared, ...site.pages.map((p) => readFileSync(new URL(`../web/site/pages/${p.file}`, import.meta.url), "utf8"))].entries()) {
    const name = i < 2 ? ["layout.html", "site.json"][i] : site.pages[i - 2].file;
    assert.ok(!/chromium|electron/i.test(text), `${name} names the browser engine`);
    // JibCoin, JibWallet and TizCat Cloud are described, never dated or given
    // a status (the user's choice, 2026-11-18). JibCoin's "Coming Soon..."
    // badge is the user's own wording and the one exception.
    const status = /not (yet|issued)|does not exist|may never|proposed|planned|placeholder|to be (decided|chosen)|before issuance|first release|pilot|on the way|to come\b|will be issued|\bdraft\b/i;
    assert.ok(!status.test(text), `${name} says whether something exists yet: "${(text.match(status) || [])[0]}"`);
  }
  for (const [name, url] of Object.entries(config.go)) {
    assert.match(url, /^https:\/\/([a-z0-9-]+\.)*tizcat\.com(\/|$)/, `go/${name}`);
  }
});

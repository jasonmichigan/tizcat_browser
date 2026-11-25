# TizCat's services: the map

TizCat has accounts (like Brave's and Firefox's: email and password,
confirmed by email), sync (bookmarks, settings, TizCat's own data and a
holder for JibWallet, encrypted on the device), TizCat Rewards (ads like
Brave's, earning points), and placeholders for JibWallet (TizCat's own
wallet) and JibCoin (the coin points will become). Everything runs on
Cloudflare's **free** plan.

The rule that keeps updates quick: **the browser holds only small,
permanent hooks.** Anything likely to change lives in a module (files copied
in at every start) or on a server (deployed in seconds, one part at a time).
A Chromium rebuild takes hours; nothing below needs one.

## The parts

| Part | Where it runs | Folder | To update | Takes |
|---|---|---|---|---|
| Website | www.tizcat.com (tizcat.com sends there) | `servers\web` | `deploy.ps1 web` | seconds |
| Account site and API | account.tizcat.com | `servers\account` | `deploy.ps1 account` | seconds |
| Front door | api.tizcat.com | `servers\api` | `deploy.ps1 api` | seconds |
| Ads | behind api.tizcat.com | `servers\ads` | `deploy.ps1 ads` | seconds |
| Rewards points | behind api.tizcat.com | `servers\rewards` | `deploy.ps1 rewards` | seconds |
| JibWallet (placeholder) | behind api.tizcat.com | `servers\wallet` | `deploy.ps1 wallet` | seconds |
| Sync (encrypted data store) | behind api.tizcat.com | `servers\sync` | `deploy.ps1 sync` | seconds |
| Live settings | Cloudflare KV `tizcat-config` | `servers\config\config.json` | `deploy.ps1 config` | seconds, nothing redeployed |
| TizCat Services (New Tab, Rewards panel, notification ads, sync) | inside TizCat | `modules\services` | restart TizCat | a restart |
| JibWallet (placeholder: toolbar button and panel) | inside TizCat | `modules\wallet` | restart TizCat | a restart |
| Browser hooks | TizCat itself | `patches\0006`, `0007` | rebuild | hours, rarely |

All commands: `powershell -ExecutionPolicy Bypass -File servers\scripts\deploy.ps1 <part>`
from `tizcat\`. `all` deploys everything in order; `health` asks every part
how it is.

How they connect:

```
TizCat ── Settings, Profile: "TizCat account" ─► tizcat.com/go/account ─► account.tizcat.com
   │                                            (where /go/ leads: config.json "go")
   └─ TizCat Services module ── HTTPS, device token ─► api.tizcat.com/v1/...
                                                          ├─ /account ─► tizcat-account
                                                          ├─ /ads     ─► tizcat-ads ─► tizcat-rewards
                                                          ├─ /rewards ─► tizcat-rewards
                                                          ├─ /wallet  ─► tizcat-wallet (placeholder)
                                                          └─ /sync    ─► tizcat-sync (encrypted, unreadable to it)
account.tizcat.com page ── externally_connectable ─► TizCat Services (hands it the device token
                                                     and the account's sync key)
tizcat-account ── SYNC.wipe() on a password reset or account deletion ─► tizcat-sync
```

Workers talk to each other over **service bindings** (no internet hop, no
extra requests counted). Only `web`, `account` and `api` have addresses;
`ads`, `rewards`, `wallet` and `sync` can't be reached from the internet at
all.

## Common changes

- **A website page.** Pages are `servers\web\site\pages\<name>.html`, content
  only. Add or rename one in `site\site.json` (its address, title, menu
  label, description; `menu` and `footer` list which appear where). Then
  `deploy.ps1 web`.
- **The website's design.** `site\layout.html` (header with the mobile menu
  button, footer columns; shared by every page) and `site\css\site.css`
  (sections in order: design tokens, base, layout, header and footer,
  components, page sections, small screens). Components to reuse in a page:
  `page-hero`, `section` / `section-alt`, `split` (text beside a figure),
  `grid grid-2|3|4` of `card`s with an `icon`, `steps`, `stats`,
  `table-wrap`, `callout` / `callout info`, `figure`, `cta-band`,
  `details.faq`, `doc` (long reading with a contents list), `person` (team).
  No inline `style="..."` anywhere: the content security policy blocks it
  (the tests check). **Raise `assetVersion` in `site.json` whenever CSS, JS or
  an image changes:** files named `?v=<version>` are cached by browsers for a
  year, so without a new version people keep the old file.
- **Footer columns.** `site.json` "footer" is a list of
  `{title, links: [paths]}`; "menu" is the header's list of paths.
- **The website does not say what TizCat is built from** (the user's
  choice, 2026-11-18): no "Chromium" or "Electron" on any page, in the
  footer or in site.json (a test checks). Naming other browsers as import
  sources, for extension compatibility or in benchmarks is fine. Never claim
  the engine is TizCat's own work. The browser itself keeps its open source
  credits and licenses; that is where the license notices belong.
- **The website describes JibCoin, JibWallet and TizCat Cloud without a
  status** (the user's choice, 2026-11-18): no "not issued", "proposed",
  "planned", "later", "first release", release dates or future roadmap; write
  "designed to" instead of "will". JibCoin's "Coming Soon..." badge is the
  user's own wording and stays. Keep the legal lines that are not about
  status: not an offer to sell, not an invitation to invest, no promise of
  value, price, listing or returns, and official details only on tizcat.com.
  The same test checks the wording. The Download page still says the
  browser is being prepared (a Download page with no download has to).
- **Pictures.** Figures from `visuals\about_v1.docx` are in
  `site\img\figures` as WebP (made from `visuals\about_v1_figures`; fig1, fig3,
  fig4, fig7 and fig9 have website wording, made by
  `python visuals\about_v1_source\make_figures.py --web`); team
  photos in `site\img\team` (600 by 600 JPEG, metadata checked). Keep
  pictures small: the site is meant to be as fast as the browser.
- **Team email** (`hamid@tizcat.com`, `ramona@tizcat.com`): Cloudflare
  Email Routing (free, enabled 2026-11-18; MX, SPF and DKIM records added by
  Cloudflare) forwards each to its owner's Gmail; sending is Gmail's "Send
  mail as" through smtp.gmail.com with a Google app password. Step-by-step
  for both people: `servers\email_v1.docx`. Forwarding rules need verified
  destinations; `servers\scripts\email-routing-watch.ps1` creates them as
  soon as each Gmail clicks Cloudflare's link (log in
  `%LOCALAPPDATA%\TizCatServer\email-routing.log`). New addresses:
  `npx wrangler@4.157.0 email routing addresses create <gmail>` then
  `... rules create tizcat.com --match-type literal --match-field to
  --match-value <name>@tizcat.com --action-type forward --action-value <gmail>`.
- `sitemap.xml` and `robots.txt` are made by the web server from
  `site.json`; nothing to edit.
- **The whitepaper, JibCoin, JibWallet pages.** Placeholders now
  (`whitepaper.html`, `jibcoin.html`, `wallet.html`); write the content in
  place of the dashed "placeholder" box.
- **Where a TizCat link leads.** `config.json` "go" (only https addresses on
  tizcat.com are followed). `deploy.ps1 config`.
- **Ad frequency, points per ad, daily limit, switching a feature off.**
  `config.json` "ads", "rewards", "features". `deploy.ps1 config`. Servers
  and modules pick it up within a minute (servers) or an hour (modules).
- **A new ad.** Put its picture in `servers\ads\media` (New Tab pictures
  1920x1080 JPEG; notification icons 192x192 PNG), add a migration in
  `servers\ads\migrations` (see `0002_house_ads.sql`), then `deploy.ps1 ads`.
- **The New Tab page or the Rewards panel.** `modules\services`
  (`newtab.*`, `rewards.*`, `sw.js`). Restart TizCat (`run.ps1` copies
  modules in). Test in Edge first: `node tests\services-live.js edge`.
- **A new kind of synced data** (the user's "other information, defined
  later"): either a holder (one JSON document, one line in `HOLDERS` in
  `modules\services\lib\sync\kinds.js`; JibWallet's is `wallet`), or a kind
  with its own read and apply (like `settings` there), listed in `KINDS` in
  `engine.js`. No server change: the sync server stores any kind by name.
  Its label for the account page goes in `KINDS` in
  `servers\account\site\js\account.js`.
- **Which browser settings sync:** `SYNCED_PREFS` in
  `modules\services\lib\sync\kinds.js` (the names Settings uses; Chrome's
  and Brave's synced choices, nothing tied to one computer).
- **JibWallet's panel** (since 2026-11-23, the user's request after
  Brave Wallet's "Unlock Wallet" panel): `modules\wallet` (ID
  `icnhcgjehlgijghlfmmijhoakpaehpag`), `panel.html`, `panel.css`,
  `panel.js`; its icon is drawn by `python modules\make_icons.py wallet`.
  A placeholder: the password field and the Unlock and Restore buttons are
  switched off and it says JibWallet is not ready yet. Its gear opens
  Settings > JibWallet (patch 0006). Design and structure are still to be
  decided. Test: `node tests\wallet-live.js`.
- **A new module:** a folder in `modules\` with a manifest and a fixed
  `key` (an RSA public key, made with Node's `crypto.generateKeyPairSync`
  and exported as SPKI DER in base64; the ID is the first 32 hex digits of
  its SHA-256, written with a to p; the private key is not needed). TizCat
  loads every folder in `modules\` since patch 0007: no rebuild. Its
  toolbar button is pinned the first time it arrives in a profile (also
  0007; Chromium itself leaves built-in extensions' buttons in the
  extensions menu); after that the person's choice stands.
- **A new server part:** a folder in `servers\` like `wallet\`, a binding in
  `servers\api\wrangler.jsonc` and a line in `PARTS` in `api\src\index.js`,
  then deploy the part, then `api`.

## Contracts

`servers\contracts\v1\requests.json` defines every request body the servers
accept; the servers check against it (`shared\validate.js`) and so do the
tests. Answers have one shape: `{ok: true, ...}` or
`{ok: false, error: {code, message}}`. A change that keeps v1 working is
safe for every part; a change that breaks it is a new `/v2/` path, with v1
kept until TizCat no longer uses it.

Messages between the account page and TizCat Services
(`chrome.runtime.sendMessage` to `genbfkjaiacbeljlbeodfphddkkdohcp`):
`tizcat.hello` -> `{ok, version, linked, deviceId, email, sync}`;
`tizcat.link {token, deviceId, email, vaultKey}` -> `{ok}` (signs this
TizCat in and starts the first sync); `tizcat.unlink` -> `{ok}`;
`tizcat.openSync` opens the sync page. Holders: `tizcat.holder.get {name}`,
`tizcat.holder.set {name, doc}` (from the module's own pages, and from other
TizCat modules listed in `HOLDER_MODULES` in `sw.js`).

Sync (`/v1/sync`, device token): `GET /v1/sync` lists the kinds with their
versions; `GET /v1/sync/<kind>` gives the encrypted text (version in
`X-TizCat-Version`); `PUT /v1/sync/<kind>` with `If-Match: <version it was
made from>` (0 for new) stores a new copy, or answers 412 when another TizCat
was first (download, merge, try again). A new kind starts at the time in
milliseconds, so one deleted and made again never repeats a version.

## Accounts and security

- **The account flow, as other software does it:** sign up (email, password
  twice, agree to the terms) -> "Check your email" -> the link in the email
  activates the account (48 hours, once) -> log in. An account that is not
  confirmed cannot log in; signing up again with the address replaces it and
  sends a new link, and each link activates the password of the sign-up that
  sent it (so someone who signs up with your address first cannot get their
  password onto your account). Forgot password: a reset link (1 hour, once).
  Change password (current one needed), log out, sign out a TizCat, delete
  the account (password needed). Answers to "forgot" and "resend" are the
  same whether or not the address has an account.
- **Passwords** (email and password, the user's choice): the page stretches
  the password with PBKDF2-SHA256, 600,000 rounds, salted with the email,
  and splits the result (HKDF) into two keys: `authKey`, sent to log in,
  and `wrapKey`, which never leaves the device (`shared\password.js`, the
  one source; the page gets a copy at deploy). The server stores only
  HMAC-SHA256(pepper, per-account salt + authKey). The password never
  leaves the page, and the server stays inside the free plan's 10 ms of
  computing per request.
- **Sync is end to end encrypted** (as Firefox and Brave; Chrome only with a
  passphrase): each account has a random vault key, stored on the server
  only locked with `wrapKey` (`shared\vault.js`). TizCat browsers get it
  when they sign in and encrypt every kind (gzip, then AES-256-GCM, bound to
  its name) before uploading. The server cannot read bookmarks, settings or
  JibWallet's data. A password change locks the same key again (nothing
  lost, browsers stay signed in). A reset cannot unlock it: a new key is
  made, the server's copy is deleted and every TizCat is signed out; they
  keep their data and upload it again after signing in. Clearing the synced
  copy from the account page never deletes anything in a TizCat (an empty
  server is a fresh start, not "everything was deleted").
- **Email** (`config.json` "email"): `provider` is `cloudflare` (free; only
  addresses verified in Email Routing receive mail, today the two team
  Gmails), `resend` or `brevo`. To let anyone sign up: make a free Resend
  account (100 emails a day) or Brevo account (300 a day), add tizcat.com
  there and put the DNS records it shows into Cloudflare (Resend uses a
  `send` subdomain and DKIM, so the inbound mail records stay), create an
  API key, run `deploy.ps1 mail-key` (it asks for the key, hidden, and sets
  it as a Cloudflare secret), set `provider`, then `deploy.ps1 config`. No
  code change. Emails come from `account@tizcat.com` (`email.from`).
  Addresses on `@test.tizcat.com` never get mail: they are for the tests,
  which use `TEST_SECRET` (made by `deploy.ps1 secrets`, kept in
  `%LOCALAPPDATA%\TizCatServer\secrets.json`) to get the link's token back.
- **The pepper** (`PASSWORD_PEPPER`) is a Cloudflare secret, made once by
  `deploy.ps1 secrets`, with its only copy in
  `%LOCALAPPDATA%\TizCatServer\secrets.json` (outside the synced folder).
  **Back it up in a password manager.** If it is lost, every password stops
  working and everyone must reset theirs.
- Sessions: an `__Host-` cookie on account.tizcat.com (HttpOnly, Secure,
  SameSite=Lax), 30 days. Calls that use the cookie must come from the
  account site's own pages (Origin checked). Devices: a `tzd_` token kept by
  TizCat Services, revocable on the account page. Only hashes of tokens are
  stored.
- Log-in tries: 10 a minute per address and place; emails asked for: 5 a
  minute per place and 5 an hour per account; sync calls: 60 a minute per
  TizCat (rate-limit bindings).
- **No browser warnings:** HTTPS only (plain http is redirected; HSTS for a
  year on tizcat.com and its subdomains), certificates issued and renewed by
  Cloudflare, a strict content security policy on every page, no framing,
  no camera, microphone or location. `/go/` links follow only tizcat.com
  addresses.
- Deleting an account deletes its devices, sessions, synced data and
  Rewards points.
- Ads are matched in the browser (as Brave): the catalog goes to the device,
  browsing history never comes back. Rewards is off until the person turns
  it on; notification ads appear only while they are at the computer.

## Free plan: limits and what is not free

Workers Free (checked 2026-11-18): 100,000 requests a day, 10 ms CPU per
request, 100 Workers. D1: 10 databases, 500 MB each, 100,000 rows written a
day. KV: 100,000 reads and 1,000 writes a day (servers keep the config a
minute). Seven Workers and four databases are used. Sync: at most 4 million
characters per kind (about 3 MB encrypted, tens of thousands of bookmarks)
and 25 million per account; TizCat syncs half a minute after a change and
every 15 minutes, and downloads a kind only when it changed.

Not free:
- **Email to anyone**: Cloudflare's Email Sending reaches only addresses
  verified in Email Routing on the free plan (anyone else: Workers Paid, $5
  a month with 3,000 emails). The free way is an outside sender (Resend or
  Brevo, above). Until one is set up, only the team's verified addresses
  can complete sign-up.
- **Turnstile** (`turnstile: false`): Cloudflare's bot check is free; it
  needs a widget made in the dashboard and its secret set (`TURNSTILE_SECRET`)
  before it is switched on. The code is in place.

## Placeholders, for later

JibWallet (`servers\wallet` answers 501; the Settings page and the Rewards
panel say "coming"), JibCoin (`config.json` "coin": name only, no mint, no
payouts), JibWallet's synced holder (empty until JibWallet defines it), the
whitepaper, the download, terms and the full privacy policy, an advertiser
portal. Not synced yet: passwords (reading them needs Windows' sign-in
prompt each time, so it needs a change in the browser itself), history and
open tabs.

## Tests

- `node --test servers\tests\servers.test.mjs`: password keys, the vault
  (locking, sealing), contracts, emails, rewards rules, site structure, and
  that the page's and the module's copies of the key code match (no network).
- `node --test tests\sync-unit.test.mjs`: sync's merge rules (no browser).
- `node servers\tests\smoke.mjs`: the live servers from outside, end to end,
  with a throwaway @test.tizcat.com account: sign up, confirm, log in,
  device, sync, ad points, change and reset the password, delete (61 checks
  on 2026-11-20).
- `node tests\services-live.js tizcat` (or `edge`): the module with the live
  servers in a throwaway profile, including sign-up and signing in on the
  account site (16 checks on 2026-11-20).
- `node tests\sync-live.js`: two TizCat browsers and the live servers: A
  signs up through the page, confirms, turns on sync; B logs in and gets A's
  bookmarks, settings and JibWallet holder (a bookmark both had, once); a
  change on B reaches A; B signs out keeping its bookmarks; A deletes the
  account (31 checks on 2026-11-20). Screenshots go to `tests\out`.
- The rate limits allow about four of these runs a minute from one place;
  more in a row get "Too many tries" (that is the limit working).

## Identifiers

| What | Value |
|---|---|
| TizCat Services module ID | `genbfkjaiacbeljlbeodfphddkkdohcp` |
| KV `tizcat-config` | `95adc45d9019496786dd8681f45e33fc` |
| D1 `tizcat-accounts` | `0e689b4f-549e-497d-815a-656b012c8df9` |
| D1 `tizcat-ads` | `0ee3b307-2e53-43da-9542-10ba7de0ac63` |
| D1 `tizcat-rewards` | `d2fb143e-e1bf-4079-9ccd-dccef83fae29` |
| D1 `tizcat-sync` | `5e3fee66-4fc6-4d0d-9da4-fe2f2479c64a` |
| Wrangler | 4.157.0, through `npx` (logged in with `npx wrangler@4.157.0 login`) |

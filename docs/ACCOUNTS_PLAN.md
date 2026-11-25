# TizCat accounts: the plan

Written 2026-11-25 from the planning conversation about subscriptions,
sign-in and user control.

**The goal:** a modern account and email system with everything people
expect from a modern platform. It runs free at small scale and grows
without a rewrite. One account works on the website (account.tizcat.com)
and connects to the TizCat browser.

Status words used below: **Live** (built and running), **Partly built**,
**To build**, **Later**, **Your step** (only you can do it, because it
happens in your own accounts).

---

## 1. Principles

- **Free at small scale.** Everything runs on the free plans of
  Cloudflare, Resend and Zoho. Pay only when traffic needs it (section 9).
- **Our own account server, not a sign-in company.** Clerk, Auth0 and
  WorkOS have large free plans, but they would replace the encrypted-sync
  sign-in, keep the user list at another company, charge $99/month
  (WorkOS) for our own domain, and lock us in.
- **Passwords never reach the server.** The page stretches the password
  before sending it, so nobody, staff included, can email a user their
  password. "Forgot password" sends a reset link instead, as every modern
  site does.
- **Synced data is encrypted on the device.** Staff and the admin console
  can never read it. This is a selling point; keep it.
- **Modular.** Accounts, sync, email, admin and billing change on their
  own. Most changes ship as server deploys or module updates, not
  browser rebuilds.

## 2. Who does what

| Service | Job | Free limit |
|---|---|---|
| Cloudflare Workers + D1 | Account server, user database, admin console | 100,000 requests a day; 5 GB of database |
| Cloudflare Turnstile | Smart captcha (usually invisible, at most one checkbox) | Free |
| Cloudflare Access | Locks the admin console to named staff | Free up to 50 staff |
| Resend | Account emails: confirm, reset, security alerts | 100 a day, 3,000 a month; marketing up to 1,000 contacts |
| Zoho Mail | Team mailboxes (hamid@, ramona@tizcat.com) | Forever Free plan |
| Zoho CRM Free | Investors, advertisers, partners | 3 staff users, about 5,000 records |

## 3. Features

### 3.1 Sign-up and log-in

| Feature | Status |
|---|---|
| Sign-up with email and password (typed twice), agree to the terms | Live |
| Confirmation email (link valid 48 hours) and "resend confirmation" | Live |
| Smart captcha (Turnstile) on sign-up and log-in | Partly built: the server check exists but is switched off; the page widget is missing |
| Smart captcha on forgot-password and resend-confirmation (these send email, so bots could flood a stranger's inbox and use up the daily limit) | To build |
| Rate limits (5 emails a minute per address, a log-in limit) | Live |
| Username chosen by the user: unique, 3 to 20 letters, numbers or dots, case-insensitive, with blocked names (admin, tizcat, support, yuzal and similar) so nobody can pose as staff. Email stays required for confirmation and reset | To build (decision 1) |
| Social sign-in: GitHub, Google, Microsoft first; LinkedIn and Facebook once their apps exist | To build |
| Sign in with Apple ($99/year developer program) | Later, with a Mac or iPhone version |
| Passkeys (Windows Hello, phone, security key) | Later |
| Breached-password warning: the page checks Have I Been Pwned; only the first 5 characters of a hash leave the device | To build |

### 3.2 Account security

| Feature | Status |
|---|---|
| Forgot password: reset link, valid 1 hour, works once | Live |
| Change password (current one needed) | Live |
| Change email: confirm the new address, notify the old one | To build |
| Two-step verification: authenticator-app codes plus 10 recovery codes | To build (decision 3) |
| Security emails: password changed | Live |
| Security emails: new sign-in from a new device, email changed, two-step turned on or off | To build |
| List of signed-in TizCat browsers; sign one out | Live |
| Website sessions in the same list, with last seen and country; "sign out everywhere" | To build |
| The user's own recent security activity (sign-ins, changes) | To build |

### 3.3 Privacy and the law

| Feature | Status |
|---|---|
| Delete account, with its devices, sessions and synced data | Live |
| Download my data (export) | To build |
| Record which terms and privacy version each user accepted, and when | To build |
| Newsletter only with an opt-in checkbox; every marketing email has an unsubscribe link and the one-click unsubscribe header Gmail and Yahoo require from bulk senders | To build |
| Privacy page names Resend, Cloudflare and Zoho as the services that handle user data | To check |

### 3.4 Admin console ("who subscribed")

A private site, admin.tizcat.com, locked by Cloudflare Access: only staff
emails on a list can open it, after a one-time code by email.

- **Users list** with search and filters: confirmed or not, sign-in
  method, plan, sign-up date, last active.
- **One user's page:** devices, sessions, security activity, newsletter
  choice, plan.
- **Actions:** resend confirmation, sign out everywhere, suspend, delete.
  Every staff action is logged with who did it.
- **Numbers:** sign-ups per day, confirmation rate, weekly active users,
  sign-in method mix.
- **CSV export.**
- **Never shown, by design:** passwords (not stored) and synced data
  (encrypted on the device).

**Zoho CRM Free** is for the people TizCat works with (investors,
advertisers, partners), mostly Ramona's. Users go into it only if they
opted in to news.

### 3.5 Email

| Item | Status |
|---|---|
| Account emails from account@tizcat.com through Resend | Partly built: code written, **blocked on DNS** (see phase 0) |
| Team mailboxes on Zoho Mail | Account made; steps in `visuals\emails_1.docx` |
| Newsletter through Resend (free up to 1,000 contacts) or Zoho Campaigns | Decision 4 |
| DMARC: start at p=none, tighten once all mail passes | To do with the DNS step |

### 3.6 Paid subscription (TizCat Cloud), once prices are set

- A plan field on each account; the browser reads the plan through
  api.tizcat.com.
- Billing: **Stripe** (no monthly fee, but TizCat handles sales tax) or
  **Paddle / Lemon Squeezy** (higher fee per sale, but they handle tax
  worldwide). Decision 5.
- Payments update the plan automatically (webhooks into the database).
- Shown as "Coming soon..." until prices are decided.

## 4. Connecting the TizCat browser

### How it works today (Live)

1. The user signs in at account.tizcat.com inside TizCat.
2. The page hands the browser a device token (through TizCat Services,
   the built-in module) plus the locked sync key.
3. TizCat Services encrypts bookmarks, settings and the JibWallet holder
   on the device and syncs them through api.tizcat.com.
4. The account page lists every TizCat signed in; signing one out stops it.
5. A second TizCat that signs in gets everything back.

Synced now: bookmarks, settings, the JibWallet holder. Not synced yet:
saved passwords (Windows asks to confirm every read, so this needs a
Chromium change), history, open tabs.

### To build

- **"Sign in to TizCat" inside the browser** (the Settings > Profile row
  and the profile button): opens the account page in a tab and comes back
  signed in; the profile button shows the user's name. The Settings row
  may need one browser rebuild; the rest ships as server and module
  updates.
- **Social sign-in from the browser**, through the same flow.
- **Sync passphrase** for accounts made with social sign-in (decision 2),
  asked the first time sync is turned on.
- **New-device email** whenever a TizCat signs in.
- **"Sign out everywhere"** also signs out every browser.
- **Test Google sign-in inside TizCat.** It is expected to work because
  TizCat is a full Chromium browser, but Google blocked the old Electron
  version (Jeep), so test before promising it.
- Later: connect a TizCat with a short code shown on screen, without
  typing the password on that computer.

## 5. Account linking rules (safety)

- One person, one account, any number of sign-in methods.
- A social sign-in joins an existing account automatically **only when
  the provider says the email is verified** (Google, Microsoft, GitHub's
  verified primary email). Otherwise (Facebook, or an unverified email)
  the user logs in with the password first and adds the method from the
  account page. This stops a takeover through a provider that allows
  unverified emails.
- Users can add and remove methods, but never the last one.
- Accounts made with social sign-in have no TizCat password, so a sync
  passphrase protects their sync. A forgotten passphrase deletes the
  synced copy, and the browser uploads it again (as a password reset
  does today). Local data on the computer is never lost.

## 6. Social sign-in providers

| Provider | Cost | What you set up | Notes |
|---|---|---|---|
| GitHub | Free | An OAuth app in GitHub's developer settings | Ready in minutes |
| Google | Free | A Google Cloud project and its consent screen, asking only for email and name | Showing the logo needs a brand check (a few days); no security audit for these scopes |
| Microsoft | Free | An app registration in Microsoft Entra, for personal and work accounts | Covers Outlook and Hotmail users |
| LinkedIn | Free | A developer app with "Sign In with LinkedIn using OpenID Connect" | The app must be tied to a TizCat LinkedIn page |
| Facebook | Free | A Meta developer app | Name and email need no review; Meta wants a privacy policy page and a data-deletion page, and may ask for business verification |
| Apple | $99/year | Apple Developer Program | Wait for a Mac or iPhone version |
| X | Skip for now | | Its API terms and prices keep changing |

Each provider asks for a "redirect address" (decided 2026-11-25):
`https://account.tizcat.com/oauth/<provider>/callback`, with `<provider>`
one of google, microsoft, github, linkedin, facebook. The code must serve
exactly these paths.

The user's click-by-click steps for every provider, Turnstile and Access
are Parts 7 to 13 of `visuals\emails_1.docx`. Keys come back through
`%LOCALAPPDATA%\TizCatServer\new-keys.txt` (a form on the laptop, outside
Google Drive): each value is moved into the Worker secrets and
`secrets.json`, then the form is emptied. Secrets never go through chat.

## 7. Order of work

**Phase 0: the blocker.** Must be done before any public sign-up and well
before downloads start on 2026-12-31 (Product Hunt).
- Add Resend's DNS records (Your step, `visuals\emails_1.docx` Part 1).
  Checked 2026-11-25: not there yet, so confirmation and reset emails
  reach only the three verified addresses.
- Switch the email provider to Resend, then send one test to a real
  outside address.

**Phase 1: a solid email-and-password account.**
Turnstile on all four forms, username, change email, sign out everywhere,
security emails, security activity, breached-password warning, terms
version record, admin console.

**Phase 2: social sign-in and the browser.**
GitHub, Google, Microsoft, then LinkedIn and Facebook; the linking rules;
the sync passphrase; "Sign in to TizCat" inside the browser.

**Phase 3: the rest of a modern platform.**
Two-step verification, passkeys, data export, newsletter with opt-in.

**Phase 4: money.** TizCat Cloud billing, once prices are set.

## 8. Your steps

Step by step, with every button named: `visuals\emails_1.docx`, Parts 7
to 13 (Part 8 connects your TizCat; after logging in, click **Turn on
sync**: it does not start by itself).

1. **Resend DNS records** in Cloudflare (`visuals\emails_1.docx`, Part 1).
2. **Turnstile widget:** Cloudflare dashboard > Turnstile > Add widget,
   hostname `account.tizcat.com`, mode "Managed". Save both keys in
   `%LOCALAPPDATA%\TizCatServer\new-keys.txt` (never in the Drive
   folder).
3. **Cloudflare Zero Trust** (free plan, pick a team name) so Access can
   lock the admin console. Cloudflare may ask for a card even on the free
   plan; there is no charge under 50 staff.
4. **Developer apps:** GitHub, Google and Microsoft first; LinkedIn once
   TizCat has a LinkedIn page; Facebook once the privacy and data-deletion
   pages are live.
5. **Zoho CRM Free**, when Ramona needs it.
6. **Decide the open questions** in section 10.

## 9. Costs as TizCat grows

| When | What | Cost |
|---|---|---|
| Now | Everything above | $0 |
| More than 100 emails a day (likely on the Product Hunt day) | Resend Pro, or Brevo's free 300 a day | $20/month (or $0) |
| More than 100,000 requests a day | Cloudflare Workers Paid | $5/month |
| A Mac or iPhone version | Sign in with Apple | $99/year |
| Charging for TizCat Cloud | Payment provider | A fee per sale only |

Roughly **$25/month at thousands of users**.

## 10. Open decisions

1. **Username:** a log-in name (log in with username or email), or only a
   name shown in the account and Rewards? *Recommended: log in with
   either.*
2. **Sync for social sign-in:** a separate sync passphrase, or a key the
   server holds? *Recommended: passphrase.* A server-held key is weaker
   and breaks the promise that TizCat cannot read user data.
3. **Two-step verification:** optional or required? *Recommended:
   optional, offered after sign-up.*
4. **Newsletter tool:** Resend or Zoho Campaigns.
5. **Payment provider** for TizCat Cloud: Stripe, or Paddle / Lemon
   Squeezy. Later.

## Sources (checked 2026-11-25)

- [Resend pricing](https://resend.com/pricing) and [Resend quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits)
- [Zoho CRM free edition](https://www.zoho.com/crm/what-is-zoho-crm-free-edition.html)
- [Facebook Login permissions review](https://developers.facebook.com/documentation/facebook-login/guides/permissions/review)
- [Clerk pricing](https://clerk.com/articles/clerk-pricing-explained), [WorkOS vs Auth0 pricing](https://workos.com/blog/auth0-vs-workos-pricing-comparison), [free sign-in providers compared](https://merginit.com/blog/13062026-free-auth-identity-providers-comparison)

Related: `docs\SERVICES.md` (how the servers and the browser module fit
together today).

// TizCat Services' background worker.
//
// - Keeps the servers' settings and the ad catalog fresh (alarm, hourly),
//   and the New Tab pictures in Cache Storage, so the New Tab page never
//   waits for the network.
// - TizCat Rewards (off until turned on): notification ads within the
//   person's hourly choice, only while they are at the computer; ad events
//   go to api.tizcat.com with this browser's device token, or wait on the
//   device until it is linked to an account.
// - Talks to the account site (account.tizcat.com, externally_connectable):
//   tizcat.hello, tizcat.link, tizcat.unlink, tizcat.openSync.
// - TizCat sync (lib\sync): bookmarks, settings and TizCat's own data,
//   encrypted here, kept the same across the account's TizCat browsers.
// - Answers its own pages (New Tab, the Rewards panel, the sync page).
import * as api from "./lib/api.js";
import { configOf, eventId, load, pickAd, save } from "./lib/state.js";
import { choicesOf, forgetSync, KINDS, signedOutByServer, SOON_ALARM, syncNow, syncSoon } from "./lib/sync/engine.js";
import { HOLDERS, readHolder, settings as settingsKind, writeHolder } from "./lib/sync/kinds.js";

const VERSION = chrome.runtime.getManifest().version;
const ACCOUNT_ORIGIN = "https://account.tizcat.com";
const MEDIA_CACHE = "tizcat-ads-v1";
const TICK = "tizcat-tick";        // every 5 minutes: is a notification ad due?
const REFRESH = "tizcat-refresh";  // settings and catalog
const SYNC = "tizcat-sync";        // every 15 minutes: changes from the account's other TizCat browsers
const MAX_PENDING = 500;
// Other TizCat modules that may read and write a holder (JibWallet's, once
// it is a module: add its fixed ID here).
const HOLDER_MODULES = new Set([]);

// ---------------------------------------------------------------------------
// Start-up and alarms

chrome.runtime.onInstalled.addListener(() => setUp());
chrome.runtime.onStartup.addListener(() => setUp());

async function setUp() {
  await chrome.alarms.create(TICK, { periodInMinutes: 5 });
  await chrome.alarms.create(SYNC, { periodInMinutes: 15 });
  const state = await load();
  const minutes = Math.max(15, configOf(state).ads.catalogRefreshMinutes || 60);
  await chrome.alarms.create(REFRESH, { periodInMinutes: minutes, delayInMinutes: 0.1 });
  syncNow();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH) {
    refresh();
  } else if (alarm.name === TICK) {
    maybeNotify();
  } else if (alarm.name === SYNC || alarm.name === SOON_ALARM) {
    syncNow();
  }
});

// A change here goes to the account's other TizCat browsers half a minute
// later (several changes in a row make one sync).
for (const event of ["onCreated", "onRemoved", "onChanged", "onMoved", "onChildrenReordered", "onImportEnded"]) {
  chrome.bookmarks[event].addListener(() => syncSoon());
}
chrome.settingsPrivate.onPrefsChanged.addListener((prefs) => {
  if (settingsKind.watches(prefs.map((p) => p.key))) {
    syncSoon();
  }
});

// Settings, catalog, the New Tab pictures, and the points balance.
async function refresh() {
  const state = await load();
  const [config, catalog] = await Promise.all([api.getConfig(), api.getCatalog()]);
  const changes = {};
  if (config.data && config.data.ok) {
    changes.config = config.data.config;
  }
  if (catalog.data && catalog.data.ok) {
    changes.catalog = { ads: catalog.data.ads, version: catalog.data.version, at: Date.now() };
    await cachePictures(catalog.data.ads);
  }
  await save(changes);
  if (state.device) {
    await flushPending();
    await refreshBalance();
  }
}

async function cachePictures(ads) {
  const cache = await caches.open(MEDIA_CACHE);
  const wanted = new Set(ads.filter((a) => a.placement === "ntp" && a.image).map((a) => a.image));
  for (const request of await cache.keys()) {
    if (!wanted.has(request.url)) {
      await cache.delete(request);  // ads no longer running
    }
  }
  for (const url of wanted) {
    if (!(await cache.match(url))) {
      try {
        const response = await fetch(url, { credentials: "omit" });
        if (response.ok) {
          await cache.put(url, response);
        }
      } catch {
        // Next refresh tries again.
      }
    }
  }
}

async function refreshBalance() {
  const state = await load();
  if (!state.device) {
    return;
  }
  const answer = await api.getBalance(state.device.token);
  if (answer.status === 401) {
    await signedOutByServer();  // signed out on the account site
  } else if (answer.data && answer.data.ok) {
    await save({ balance: { points: answer.data.points, at: Date.now() } });
  }
}

// ---------------------------------------------------------------------------
// Ad events

async function recordEvent(ad, placement, kind) {
  const state = await load();
  const event = { eventId: eventId(), adId: ad.id, placement, kind, at: Date.now() };
  if (!state.device) {
    // Kept on the device (with an estimate of its points) until linked.
    const points = (configOf(state).rewards.points || {})[`${placement}.${kind}`] || 0;
    const pending = [...state.pending, event].slice(-MAX_PENDING);
    await save({ pending, localPoints: state.localPoints + points });
    return;
  }
  const answer = await api.sendEvent(state.device.token, event);
  if (answer.status === 0) {
    await save({ pending: [...state.pending, event].slice(-MAX_PENDING) });  // offline: later
  } else if (answer.data && answer.data.ok && typeof answer.data.balance === "number") {
    await save({ balance: { points: answer.data.balance, at: Date.now() } });
  }
}

// Events from before linking (or while offline) go up once there is an
// account; the server counts each event id once.
async function flushPending() {
  const state = await load();
  if (!state.device || !state.pending.length) {
    return;
  }
  const weekAgo = Date.now() - 7 * 86400_000;
  const left = [];
  for (const event of state.pending) {
    if (event.at < weekAgo) {
      continue;
    }
    const answer = await api.sendEvent(state.device.token, event);
    if (answer.status === 0) {
      left.push(event);
    }
  }
  await save({ pending: left, localPoints: left.length ? state.localPoints : 0 });
}

// ---------------------------------------------------------------------------
// Notification ads

async function maybeNotify(force = false) {
  const state = await load();
  const config = configOf(state);
  if (!force) {
    if (!state.rewardsOn || !config.features.rewards || !config.features.notificationAds) {
      return;
    }
    if (!state.adsPerHour || Date.now() - state.lastNotifyAt < 3600_000 / state.adsPerHour) {
      return;
    }
    // Only while the person is at the computer, as Brave does.
    if ((await chrome.idle.queryState(120)) !== "active") {
      return;
    }
  }
  const ads = ((state.catalog && state.catalog.ads) || []).filter((a) => a.placement === "notification");
  const ad = pickAd(ads);
  if (!ad) {
    return;
  }
  const id = `tizcat-ad:${ad.id}:${eventId()}`;
  await chrome.notifications.create(id, {
    type: "basic",
    iconUrl: (await iconFor(ad)) || "icons/icon_128.png",
    title: ad.title,
    message: ad.body || ad.advertiser,
    contextMessage: `Ad from ${ad.advertiser}, TizCat Rewards`,
    priority: 0,
  });
  await save({ lastNotifyAt: Date.now() });
  await recordEvent(ad, "notification", "view");
}

async function iconFor(ad) {
  if (!ad.image) {
    return null;
  }
  try {
    const response = await fetch(ad.image, { credentials: "omit" });
    if (!response.ok) {
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (const b of bytes) {
      binary += String.fromCharCode(b);
    }
    return `data:${response.headers.get("content-type") || "image/png"};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

chrome.notifications.onClicked.addListener(async (id) => {
  const m = id.match(/^tizcat-ad:([a-z0-9-]+):/);
  if (!m) {
    return;
  }
  const state = await load();
  const ad = ((state.catalog && state.catalog.ads) || []).find((a) => a.id === m[1]);
  chrome.notifications.clear(id);
  if (ad && /^https:\/\//.test(ad.url)) {
    await chrome.tabs.create({ url: ad.url });
    await recordEvent(ad, "notification", "click");
  }
});

// ---------------------------------------------------------------------------
// The New Tab page asks which background to show.

async function nextBackground() {
  const state = await load();
  const config = configOf(state);
  const count = state.ntpCount + 1;
  await save({ ntpCount: count });
  if (!state.rewardsOn || !config.features.rewards || !config.features.ntpSponsored) {
    return null;
  }
  const every = Math.max(1, config.ads.ntpSponsoredEvery || 4);
  if (count % every !== 0) {
    return null;
  }
  const cache = await caches.open(MEDIA_CACHE);
  const ready = [];
  for (const ad of ((state.catalog && state.catalog.ads) || []).filter((a) => a.placement === "ntp")) {
    if (ad.image && (await cache.match(ad.image))) {
      ready.push(ad);  // only pictures already on the device: no waiting
    }
  }
  return pickAd(ready);
}

// ---------------------------------------------------------------------------
// What the Rewards panel and New Tab page show

async function summary() {
  const state = await load();
  const config = configOf(state);
  return {
    version: VERSION,
    rewardsOn: state.rewardsOn,
    adsPerHour: state.adsPerHour,
    adsPerHourChoices: config.ads.notificationsPerHourChoices,
    linked: !!state.device,
    email: state.device ? state.device.email : null,
    points: state.device && state.balance ? state.balance.points : state.localPoints,
    pointsOnServer: !!(state.device && state.balance),
    pendingEvents: state.pending.length,
    coin: config.coin,
    wallet: config.wallet,
    sync: syncView(state),
  };
}

function syncView(state) {
  const choices = choicesOf(state);
  return {
    on: !!(state.device && state.vaultKey),
    ...(state.syncStatus || {}),
    kinds: KINDS.map((k) => ({ name: k.name, label: k.label, detail: k.detail || "", on: choices[k.name] })),
  };
}

// This TizCat signs out of the account: no more sync or Rewards on the
// account; bookmarks and settings stay here.
async function signOutHere() {
  const state = await load();
  if (state.device) {
    await api.unlinkDevice(state.device.token, state.device.deviceId);
  }
  await forgetSync();
  await save({ device: null, balance: null });
}

function openSyncPage() {
  return chrome.tabs.create({ url: chrome.runtime.getURL("sync.html") });
}

// ---------------------------------------------------------------------------
// Messages from the module's own pages

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message.type !== "string") {
    return false;
  }
  handleOwn(message).then(reply, (e) => reply({ ok: false, error: String(e) }));
  return true;  // answers later
});

async function handleOwn(message) {
  switch (message.type) {
    case "tizcat.summary":
      return { ok: true, ...(await summary()) };
    case "tizcat.setRewards":
      await save({ rewardsOn: !!message.on });
      if (message.on) {
        refresh();
      }
      return { ok: true, ...(await summary()) };
    case "tizcat.setAdsPerHour": {
      const n = Number(message.n);
      const choices = (await summary()).adsPerHourChoices;
      if (!choices.includes(n)) {
        return { ok: false, error: "not a choice" };
      }
      await save({ adsPerHour: n });
      return { ok: true, ...(await summary()) };
    }
    case "tizcat.ntp.background":
      return { ok: true, ad: await nextBackground() };
    case "tizcat.ntp.viewed": {
      const state = await load();
      const ad = ((state.catalog && state.catalog.ads) || []).find((a) => a.id === message.adId);
      if (ad && ad.placement === "ntp" && state.rewardsOn) {
        await recordEvent(ad, "ntp", "view");
      }
      return { ok: true };
    }
    case "tizcat.refresh":
      await refresh();
      return { ok: true, ...(await summary()) };
    case "tizcat.unlinkHere":
      await signOutHere();
      return { ok: true, ...(await summary()) };
    case "tizcat.sync.now":
      await syncNow();
      return { ok: true, ...(await summary()) };
    case "tizcat.sync.choose": {
      const state = await load();
      if (!KINDS.some((k) => k.name === message.name)) {
        return { ok: false, error: "no such kind" };
      }
      await save({ syncChoices: { ...(state.syncChoices || {}), [message.name]: !!message.on } });
      if (message.on) {
        syncNow();
      }
      return { ok: true, ...(await summary()) };
    }
    case "tizcat.holder.get":
      return holderGet(message);
    case "tizcat.holder.set":
      return holderSet(message);
    case "tizcat.openSync":
      await openSyncPage();
      return { ok: true };
    case "tizcat.test.notify":
      // For tests: a notification ad now, whatever the schedule.
      await maybeNotify(true);
      return { ok: true };
    default:
      return { ok: false, error: "unknown message" };
  }
}

// ---------------------------------------------------------------------------
// Messages from the account site

// ---------------------------------------------------------------------------
// Holders (kinds.js): one JSON document each, synced, for parts of TizCat
// that define their contents later (JibWallet's).

async function holderGet(message) {
  if (!HOLDERS[message.name]) {
    return { ok: false, error: "no such holder" };
  }
  return { ok: true, doc: await readHolder(message.name) };
}

async function holderSet(message) {
  const doc = message.doc;
  if (!HOLDERS[message.name] || !doc || typeof doc !== "object" || JSON.stringify(doc).length > 1_000_000) {
    return { ok: false, error: "not a holder document" };
  }
  await writeHolder(message.name, doc);
  syncSoon();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Messages from the account site (and, for holders, other TizCat modules)

chrome.runtime.onMessageExternal.addListener((message, sender, reply) => {
  if (!message) {
    reply({ ok: false });
    return false;
  }
  if (sender.id && HOLDER_MODULES.has(sender.id) && /^tizcat\.holder\.(get|set)$/.test(message.type)) {
    (message.type === "tizcat.holder.get" ? holderGet(message) : holderSet(message))
      .then(reply, () => reply({ ok: false }));
    return true;
  }
  if (!sender.url || new URL(sender.url).origin !== ACCOUNT_ORIGIN) {
    reply({ ok: false });
    return false;
  }
  handleAccount(message).then(reply, () => reply({ ok: false }));
  return true;
});

async function handleAccount(message) {
  const state = await load();
  switch (message.type) {
    case "tizcat.hello":
      return { ok: true, version: VERSION, linked: !!state.device,
        deviceId: state.device ? state.device.deviceId : null,
        email: state.device ? state.device.email : null,
        sync: syncView(state) };
    case "tizcat.link": {
      // Sign this TizCat in: the device token, and the account's sync key
      // (unlocked by the page with the password; it is not sent anywhere).
      const token = String(message.token || "");
      const deviceId = String(message.deviceId || "");
      const vaultKey = String(message.vaultKey || "");
      if (!/^tzd_[A-Za-z0-9_-]{43}$/.test(token) || !/^d_[A-Za-z0-9_-]{8,40}$/.test(deviceId) ||
          !/^[A-Za-z0-9_-]{43}$/.test(vaultKey)) {
        return { ok: false };
      }
      if (state.device && state.device.email !== message.email) {
        return { ok: false, error: "signed in to another account" };
      }
      // Check with the server that the token is real before keeping it.
      const me = await api.getMe(token);
      if (!me.data || !me.data.ok) {
        return { ok: false };
      }
      await save({ device: { token, deviceId, email: me.data.account.email }, vaultKey, syncStatus: null });
      // The first sync (and points earned before signing in) run now; the
      // page does not wait for them.
      (async () => {
        await syncNow();
        await flushPending();
        await refreshBalance();
      })();
      return { ok: true };
    }
    case "tizcat.unlink":
      await forgetSync();
      await save({ device: null, balance: null });
      return { ok: true };
    case "tizcat.openSync":
      await openSyncPage();
      return { ok: true };
    default:
      return { ok: false };
  }
}

// TizCat sync: keeps this TizCat's bookmarks, settings and TizCat's own data
// the same as the account's other TizCat browsers, through api.tizcat.com
// (/v1/sync). Everything is encrypted here with the account's vault key
// (vault.js) before it leaves; the server cannot read it.
//
// For each kind: read what is here, download the server's copy if it
// changed since the last sync, merge the three (merge.js), apply the result
// here, and upload it if the server's copy differs. If another TizCat
// uploaded in between (412), start that kind again.
//
// What this module keeps (chrome.storage.local): vaultKey; syncChoices
// {kind: true|false}; syncStatus {lastSyncAt, error, signedOut}; and per
// kind "sync.<kind>" = {version, base}, the copy both sides had last time.
import * as api from "../api.js";
import { load, save } from "../state.js";
import { openCollection, sealCollection } from "../vault.js";
import bookmarks from "./bookmarks.js";
import { holder, settings, tizcat } from "./kinds.js";
import { mergeRecords, same } from "./merge.js";

export const KINDS = [bookmarks, settings, tizcat, holder("wallet")];
const MAX_TRIES = 3;
const SOON = "tizcat-sync-soon";

let running = null;
let again = false;
let applying = false;

export function choicesOf(state) {
  const out = {};
  for (const kind of KINDS) {
    out[kind.name] = !state.syncChoices || state.syncChoices[kind.name] !== false;
  }
  return out;
}

// After a change here: sync in half a minute (several changes, one sync).
export function syncSoon() {
  if (!applying) {
    chrome.alarms.create(SOON, { delayInMinutes: 0.5 });
  }
}

export const SOON_ALARM = SOON;

// One sync at a time; a request during one runs once more after it.
export function syncNow() {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await runOnce();
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function runOnce() {
  const state = await load();
  if (!state.device || !state.vaultKey) {
    return;
  }
  const token = state.device.token;
  const list = await api.syncList(token);
  if (list.status === 401) {
    await signedOutByServer();
    return;
  }
  if (!list.data || !list.data.ok) {
    await status({ error: list.status === 0 ? "TizCat could not reach its servers; it tries again later." : "Sync is paused for a moment." });
    return;
  }
  const versions = {};
  for (const c of list.data.collections) {
    versions[c.name] = c.version;
  }
  const choices = choicesOf(state);
  const problems = [];
  for (const kind of KINDS) {
    if (!choices[kind.name]) continue;
    try {
      await syncKind(kind, token, state.vaultKey, versions[kind.name] || 0);
    } catch (e) {
      console.warn("TizCat sync:", kind.name, e);
      if (e && e.signedOut) {
        await signedOutByServer();
        return;
      }
      problems.push(`${kind.label}: ${(e && e.message) || "could not sync"}`);
    }
  }
  await status({ lastSyncAt: Date.now(), error: problems.length ? problems.join(" ") : null });
}

async function syncKind(kind, token, vaultKey, remoteVersion) {
  const stateKey = `sync.${kind.name}`;
  const saved = (await chrome.storage.local.get(stateKey))[stateKey] || null;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    let snap = await kind.read();
    let remote = {};
    let version = 0;
    if (remoteVersion > 0) {
      if (saved && saved.version === remoteVersion) {
        remote = saved.base;  // unchanged since the last sync: nothing to download
        version = remoteVersion;
      } else {
        const got = await api.syncGet(token, kind.name);
        if (got.status === 401) throw Object.assign(new Error("signed out"), { signedOut: true });
        if (got.status === 200) {
          const doc = await openCollection(vaultKey, kind.name, got.text);
          remote = doc.records || {};
          version = got.version;
        } else if (got.status !== 404) {
          throw new Error(got.status === 0 ? "TizCat could not reach its servers" : `server answered ${got.status}`);
        }
      }
    }
    if (!saved && kind.adopt) {
      snap = await kind.adopt(snap, remote);
    }
    // Nothing on the server (never synced, or its copy was deleted on the
    // account page): a fresh start, so nothing here counts as deleted there.
    const base = saved && version > 0 ? saved.base : {};
    const merged = mergeRecords(base, snap.records, remote);
    if (!same(merged, snap.records)) {
      applying = true;
      try {
        await kind.apply(merged, snap);
      } finally {
        applying = false;
      }
      snap = await kind.read();
    }
    if (version > 0 && same(snap.records, remote)) {
      await chrome.storage.local.set({ [stateKey]: { version, base: snap.records } });
      return;
    }
    const text = await sealCollection(vaultKey, kind.name, { schema: 1, records: snap.records });
    const put = await api.syncPut(token, kind.name, version, text);
    if (put.status === 200 && put.data && put.data.ok) {
      await chrome.storage.local.set({ [stateKey]: { version: put.data.version, base: snap.records } });
      return;
    }
    if (put.status === 412 && put.data) {
      remoteVersion = put.data.version;  // another TizCat was first: again, with its copy
      continue;
    }
    if (put.status === 401) throw Object.assign(new Error("signed out"), { signedOut: true });
    if (put.status === 413) throw new Error("too much to sync");
    throw new Error(put.status === 0 ? "TizCat could not reach its servers" : `server answered ${put.status}`);
  }
  throw new Error("other TizCat browsers kept syncing at the same time; trying again later");
}

async function status(changes) {
  const state = await load();
  await save({ syncStatus: { ...(state.syncStatus || {}), signedOut: false, ...changes } });
}

// The account signed this TizCat out (a password reset, or "Sign out" on the
// account page): stop syncing; the bookmarks and settings stay here.
export async function signedOutByServer() {
  await forgetSync();
  await save({ device: null, balance: null, syncStatus: { signedOut: true, error: null, lastSyncAt: null } });
}

// Forgets the account's sync state here (on signing out). The data stays.
export async function forgetSync() {
  await chrome.storage.local.remove(KINDS.map((k) => `sync.${k.name}`));
  await bookmarks.forget();
  await save({ vaultKey: null, syncStatus: null });
}

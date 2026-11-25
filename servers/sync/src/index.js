// tizcat-sync: stores what TizCat browsers sync, encrypted on the device
// (shared/vault.js); this server cannot read any of it. Reached only through
// api.tizcat.com, which turns the browser's device token into the
// X-TizCat-Account / X-TizCat-Device headers.
//
//   GET    /v1/sync            the account's collections: name, version, size, when
//   GET    /v1/sync/<name>     one collection (text), its version in X-TizCat-Version
//   PUT    /v1/sync/<name>     a new copy; If-Match: <the version it was made from>
//                              ("0" for a new one). 412 if another TizCat got
//                              there first: download, merge, try again.
//   DELETE /v1/sync            delete everything synced (the account stays)
//
// RPC for the account part (service binding): wipe(accountId),
// summary(accountId), health().
import { WorkerEntrypoint } from "cloudflare:workers";
import { liveConfig } from "../../shared/config.js";
import { randomToken } from "../../shared/crypto.js";
import { error, json, secure } from "../../shared/http.js";

export const VERSION = "0.1.0";
const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const PIECE = 1_000_000;                 // characters per stored piece (D1 rows: 2 MB at most)
export const LIMITS = {
  collectionSize: 4_000_000,             // characters, about 3 MB of encrypted data
  accountSize: 25_000_000,
  collections: 32,
};

export default class SyncService extends WorkerEntrypoint {
  async fetch(request) {
    const env = this.env;
    try {
      const config = await liveConfig(env);
      if (config.features.sync === false) {
        return error(503, "sync_off", "Sync is paused for a moment. TizCat tries again later.");
      }
      const account = request.headers.get("x-tizcat-account");
      const device = request.headers.get("x-tizcat-device");
      if (!account || !device) {
        return error(401, "not_linked", "Sign in to TizCat to sync.");
      }
      if (env.SYNC_LIMITER) {
        const { success } = await env.SYNC_LIMITER.limit({ key: device });
        if (!success) {
          return error(429, "too_many", "Syncing too often. TizCat tries again in a minute.");
        }
      }
      const path = new URL(request.url).pathname.replace(/\/+$/, "");
      if (path === "/v1/sync") {
        if (request.method === "GET") {
          return json({ ok: true, ...(await summaryOf(env, account)) });
        }
        if (request.method === "DELETE") {
          await wipeAll(env, account);
          return json({ ok: true });
        }
      }
      const m = path.match(/^\/v1\/sync\/([a-z0-9-]+)$/);
      if (m && NAME.test(m[1])) {
        if (request.method === "GET") {
          return download(env, account, m[1]);
        }
        if (request.method === "PUT") {
          return upload(request, env, account, device, m[1]);
        }
      }
      return error(404, "not_found", "No such sync call.");
    } catch (e) {
      console.error("sync", e && e.stack ? e.stack : e);
      return error(500, "server_error", "Something went wrong. TizCat tries again later.");
    }
  }

  async wipe(accountId) {
    await wipeAll(this.env, accountId);
    return { ok: true };
  }

  async summary(accountId) {
    return summaryOf(this.env, accountId);
  }

  async health() {
    let db = false;
    try {
      db = !!(await this.env.DB.prepare("SELECT 1 AS ok").first());
    } catch {
      db = false;
    }
    return { part: "sync", version: VERSION, ok: db, db };
  }
}

async function summaryOf(env, account) {
  const rows = await env.DB.prepare(
    "SELECT name, version, size, updated_at FROM collections WHERE account_id = ?1 ORDER BY name",
  ).bind(account).all();
  return {
    collections: rows.results.map((r) => ({
      name: r.name, version: r.version, size: r.size, updatedAt: r.updated_at,
    })),
    limits: LIMITS,
  };
}

async function download(env, account, name) {
  const row = await env.DB.prepare(
    "SELECT version, write_id, pieces FROM collections WHERE account_id = ?1 AND name = ?2",
  ).bind(account, name).first();
  if (!row) {
    return error(404, "none", "Nothing synced of this kind yet.");
  }
  const pieces = await env.DB.prepare(
    "SELECT data FROM pieces WHERE account_id = ?1 AND name = ?2 AND write_id = ?3 ORDER BY n",
  ).bind(account, name, row.write_id).all();
  if (pieces.results.length !== row.pieces) {
    // Changed between the two reads: the caller asks again.
    return error(409, "busy", "Being updated. Try again.");
  }
  return secure(new Response(pieces.results.map((p) => p.data).join(""), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-tizcat-version": String(row.version),
    },
  }));
}

async function upload(request, env, account, device, name) {
  const expected = Number(request.headers.get("if-match"));
  if (!Number.isInteger(expected) || expected < 0) {
    return error(400, "bad_request", "If-Match must be the version this copy was made from (0 for a new one).");
  }
  const data = await request.text();
  if (!/^[A-Za-z0-9_-]+$/.test(data)) {
    return error(400, "bad_request", "Sync data must be the encrypted text TizCat makes.");
  }
  if (data.length > LIMITS.collectionSize) {
    return error(413, "too_big", "This is more than TizCat syncs of one kind.");
  }
  const current = await env.DB.prepare(
    "SELECT version, write_id, size FROM collections WHERE account_id = ?1 AND name = ?2",
  ).bind(account, name).first();
  if ((current ? current.version : 0) !== expected) {
    return conflict(current);
  }
  const totals = await env.DB.prepare(
    "SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS size FROM collections WHERE account_id = ?1",
  ).bind(account).first();
  if (!current && totals.n >= LIMITS.collections) {
    return error(413, "too_many_kinds", "This account syncs too many kinds of data.");
  }
  if (totals.size - (current ? current.size : 0) + data.length > LIMITS.accountSize) {
    return error(413, "account_full", "This account's synced data is at its limit.");
  }

  // The new pieces under a new write id first; then the collection row is
  // moved to them only if no one else moved it meanwhile. A new collection
  // starts at the time in milliseconds, not 1: one deleted and made again
  // never repeats a version a TizCat remembers from before.
  const writeId = randomToken(9);
  const next = current ? expected + 1 : Date.now();
  const count = Math.max(1, Math.ceil(data.length / PIECE));
  const inserts = [];
  for (let n = 0; n < count; n++) {
    inserts.push(env.DB.prepare(
      "INSERT INTO pieces (account_id, name, write_id, n, data) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(account, name, writeId, n, data.slice(n * PIECE, (n + 1) * PIECE)));
  }
  await env.DB.batch(inserts);
  const now = Date.now();
  const moved = current
    ? await env.DB.prepare(
      "UPDATE collections SET version = ?3, write_id = ?4, size = ?5, pieces = ?6, updated_at = ?7, updated_by = ?8 " +
      "WHERE account_id = ?1 AND name = ?2 AND version = ?9",
    ).bind(account, name, next, writeId, data.length, count, now, device, expected).run()
    : await env.DB.prepare(
      "INSERT INTO collections (account_id, name, version, write_id, size, pieces, updated_at, updated_by) " +
      "VALUES (?1, ?2, ?8, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(account_id, name) DO NOTHING",
    ).bind(account, name, writeId, data.length, count, now, device, next).run();
  if (!moved.meta.changes) {
    await env.DB.prepare("DELETE FROM pieces WHERE account_id = ?1 AND name = ?2 AND write_id = ?3")
      .bind(account, name, writeId).run();
    return conflict(await env.DB.prepare(
      "SELECT version FROM collections WHERE account_id = ?1 AND name = ?2").bind(account, name).first());
  }
  if (current) {
    await env.DB.prepare("DELETE FROM pieces WHERE account_id = ?1 AND name = ?2 AND write_id = ?3")
      .bind(account, name, current.write_id).run();
  }
  return json({ ok: true, version: next, size: data.length });
}

function conflict(current) {
  return json({
    ok: false,
    error: { code: "conflict", message: "Another TizCat synced first: download, merge and try again." },
    version: current ? current.version : 0,
  }, 412);
}

async function wipeAll(env, account) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM pieces WHERE account_id = ?1").bind(account),
    env.DB.prepare("DELETE FROM collections WHERE account_id = ?1").bind(account),
  ]);
}

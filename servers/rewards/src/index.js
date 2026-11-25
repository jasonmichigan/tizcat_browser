// tizcat-rewards: TizCat Rewards' points.
//
//   GET /v1/rewards/balance   the account's points, and the JibCoin
//                             placeholder (through api.tizcat.com, which
//                             passes X-TizCat-Account from the device token)
// RPC (service binding only):
//   credit({eventId, accountId, deviceId, adId, placement, kind})   tizcat-ads
//     -> {credited, points, balance, reason?}
//   forget(accountId)                                    tizcat-account
//   health()
import { WorkerEntrypoint } from "cloudflare:workers";
import { liveConfig } from "../../shared/config.js";
import { error, json } from "../../shared/http.js";
import { overDailyLimit, pointsFor, utcDay } from "./rules.js";

export const VERSION = "0.1.0";

export default class RewardsService extends WorkerEntrypoint {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");
    if (path === "/v1/rewards/balance" && request.method === "GET") {
      const account = request.headers.get("x-tizcat-account");
      if (!account) {
        return error(401, "not_linked", "Link TizCat to an account to keep points.");
      }
      const config = await liveConfig(this.env);
      const row = await this.env.DB.prepare(
        "SELECT points FROM balances WHERE account_id = ?1",
      ).bind(account).first();
      return json({ ok: true, points: row ? row.points : 0, coin: config.coin });
    }
    return error(404, "not_found", "No such rewards call.");
  }

  async credit({ eventId, accountId, deviceId, adId, placement, kind }) {
    const config = await liveConfig(this.env);
    if (!config.features.rewards) {
      return { credited: false, points: 0, reason: "rewards_off" };
    }
    const points = pointsFor(config, placement, kind);
    if (!points) {
      return { credited: false, points: 0, reason: "no_points" };
    }
    const now = Date.now();
    const day = utcDay(now);
    const today = await this.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM events WHERE device_id = ?1 AND day = ?2",
    ).bind(deviceId, day).first();
    if (overDailyLimit(config, today ? today.n : 0)) {
      return { credited: false, points: 0, reason: "daily_limit" };
    }
    // Insert the event once (its id is the browser's), and add its points
    // only if it was new: both in one batch.
    const results = await this.env.DB.batch([
      this.env.DB.prepare(
        "INSERT INTO events (id, account_id, device_id, ad_id, placement, kind, points, day, created_at) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) ON CONFLICT(id) DO NOTHING",
      ).bind(eventId, accountId, deviceId, adId, placement, kind, points, day, now),
      this.env.DB.prepare(
        "INSERT INTO balances (account_id, points, updated_at) " +
        "SELECT ?1, ?2, ?3 WHERE changes() > 0 " +
        "ON CONFLICT(account_id) DO UPDATE SET points = points + excluded.points, updated_at = excluded.updated_at",
      ).bind(accountId, points, now),
      this.env.DB.prepare("SELECT points FROM balances WHERE account_id = ?1").bind(accountId),
    ]);
    const credited = results[0].meta.changes > 0;
    const balance = results[2].results[0] ? results[2].results[0].points : 0;
    return { credited, points: credited ? points : 0, balance, reason: credited ? undefined : "duplicate" };
  }

  // When an account is deleted (tizcat-account calls this), its points and
  // their history go with it.
  async forget(accountId) {
    await this.env.DB.batch([
      this.env.DB.prepare("DELETE FROM events WHERE account_id = ?1").bind(accountId),
      this.env.DB.prepare("DELETE FROM balances WHERE account_id = ?1").bind(accountId),
    ]);
    return { forgotten: true };
  }

  async health() {
    let db = false;
    try {
      db = !!(await this.env.DB.prepare("SELECT 1 AS ok").first());
    } catch {
      db = false;
    }
    return { part: "rewards", version: VERSION, ok: db, db };
  }
}

// tizcat-ads: the ads TizCat shows, as Brave does, and their events.
//
//   GET  /v1/ads/catalog          the active ads (no account needed)
//   GET  /v1/ads/media/<file>     an ad's picture
//   POST /v1/ads/events           {eventId, adId, placement, kind, at?}
//                                 a view or click; earns Rewards points when
//                                 the device is linked (X-TizCat-Account and
//                                 X-TizCat-Device, set by api.tizcat.com)
// RPC: health()
import { WorkerEntrypoint } from "cloudflare:workers";
import { liveConfig } from "../../shared/config.js";
import { error, json, readJson, secure } from "../../shared/http.js";
import { check } from "../../shared/validate.js";

export const VERSION = "0.1.0";
const MEDIA_BASE = "https://api.tizcat.com/v1/ads/media/";

export default class AdsService extends WorkerEntrypoint {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");
    try {
      if (path === "/v1/ads/catalog" && request.method === "GET") {
        return await this.catalog();
      }
      const media = path.match(/^\/v1\/ads\/media\/([a-z0-9-]+\.(?:png|jpg|webp))$/);
      if (media && request.method === "GET") {
        const file = await this.env.MEDIA.fetch(new Request(`https://media/${media[1]}`));
        if (!file.ok) {
          return error(404, "not_found", "No such picture.");
        }
        const out = secure(file);
        out.headers.set("cache-control", "public, max-age=86400");
        return out;
      }
      if (path === "/v1/ads/events" && request.method === "POST") {
        return await this.event(request);
      }
      return error(404, "not_found", "No such ads call.");
    } catch (e) {
      console.error("ads", e && e.stack ? e.stack : e);
      return error(500, "server_error", "Something went wrong.");
    }
  }

  async catalog() {
    const now = Date.now();
    const rows = await this.env.DB.prepare(
      "SELECT id, placement, advertiser, title, body, image, target_url, weight FROM ads " +
      "WHERE active = 1 AND starts_at <= ?1 AND (ends_at = 0 OR ends_at > ?1)",
    ).bind(now).all();
    const config = await liveConfig(this.env);
    return json({
      ok: true,
      version: now,
      refreshMinutes: config.ads.catalogRefreshMinutes,
      ads: rows.results.map((ad) => ({
        id: ad.id,
        placement: ad.placement,
        advertiser: ad.advertiser,
        title: ad.title,
        body: ad.body,
        image: ad.image ? MEDIA_BASE + ad.image : "",
        url: ad.target_url,
        weight: ad.weight,
      })),
    }, 200, { "cache-control": "public, max-age=300" });
  }

  async event(request) {
    const body = await readJson(request);
    const reason = check("ads.event", body);
    if (reason) {
      return error(400, "bad_request", reason);
    }
    const ad = await this.env.DB.prepare(
      "SELECT id, placement FROM ads WHERE id = ?1 AND active = 1",
    ).bind(body.adId).first();
    if (!ad || ad.placement !== body.placement) {
      return error(404, "no_such_ad", "That ad is not running.");
    }
    const accountId = request.headers.get("x-tizcat-account");
    const deviceId = request.headers.get("x-tizcat-device");
    if (!accountId || !deviceId) {
      // Counted on the device until it is linked; nothing is kept here.
      return json({ ok: true, credited: false, reason: "not_linked" });
    }
    const result = await this.env.REWARDS.credit({
      eventId: body.eventId,
      accountId,
      deviceId,
      adId: ad.id,
      placement: body.placement,
      kind: body.kind,
    });
    return json({ ok: true, ...result });
  }

  async health() {
    let db = false;
    try {
      db = !!(await this.env.DB.prepare("SELECT COUNT(*) AS n FROM ads").first());
    } catch {
      db = false;
    }
    return { part: "ads", version: VERSION, ok: db, db };
  }
}

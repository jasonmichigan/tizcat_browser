// tizcat-api: api.tizcat.com, the front door.
//
//   GET  /v1/health        every part's version and state
//   GET  /v1/config        the live settings a browser may see
//   *    /v1/account/...   -> tizcat-account
//   *    /v1/ads/...       -> tizcat-ads      (device token checked here)
//   *    /v1/rewards/...   -> tizcat-rewards  (device token checked here)
//   *    /v1/wallet/...    -> tizcat-wallet   (JibWallet placeholder)
//   *    /v1/sync/...      -> tizcat-sync     (encrypted bookmarks, settings, ...)
//
// For ads, rewards, wallet and sync, a request's "Authorization: Bearer tzd_..."
// token is turned into the account and device it belongs to (asked of
// tizcat-account) and passed on as X-TizCat-Account / X-TizCat-Device. Those
// headers are always removed from what arrives from the internet, so only
// this front door can set them.
import { liveConfig, publicConfig } from "../../shared/config.js";
import { corsHeaders, error, httpsRedirect, json, withHeaders } from "../../shared/http.js";

export const VERSION = "0.1.0";

// TizCat Services' pages (the New Tab page, the Rewards panel) and its
// service worker call this API; their origin is the module's fixed ID.
const ALLOWED_ORIGINS = ["chrome-extension://genbfkjaiacbeljlbeodfphddkkdohcp"];
const PARTS = { account: "ACCOUNT", ads: "ADS", rewards: "REWARDS", wallet: "WALLET", sync: "SYNC" };
const TOKEN_PARTS = new Set(["ads", "rewards", "wallet", "sync"]);

export default {
  async fetch(request, env) {
    const redirect = httpsRedirect(request);
    if (redirect) {
      return redirect;
    }
    const cors = corsHeaders(request, ALLOWED_ORIGINS);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    try {
      return withHeaders(await route(request, env), cors);
    } catch (e) {
      console.error("api", e && e.stack ? e.stack : e);
      return withHeaders(error(500, "server_error", "Something went wrong."), cors);
    }
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/" || url.pathname === "/v1" || url.pathname === "/v1/") {
    return json({ ok: true, name: "TizCat API", version: VERSION, docs: "https://www.tizcat.com/developers" });
  }
  if (url.pathname === "/v1/health") {
    return json(await health(env));
  }
  if (url.pathname === "/v1/config" && request.method === "GET") {
    return json({ ok: true, config: publicConfig(await liveConfig(env)) }, 200, {
      "cache-control": "public, max-age=300",
    });
  }
  const m = url.pathname.match(/^\/v1\/([a-z]+)(\/|$)/);
  const part = m && PARTS[m[1]];
  if (!part) {
    return error(404, "not_found", "No such API call.");
  }
  const headers = new Headers(request.headers);
  headers.delete("x-tizcat-account");
  headers.delete("x-tizcat-device");
  if (TOKEN_PARTS.has(m[1])) {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
    const device = token ? await env.ACCOUNT.resolveDevice(token) : null;
    if (device) {
      headers.set("x-tizcat-account", device.accountId);
      headers.set("x-tizcat-device", device.deviceId);
    }
    headers.delete("authorization");
  }
  return env[part].fetch(new Request(request, { headers }));
}

async function health(env) {
  const parts = {};
  let ok = true;
  for (const [name, binding] of Object.entries(PARTS)) {
    try {
      parts[name] = await env[binding].health();
      ok = ok && parts[name].ok;
    } catch (e) {
      parts[name] = { part: name, ok: false, error: String(e && e.message ? e.message : e) };
      ok = false;
    }
  }
  return { ok, part: "api", version: VERSION, parts, time: new Date().toISOString() };
}

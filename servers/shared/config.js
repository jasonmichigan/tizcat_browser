// The live settings every TizCat server reads: one JSON document in the KV
// namespace tizcat-config (key "config"), edited in servers\config\config.json
// and sent with `deploy.ps1 config`. No server is redeployed for a change.
// Workers keep a copy for a minute, so KV's free daily reads go far.
import defaults from "../config/config.json" with { type: "json" };

let cached = null;
let cachedAt = 0;

export async function liveConfig(env) {
  const now = Date.now();
  if (cached && now - cachedAt < 60_000) {
    return cached;
  }
  let stored = null;
  if (env.CONFIG) {
    try {
      stored = await env.CONFIG.get("config", { type: "json", cacheTtl: 60 });
    } catch {
      stored = null;  // KV unavailable: the defaults still work.
    }
  }
  cached = merge(defaults, stored || {});
  cachedAt = now;
  return cached;
}

// The parts a browser may see (no internal switches).
export function publicConfig(config) {
  return {
    version: config.version,
    features: config.features,
    ads: config.ads,
    rewards: config.rewards,
    coin: config.coin,
    wallet: config.wallet,
  };
}

function merge(base, over) {
  if (!over || typeof over !== "object" || Array.isArray(over)) {
    return over === undefined ? base : over;
  }
  const out = { ...base };
  for (const [key, value] of Object.entries(over)) {
    out[key] = base && typeof base[key] === "object" && !Array.isArray(base[key])
      ? merge(base[key], value)
      : value;
  }
  return out;
}

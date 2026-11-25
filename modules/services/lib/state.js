// What TizCat Services remembers, in chrome.storage.local (this profile
// only; the device token never leaves the module except to api.tizcat.com).
export const DEFAULTS = {
  rewardsOn: false,          // TizCat Rewards is off until the person turns it on
  adsPerHour: 2,             // notification ads an hour (their choice)
  device: null,              // {token, deviceId, email} once linked to an account
  pending: [],               // ad events from before the browser was linked
  localPoints: 0,            // points earned on this device, before linking
  balance: null,             // {points, at} from the server, once linked
  config: null,              // the servers' public settings (api /v1/config)
  catalog: null,             // {ads, version, at} (api /v1/ads/catalog)
  ntpCount: 0,               // New Tab pages opened, for the sponsored picture's turn
  lastNotifyAt: 0,
  vaultKey: null,            // the account's sync key (from the account page), once signed in
  syncChoices: null,         // {kind: false} for kinds the person does not sync
  syncStatus: null,          // {lastSyncAt, error, signedOut}
};

// Settings that apply until the servers have been reached once.
export const FALLBACK_CONFIG = {
  features: { rewards: true, ntpSponsored: true, notificationAds: true },
  ads: { ntpSponsoredEvery: 4, notificationsPerHourDefault: 2,
    notificationsPerHourChoices: [0, 1, 2, 3, 4, 5, 10], catalogRefreshMinutes: 60 },
  rewards: { points: { "ntp.view": 1, "notification.view": 2, "notification.click": 5 } },
  coin: { name: "JibCoin", mint: null, payouts: false },
  wallet: { name: "JibWallet", status: "coming" },
};

export async function load() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export async function save(changes) {
  await chrome.storage.local.set(changes);
}

export function configOf(state) {
  return state.config || FALLBACK_CONFIG;
}

export function eventId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// A random pick among ads, by their weight.
export function pickAd(ads) {
  const total = ads.reduce((n, ad) => n + Math.max(1, ad.weight || 1), 0);
  let at = Math.random() * total;
  for (const ad of ads) {
    at -= Math.max(1, ad.weight || 1);
    if (at <= 0) {
      return ad;
    }
  }
  return ads[ads.length - 1] || null;
}

// Small crypto helpers shared by the TizCat servers, built on Web Crypto
// (the same in Workers and in Node 20+, so the tests run them unchanged).

const encoder = new TextEncoder();

export function toBase64Url(bytes) {
  const all = new Uint8Array(bytes);
  let binary = "";
  // In slices, so megabytes of synced data stay quick.
  for (let i = 0; i < all.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, all.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

// A random, URL-safe token (32 bytes by default): session and device tokens,
// ids, salts.
export function randomToken(bytes = 32) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return toBase64Url(digest);
}

export async function hmacSha256(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    typeof secret === "string" ? encoder.encode(secret) : secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

// Compares two byte arrays in time that does not depend on where they
// differ (Workers have crypto.subtle.timingSafeEqual; Node does not).
export function sameBytes(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  if (crypto.subtle.timingSafeEqual) {
    return crypto.subtle.timingSafeEqual(a, b);
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export function concatBytes(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

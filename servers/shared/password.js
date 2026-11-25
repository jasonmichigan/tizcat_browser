// TizCat account passwords. The free Workers plan gives a request 10 ms of
// computing, too little for a slow password hash on the server, so the slow
// part runs in the person's browser (the Bitwarden pattern). From the
// password and email, the page makes two keys that cannot be turned into
// each other or back into the password:
//
//   master  = PBKDF2-SHA256(password, "tizcat-account-v1:" + email,
//                           600,000 rounds, 32 bytes)
//   authKey = HKDF-SHA256(master, "tizcat auth v2")   sent to log in
//   wrapKey = HKDF-SHA256(master, "tizcat wrap v2")   never leaves the device
//
//   server: verifier = HMAC-SHA256(PASSWORD_PEPPER, salt || authKey)
//
// The password never leaves the page; the server keeps only the verifier,
// with a random salt per account and a secret pepper that is not in the
// database. Someone who stole the database would still need the pepper, and
// then 600,000 rounds for every password they guess.
//
// wrapKey locks the account's sync key (vault.js), so what TizCat syncs
// (bookmarks, settings, JibWallet's data) is encrypted with a key the server
// never sees: not even TizCat can read it.
//
// This file is the one source: the account site's page loads a copy of it
// (deploy.ps1 copies it to account\site\js\password.js), and tests check both.
import { fromBase64Url, hmacSha256, concatBytes, toBase64Url } from "./crypto.js";

export const KDF = "pbkdf2-sha256-600000-hkdf-v2";
export const ROUNDS = 600000;
export const MIN_PASSWORD_LENGTH = 10;

const encoder = new TextEncoder();

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

// A plain check: something@domain.tld, at most 254 characters.
export function validEmail(email) {
  const e = normalizeEmail(email);
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

// A key as sent: 32 bytes as 43 URL-safe characters.
export function validAuthKey(key) {
  return typeof key === "string" && /^[A-Za-z0-9_-]{43}$/.test(key);
}

// In the browser: the password and email become {authKey, wrapKey}.
export async function accountKeys(password, email) {
  const material = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const master = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode("tizcat-account-v1:" + normalizeEmail(email)),
      iterations: ROUNDS,
    },
    material,
    256,
  );
  const hkdf = await crypto.subtle.importKey("raw", master, "HKDF", false, ["deriveBits"]);
  const derive = async (info) => toBase64Url(await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: encoder.encode(info) },
    hkdf,
    256,
  ));
  return { authKey: await derive("tizcat auth v2"), wrapKey: await derive("tizcat wrap v2") };
}

// On the server: what is stored for an authKey (all base64url).
export async function verifierFor(pepper, salt, authKey) {
  const mac = await hmacSha256(pepper, concatBytes(fromBase64Url(salt), fromBase64Url(authKey)));
  return toBase64Url(mac);
}

// TizCat sync's encryption, end to end: what a TizCat browser syncs is
// encrypted on the device, and the servers store only the result.
//
//   vault key    32 random bytes, made once per account (on sign-up, and
//                again on a password reset). The account's TizCat browsers
//                keep it; the server keeps it only locked ("wrapped") with
//                the wrapKey from the password (password.js), which it
//                never sees.
//   collection   one kind of data (bookmarks, settings, wallet, ...):
//                JSON, gzipped, then AES-256-GCM with the vault key. The
//                collection's name is bound in (additional data), so the
//                server cannot pass one off as another.
//
// Changing the password re-locks the same vault key (nothing is lost). A
// reset, by someone who no longer knows the password, cannot unlock it: a
// new vault key is made, the old synced copy is deleted, and each TizCat
// uploads its data again when it is signed in (as Firefox does).
//
// This file is the one source. Copies: account\site\js\vault.js (by
// deploy.ps1) and modules\services\lib\vault.js (checked by the tests).
import { concatBytes, fromBase64Url, toBase64Url } from "./crypto.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAGIC = encoder.encode("TZS1");
const WRAP_INFO = encoder.encode("tizcat vault key v1");

export function newVaultKey() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

// "v1." + iv (12 bytes) + "." + the encrypted key with its tag (48 bytes).
export function validWrappedKey(text) {
  return typeof text === "string" && /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{64}$/.test(text);
}

function aesKey(raw, use) {
  return crypto.subtle.importKey("raw", fromBase64Url(raw), "AES-GCM", false, [use]);
}

export async function wrapVaultKey(wrapKey, vaultKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: WRAP_INFO },
    await aesKey(wrapKey, "encrypt"),
    fromBase64Url(vaultKey),
  );
  return `v1.${toBase64Url(iv)}.${toBase64Url(sealed)}`;
}

// Throws if the wrapKey is not the one that locked it (a wrong password).
export async function unwrapVaultKey(wrapKey, wrapped) {
  if (!validWrappedKey(wrapped)) {
    throw new Error("not a locked vault key");
  }
  const [, iv, sealed] = wrapped.split(".");
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(iv), additionalData: WRAP_INFO },
    await aesKey(wrapKey, "decrypt"),
    fromBase64Url(sealed),
  );
  return toBase64Url(raw);
}

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function nameData(name) {
  return encoder.encode("tizcat sync v1:" + name);
}

// A collection's value -> base64url text, as the sync server stores it.
export async function sealCollection(vaultKey, name, value) {
  const zipped = await pipe(encoder.encode(JSON.stringify(value)), new CompressionStream("gzip"));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: nameData(name) },
    await aesKey(vaultKey, "encrypt"),
    zipped,
  );
  return toBase64Url(concatBytes(MAGIC, iv, new Uint8Array(sealed)));
}

// Throws if the text was not sealed with this vault key for this name.
export async function openCollection(vaultKey, name, text) {
  const bytes = fromBase64Url(text);
  if (bytes.length < 4 + 12 + 16 || MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new Error("not a TizCat sync collection");
  }
  const zipped = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.subarray(4, 16), additionalData: nameData(name) },
    await aesKey(vaultKey, "decrypt"),
    bytes.subarray(16),
  );
  const json = await pipe(new Uint8Array(zipped), new DecompressionStream("gzip"));
  return JSON.parse(decoder.decode(json));
}

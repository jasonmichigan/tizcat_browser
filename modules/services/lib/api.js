// TizCat Services' calls to TizCat's servers (api.tizcat.com, contract v1 in
// servers\contracts). Every call has a short time limit: nothing here may
// slow the browser down, and the module works on its saved copy when the
// servers cannot be reached.
export const API = "https://api.tizcat.com/v1";

async function call(path, { method = "GET", token, body, timeout = 8000 } = {}) {
  const headers = {};
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  if (body) {
    headers["content-type"] = "application/json";
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(API + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      credentials: "omit",
      cache: "no-store",
    });
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  } catch {
    return { status: 0, data: null };  // offline or too slow
  } finally {
    clearTimeout(timer);
  }
}

// Sync (/v1/sync): collections travel as the encrypted text vault.js makes,
// so these send and read plain text, with a longer time limit.
async function text(path, { method = "GET", token, body, version, timeout = 30000 }) {
  const headers = { authorization: `Bearer ${token}` };
  if (body !== undefined) {
    headers["content-type"] = "text/plain";
    headers["if-match"] = String(version);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(API + path, {
      method, headers, body, signal: controller.signal, credentials: "omit", cache: "no-store",
    });
    const isJson = (response.headers.get("content-type") || "").includes("json");
    return {
      status: response.status,
      version: Number(response.headers.get("x-tizcat-version")) || 0,
      text: isJson ? null : await response.text(),
      data: isJson ? await response.json().catch(() => null) : null,
    };
  } catch {
    return { status: 0, version: 0, text: null, data: null };
  } finally {
    clearTimeout(timer);
  }
}

export const syncList = (token) => call("/sync", { token, timeout: 15000 });
export const syncGet = (token, name) => text(`/sync/${name}`, { token });
export const syncPut = (token, name, version, body) => text(`/sync/${name}`, { method: "PUT", token, body, version });

export const getConfig = () => call("/config");
export const getCatalog = () => call("/ads/catalog");
export const getMe = (token) => call("/account/me", { token });
export const getBalance = (token) => call("/rewards/balance", { token });
export const sendEvent = (token, event) => call("/ads/events", { method: "POST", token, body: event });
export const unlinkDevice = (token, deviceId) =>
  call(`/account/devices/${deviceId}`, { method: "DELETE", token });

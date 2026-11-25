// Talk to Jeep's Python backend (web_dashboard.py), unchanged: the same
// HTTP contract Jeep's main process used. Jib does not start it; run.ps1
// does, with JEEP_NO_BROWSER=1 so it does not open Jeep as well.

export const BACKEND_URL = "http://127.0.0.1:5050";

export async function health(timeoutMs = 1500) {
  try {
    const r = await fetch(`${BACKEND_URL}/api/health`, {
      cache: "no-store", signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function postJson(path, body) {
  const r = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`${path} ${r.status}: ${txt.slice(0, 200)}`);
  }
  return await r.json();
}

export const postChat = (body) => postJson("/api/chat", body);

// Full-page screenshot -> PDF bytes (base64); nothing is written to disk.
export const postSnapshot = (body) => postJson("/api/snapshot", body);

// Ask the backend to write a Yuzal-generated file; returns
// {ok, name, original_name, path, mime, size, download_url}.
export const postGenerateFile = (body) => postJson("/api/generate_file", body);

// One thing Yuzal should remember between sessions (memory.json).
export const postMemory = (body) => postJson("/api/memory", body);

// Push this turn's screenshot and page state so the backend updates
// vision_current.png and status.csv (before/after page-change awareness).
// Best-effort; never throws, and gives up after 15 s.
export async function postVisionStatus(image_b64, page_state) {
  try {
    await fetch(`${BACKEND_URL}/api/vision_status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_b64: image_b64 || "", page_state }),
      signal: AbortSignal.timeout(15000),
    });
  } catch { /* ignore */ }
}

export async function postActionResult(results) {
  try {
    await fetch(`${BACKEND_URL}/api/action-result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ results }),
    });
  } catch { /* ignore */ }
}

// Where a generated file can be fetched from. The backend registers each one
// under its on-disk name, which is the last part of the path it returned.
export function downloadUrl(path) {
  const name = String(path || "").split(/[\\/]/).pop();
  return `${BACKEND_URL}/api/download/${encodeURIComponent(name)}`;
}

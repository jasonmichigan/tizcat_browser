// Shared by every TizCat server: JSON answers, errors, security headers and
// CORS. Each Worker imports what it needs; Wrangler bundles it in.

// Sent with every answer, so browsers never warn about the site: HTTPS only
// (HSTS for a year, all tizcat.com subdomains), no sniffing of content
// types, no framing by other sites, and no camera, microphone or location.
export const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

// A page's content security policy: its own files only, plus what a page
// names (Turnstile's script, for example).
export function csp({ scripts = [], connect = [], frames = [], images = [] } = {}) {
  const list = (base, extra) => [base, ...extra].join(" ");
  return [
    "default-src 'self'",
    `script-src ${list("'self'", scripts)}`,
    `connect-src ${list("'self'", connect)}`,
    `img-src ${list("'self' data:", images)}`,
    "style-src 'self'",
    `frame-src ${frames.length ? frames.join(" ") : "'none'"}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

// The same answer with the security headers (and a page's CSP) added.
export function secure(response, policy) {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    out.headers.set(name, value);
  }
  if (policy) {
    out.headers.set("Content-Security-Policy", policy);
  }
  return out;
}

// Plain HTTP is never served: send the visitor to the HTTPS address.
export function httpsRedirect(request) {
  const url = new URL(request.url);
  if (url.protocol === "http:") {
    url.protocol = "https:";
    return Response.redirect(url.toString(), 301);
  }
  return null;
}

export function json(data, status = 200, headers = {}) {
  return secure(
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        ...headers,
      },
    }),
  );
}

// Errors have one shape everywhere: {ok: false, error: {code, message}}.
export function error(status, code, message) {
  return json({ ok: false, error: { code, message } }, status);
}

// Reads a JSON body of at most `limit` bytes, or null if it is not one.
export async function readJson(request, limit = 16 * 1024) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().startsWith("application/json")) {
    return null;
  }
  const text = await request.text();
  if (text.length > limit) {
    return null;
  }
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// CORS for the origins a server allows (TizCat Services' extension pages).
export function corsHeaders(request, allowed) {
  const origin = request.headers.get("origin");
  if (!origin || !allowed.includes(origin)) {
    return {};
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, if-match",
    "Access-Control-Expose-Headers": "x-tizcat-version",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function withHeaders(response, headers) {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) {
    out.headers.set(name, value);
  }
  return out;
}

// tizcat-web: www.tizcat.com.
//
//   /go/<name>      a link TizCat opens; leads where config.json "go" says
//   page paths      site\pages\<file> wrapped in site\layout.html (site.json)
//   moved paths     a 301 to the page's new address (site.json "moved")
//   other paths     the site's files (css, img), as they are
//
// tizcat.com sends visitors to www.tizcat.com (one address for search
// engines and certificates); /go/ links work on both.
import { liveConfig } from "../../shared/config.js";
import { csp, error, httpsRedirect, secure } from "../../shared/http.js";

const WWW = "https://www.tizcat.com";
const PAGE_POLICY = csp();
// Files that hold the site's structure, not pages to visit on their own.
const HIDDEN = /^\/(site\.json|layout\.html|pages\/.*)$/;

let site = null;  // site.json, read once per Worker instance

export default {
  async fetch(request, env) {
    const redirect = httpsRedirect(request);
    if (redirect) {
      return redirect;
    }
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/go/")) {
        return await go(url, env);
      }
      if (url.hostname === "tizcat.com") {
        return Response.redirect(WWW + url.pathname + url.search, 301);
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return error(405, "method", "Only pages to read here.");
      }
      const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : "/";
      if (HIDDEN.test(path)) {
        return await page(env, "/404", 404);
      }
      const info = await siteInfo(env);
      // A page that moved (Lovona became Yuzal on 2026-11-23): old links
      // land on the new address.
      const moved = info.moved && Object.hasOwn(info.moved, path) ? info.moved[path] : null;
      if (moved) {
        return secure(new Response(null, {
          status: 301,
          headers: { location: WWW + moved + url.search, "cache-control": "public, max-age=86400" },
        }));
      }
      if (path === "/robots.txt") {
        return text200(`User-agent: *\nAllow: /\nSitemap: ${WWW}/sitemap.xml\n`, "text/plain");
      }
      if (path === "/sitemap.xml") {
        const urls = info.pages.map((p) => `  <url><loc>${WWW}${p.path}</loc></url>`).join("\n");
        return text200(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
          "application/xml");
      }
      if (info.pages.some((p) => p.path === path)) {
        return await page(env, path, 200);
      }
      const file = await env.ASSETS.fetch(request);
      if (file.status === 404) {
        return await page(env, "/404", 404);
      }
      const out = secure(file, PAGE_POLICY);
      // Files named with ?v=<assetVersion> never change: browsers keep them a
      // year (speed); the rest for a day.
      out.headers.set("cache-control", url.searchParams.has("v")
        ? "public, max-age=31536000, immutable" : "public, max-age=86400");
      return out;
    } catch (e) {
      console.error("web", e && e.stack ? e.stack : e);
      return secure(new Response("TizCat's site had a problem. Please try again.", {
        status: 500, headers: { "content-type": "text/plain; charset=utf-8" },
      }));
    }
  },
};

// Only https addresses on tizcat.com and its subdomains, so a /go/ link can
// never be turned into a way to send people elsewhere.
async function go(url, env) {
  const name = url.pathname.slice(4).replace(/\/+$/, "");
  const config = await liveConfig(env);
  const target = /^[a-z0-9-]{1,32}$/.test(name) ? config.go[name] : null;
  if (target && /^https:\/\/([a-z0-9-]+\.)*tizcat\.com(\/|$)/.test(target)) {
    return secure(new Response(null, {
      status: 302,
      headers: { location: target, "cache-control": "no-store" },
    }));
  }
  return page(env, "/404", 404);
}

async function siteInfo(env) {
  if (!site) {
    const file = await env.ASSETS.fetch(new Request("https://assets/site.json"));
    site = await file.json();
  }
  return site;
}

async function text(env, path) {
  const file = await env.ASSETS.fetch(new Request("https://assets" + path));
  if (!file.ok) {
    throw new Error(`missing site file ${path}`);
  }
  return file.text();
}

function escape(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

async function page(env, path, status) {
  const info = await siteInfo(env);
  const entry = path === "/404"
    ? { path: "/404", file: "404.html", title: "Page not found", label: "", description: "" }
    : info.pages.find((p) => p.path === path);
  const byPath = Object.fromEntries(info.pages.map((p) => [p.path, p]));
  const links = (paths) => paths
    .filter((p) => byPath[p])
    .map((p) => `<a href="${p}"${p === path ? ' aria-current="page"' : ""}>${escape(byPath[p].label)}</a>`)
    .join("");
  const [layout, content] = await Promise.all([
    text(env, "/layout.html"),
    text(env, "/pages/" + entry.file),
  ]);
  const values = {
    title: escape(entry.title),
    description: escape(entry.description),
    path: escape(entry.path === "/404" ? "/" : entry.path),
    name: escape(entry.file.replace(/\.html$/, "")),
    assetVersion: escape(info.assetVersion),
    menu: links(info.menu),
    // Footer columns: [{title, links: [paths]}] (or a plain list of paths).
    footer: info.footer.map((col) => (typeof col === "string" ? links([col])
      : `<div class="footer-col"><h4>${escape(col.title)}</h4>${links(col.links)}</div>`)).join(""),
    content,
  };
  const html = layout.replace(/\{\{(\w+)\}\}/g, (all, key) => (key in values ? values[key] : all));
  return secure(new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  }), PAGE_POLICY);
}

function text200(body, type) {
  return secure(new Response(body, {
    headers: { "content-type": `${type}; charset=utf-8`, "cache-control": "public, max-age=3600" },
  }));
}

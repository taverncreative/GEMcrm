/*
 * GEM CRM — hand-rolled service worker (manual, Turbopack-safe).
 *
 * Why hand-rolled, not serwist: this app builds with Turbopack, and
 * @serwist/next is a webpack plugin (Next 16's own PWA guide flags this).
 * So we follow Next's documented manual-SW approach — no build-pipeline
 * change. Registered prod-only by components/sync/service-worker-register.tsx.
 *
 * GOAL: make offline client-side navigation work. Soft-nav and cold reload
 * of routes visited online resolve from cache; routes never visited online
 * fall back to the /offline shell — never the browser's offline dino page.
 *
 * ─── INVARIANT: respondWith ALWAYS gets a RESOLVED Response ──────────────
 * A rejected promise to respondWith becomes a "FetchEvent network error",
 * which the browser handles by hard-loading → dino. So every handler here
 * resolves to *some* Response (cache, /offline shell, or a 503) and NEVER
 * rethrows fetch's offline rejection. This is the fix for the dino.
 *
 * ─── HARD SAFETY BOUNDARY (must stay airtight) ───────────────────────────
 * The Dexie + outbox + sync engine is the source of truth and MUST be
 * untouched. The SW only handles **same-origin GET** for app routes +
 * static assets. Everything else passes straight through:
 *   - Supabase (cross-origin) — excluded by the same-origin gate (+ explicit).
 *   - Server actions / mutations / sync pull+drain — POST (with a
 *     Next-Action header) — excluded by the GET-only gate (+ explicit).
 *   - API / export / auth-callback / sw.js — explicit network-only bypass.
 *   - IndexedDB (Dexie) isn't network traffic, so the SW never sees it.
 *
 * UPDATES: no skipWaiting() — a new SW installs in the background and takes
 * over on the next cold start. Old-version caches are purged on activate.
 * Bump VERSION on each deploy.
 */

const VERSION = "v2";
const STATIC_CACHE = `gemcrm-static-${VERSION}`;
const PAGES_CACHE = `gemcrm-pages-${VERSION}`;
const OFFLINE_URL = "/offline";

// Network-only: never cache or serve these from cache.
const BYPASS_PREFIXES = ["/api/", "/reports/export", "/auth/callback"];

self.addEventListener("install", (event) => {
  // Precache only the offline fallback shell. Everything else is cached on
  // first online use (runtime). Intentionally NO skipWaiting().
  event.waitUntil(
    caches
      .open(PAGES_CACHE)
      .then((cache) => cache.add(OFFLINE_URL))
      .catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Purge caches from previous versions (incl. the broken v1) — stale-
      // chunk footgun guard + clears any bad cached entries.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("gemcrm-") && !k.endsWith(VERSION))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function isBypassed(url) {
  if (url.pathname === "/sw.js") return true; // never let the SW cache itself
  return BYPASS_PREFIXES.some((p) => url.pathname.startsWith(p));
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/icon.png" ||
    url.pathname === "/manifest.webmanifest" ||
    /\.(?:js|css|woff2?|png|jpe?g|svg|ico|webp|gif)$/i.test(url.pathname)
  );
}

function isRSC(request, url) {
  return url.searchParams.has("_rsc") || request.headers.get("RSC") === "1";
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Same-origin ONLY. Cross-origin (Supabase, any CDN) → don't touch.
  if (url.origin !== self.location.origin) return;
  // 2. GET ONLY. Mutations/server actions/sync are POST → never intercept.
  if (request.method !== "GET") return;
  if (request.headers.get("Next-Action")) return; // belt-and-braces
  // 3. Explicit network-only bypass (api, export, auth callback, sw.js).
  if (isBypassed(url)) return;

  // 4. Static assets (content-hashed/immutable) → CacheFirst.
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  // 5. RSC payloads (soft client-nav) → NetworkFirst, graceful on miss.
  if (isRSC(request, url)) {
    event.respondWith(rscHandler(request));
    return;
  }
  // 6. Document navigations → NetworkFirst, /offline shell on miss.
  if (request.mode === "navigate") {
    event.respondWith(navigationHandler(request));
    return;
  }
  // 7. Any other same-origin GET → NetworkFirst, 503 on miss.
  event.respondWith(networkFirstSafe(request));
});

/** Try cache, then network; on offline miss resolve with a 503 (never throw). */
async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
    return res;
  } catch {
    // Offline + uncached static (e.g. a chunk for a never-visited route).
    return new Response("", { status: 503, statusText: "Offline" });
  }
}

/**
 * Network-first that NEVER rejects. Returns the fresh Response (and caches
 * it) when online; on offline failure returns the cached Response if present,
 * otherwise `undefined` (callers supply the appropriate fallback).
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok && res.type !== "opaqueredirect") {
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    return cache.match(request, { ignoreVary: true }); // may be undefined
  }
}

async function navigationHandler(request) {
  const fresh = await networkFirst(request, PAGES_CACHE);
  if (fresh) return fresh;
  // Offline + this route's document not cached → the precached offline shell.
  const cache = await caches.open(PAGES_CACHE);
  const offline = await cache.match(OFFLINE_URL, { ignoreVary: true });
  if (offline) return offline;
  // Last-ditch (offline shell somehow absent): an inline page, still no dino.
  return new Response(
    "<!doctype html><meta charset=utf-8><title>Offline</title>" +
      "<body style=\"font-family:system-ui;padding:2rem;text-align:center\">" +
      "<h1>You're offline</h1><p>Reconnect and try again.</p>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

async function rscHandler(request) {
  const fresh = await networkFirst(request, PAGES_CACHE);
  if (fresh) return fresh;
  // Offline + RSC not cached: resolve with a graceful (non-rejecting) RSC
  // response. A failed RSC soft-nav makes Next's router hard-navigate, which
  // re-enters this SW as a document request → navigationHandler → /offline.
  // Crucially this is a RESOLVED Response, so it never becomes a FetchEvent
  // network error (= no dino).
  return new Response("", {
    status: 503,
    statusText: "Offline",
    headers: { "Content-Type": "text/x-component" },
  });
}

async function networkFirstSafe(request) {
  const res = await networkFirst(request, PAGES_CACHE);
  if (res) return res;
  return new Response("", { status: 503, statusText: "Offline" });
}

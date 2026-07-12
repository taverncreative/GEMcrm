/**
 * Reports-bucket asset URL helpers (H1 — private bucket).
 *
 * The `reports` Storage bucket is PRIVATE, so the old
 * `…/object/public/reports/…` URLs stored across the DB (and computed
 * client-side for photos) no longer resolve. Every in-app consumer
 * routes display through the auth-gated proxy at
 * `/api/storage/reports/<path>` instead — a stable, same-origin URL that
 * needs NO client-side signing (so it works in `"use client"` Dexie
 * surfaces) and streams the object server-side via the service role.
 *
 * These helpers are PURE and client-safe — no server imports, no secret
 * — so a `"use client"` component can rewrite a stored URL to the proxy
 * form at render time.
 */

const BUCKET = "reports";

/**
 * Extract the object path within the reports bucket from any stored
 * reference: a legacy public URL, a `/object/sign|authenticated/…` URL,
 * an already-proxied `/api/storage/reports/…` URL, or a bare
 * `photos/<id>.jpg` path. Returns null for empty values and inline
 * `data:` URIs (which are not Storage objects).
 */
export function storageObjectPath(
  stored: string | null | undefined
): string | null {
  if (!stored) return null;
  if (stored.startsWith("data:")) return null;

  const clean = stored.split("?")[0].split("#")[0];
  const marker = `/${BUCKET}/`;
  const idx = clean.indexOf(marker);
  if (idx !== -1) {
    const path = clean.slice(idx + marker.length).replace(/^\/+/, "");
    return path || null;
  }

  // Bare path (no bucket prefix, no scheme), e.g. "photos/<id>.jpg".
  const bare = clean.replace(/^\/+/, "");
  if (bare && !bare.includes("://")) return bare;
  return null;
}

/**
 * Rewrite a stored asset reference to the auth-gated proxy URL. `data:`
 * URIs (inline signatures) and unrecognised values pass through
 * unchanged; null/empty stays null. Idempotent — re-applying to an
 * already-proxied URL yields the same URL.
 */
export function proxyAssetUrl(
  stored: string | null | undefined
): string | null {
  if (!stored) return null;
  if (stored.startsWith("data:")) return stored;
  const path = storageObjectPath(stored);
  return path ? `/api/storage/${BUCKET}/${path}` : stored;
}

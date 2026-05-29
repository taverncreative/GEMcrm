/**
 * Deterministic Supabase Storage paths for photos.
 *
 * Photos always live at `photos/<photoId>.jpg` in the `reports` bucket.
 * The client-generated photoId is both the `photos_pending.id` (Dexie
 * primary key) AND the Storage object name. This deterministic mapping
 * means:
 *
 *   - The sync engine's photo loop can upload to the right path
 *     without coordinating with anyone.
 *   - The server-side action replay (writeServiceSheet) can compute
 *     `photo_urls` entries by URL-building from the photoId — no need
 *     to look up where each photo was uploaded.
 *   - If a photo is mid-upload when its parent action replays, the
 *     `photo_urls` URL is dead for a few seconds then becomes live —
 *     no broken-image state needs separate tracking.
 *
 * All capture (capturePhoto in lib/db/photos.ts) compresses to JPEG, so
 * the `.jpg` extension is correct for every offline-captured photo.
 * Online direct submits with arbitrary mime types use a separate code
 * path (legacy `photos/<jobId>/<idx>.<ext>`) and aren't a concern of
 * this module.
 */

const BUCKET = "reports";

/**
 * Strict UUID regex (versions 1-5). `crypto.randomUUID()` produces v4;
 * future migration to a different version stays compatible. Anything
 * that isn't a valid UUID is rejected by `writeServiceSheet` rather
 * than silently treated as a Storage path (a future regression magnet
 * if we let "unknown format" fall through).
 */
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPhotoClientId(s: string): boolean {
  return UUID_REGEX.test(s);
}

/** Storage object key for a photoId. */
export function photoStoragePath(photoId: string): string {
  if (!isPhotoClientId(photoId)) {
    throw new Error(
      `photoStoragePath: invalid photoId (must be a UUID): ${photoId.slice(0, 40)}`
    );
  }
  return `photos/${photoId}.jpg`;
}

/** Bucket name — exported so route handlers don't hard-code it. */
export const PHOTO_BUCKET = BUCKET;

/**
 * Compute the public Storage URL for a photoId, client-side, without
 * needing a Supabase client. Mirrors `supabase.storage.from(bucket)
 * .getPublicUrl(path)` — the URL is stable and deterministic.
 *
 * Used by ServiceSheetForm's wrapper meta (`applyLocal`) to write
 * renderable URLs into Dexie's `jobs.photo_urls` immediately on
 * offline submit. The Storage object behind that URL doesn't exist
 * yet (the photos loop hasn't uploaded), so the URL is "dead" until
 * the photos loop catches up — brief broken-image, then live. Same
 * deterministic trade-off step 6 already committed to.
 *
 * Throws if photoId is malformed (same UUID regex as the rest of this
 * module) or if NEXT_PUBLIC_SUPABASE_URL isn't configured.
 */
export function photoPublicUrl(photoId: string): string {
  if (!isPhotoClientId(photoId)) {
    throw new Error(
      `photoPublicUrl: invalid photoId (must be a UUID): ${photoId.slice(0, 40)}`
    );
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) {
    throw new Error(
      "photoPublicUrl: NEXT_PUBLIC_SUPABASE_URL is not configured"
    );
  }
  // Supabase public URL shape: {base}/storage/v1/object/public/{bucket}/{path}
  return `${base}/storage/v1/object/public/${BUCKET}/${photoStoragePath(photoId)}`;
}

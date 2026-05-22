"use client";

/**
 * Resolve a photo reference to a `src` URL usable in <img src="...">.
 *
 * Three input shapes the app deals with:
 *
 *   1. A `PendingPhoto` row (Dexie record) — local blob, not yet
 *      uploaded. We mint an Object URL.
 *   2. A bare URL string starting with "http(s)://" — already uploaded
 *      to Supabase Storage. Return as-is.
 *   3. A bare client UUID string — local id of a pending photo. Look
 *      it up in `photos_pending` and mint an Object URL. **Async** —
 *      use the async variant.
 *
 * The third case happens when a job's `photo_urls` array contains
 * client ids (photos captured offline that haven't been uploaded yet).
 * Once the sync engine uploads the photo, it swaps the id for the
 * real URL in the parent row, so subsequent reads use case 2.
 *
 * Callers are responsible for revoking Object URLs they no longer need
 * (`URL.revokeObjectURL(src)`) — typically in a useEffect cleanup.
 */

import { db, type PendingPhoto } from "@/lib/db";

/**
 * Sync variant — works for the common cases: an explicit PendingPhoto
 * record or a URL string. Throws if given a bare client id (use
 * `getPhotoSrcAsync` for that case).
 */
export function getPhotoSrc(ref: PendingPhoto | string): string {
  if (typeof ref !== "string") {
    return URL.createObjectURL(ref.blob);
  }
  if (ref.startsWith("http://") || ref.startsWith("https://")) {
    return ref;
  }
  throw new Error(
    `getPhotoSrc: bare local id "${ref}" — use getPhotoSrcAsync to resolve via Dexie`
  );
}

/**
 * Async variant — handles all three cases including a bare client id
 * that requires a Dexie lookup. Returns null if a client id is given
 * but no matching photo exists in `photos_pending`.
 */
export async function getPhotoSrcAsync(
  ref: PendingPhoto | string
): Promise<string | null> {
  if (typeof ref !== "string") {
    return URL.createObjectURL(ref.blob);
  }
  if (ref.startsWith("http://") || ref.startsWith("https://")) {
    return ref;
  }
  // Bare client id — look it up in pending photos.
  const photo = await db.photos_pending.get(ref);
  if (!photo) {
    return null;
  }
  // If the local blob has been garbage-collected post-upload
  // (photos loop clears blobs >7d after capture once `uploaded=true`),
  // fall back to the cached server URL. Either side existing is enough
  // to render the image.
  if (photo.uploaded && photo.server_url && photo.blob.size === 0) {
    return photo.server_url;
  }
  return URL.createObjectURL(photo.blob);
}

"use client";

/**
 * Recover photos that never made it to the server.
 *
 * On 13 July an RLS failure made every photo upload fail. The loop's
 * five-attempt ceiling was burned in a couple of minutes, hours before
 * the fix shipped, and `drainPhotos` skipped those rows ever after:
 * they were stuck by policy, not by any remaining fault. Twelve photos
 * across four completed jobs are in that state, and their bytes only
 * ever existed in this device's IndexedDB. (The ceiling itself is gone
 * now — see lib/sync/photos.ts — so nothing new can be abandoned that
 * way, but the twelve still need sending.)
 *
 * ── Why this lives in Settings and not a dev route ──
 *
 * The blobs are on the OPERATOR's phone. A recovery tool he cannot reach
 * from the phone recovers nothing, so a desktop-only or hidden dev screen
 * would be the wrong shape entirely.
 *
 * It is also self-hiding: with nothing pending, the card renders nothing
 * at all, so Settings gains no permanent clutter.
 *
 * This surface lists EVERYTHING still pending, stuck or not, because
 * "which of my photos are not on the server yet" is the question an
 * operator brings to Settings. The conflict inbox shows the narrower,
 * more alarming set (see StuckPhotosInbox).
 *
 * ── Why no database write ──
 *
 * The Storage key is derived from the photo id, and the job's
 * `photo_urls` already contains the URL for that exact key (the
 * completion recorded it before the upload was attempted — that ordering
 * is the original bug). So a successful upload makes the existing
 * reference resolve on its own. This component never touches the jobs
 * table.
 */

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { PendingPhotoList } from "@/components/photos/pending-photo-list";

export function PhotoRecoveryCard() {
  const pending = useLiveQuery(
    () => db.photos_pending.filter((p) => !p.uploaded).toArray(),
    []
  );

  if (!pending) return null;

  return (
    <PendingPhotoList
      photos={pending}
      title="Photos waiting to upload"
      intro="These photos are still on this device but never reached the server. Retrying sends them now. Nothing else needs changing: each one goes back to the exact place its service sheet already points at."
    />
  );
}

"use client";

/**
 * Stuck photos, in the conflict inbox.
 *
 * `lib/sync/photos.ts` used to claim in its own docstring that "the
 * conflict inbox surfaces them". It did not: the inbox reads `outbox`
 * and has never read `photos_pending`. The only photo signal anywhere
 * was a pending COUNT in the sync popover, which reads as "still
 * working" — the opposite of the truth for a photo that has been given
 * up on. This component makes the claim true.
 *
 * The inbox is the right home because it is already where an operator
 * looks when something did not send, and a stuck photo is exactly that.
 * It sits ABOVE the outbox entries because a photo is the one thing
 * here that cannot be recreated: a refused booking can be re-entered
 * from memory, a photo taken in a customer's loft cannot.
 *
 * The copy states the consequence rather than implying progress. "Will
 * be lost if you clear the app" is the literal truth — the bytes exist
 * in this browser's IndexedDB and nowhere else.
 */

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { isPhotoStuck } from "@/lib/sync/photos";
import { PendingPhotoList } from "@/components/photos/pending-photo-list";

export function StuckPhotosInbox() {
  const stuck = useLiveQuery(
    () => db.photos_pending.filter((p) => isPhotoStuck(p)).toArray(),
    []
  );

  if (!stuck) return null;

  return (
    <PendingPhotoList
      photos={stuck}
      tone="alarm"
      title="Photos that have not been sent"
      intro="These photos are still only on this device. They keep retrying in the background, but they have failed enough times to need a look. If this device is cleared or the app is reinstalled before they send, they are gone for good: photos taken on site cannot be recreated."
    />
  );
}

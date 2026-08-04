import { ConflictsInbox } from "@/components/sync/conflicts-inbox";
import { StuckPhotosInbox } from "@/components/sync/stuck-photos-inbox";

export const metadata = {
  title: "Sync conflicts",
};

/**
 * Conflict inbox — surfaces outbox entries that the push loop has
 * given up on (5+ client-error attempts, or UnknownActionError on
 * first attempt).
 *
 * Auth-gated by the (app) route group. Server component shell; the
 * inner list is client-side because it reads Dexie live.
 */
export default function SyncConflictsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Sync conflicts</h1>
        <p className="mt-1 text-sm text-gray-500">
          Work that hasn&apos;t reached the server: changes it refused, and
          photos that failed to upload. Retry once you&apos;ve fixed the
          underlying issue, or discard to abandon a change locally.
        </p>
      </header>
      {/* Photos first: an unsent photo is the only thing on this page
          that cannot be recreated from memory. Renders nothing when
          none are stuck. */}
      <div className="mb-6">
        <StuckPhotosInbox />
      </div>
      <ConflictsInbox />
    </div>
  );
}

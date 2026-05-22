import { ConflictsInbox } from "@/components/sync/conflicts-inbox";

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
          Offline changes the server refused. Retry once you&apos;ve fixed
          the underlying issue, or discard to abandon the change locally.
        </p>
      </header>
      <ConflictsInbox />
    </div>
  );
}

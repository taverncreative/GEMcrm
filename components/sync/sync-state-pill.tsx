"use client";

/**
 * Inline sync-state pill — small badge designed to sit next to action
 * buttons inside a detail page, so the operator can see at a glance
 * whether their next press will go straight to the server or be queued
 * for later.
 *
 * Distinct from `<SyncStatusIndicator>` (the header chip):
 *   - The chip is the global, always-on top-right pill — easy to miss on
 *     a phone when focus is on a primary action.
 *   - This pill sits *near the button you're about to tap*. Same data
 *     source, presented inline for proximity.
 *
 * Truthfulness rule (operator-caught in the pass-B offline run): the
 * pill must NEVER claim Synced while outbox entries are pending. State
 * derives from the PENDING COUNT first; run-completion data
 * (lastSyncAt) is only trusted at zero pending. The count's first
 * paint is `undefined` (not 0) — a freshly-mounted pill renders
 * nothing rather than flashing "Synced" before the IDB count resolves
 * (the completion flow remounts this pill at exactly that moment).
 *
 * Variants (priority order):
 *   - count unresolved   →  null   (no pill until we know)
 *   - offline + pending  →  amber  "Waiting to sync · N"
 *   - offline + no queue →  grey   "Offline"
 *   - pending OR syncing →  blue   "Syncing…"
 *   - synced (lastSyncAt)→  green  "Synced"
 *   - first paint        →  null
 */

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useSyncStatus } from "@/lib/sync/status";
import { useIsOnline } from "@/lib/hooks/use-is-online";

interface Variant {
  label: string;
  classes: string;
  dot: string;
  pulse?: boolean;
}

export function SyncStatePill() {
  const status = useSyncStatus();
  const online = useIsOnline();
  // No default value: `undefined` means "count not yet known" and
  // renders nothing. A default of 0 let a freshly-mounted pill claim
  // "Synced" for the tick before the IDB query resolved.
  const pending = useLiveQuery(() =>
    db.outbox.filter((e) => !e.stuck).count()
  );

  const variant: Variant | null = (() => {
    if (pending === undefined) return null;
    if (!online) {
      if (pending > 0) {
        return {
          label: `Waiting to sync · ${pending}`,
          classes: "bg-amber-50 text-amber-800 border-amber-200",
          dot: "bg-amber-500",
        };
      }
      return {
        label: "Offline",
        classes: "bg-gray-50 text-gray-600 border-gray-200",
        dot: "bg-gray-400",
      };
    }
    // Anything still queued means we are NOT synced — whether the
    // engine is mid-run or between backoff attempts. One calm state
    // covers both; the live count flips it the moment the drain lands.
    if (pending > 0 || status.syncing) {
      return {
        label: "Syncing…",
        classes: "bg-blue-50 text-blue-700 border-blue-200",
        dot: "bg-blue-500",
        pulse: true,
      };
    }
    if (status.lastSyncAt) {
      return {
        label: "Synced",
        classes: "bg-green-50 text-green-700 border-green-200",
        dot: "bg-green-500",
      };
    }
    return null;
  })();

  if (!variant) return null;

  return (
    <span
      aria-live="polite"
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${variant.classes}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${variant.dot} ${variant.pulse ? "animate-pulse" : ""}`}
      />
      {variant.label}
    </span>
  );
}

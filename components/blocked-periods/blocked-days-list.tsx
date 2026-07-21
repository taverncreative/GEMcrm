"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { wrapAction } from "@/lib/actions/wrap";
import { deleteBlockedPeriodAction } from "@/app/(app)/blocked-periods/actions";
import { todayUk } from "@/lib/utils/today-uk";
import { BlockOutModal } from "@/components/blocked-periods/block-out-modal";
import type { BlockedPeriod } from "@/types/database";

/**
 * Upcoming block-out days, with edit + delete. Reads Dexie LIVE
 * (useLiveQuery) rather than server props so an offline create/edit/delete
 * reflects here instantly — the server-rendered calendar band lags until the
 * next sync, but this management list never does.
 *
 * Delete is offline-first via wrapAction: the local row is stamped
 * `deleted_at` (dropping it from this live list at once) + a `delete` outbox
 * entry is queued; online the soft_delete_blocked_period RPC runs, offline it
 * replays on reconnect. A scoped router.refresh() clears the calendar band.
 */

// Module-scope (stable ref) — mirrors customer-side-panel's wrapped toggles.
const wrappedDelete = wrapAction(deleteBlockedPeriodAction, {
  actionName: "deleteBlockedPeriodAction",
  entityType: "blocked_period",
  entityId: ([id]) => id as string,
  applyLocal: async ([id]) => {
    await db.blocked_periods.update(id as string, {
      deleted_at: new Date().toISOString(),
    });
  },
});

function formatRange(start: string, end: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}

export function BlockedDaysList() {
  const router = useRouter();
  const [editing, setEditing] = useState<BlockedPeriod | null>(null);

  const blocks = useLiveQuery(async () => {
    const today = todayUk();
    const all = await db.blocked_periods.toArray();
    return all
      .filter((b) => !b.deleted_at && b.end_date >= today)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
  }, []);

  async function handleDelete(block: BlockedPeriod) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Remove block-out "${block.title}"?`)
    ) {
      return;
    }
    await wrappedDelete(block.id);
    router.refresh();
  }

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <h3 className="text-sm font-medium text-gray-500">Blocked days</h3>

      {blocks === undefined ? (
        <p className="mt-3 text-sm text-gray-400">Loading…</p>
      ) : blocks.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">
          No days blocked out. Use “Block out days” to mark yourself off.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {blocks.map((block) => (
            <li
              key={block.id}
              className="flex items-start justify-between gap-2 rounded-lg border border-rose-100 bg-rose-50/60 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-rose-900">
                  {block.title}
                </p>
                <p className="text-xs text-rose-700">
                  {formatRange(block.start_date, block.end_date)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEditing(block)}
                  className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-white"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(block)}
                  className="rounded-md px-2 py-1 text-xs font-medium text-rose-700 hover:bg-white"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <BlockOutModal editing={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

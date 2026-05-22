"use client";

/**
 * Conflict inbox UI.
 *
 * Lists outbox entries with `stuck === true`. Each row shows:
 *   - Entity type + truncated id
 *   - Action name
 *   - Last error message (typically the server's 4xx / refusal text)
 *   - Created-at timestamp, attempts count
 *   - "Args" disclosure → JSON pretty-print
 *   - Retry button: resets attempts, clears stuck flag, kicks off a
 *     sync run.
 *   - Discard button: 2-step confirm; removes the outbox entry. Does
 *     NOT revert the local Dexie change (the operator may have
 *     dependent work atop the row; reverting would cascade). Warning
 *     copy makes the local-state divergence explicit.
 *
 * No revert-on-discard in step 6 — flagged in STEP_6_NOTES.md as a
 * follow-up. Doing it safely would need per-entity rollback logic
 * (e.g. "undo this delete by un-setting deleted_at" / "undo this
 * update by … what?"). Defer until a real use case surfaces.
 */

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { unstickEntry } from "@/lib/sync/push";
import { removeOutboxEntry } from "@/lib/db/outbox";
import { runSync } from "@/lib/sync/engine";

export function ConflictsInbox() {
  const stuckEntries = useLiveQuery(
    () => db.outbox.filter((e) => e.stuck).sortBy("created_at"),
    [],
    []
  );
  const [confirmDiscardId, setConfirmDiscardId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleRetry(id: number) {
    setBusy(true);
    try {
      await unstickEntry(id);
      // Kick off a sync immediately so the operator sees the outcome
      // without waiting for the next 30s tick.
      await runSync("manual");
    } finally {
      setBusy(false);
    }
  }

  async function handleDiscard(id: number) {
    setBusy(true);
    try {
      await removeOutboxEntry(id);
      setConfirmDiscardId(null);
    } finally {
      setBusy(false);
    }
  }

  if (stuckEntries === undefined) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-400">
        Loading…
      </div>
    );
  }

  if (stuckEntries.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-gray-500">
          No conflicts. Everything synced cleanly.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {stuckEntries.map((e) => {
        const isConfirming = confirmDiscardId === e.id;
        return (
          <li
            key={e.id}
            className="rounded-xl border border-red-100 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-sm font-semibold text-gray-900">
                    {e.action_name}
                  </span>
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-700">
                    stuck
                  </span>
                  <span className="text-xs text-gray-500">
                    {e.entity_type} · {e.entity_id.slice(0, 8)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {e.attempts} attempts · queued{" "}
                  {new Date(e.created_at).toLocaleString()}
                </p>
                {e.last_error && (
                  <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                    {e.last_error}
                  </p>
                )}
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-gray-400 hover:text-gray-600">
                    args
                  </summary>
                  <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-gray-50 p-2 text-[11px] text-gray-700">
                    {JSON.stringify(e.args, null, 2)}
                  </pre>
                </details>
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                <button
                  type="button"
                  onClick={() => handleRetry(e.id!)}
                  disabled={busy}
                  className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                >
                  Retry
                </button>
                {isConfirming ? (
                  <div className="flex flex-col gap-1.5">
                    <p className="max-w-[14rem] text-[10px] text-amber-700">
                      Discard removes the queued change; local data
                      isn&apos;t reverted. Confirm?
                    </p>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => handleDiscard(e.id!)}
                        disabled={busy}
                        className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Yes, discard
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDiscardId(null)}
                        className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDiscardId(e.id!)}
                    disabled={busy}
                    className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    Discard
                  </button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

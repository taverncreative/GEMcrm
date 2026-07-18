"use client";

/**
 * Bulk-complete N tasks at once.
 *
 * Wrapping strategy: **fan-out at enqueue time**.
 *
 *   - Local: mark all N task rows complete in Dexie.
 *   - Outbox: enqueue N entries, each `completeTaskAction` with a
 *     single task_id. The bulk action does NOT enter the outbox;
 *     replay always goes through the single-task path.
 *   - Online: dispatch `bulkCompleteTasksAction` directly (one HTTP
 *     round-trip — efficient).
 *
 * Why fan-out at enqueue rather than replay: the registry stays clean
 * of any "bulk" concept (a single-action invariant on the registry
 * makes step 6's sync engine simpler and step-7 actions only need to
 * register the single-row form). Replay correctness is preserved
 * because each completeTaskAction is idempotent server-side.
 *
 * Cost: N entries in the outbox vs 1. At GEM's scale (a handful of
 * tasks completed at once) this is fine. If a user ever ticks 200
 * tasks the outbox grows by 200 rows — Dexie handles that easily.
 *
 * Not using useLocalFirstAction here — its single-enqueue assumption
 * doesn't fit fan-out. Direct handler instead.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkCompleteTasksAction } from "@/app/(app)/dashboard/actions";
import { enqueueAction } from "@/lib/db/outbox";
import { db } from "@/lib/db";

export function BulkCompleteButton({ taskIds }: { taskIds: string[] }) {
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function handleClick() {
    if (taskIds.length === 0) return;
    const now = new Date().toISOString();

    // 1. Local — update all tasks. Parallel; Dexie is happy.
    await Promise.all(
      taskIds.map((id) =>
        db.tasks.update(id, {
          status: "complete",
          completed_at: now,
          updated_at: now,
        })
      )
    );

    // 2. Outbox — fan-out N single-task entries. Each enqueueAction
    //    also goes through compaction (update+update merge), so if a
    //    given task already had a pending completeTaskAction queued,
    //    only the latest survives.
    await Promise.all(
      taskIds.map((id) =>
        enqueueAction({
          action_name: "completeTaskAction",
          args: { task_id: id },
          entity_type: "task",
          entity_id: id,
          op: "update",
        })
      )
    );

    // 3. Online: dispatch the bulk action for efficiency. Fire-and-
    //    forget — the local + outbox writes are what matter. If the
    //    bulk call fails, the N outbox entries still drain individually.
    if (typeof navigator !== "undefined" && navigator.onLine) {
      startTransition(async () => {
        const fd = new FormData();
        fd.set("task_ids", JSON.stringify(taskIds));
        try {
          await bulkCompleteTasksAction(
            { success: false, errors: {}, message: null },
            fd
          );
          // Server has marked them complete — refresh AFTER it resolves (not
          // before, or the refetch races the write) so the server-rendered
          // dashboard tile re-fetches and drops the completed rows in place.
          // Replaces bulkCompleteTasksAction's old revalidatePath (which
          // purged the whole client cache and stampeded a re-prefetch).
          router.refresh();
        } catch (err) {
          // Outbox entries remain — sync engine will retry per-task.
          console.warn("[bulk-complete] bulk dispatch failed:", err);
        }
      });
    }

    setDone(true);
  }

  if (done) {
    return <span className="text-xs text-brand-darker">All done</span>;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending || taskIds.length === 0}
      className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 transition-colors"
    >
      {pending ? "..." : "Complete all"}
    </button>
  );
}

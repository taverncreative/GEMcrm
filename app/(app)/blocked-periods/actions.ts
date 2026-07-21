"use server";

import { saveBlockedPeriod, deleteBlockedPeriod } from "@/lib/data/blocked-periods";
import { BlockedPeriodSchema } from "@/lib/validation/blocked-period";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionState } from "@/types/actions";

/**
 * Create or edit a block-out period ("block-out days"). Date-only range.
 *
 * Offline-first contract (mirrors createTaskAction): the modal's local-first
 * wrapper writes the row to Dexie and enqueues a `create`/`update` outbox
 * entry carrying the client-generated `id`, then (online) invokes this action
 * with the SAME id. saveBlockedPeriod upserts on id, so the online call and
 * any later outbox replay are idempotent. Registered in lib/sync/registry.ts
 * under the same action name for replay.
 *
 * No revalidatePath — the modal runs a scoped router.refresh() on success so
 * the new/edited band appears on the server-rendered calendar without the
 * client-cache purge / prefetch stampede a broad revalidate would trigger.
 */
export async function saveBlockedPeriodAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireUser();

  const str = (key: string): string =>
    (formData.get(key) as string | null) ?? "";

  const result = BlockedPeriodSchema.safeParse({
    title: str("title"),
    start_date: str("start_date"),
    end_date: str("end_date"),
  });

  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !errors[key]) errors[key] = issue.message;
    }
    return { success: false, errors, message: null };
  }

  // Client-generated id from the local-first wrapper (present online and on
  // replay). Empty only for a hypothetical non-wrapped caller → mint one.
  const id = str("id") || undefined;
  const { title, start_date, end_date } = result.data;

  try {
    await saveBlockedPeriod({ id, title, start_date, end_date });
  } catch (err) {
    return {
      success: false,
      errors: {},
      message:
        err instanceof Error ? err.message : "Failed to save block-out period",
    };
  }

  return { success: true, errors: {}, message: "Block-out saved" };
}

/**
 * Soft-delete a block-out period. Offline-first via wrapAction: the caller
 * optimistically stamps `deleted_at` on the Dexie row + enqueues a `delete`
 * outbox entry, then (online) this runs. deleteBlockedPeriod goes through the
 * soft_delete_blocked_period RPC (a direct client UPDATE would 42501 under
 * the SELECT policy). Idempotent on replay. Registered in the sync registry.
 */
export async function deleteBlockedPeriodAction(
  id: string
): Promise<{ success: boolean; message?: string }> {
  await requireUser();
  if (!id) return { success: false, message: "Missing block-out id" };
  try {
    await deleteBlockedPeriod(id);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      message:
        err instanceof Error ? err.message : "Failed to delete block-out period",
    };
  }
}

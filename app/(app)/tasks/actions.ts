"use server";

import { createTask } from "@/lib/data/tasks";
import { TaskCreateSchema } from "@/lib/validation/task";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionState } from "@/types/actions";

/**
 * Create a manual personal to-do (task_type 'todo'). Date-only — no
 * time-of-day, no recurrence (v1).
 *
 * Offline-first contract: the form's local-first wrapper writes the row
 * to Dexie and enqueues a `create` outbox entry carrying the
 * client-generated `id`, then (online) invokes this action with the SAME
 * id. createTask upserts on id, so the online call and any later outbox
 * replay are idempotent. Registered in lib/sync/registry.ts under the
 * same action name for replay.
 */
export async function createTaskAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireUser();

  const str = (key: string): string =>
    (formData.get(key) as string | null) ?? "";

  const result = TaskCreateSchema.safeParse({
    title: str("title"),
    due_date: str("due_date"),
    notes: str("notes"),
  });

  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !errors[key]) errors[key] = issue.message;
    }
    return { success: false, errors, message: null };
  }

  // Client-generated id from the local-first wrapper (always present
  // online and on replay). Empty only for a hypothetical non-wrapped
  // caller, in which case createTask mints one.
  const id = str("id") || undefined;
  const { title, due_date, notes } = result.data;

  try {
    await createTask({
      id,
      title,
      due_date: due_date === "" ? null : due_date,
      notes: notes === "" ? null : notes,
      task_type: "todo",
    });
  } catch (err) {
    return {
      success: false,
      errors: {},
      message: err instanceof Error ? err.message : "Failed to create task",
    };
  }

  // No revalidatePath — the NewTaskModal caller runs a scoped router.refresh()
  // on success (online) and after an offline queue, re-fetching only the
  // current route to surface the new to-do on the server-rendered
  // calendar/dashboard. Avoids the client-cache purge / prefetch stampede.
  return { success: true, errors: {}, message: "Task created" };
}

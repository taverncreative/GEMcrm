"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { completeTaskAction } from "@/app/(app)/dashboard/actions";
import { useLocalFirstAction, type WrapMeta } from "@/lib/actions/wrap";
import { db } from "@/lib/db";
import type { ActionState } from "@/types/actions";

export const completeTaskInitialState: ActionState = {
  success: false,
  errors: {},
  message: null,
};

// Wrapper metadata — defined at module level so the reference is stable
// across renders (the hook's useCallback deps include `meta`). Exported
// so other surfaces (e.g. the calendar task modal) drive the identical
// local-first completion without duplicating the Dexie write.
export interface CompleteTaskInput {
  task_id: string;
}
export const completeTaskMeta: WrapMeta<CompleteTaskInput> = {
  actionName: "completeTaskAction",
  entityType: "task",
  entityId: (input) => input.task_id,
  parseInput: (formData) => {
    const taskId = formData.get("task_id");
    return typeof taskId === "string" && taskId
      ? { task_id: taskId }
      : null;
  },
  applyLocal: async (input) => {
    const now = new Date().toISOString();
    await db.tasks.update(input.task_id, {
      status: "complete",
      completed_at: now,
      updated_at: now,
    });
  },
};

export function CompleteTaskButton({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [state, action, isPending] = useLocalFirstAction(
    completeTaskAction,
    completeTaskInitialState,
    completeTaskMeta
  );

  // On success (online only — the legacy wrap path flips success from the
  // server result), refresh so the server-rendered dashboard tile re-fetches
  // and drops the now-complete row in place. This replaces the revalidatePath
  // that completeTaskAction used to call (which purged the whole client cache
  // and stampeded a re-prefetch of every link). The calendar chip does the
  // identical refresh. Offline, success never flips, so this never fires
  // against stale server data — the row stays until the next sync + refresh.
  useEffect(() => {
    if (state.success) router.refresh();
  }, [state.success, router]);

  if (state.success) {
    return (
      <span className="shrink-0 text-xs text-brand-darker">Done</span>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="task_id" value={taskId} />
      <button
        type="submit"
        disabled={isPending}
        className="shrink-0 rounded px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
      >
        {isPending ? "..." : "Complete"}
      </button>
    </form>
  );
}

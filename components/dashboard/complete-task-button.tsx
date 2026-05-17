"use client";

import { useActionState } from "react";
import { completeTaskAction } from "@/app/(app)/dashboard/actions";
import type { ActionState } from "@/types/actions";

const initialState: ActionState = {
  success: false,
  errors: {},
  message: null,
};

export function CompleteTaskButton({ taskId }: { taskId: string }) {
  const [state, action, isPending] = useActionState(
    completeTaskAction,
    initialState
  );

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

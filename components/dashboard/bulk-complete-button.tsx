"use client";

import { useActionState } from "react";
import { bulkCompleteTasksAction } from "@/app/(app)/dashboard/actions";
import type { ActionState } from "@/types/actions";

const initialState: ActionState = {
  success: false,
  errors: {},
  message: null,
};

export function BulkCompleteButton({ taskIds }: { taskIds: string[] }) {
  const [state, action, isPending] = useActionState(
    bulkCompleteTasksAction,
    initialState
  );

  if (state.success) {
    return <span className="text-xs text-brand-darker">All done</span>;
  }

  return (
    <form action={action}>
      <input type="hidden" name="task_ids" value={JSON.stringify(taskIds)} />
      <button
        type="submit"
        disabled={isPending}
        className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 transition-colors"
      >
        {isPending ? "..." : "Complete all"}
      </button>
    </form>
  );
}

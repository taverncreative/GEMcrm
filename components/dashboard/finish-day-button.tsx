"use client";

import { useActionState } from "react";
import { finishDayAction } from "@/app/(app)/dashboard/actions";
import type { ActionState } from "@/types/actions";

const initialState: ActionState = {
  success: false,
  errors: {},
  message: null,
};

export function FinishDayButton() {
  const [state, action, isPending] = useActionState(
    finishDayAction,
    initialState
  );

  if (state.success) {
    return (
      <span className="text-xs font-medium text-brand-darker">
        Day logged
      </span>
    );
  }

  return (
    <form action={action}>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-50 transition-colors"
      >
        {isPending ? "Saving..." : "Finish Day"}
      </button>
    </form>
  );
}

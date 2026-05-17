"use client";

import { useActionState } from "react";
import { updateJobStatusAction } from "@/app/(app)/jobs/[id]/actions";
import { JOB_STATUS_COLORS } from "@/lib/constants/job-labels";
import type { ActionState } from "@/types/actions";
import type { JobStatus } from "@/types/database";

const initialState: ActionState = {
  success: false,
  errors: {},
  message: null,
};

function StatusButton({
  jobId,
  targetStatus,
  label,
  className,
}: {
  jobId: string;
  targetStatus: JobStatus;
  label: string;
  className: string;
}) {
  const [state, action, isPending] = useActionState(
    updateJobStatusAction,
    initialState
  );

  return (
    <form action={action}>
      <input type="hidden" name="job_id" value={jobId} />
      <input type="hidden" name="status" value={targetStatus} />
      <button
        type="submit"
        disabled={isPending}
        className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 transition-colors ${className}`}
      >
        {isPending ? "..." : label}
      </button>
      {state.message && (
        <p className="mt-1 text-xs text-red-500">{state.message}</p>
      )}
    </form>
  );
}

export function JobStatusActions({
  jobId,
  currentStatus,
}: {
  jobId: string;
  currentStatus: JobStatus;
}) {
  if (currentStatus === "completed") {
    return (
      <span className={`rounded-full px-3 py-1 text-xs font-medium ${JOB_STATUS_COLORS.completed}`}>
        Completed
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {currentStatus === "scheduled" && (
        <>
          <StatusButton
            jobId={jobId}
            targetStatus="in_progress"
            label="Start Job"
            className="bg-amber-100 text-amber-700 hover:bg-amber-200"
          />
          <StatusButton
            jobId={jobId}
            targetStatus="completed"
            label="Start & Complete"
            className="bg-brand text-white hover:bg-brand-dark"
          />
        </>
      )}
      {currentStatus === "in_progress" && (
        <StatusButton
          jobId={jobId}
          targetStatus="completed"
          label="Complete Job"
          className="bg-brand text-white hover:bg-brand-dark"
        />
      )}
    </div>
  );
}

/** Compact version for use in lists/tables */
export function JobQuickAction({
  jobId,
  currentStatus,
}: {
  jobId: string;
  currentStatus: JobStatus;
}) {
  // Hooks must be called unconditionally, so declare before any early return.
  const [, action, isPending] = useActionState(
    updateJobStatusAction,
    initialState
  );

  if (currentStatus === "completed") return null;

  const target: JobStatus = currentStatus === "scheduled" ? "in_progress" : "completed";
  const label = currentStatus === "scheduled" ? "Start" : "Done";

  return (
    <form action={action}>
      <input type="hidden" name="job_id" value={jobId} />
      <input type="hidden" name="status" value={target} />
      <button
        type="submit"
        disabled={isPending}
        className="rounded px-3 py-1.5 text-xs font-medium text-brand-darker hover:bg-brand-soft disabled:opacity-50 transition-colors"
      >
        {isPending ? "..." : label}
      </button>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { updateJobStatusAction } from "@/app/(app)/jobs/[id]/actions";
import { JOB_STATUS_LABELS, JOB_STATUS_COLORS, JOB_STATUSES } from "@/lib/constants/job-labels";
import type { ActionState } from "@/types/actions";
import type { JobStatus } from "@/types/database";

const initialState: ActionState = {
  success: false,
  errors: {},
  message: null,
};

export function JobStatusSelect({
  jobId,
  currentStatus,
}: {
  jobId: string;
  currentStatus: JobStatus;
}) {
  const [state, action, isPending] = useActionState(
    updateJobStatusAction,
    initialState
  );

  return (
    <form action={action}>
      <input type="hidden" name="job_id" value={jobId} />
      <div className="flex items-center gap-2">
        <select
          name="status"
          defaultValue={currentStatus}
          disabled={isPending}
          className={`h-8 rounded-full border-0 px-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-50 ${JOB_STATUS_COLORS[currentStatus]}`}
          onChange={(e) => {
            const form = e.target.closest("form");
            if (form) form.requestSubmit();
          }}
        >
          {JOB_STATUSES.map((s) => (
            <option key={s} value={s}>
              {JOB_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {state.message && (
          <span className="text-xs text-red-500">{state.message}</span>
        )}
      </div>
    </form>
  );
}

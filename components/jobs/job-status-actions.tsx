"use client";

import { updateJobStatusAction } from "@/app/(app)/jobs/[id]/actions";
import { JOB_STATUS_COLORS } from "@/lib/constants/job-labels";
import { useLocalFirstAction, type WrapMeta } from "@/lib/actions/wrap";
import { db } from "@/lib/db";
import type { ActionState } from "@/types/actions";
import type { JobStatus } from "@/types/database";

// Meta for the wrapper — module-level for ref stability.
const VALID_STATUSES: readonly JobStatus[] = [
  "scheduled",
  "in_progress",
  "completed",
];
interface UpdateJobStatusInput {
  job_id: string;
  status: JobStatus;
}
const updateJobStatusMeta: WrapMeta<UpdateJobStatusInput> = {
  actionName: "updateJobStatusAction",
  entityType: "job",
  entityId: (input) => input.job_id,
  parseInput: (formData) => {
    const jobId = formData.get("job_id");
    const status = formData.get("status");
    if (typeof jobId !== "string" || typeof status !== "string") return null;
    if (!VALID_STATUSES.includes(status as JobStatus)) return null;
    return { job_id: jobId, status: status as JobStatus };
  },
  applyLocal: async (input) => {
    await db.jobs.update(input.job_id, {
      job_status: input.status,
      updated_at: new Date().toISOString(),
    });
  },
};

const initialState: ActionState = {
  success: false,
  errors: {},
  message: null,
};

// Tiny inline spinner used by both button variants for the "saving" state.
function Spinner({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  );
}

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
  // Wrapped: local-first Dexie update + outbox enqueue + offline-tolerant.
  // (Step 7: previously this larger detail-page variant used raw
  // useActionState — wrap-on-touch as we convert jobs/[id].)
  const [state, action, isPending] = useLocalFirstAction(
    updateJobStatusAction,
    initialState,
    updateJobStatusMeta
  );

  return (
    <form action={action} className="inline-flex flex-col items-start">
      <input type="hidden" name="job_id" value={jobId} />
      <input type="hidden" name="status" value={targetStatus} />
      <button
        type="submit"
        disabled={isPending}
        // active:scale-95 gives instant tactile feedback on press,
        // before isPending propagates — matters on touch devices where
        // the operator otherwise wonders if their tap registered.
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-75 active:scale-95 disabled:cursor-wait disabled:opacity-70 ${className}`}
      >
        {isPending ? (
          <>
            <Spinner />
            <span>Saving…</span>
          </>
        ) : (
          label
        )}
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
  // Wrapped: local-first Dexie update + outbox enqueue + offline-tolerant.
  const [, action, isPending] = useLocalFirstAction(
    updateJobStatusAction,
    initialState,
    updateJobStatusMeta
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
        className="inline-flex items-center justify-center gap-1 rounded px-3 py-1.5 text-xs font-medium text-brand-darker transition-all duration-75 hover:bg-brand-soft active:scale-95 disabled:cursor-wait disabled:opacity-70"
      >
        {isPending ? (
          <>
            <Spinner className="h-3 w-3" />
            <span>Saving…</span>
          </>
        ) : (
          label
        )}
      </button>
    </form>
  );
}

"use client";

import Link from "next/link";
import { updateJobStatusAction } from "@/app/(app)/jobs/[id]/actions";
import { JOB_STATUS_COLORS } from "@/lib/constants/job-labels";
import { ROUTES } from "@/lib/constants/routes";
import { useLocalFirstAction, type WrapMeta } from "@/lib/actions/wrap";
import { db } from "@/lib/db";
import type { ActionState } from "@/types/actions";
import type { JobStatus } from "@/types/database";

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
    // L1 mirror of the server rule: in_progress is the only status this
    // action moves to — completion goes through the service sheet. A
    // null here means the tap neither writes Dexie nor queues an outbox
    // entry, so local state can't lie about a rejected transition.
    if (status !== "in_progress") return null;
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

  // Q0: a draft is a phone jotting with no customer/site — it is NOT
  // completable. The only forward action is to upgrade it to a real
  // booking (attach customer + site). Render that, never the
  // "Complete job →" link, which the fall-through below would
  // otherwise show for any non-{completed,scheduled} status.
  if (currentStatus === "draft") {
    return (
      <Link
        href={`${ROUTES.jobDetail(jobId)}/upgrade`}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-all duration-75 hover:bg-brand-dark active:scale-95"
      >
        Upgrade to booking →
      </Link>
    );
  }

  // L1: no direct status-to-completed write exists any more. The
  // completion affordance NAVIGATES to the service sheet — the only
  // route to completed, whose L0 invariant requires a filled sheet.
  return (
    <div className="flex flex-wrap items-center gap-2">
      {currentStatus === "scheduled" && (
        <StatusButton
          jobId={jobId}
          targetStatus="in_progress"
          label="Start Job"
          className="bg-amber-100 text-amber-700 hover:bg-amber-200"
        />
      )}
      <Link
        href={`${ROUTES.jobDetail(jobId)}/complete`}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-all duration-75 hover:bg-brand-dark active:scale-95"
      >
        Complete job →
      </Link>
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

  // L1: "Done" (one-tap empty completion from the dashboard — how the
  // three stranded empty-completed jobs were made) is gone. In-progress
  // jobs link to the service sheet instead; "Start" stays a status
  // write (scheduled → in_progress is harmless).
  if (currentStatus !== "scheduled") {
    return (
      <Link
        href={`${ROUTES.jobDetail(jobId)}/complete`}
        className="inline-flex items-center justify-center gap-1 rounded px-3 py-1.5 text-xs font-medium text-brand-darker transition-all duration-75 hover:bg-brand-soft active:scale-95"
      >
        Complete →
      </Link>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="job_id" value={jobId} />
      <input type="hidden" name="status" value="in_progress" />
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
          "Start"
        )}
      </button>
    </form>
  );
}

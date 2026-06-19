"use client";

import { useEffect, useState, useTransition } from "react";
import {
  deleteJobAction,
  getJobDeleteImpactAction,
} from "@/app/(app)/jobs/[id]/actions";
import type { JobDeleteImpact } from "@/lib/data/jobs";
import { wrapDirectCallGracefully } from "@/lib/actions/graceful";
import { db } from "@/lib/db";

// Wrap so a transport-layer failure resolves to a `{success:false}` shape
// the error rendering already understands, instead of throwing out of the
// transition and hanging the dialog (same safety net as customer-delete).
const wrappedDeleteJob = wrapDirectCallGracefully(deleteJobAction);

interface DeleteJobConfirmProps {
  jobId: string;
  /** A short human label for the job, e.g. "job 00005-BSK" or "this job". */
  jobLabel: string;
  open: boolean;
  onClose: () => void;
  /** Called after a successful delete (e.g. redirect to the jobs list). */
  onDeleted: () => void;
}

/**
 * Single-step delete confirmation for a job. Far lower-stakes than the
 * customer delete (one recoverable soft-delete, no cascade), so there's NO
 * type-the-name friction — a clear confirm is enough. Surfaces the impact:
 * if the job is on an invoice it's named (the invoice STANDS), and any
 * follow-up child jobs are flagged. Warn-and-proceed — an invoiced job is
 * NOT blocked (mirrors how customer-delete leaves dependents in place).
 *
 * It's a SOFT delete, so the copy stays "Delete job" / "Removes" — never
 * "permanently" / "forever".
 */
export function DeleteJobConfirm({
  jobId,
  jobLabel,
  open,
  onClose,
  onDeleted,
}: DeleteJobConfirmProps) {
  const [impact, setImpact] = useState<JobDeleteImpact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Fetch the impact preview when the dialog opens. Kept async-only (no
  // synchronous setState in the effect body) — resets happen in handleClose,
  // an event handler, which is the React-idiomatic place for them.
  useEffect(() => {
    if (!open) return;
    let active = true;
    void getJobDeleteImpactAction(jobId).then((res) => {
      if (active) setImpact(res);
    });
    return () => {
      active = false;
    };
  }, [open, jobId]);

  if (!open) return null;

  function handleClose() {
    setImpact(null);
    setError(null);
    onClose();
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const res = await wrappedDeleteJob(jobId);
      if (!res.success) {
        setError(res.message ?? "Failed to delete job");
        return;
      }
      // Mirror the soft-delete into Dexie so the offline-first views (jobs
      // list + this detail page) drop it immediately, without waiting for
      // the next sync pull. The server row is already updated.
      try {
        await db.jobs.update(jobId, { deleted_at: new Date().toISOString() });
      } catch {
        // Non-fatal — the next sync pull reconciles it.
      }
      onDeleted();
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={handleClose}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="px-6 pt-6">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
            <svg
              className="h-5 w-5 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
              />
            </svg>
          </div>
          <h2 className="text-center text-lg font-semibold text-gray-900">
            Delete this job?
          </h2>
          <p className="mt-2 text-center text-sm text-gray-500">
            Removes {jobLabel} from your job list and dashboard.
          </p>

          {impact && (impact.invoiceNumber || impact.followUps > 0) && (
            <div className="mt-4 space-y-2 rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800">
              {impact.invoiceNumber && (
                <p>
                  On invoice{" "}
                  <span className="font-medium">{impact.invoiceNumber}</span>,
                  which will stand — deleting the job doesn&rsquo;t change it.
                </p>
              )}
              {impact.followUps > 0 && (
                <p>
                  {impact.followUps} follow-up{" "}
                  {impact.followUps === 1 ? "job" : "jobs"} link to this one and
                  will keep that link.
                </p>
              )}
            </div>
          )}

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>

        <div className="mt-6 flex gap-2 border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={isPending}
            className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Deleting…" : "Delete job"}
          </button>
        </div>
      </div>
    </div>
  );
}

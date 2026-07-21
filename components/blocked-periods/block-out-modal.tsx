"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { saveBlockedPeriodAction } from "@/app/(app)/blocked-periods/actions";
import { deleteJobAction } from "@/app/(app)/jobs/[id]/actions";
import { INITIAL_ACTION_STATE } from "@/types/actions";
import {
  useLocalFirstAction,
  formDataToObject,
  type WrapMeta,
} from "@/lib/actions/wrap";
import { wrapDirectCallGracefully } from "@/lib/actions/graceful";
import { db } from "@/lib/db";
import { findJobsInRangeLocal } from "@/lib/db/lookups";
import { applyJobCancellations } from "@/lib/blocked-periods/cancel-jobs";
import { newId } from "@/lib/utils/id";
import { todayUk } from "@/lib/utils/today-uk";
import { CALL_TYPE_LABELS } from "@/lib/constants/job-labels";
import { BlockedPeriodSchema } from "@/lib/validation/blocked-period";
import { RescheduleJobModal } from "@/components/jobs/reschedule-job-modal";
import type { BlockedPeriod, CallType, Job } from "@/types/database";

// Job soft-delete is online-only (the RPC path, not the outbox). Wrap so an
// offline/transport failure resolves to a { success:false } "connection lost"
// message instead of throwing — the block still saves; the cancel is reported.
const wrappedDeleteJob = wrapDirectCallGracefully(deleteJobAction);

function formatJobDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/**
 * "Block out days" modal — create or edit a personal unavailability period
 * (migration 046). Mobile-first sheet mirroring NewTaskModal.
 *
 * Date-only range: reason (title) + start date + optional end date (blank =
 * single day). Local-first via useLocalFirstAction: applyLocal upserts the
 * Dexie row + enqueues a create/update outbox entry carrying the client id;
 * online the server action upserts to Supabase and state.success flips, so a
 * scoped router.refresh() surfaces the band on the (server-rendered)
 * calendar. Offline the server isn't called — the block is queued and we
 * close optimistically; it appears on the calendar after the next sync.
 */

interface BlockOutParsedInput {
  id: string;
  title: string;
  start_date: string;
  end_date: string; // already normalised (>= start) by the schema
}

function field(fd: FormData, key: string): string {
  return ((fd.get(key) as string | null) ?? "").trim();
}

function parseBlockOutFormData(fd: FormData): BlockOutParsedInput | null {
  const result = BlockedPeriodSchema.safeParse({
    title: field(fd, "title"),
    start_date: field(fd, "start_date"),
    end_date: field(fd, "end_date"),
  });
  if (!result.success) return null;
  // The hidden `id` field carries the create/edit id chosen on open.
  const id = field(fd, "id") || newId();
  return {
    id,
    title: result.data.title,
    start_date: result.data.start_date,
    end_date: result.data.end_date,
  };
}

/** Build the local-first meta. `editing` decides op (create vs update) and,
 *  for a create, seeds the multi-entity guard / discard-revert with the new
 *  id. applyLocal preserves created_at/created_by on edit. */
function makeMeta(editing: BlockedPeriod | null): WrapMeta<BlockOutParsedInput> {
  return {
    actionName: "saveBlockedPeriodAction",
    entityType: "blocked_period",
    entityId: (input) => input.id,
    op: editing ? "update" : "create",
    ...(editing ? {} : { entityIds: (input) => [input.id] }),
    parseInput: parseBlockOutFormData,
    replayArgs: (input, formData) => ({
      ...formDataToObject(formData),
      id: input.id,
      title: input.title,
      start_date: input.start_date,
      end_date: input.end_date,
    }),
    applyLocal: async (input) => {
      const now = new Date().toISOString();
      const row: BlockedPeriod = {
        id: input.id,
        created_at: editing?.created_at ?? now,
        updated_at: now,
        deleted_at: null,
        start_date: input.start_date,
        end_date: input.end_date,
        title: input.title,
        created_by: editing?.created_by ?? null,
      };
      await db.blocked_periods.put(row);
    },
  };
}

interface BlockOutModalProps {
  /** Parent mounts this only while open, so every open is a fresh mount. */
  onClose: () => void;
  /** Present → edit that period; absent → create a new one. */
  editing?: BlockedPeriod | null;
}

export function BlockOutModal({ onClose, editing = null }: BlockOutModalProps) {
  // Stable id for the lifetime of this open: the edit row's id, or a fresh
  // one for a create. Shared by the local write, the outbox replay, and the
  // online server call.
  const [id] = useState(() => editing?.id ?? newId());
  const meta = useMemo(() => makeMeta(editing), [editing]);

  const [state, formAction, isPending] = useLocalFirstAction(
    saveBlockedPeriodAction,
    INITIAL_ACTION_STATE,
    meta
  );
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  // Controlled dates so the resolve-jobs lookup below can react to them.
  const [startDate, setStartDate] = useState(editing?.start_date ?? todayUk());
  const [endDate, setEndDate] = useState(editing?.end_date ?? "");
  // A blank "To" means a single day → the range end is the start.
  const effectiveEnd = endDate || startDate;

  // Jobs the block would cover — read LIVE from the Dexie mirror, so it
  // reflects a mid-flow reschedule/cancel (both write Dexie) without a manual
  // re-trigger, and works offline. undefined = still loading → treat as none.
  const jobsInRange =
    useLiveQuery(
      () => findJobsInRangeLocal(startDate, effectiveEnd),
      [startDate, effectiveEnd]
    ) ?? [];

  // Jobs Nate marked CANCEL (applied after the block saves). KEEP is the
  // default (absence from this set); MOVE routes to the reschedule modal.
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(new Set());
  // When set, the reschedule modal is open for this job (the MOVE handoff).
  const [reschedulingJob, setReschedulingJob] = useState<Job | null>(null);
  // The contract visit whose CANCEL is awaiting confirmation (guards against
  // an accidental cancel of an agreement-scheduled visit).
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(
    null
  );
  // Non-blocking: cancels that couldn't apply (offline). Block still saved.
  const [jobActionError, setJobActionError] = useState<string | null>(null);

  function toggleCancel(jobId: string, cancel: boolean) {
    setCancelledIds((prev) => {
      const next = new Set(prev);
      if (cancel) next.add(jobId);
      else next.delete(jobId);
      return next;
    });
  }

  // Contract visits require a confirmation before being marked for cancel;
  // ordinary jobs mark straight away.
  function requestCancel(job: Job) {
    if (job.agreement_id) setConfirmingCancelId(job.id);
    else toggleCancel(job.id, true);
  }

  // Online success → the block row is on the server; refresh so the calendar
  // re-fetches and shows the band, then close. Held back while a job-action
  // failure is being shown (the block saved, but Nate needs to see the note).
  useEffect(() => {
    if (state.success && !jobActionError) {
      onClose();
      router.refresh();
    }
  }, [state.success, jobActionError, onClose, router]);

  // Escape-to-close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const errors: Record<string, string> = { ...state.errors, ...clientErrors };

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);

    const result = BlockedPeriodSchema.safeParse({
      title: field(fd, "title"),
      start_date: field(fd, "start_date"),
      end_date: field(fd, "end_date"),
    });
    if (!result.success) {
      const next: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !next[key]) next[key] = issue.message;
      }
      setClientErrors(next);
      return;
    }
    setClientErrors({});
    setJobActionError(null);

    // Snapshot connectivity: the LEGACY wrap path only calls the server (and
    // flips state.success) when online. Offline the block is written to Dexie
    // + the outbox, so we close ourselves; online the success effect closes.
    const offline = typeof navigator !== "undefined" && !navigator.onLine;

    // 1. THE BLOCK ALWAYS SAVES FIRST. Optimistic local write + outbox enqueue
    //    resolve before this await returns; it never depends on the job
    //    actions below (decision 4).
    await formAction(fd);

    // 2. Best-effort CANCELs, applied only now (after the block is queued).
    //    Only cancel jobs still in range — one moved out via reschedule is no
    //    longer ours to touch. Failures (offline: job soft-delete is
    //    online-only) are surfaced without blocking; the block already saved.
    const toCancel = [...cancelledIds].filter((jobId) =>
      jobsInRange.some((r) => r.job.id === jobId)
    );
    let failures = 0;
    if (toCancel.length > 0) {
      const res = await applyJobCancellations(toCancel, wrappedDeleteJob);
      failures = res.failures.length;
    }

    if (failures > 0) {
      setJobActionError(
        `Block saved. ${failures} job${failures === 1 ? "" : "s"} couldn't be cancelled — that needs a connection. Try again from the calendar when you're back online.`
      );
      return; // Keep the modal open so the note shows; the block is saved.
    }

    if (offline) {
      onClose();
      router.refresh();
    }
  }

  const inputClass =
    "mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
  const labelClass = "block text-xs font-medium text-gray-600";

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-start sm:py-12">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative flex h-full w-full flex-col bg-white shadow-xl sm:mx-4 sm:h-auto sm:max-h-[90vh] sm:max-w-md sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">
            {editing ? "Edit block-out" : "Block out days"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <input type="hidden" name="id" value={id} />
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div>
              <label htmlFor="block-title" className={labelClass}>
                Reason
              </label>
              <input
                id="block-title"
                name="title"
                type="text"
                autoFocus
                defaultValue={editing?.title ?? ""}
                placeholder="e.g. Fishing at Bewl Water"
                className={inputClass}
              />
              {errors.title && (
                <p className="mt-1 text-xs text-red-600">{errors.title}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="block-start" className={labelClass}>
                  From
                </label>
                <input
                  id="block-start"
                  name="start_date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={inputClass}
                />
                {errors.start_date && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.start_date}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="block-end" className={labelClass}>
                  To <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  id="block-end"
                  name="end_date"
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={inputClass}
                />
                {errors.end_date && (
                  <p className="mt-1 text-xs text-red-600">{errors.end_date}</p>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-400">
              Leave <span className="font-medium">To</span> blank for a single
              day.
            </p>

            {/* Resolve-jobs list — jobs the block would cover. Non-blocking:
                helps Nate action them, never gates the save. Appears only when
                jobs fall in range; reads Dexie LIVE so a mid-flow reschedule/
                cancel updates it. */}
            {jobsInRange.length > 0 && (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-800">
                  {jobsInRange.length} job
                  {jobsInRange.length === 1 ? "" : "s"} scheduled during this
                  period
                </p>
                <p className="text-xs text-amber-700">
                  Choose what to do with each — or leave them and block out
                  anyway.
                </p>
                <ul className="space-y-2">
                  {jobsInRange.map(({ job, customerName }) => {
                    const isCancelled = cancelledIds.has(job.id);
                    const typeLabel = job.call_type
                      ? CALL_TYPE_LABELS[job.call_type as CallType] ??
                        job.call_type
                      : "Job";
                    return (
                      <li
                        key={job.id}
                        className="rounded-md border border-amber-100 bg-white p-2"
                      >
                        <div className="min-w-0">
                          <p
                            className={`truncate text-sm font-medium ${
                              isCancelled
                                ? "text-gray-400 line-through"
                                : "text-gray-900"
                            }`}
                          >
                            {customerName}
                          </p>
                          <p className="flex flex-wrap items-center gap-1 text-xs text-gray-500">
                            <span>{formatJobDate(job.job_date)}</span>
                            <span aria-hidden="true">·</span>
                            <span>{typeLabel}</span>
                            {job.agreement_id && (
                              <span className="inline-flex items-center rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                                Contract visit
                              </span>
                            )}
                          </p>
                        </div>
                        {confirmingCancelId === job.id ? (
                          // Contract-visit cancel confirmation. Marking a
                          // contract visit for cancel is gated here so an
                          // agreement-scheduled visit isn't dropped by mistake.
                          <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 p-2">
                            <p className="text-xs text-rose-800">
                              This is a scheduled contract visit for{" "}
                              <span className="font-medium">{customerName}</span>
                              . Cancel it anyway?
                            </p>
                            <div className="mt-1.5 flex gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  toggleCancel(job.id, true);
                                  setConfirmingCancelId(null);
                                }}
                                className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700"
                              >
                                Cancel visit
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmingCancelId(null)}
                                className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                              >
                                Keep it
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2 flex gap-1">
                            <button
                              type="button"
                              onClick={() => toggleCancel(job.id, false)}
                              aria-pressed={!isCancelled}
                              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                                !isCancelled
                                  ? "bg-brand text-white"
                                  : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                              }`}
                            >
                              Keep
                            </button>
                            <button
                              type="button"
                              onClick={() => setReschedulingJob(job)}
                              className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                            >
                              Move
                            </button>
                            <button
                              type="button"
                              onClick={() => requestCancel(job)}
                              aria-pressed={isCancelled}
                              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                                isCancelled
                                  ? "bg-red-600 text-white"
                                  : "border border-gray-200 bg-white text-rose-700 hover:bg-rose-50"
                              }`}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {jobActionError && (
                  <p className="text-xs font-medium text-red-600">
                    {jobActionError}
                  </p>
                )}
              </div>
            )}

            {state.message && !state.success && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
                {state.message}
              </div>
            )}
          </div>

          <div className="flex shrink-0 justify-end gap-3 border-t px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {isPending
                ? "Saving…"
                : jobsInRange.length > 0
                  ? "Block out anyway"
                  : editing
                    ? "Save changes"
                    : "Block out"}
            </button>
          </div>
        </form>
      </div>

      {/* MOVE handoff — the existing reschedule modal (carries the clash +
          blocked-day advisories). Renders on top; on optimistic success it
          writes Dexie, so the live jobsInRange list re-evaluates and the job
          drops out of range if it was moved clear of the block. */}
      {reschedulingJob && (
        <RescheduleJobModal
          job={reschedulingJob}
          onClose={() => setReschedulingJob(null)}
        />
      )}
    </div>
  );
}

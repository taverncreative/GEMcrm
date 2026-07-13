"use client";

import { useEffect, useState } from "react";
import { rescheduleJobAction } from "@/app/(app)/jobs/[id]/actions";
import { useLocalFirstAction, type WrapMeta } from "@/lib/actions/wrap";
import { db } from "@/lib/db";
import {
  findClashingJobLocal,
  findOverlappingBookingsLocal,
  type BookingClash,
} from "@/lib/db/lookups";
import { TimeWindowPicker, type TimeWindow } from "@/components/ui/time-window-picker";
import { todayUk } from "@/lib/utils/today-uk";
import type { ActionState } from "@/types/actions";
import type { Job } from "@/types/database";

interface RescheduleJobInput {
  job_id: string;
  job_date: string;
  job_time: string;
  job_time_end: string;
}

/**
 * Optimistic reschedule (the booking-modal treatment): applyLocal writes
 * the new date/time to Dexie and ONE outbox entry is enqueued; the modal
 * flips to success immediately and drainOutbox owns the single server
 * replay. Structure mirrors updateJobStatusMeta. Module-level so the
 * reference is stable across renders.
 */
const rescheduleJobMeta: WrapMeta<RescheduleJobInput> = {
  actionName: "rescheduleJobAction",
  entityType: "job",
  entityId: (input) => input.job_id,
  parseInput: (formData) => {
    const jobId = formData.get("job_id");
    const jobDate = formData.get("job_date");
    if (typeof jobId !== "string" || typeof jobDate !== "string" || !jobDate) {
      return null;
    }
    return {
      job_id: jobId,
      job_date: jobDate,
      job_time: (formData.get("job_time") as string) || "",
      job_time_end: (formData.get("job_time_end") as string) || "",
    };
  },
  applyLocal: async (input) => {
    await db.jobs.update(input.job_id, {
      job_date: input.job_date,
      job_time: input.job_time || null,
      job_time_end: input.job_time_end || null,
      updated_at: new Date().toISOString(),
    });
  },
};

const initialState: ActionState = { success: false, errors: {}, message: null };

const rescheduleOpts = {
  // Optimistic: the move is "done" the instant the local write + outbox
  // entry land, online or offline. The server replay happens in the
  // background via drainOutbox — exactly one round-trip, no submit-time
  // server call (mirrors the New Booking modal).
  localSuccessState: () => ({ success: true, errors: {}, message: null }),
};

/** "HH:MM:SS" / "HH:MM" → "HH:MM"; null/blank → "". */
function toHhMm(time: string | null): string {
  if (!time) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
}

/**
 * Reschedule modal — edits ONLY the date + time window of an existing job.
 * Deliberately NOT the full BookingModal: no customer/site/call-type/pest/
 * value creation logic rides along. An agreement-generated visit moves in
 * place and keeps its agreement_id (we never touch it).
 */
export function RescheduleJobModal({
  job,
  onClose,
}: {
  job: Job;
  onClose: () => void;
}) {
  const [jobDate, setJobDate] = useState(job.job_date);
  const [window, setWindow] = useState<TimeWindow>({
    start: toHhMm(job.job_time),
    end: toHhMm(job.job_time_end),
  });
  const [clashWarning, setClashWarning] = useState<BookingClash[] | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const [state, action, isPending] = useLocalFirstAction(
    rescheduleJobAction,
    initialState,
    rescheduleJobMeta,
    rescheduleOpts
  );

  // Close on optimistic success — applyLocal already wrote Dexie, so the
  // job detail's useLiveQuery re-renders the new date on its own. The modal
  // unmounts on close (parent renders it conditionally), so this fires once.
  useEffect(() => {
    if (state.success) onClose();
  }, [state, onClose]);

  // Live overlap advisory (non-blocking). Passes job.id as excludeJobId so
  // the job can never clash with itself when only its time changes — this
  // is the case the excludeJobId parameter was built for. Untimed → no
  // warning (findOverlappingBookingsLocal returns []).
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!window.start) {
        setClashWarning(null);
        return;
      }
      void findOverlappingBookingsLocal(
        {
          job_date: jobDate,
          job_time: window.start,
          job_time_end: window.end || null,
        },
        job.id
      ).then((clashes) => {
        if (cancelled) return;
        setClashWarning(clashes.length > 0 ? clashes : null);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobDate, window.start, window.end, job.id]);

  async function handleSubmit(formData: FormData) {
    if (!jobDate) {
      setClientError("Pick a date");
      return;
    }
    // Hard duplicate guard — same site + date + call type. Agreement
    // visits are excluded from the partial-unique index, so we skip the
    // guard for them (they move freely). Passes job.id so moving to the
    // SAME date doesn't flag the job against itself.
    if (!job.agreement_id && job.site_id && job.call_type) {
      const clash = await findClashingJobLocal(
        job.site_id,
        jobDate,
        job.call_type,
        job.id
      );
      if (clash) {
        setClientError(
          "There's already a job of this type for this site on this date."
        );
        return;
      }
    }
    setClientError(null);
    await action(formData);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => !isPending && onClose()}
        aria-hidden="true"
      />
      <div className="relative m-0 w-full max-w-md rounded-t-2xl bg-white shadow-xl sm:m-4 sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Reschedule</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form action={handleSubmit} className="space-y-5 px-5 py-5">
          <input type="hidden" name="job_id" value={job.id} />
          <input type="hidden" name="job_date" value={jobDate} />
          <input type="hidden" name="job_time" value={window.start} />
          <input type="hidden" name="job_time_end" value={window.end} />

          <div>
            <label htmlFor="reschedule-date" className="block text-sm font-medium text-gray-700">
              Date <span className="text-red-500">*</span>
            </label>
            <input
              id="reschedule-date"
              type="date"
              value={jobDate}
              min={todayUk()}
              onChange={(e) => {
                setJobDate(e.target.value);
                if (clientError) setClientError(null);
              }}
              className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Arrival window
            </label>
            <div className="mt-1.5">
              <TimeWindowPicker
                value={window}
                onChange={setWindow}
                idPrefix="reschedule"
              />
            </div>
          </div>

          {clashWarning && clashWarning.length > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <p className="font-medium">
                Heads up — this time clashes with{" "}
                {clashWarning.length === 1
                  ? "another booking"
                  : `${clashWarning.length} other bookings`}{" "}
                that day:
              </p>
              <ul className="list-disc space-y-0.5 pl-5">
                {clashWarning.map((c) => (
                  <li key={c.id}>
                    {c.customerName}
                    {c.timeLabel ? ` at ${c.timeLabel}` : ""}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-amber-700">
                You can still save — this is just a heads up.
              </p>
            </div>
          )}

          {clientError && (
            <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
              {clientError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save new date"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

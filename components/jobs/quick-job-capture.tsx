"use client";

import { useState } from "react";
import { captureQuickJobAction } from "@/app/(app)/bookings/actions";
import {
  useLocalFirstAction,
  type WrapMeta,
  type LocalFirstOptions,
} from "@/lib/actions/wrap";
import { db } from "@/lib/db";
import { newId } from "@/lib/utils/id";
import { todayUk } from "@/lib/utils/today-uk";
import { TimeWindowPicker } from "@/components/ui/time-window-picker";
import type { ActionState } from "@/types/actions";
import type { Job } from "@/types/database";

/**
 * Quick job capture (Q2) — the "phone booking on the move" path.
 *
 * One phrase + a date + an arrival window → a DRAFT job in seconds, with
 * no customer/site/details. Offline-first, identical machinery to the
 * booking modal: applyLocal writes the draft to Dexie with a client UUID
 * and enqueues ONE outbox entry (op:"create"); the server is never
 * called at submit. Upgrading the draft to a real booking is Q3.
 */

interface QuickCaptureInput {
  jobId: string;
  capture_note: string;
  job_date: string;
  job_time: string;
  job_time_end: string;
  /** Optional caller contact (Track 2). Empty string = unset. */
  draft_contact_name: string;
  draft_contact_phone: string;
}

const s = (fd: FormData, k: string) => ((fd.get(k) as string | null) ?? "").trim();

export const quickCaptureMeta: WrapMeta<QuickCaptureInput> = {
  actionName: "captureQuickJobAction",
  entityType: "job",
  op: "create",
  parseInput: (formData) => {
    const capture_note = s(formData, "capture_note");
    const job_date = s(formData, "job_date");
    // Light offline guard mirroring the server schema — a blank phrase
    // or missing date skips the local write + enqueue (the form's own
    // validation blocks this UI path; this is belt-and-braces for a
    // stray replay).
    if (!capture_note || !job_date) return null;
    return {
      jobId: newId(),
      capture_note,
      job_date,
      job_time: s(formData, "job_time"),
      job_time_end: s(formData, "job_time_end"),
      draft_contact_name: s(formData, "draft_contact_name"),
      draft_contact_phone: s(formData, "draft_contact_phone"),
    };
  },
  applyLocal: async (input) => {
    const now = new Date().toISOString();
    // A full draft Job row — site_id null + job_status 'draft' (the DB
    // CHECK permits null site only for drafts). No reference_number yet
    // (needs a customer; generated at upgrade in Q3).
    await db.jobs.add({
      id: input.jobId,
      site_id: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      job_date: input.job_date,
      job_time: input.job_time || null,
      job_time_end: input.job_time_end || null,
      capture_note: input.capture_note,
      draft_contact_name: input.draft_contact_name || null,
      draft_contact_phone: input.draft_contact_phone || null,
      call_type: null,
      pest_species: [],
      findings: null,
      recommendations: null,
      treatment: null,
      pesticides_used: null,
      risk_level: null,
      risk_comments: null,
      technician_signature_url: null,
      client_signature_url: null,
      job_status: "draft",
      agreement_id: null,
      environmental_risk: null,
      environmental_comments: null,
      protected_species_present: false,
      method_used: [],
      photo_urls: [],
      client_present: false,
      client_name: null,
      report_notes: null,
      value: null,
      is_invoiced: false,
      is_paid: false,
      report_emailed_to: null,
      report_emailed_at: null,
      reference_number: null,
      parent_job_id: null,
      is_archived: false,
    } as Job);
  },
  entityId: (input) => input.jobId,
  // Only the newly-created id — discard-revert deletes exactly this row.
  entityIds: (input) => [input.jobId],
  // Inject the client id so the server replay (and online fast-path)
  // upserts the SAME row applyLocal wrote.
  replayArgs: (input) => ({
    job_id: input.jobId,
    capture_note: input.capture_note,
    job_date: input.job_date,
    job_time: input.job_time,
    job_time_end: input.job_time_end,
    draft_contact_name: input.draft_contact_name,
    draft_contact_phone: input.draft_contact_phone,
  }),
};

const quickCaptureOpts: LocalFirstOptions<ActionState, QuickCaptureInput> = {
  // Optimistic close: the sheet dismisses the instant the local write +
  // enqueue land, regardless of connectivity. No server call at submit.
  localSuccessState: () => ({
    success: true,
    errors: {},
    message: "Draft captured",
  }),
};

const initialState: ActionState = { success: false, errors: {}, message: null };

export function QuickJobCapture({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [phrase, setPhrase] = useState("");
  const [jobDate, setJobDate] = useState(todayUk());
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [phraseError, setPhraseError] = useState<string | null>(null);

  const [, action, isPending] = useLocalFirstAction<
    ActionState,
    QuickCaptureInput
  >(captureQuickJobAction, initialState, quickCaptureMeta, quickCaptureOpts);

  if (!open) return null;

  function reset() {
    setPhrase("");
    setJobDate(todayUk());
    setStart("");
    setEnd("");
    setContactName("");
    setContactPhone("");
    setPhraseError(null);
  }

  function handleSubmit(formData: FormData) {
    if (!phrase.trim()) {
      setPhraseError("Jot down what the job is");
      return;
    }
    setPhraseError(null);
    void action(formData);
    // Optimistic: the local write + enqueue are synchronous-enough that
    // closing immediately is safe; the engine syncs in the background.
    reset();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Quick job">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Quick job</h2>
            <p className="text-xs text-gray-500">
              Jot it down now — add the customer &amp; details later.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form action={handleSubmit} className="space-y-4 px-5 py-4">
          {/* Hidden fields carry the controlled values into FormData for
              the wrapper's parseInput. */}
          <input type="hidden" name="job_time" value={start} />
          <input type="hidden" name="job_time_end" value={end} />

          <div>
            <label htmlFor="qjc-phrase" className="block text-sm font-medium text-gray-700">
              What&apos;s the job?
            </label>
            <input
              id="qjc-phrase"
              name="capture_note"
              type="text"
              autoFocus
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="Sarah, Wasps, Folkestone"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            />
            {phraseError && <p className="mt-1 text-xs text-red-500">{phraseError}</p>}
          </div>

          {/* Optional caller contact (Track 2). The everyday trigger is a
              usually-new customer phoning in — jot their name + number now so
              the draft carries it to upgrade. Both optional; the phrase above
              stays the only required field. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="qjc-contact-name" className="block text-sm font-medium text-gray-700">
                Caller name <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <input
                id="qjc-contact-name"
                name="draft_contact_name"
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="e.g. Sarah Jones"
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              />
            </div>
            <div>
              <label htmlFor="qjc-contact-phone" className="block text-sm font-medium text-gray-700">
                Phone <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <input
                id="qjc-contact-phone"
                name="draft_contact_phone"
                type="tel"
                inputMode="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="e.g. 07700 900000"
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="qjc-date" className="block text-sm font-medium text-gray-700">
              Date
            </label>
            <input
              id="qjc-date"
              name="job_date"
              type="date"
              required
              value={jobDate}
              onChange={(e) => setJobDate(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500 sm:max-w-xs"
            />
          </div>

          <div>
            <span className="block text-sm font-medium text-gray-700">Arrival window</span>
            <div className="mt-1">
              <TimeWindowPicker
                idPrefix="qjc-window"
                value={{ start, end }}
                onChange={({ start: ns, end: ne }) => {
                  setStart(ns);
                  setEnd(ne);
                }}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save draft"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

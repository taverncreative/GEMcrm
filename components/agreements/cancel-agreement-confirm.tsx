"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { updateAgreementStatusAction } from "@/app/(app)/agreements/[id]/actions";
import {
  updateAgreementStatusMeta,
  statusInitialState,
} from "@/components/agreements/agreement-status-actions";
import { agreementCancelImpact } from "@/lib/agreements/cancel-impact";
import { useLocalFirstAction } from "@/lib/actions/wrap";
import { db } from "@/lib/db";

interface CancelAgreementConfirmProps {
  agreementId: string;
  open: boolean;
  onClose: () => void;
  /** The cut-off, captured by the PARENT in the click handler that opened
   *  this dialog — i.e. at the moment the operator reached for Cancel. See
   *  the note below on why it is frozen. */
  cutoff: string;
}

/**
 * Confirm dialog for cancelling an agreement.
 *
 * Cancelling now REMOVES the contract's future scheduled visits, which is
 * not something the button can convey on its own, so the blast radius is
 * spelled out before the operator commits: how many go, how many of those
 * are booked for today, what stays, and what is never touched. One decision
 * about one contract, so it mirrors the site-delete dialog rather than the
 * block-out flow's per-row triage.
 *
 * THE CUT-OFF DATE is captured once, when the dialog opens, and frozen for
 * the life of the dialog. The same value feeds the impact preview, the
 * local Dexie mirror and the outbox entry, so all three agree on where
 * "future" starts. Offline that matters: a replay three days later removes
 * the set the operator saw, not a set recomputed at replay time.
 *
 * Cancelling stays offline-capable (the shared local-first meta writes
 * Dexie first and always enqueues), which is why the dialog acknowledges an
 * offline cancel in place rather than waiting on a server round trip.
 */
export function CancelAgreementConfirm({
  agreementId,
  open,
  onClose,
  cutoff,
}: CancelAgreementConfirmProps) {
  const router = useRouter();
  const [state, action, isPending] = useLocalFirstAction(
    updateAgreementStatusAction,
    statusInitialState,
    updateAgreementStatusMeta
  );
  const [queuedOffline, setQueuedOffline] = useState(false);

  // Counted from Dexie, not the server: cancelling works offline, and this
  // is the same local store the calendar renders from, so the dialog's
  // numbers and the visits on screen cannot disagree. `undefined` while the
  // query is in flight, which keeps the confirm button disabled.
  const jobs = useLiveQuery(
    async () => {
      if (!open) return undefined;
      return db.jobs.where("agreement_id").equals(agreementId).toArray();
    },
    [open, agreementId]
  );

  const impact = useMemo(
    () => (jobs && cutoff ? agreementCancelImpact(jobs, cutoff) : null),
    [jobs, cutoff]
  );

  // Online success: the row is cancelled and the visits are gone server-side.
  // Refresh so the server-rendered agreement page, visit list and calendar
  // re-render without them.
  useEffect(() => {
    if (!state.success) return;
    onClose();
    router.refresh();
  }, [state.success, onClose, router]);

  // Escape closes. Resets live in handleClose (an event handler) for the
  // open path; here the same resets are inlined so the effect can keep a
  // stable dep array rather than re-registering on every render.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setQueuedOffline(false);
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function handleClose() {
    setQueuedOffline(false);
    onClose();
  }

  async function handleConfirm() {
    const fd = new FormData();
    fd.set("agreement_id", agreementId);
    fd.set("status", "cancelled");
    fd.set("cutoff_date", cutoff);
    const offline = typeof navigator !== "undefined" && !navigator.onLine;
    await action(fd);
    if (offline) {
      // Local write + outbox entry are done; there is no server result to
      // flip state.success, so acknowledge in place instead of leaving the
      // button looking inert. The visits are already gone from this device.
      setQueuedOffline(true);
      router.refresh();
    }
  }

  const removed = impact?.removed ?? 0;
  const today = impact?.today ?? 0;

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
                d="M12 9v3.75m0 3.75h.007v.008H12v-.008Zm0-12.75c5.385 0 9.75 4.365 9.75 9.75s-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12 6.615 2.25 12 2.25Z"
              />
            </svg>
          </div>
          <h2 className="text-center text-lg font-semibold text-gray-900">
            Cancel this agreement?
          </h2>

          {queuedOffline ? (
            <p className="mt-3 text-center text-sm text-brand-darker">
              Cancelled on this device, will sync when you are back online.
            </p>
          ) : (
            <>
              {removed > 0 && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <span className="font-semibold">
                    {removed} future {removed === 1 ? "visit" : "visits"}
                  </span>{" "}
                  will be removed from the calendar
                  {today > 0 && <>, including {today} booked for today</>}.
                </div>
              )}

              {impact && (impact.past > 0 || impact.completed > 0 || impact.inProgress > 0) && (
                <div className="mt-3 space-y-1 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                  {impact.past > 0 && (
                    <p>
                      {impact.past} past{" "}
                      {impact.past === 1 ? "visit stays" : "visits stay"}, for
                      you to write up or delete.
                    </p>
                  )}
                  {impact.completed > 0 && (
                    <p>
                      {impact.completed} completed{" "}
                      {impact.completed === 1 ? "visit is" : "visits are"}{" "}
                      untouched.
                    </p>
                  )}
                  {impact.inProgress > 0 && (
                    <p>
                      {impact.inProgress}{" "}
                      {impact.inProgress === 1 ? "visit" : "visits"} in progress{" "}
                      {impact.inProgress === 1 ? "is" : "are"} untouched.
                    </p>
                  )}
                </div>
              )}

              {removed > 0 && (
                <p className="mt-3 text-center text-xs text-gray-500">
                  This cannot be undone. Removed visits do not come back if the
                  agreement is reactivated.
                </p>
              )}
            </>
          )}

          {state.message && !state.success && (
            <p className="mt-3 text-sm text-red-600">{state.message}</p>
          )}
        </div>

        <div className="mt-6 flex gap-2 border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={isPending}
            className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {queuedOffline ? "Close" : "Keep it"}
          </button>
          {!queuedOffline && (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isPending || impact === null}
              className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Cancelling…" : "Cancel agreement"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

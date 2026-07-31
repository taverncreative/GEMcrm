"use client";

import { useCallback, useState } from "react";
import { updateAgreementStatusAction } from "@/app/(app)/agreements/[id]/actions";
import { CancelAgreementConfirm } from "@/components/agreements/cancel-agreement-confirm";
import { useLocalFirstAction, type WrapMeta } from "@/lib/actions/wrap";
import { db } from "@/lib/db";
import { todayUk } from "@/lib/utils/today-uk";
import type { ActionState } from "@/types/actions";
import type { AgreementStatus } from "@/types/database";

// Module-level meta so the hook's useCallback deps stay stable across
// renders. The form has three fields — agreement_id, status, and (on a
// cancel) cutoff_date — and we validate the status against the same union
// the server action checks.
const VALID_STATUSES: readonly AgreementStatus[] = [
  "active",
  "paused",
  "cancelled",
];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface UpdateAgreementStatusInput {
  agreement_id: string;
  status: AgreementStatus;
  /** Cut-off for the cancel visit-removal, captured on THIS device at the
   *  moment the operator pressed Cancel. Empty for activate/pause. */
  cutoff_date: string;
}

// Exported so the cancel confirm dialog drives the SAME local-first action
// (same Dexie mirror, same outbox entry shape) as the plain status buttons,
// the way CalendarTaskChip reuses completeTaskMeta.
export const updateAgreementStatusMeta: WrapMeta<UpdateAgreementStatusInput> = {
  actionName: "updateAgreementStatusAction",
  entityType: "agreement",
  entityId: (input) => input.agreement_id,
  parseInput: (formData) => {
    const agreementId = formData.get("agreement_id");
    const status = formData.get("status");
    if (typeof agreementId !== "string" || typeof status !== "string") {
      return null;
    }
    if (!VALID_STATUSES.includes(status as AgreementStatus)) return null;
    const cutoff = formData.get("cutoff_date");
    return {
      agreement_id: agreementId,
      status: status as AgreementStatus,
      cutoff_date: typeof cutoff === "string" ? cutoff : "",
    };
  },
  applyLocal: async (input) => {
    const now = new Date().toISOString();
    await db.agreements.update(input.agreement_id, {
      status: input.status,
      updated_at: now,
    });

    // CANCEL also clears the contract's future scheduled visits locally, so
    // the operator's own calendar and job list drop them immediately rather
    // than waiting for the pull that carries the server's tombstones. The
    // predicate mirrors cancel_agreement_visits (migration 051) exactly:
    // live + scheduled + on-or-after the cut-off. Completed and in-progress
    // visits are untouched here for the same reason they are untouched
    // there.
    //
    // The cut-off comes from the input (and rides the outbox entry), NOT
    // from `new Date()` — offline, this local write and the eventual server
    // replay must agree on where "future" started.
    //
    // Nothing here for `paused`: pause leaves visits alone.
    if (input.status !== "cancelled" || !ISO_DATE.test(input.cutoff_date)) {
      return;
    }
    await db.jobs
      .where("agreement_id")
      .equals(input.agreement_id)
      .modify((job) => {
        if (
          !job.deleted_at &&
          job.job_status === "scheduled" &&
          job.job_date >= input.cutoff_date
        ) {
          job.deleted_at = now;
        }
      });
  },
};

export const statusInitialState: ActionState = {
  success: false,
  errors: {},
  message: null,
};

const initialState = statusInitialState;

function StatusButton({
  agreementId,
  targetStatus,
  label,
  className,
}: {
  agreementId: string;
  targetStatus: AgreementStatus;
  label: string;
  className: string;
}) {
  // Wrapped: local-first Dexie update + outbox enqueue + offline-tolerant.
  const [state, action, isPending] = useLocalFirstAction(
    updateAgreementStatusAction,
    initialState,
    updateAgreementStatusMeta
  );

  return (
    <form action={action} className="inline">
      <input type="hidden" name="agreement_id" value={agreementId} />
      <input type="hidden" name="status" value={targetStatus} />
      <button
        type="submit"
        disabled={isPending}
        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${className}`}
      >
        {isPending ? "…" : label}
      </button>
      {state.message && (
        <p className="mt-1 text-xs text-red-500">{state.message}</p>
      )}
    </form>
  );
}

export function AgreementStatusActions({
  agreementId,
  currentStatus,
}: {
  agreementId: string;
  currentStatus: AgreementStatus;
}) {
  const [cancelOpen, setCancelOpen] = useState(false);
  // The cut-off is captured HERE, in the click handler, so it is the date on
  // the operator's device at the moment they reached for Cancel. It then
  // feeds the dialog's preview, the Dexie mirror and the outbox entry
  // identically — see cancel_agreement_visits (migration 051).
  const [cancelCutoff, setCancelCutoff] = useState("");
  const handleCancelClose = useCallback(() => setCancelOpen(false), []);

  return (
    <div className="flex flex-wrap gap-2">
      {currentStatus !== "active" && (
        <StatusButton
          agreementId={agreementId}
          targetStatus="active"
          label="Activate"
          className="bg-brand text-white hover:bg-brand-dark"
        />
      )}
      {currentStatus !== "paused" && currentStatus !== "cancelled" && (
        <StatusButton
          agreementId={agreementId}
          targetStatus="paused"
          label="Pause"
          className="bg-amber-100 text-amber-800 hover:bg-amber-200"
        />
      )}
      {/* Cancel goes through a confirm, unlike Activate/Pause: it is the one
          status change that DESTROYS something (the contract's future
          scheduled visits) and cannot be undone, so the counts are stated
          before it happens. Pause deliberately keeps its plain button —
          pausing leaves every visit exactly where it is. */}
      {currentStatus !== "cancelled" && (
        <>
          <button
            type="button"
            onClick={() => {
              setCancelCutoff(todayUk());
              setCancelOpen(true);
            }}
            className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-200"
          >
            Cancel
          </button>
          <CancelAgreementConfirm
            agreementId={agreementId}
            open={cancelOpen}
            onClose={handleCancelClose}
            cutoff={cancelCutoff}
          />
        </>
      )}
    </div>
  );
}

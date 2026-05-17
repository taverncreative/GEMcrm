"use client";

import { useActionState } from "react";
import { updateAgreementStatusAction } from "@/app/(app)/agreements/[id]/actions";
import type { ActionState } from "@/types/actions";
import type { AgreementStatus } from "@/types/database";

const initialState: ActionState = {
  success: false,
  errors: {},
  message: null,
};

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
  const [state, action, isPending] = useActionState(
    updateAgreementStatusAction,
    initialState
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
      {currentStatus !== "cancelled" && (
        <StatusButton
          agreementId={agreementId}
          targetStatus="cancelled"
          label="Cancel"
          className="bg-red-100 text-red-700 hover:bg-red-200"
        />
      )}
    </div>
  );
}

"use client";

import { updateAgreementStatusAction } from "@/app/(app)/agreements/[id]/actions";
import { useLocalFirstAction, type WrapMeta } from "@/lib/actions/wrap";
import { db } from "@/lib/db";
import type { ActionState } from "@/types/actions";
import type { AgreementStatus } from "@/types/database";

// Module-level meta so the hook's useCallback deps stay stable across
// renders. The form has two fields — agreement_id and status — and we
// validate the status against the same union the server action checks.
const VALID_STATUSES: readonly AgreementStatus[] = [
  "active",
  "paused",
  "cancelled",
];
interface UpdateAgreementStatusInput {
  agreement_id: string;
  status: AgreementStatus;
}
const updateAgreementStatusMeta: WrapMeta<UpdateAgreementStatusInput> = {
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
    return {
      agreement_id: agreementId,
      status: status as AgreementStatus,
    };
  },
  applyLocal: async (input) => {
    await db.agreements.update(input.agreement_id, {
      status: input.status,
      updated_at: new Date().toISOString(),
    });
  },
};

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

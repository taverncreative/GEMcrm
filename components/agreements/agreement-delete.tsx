"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteAgreementAction,
  getAgreementDeleteImpactAction,
} from "@/app/(app)/agreements/[id]/actions";
import { wrapDirectCallGracefully } from "@/lib/actions/graceful";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { ROUTES } from "@/lib/constants/routes";
import { db } from "@/lib/db";

// Safety net shared with the other deletes: a transport failure resolves to
// a `{success:false}` shape instead of throwing out of the transition.
const wrappedDeleteAgreement = wrapDirectCallGracefully(deleteAgreementAction);

/**
 * Delete a CANCELLED agreement.
 *
 * A cancelled agreement is a dead contract — nothing is protected by
 * keeping the row, and until now there was no way to clear one out (delete
 * was draft-only). Active and paused agreements are live contracts and are
 * deliberately not deletable from anywhere; the server action enforces that
 * too, so this component simply is not rendered for them.
 *
 * Soft delete, so the copy stays "Delete agreement" / "Removes".
 * Online-only, like the rest of the agreement flow.
 *
 * The agreement's generated visits are NOT removed — cancelling an
 * agreement never removed them either, so they may still be sitting on the
 * calendar. The dialog names the count rather than leaving it as a surprise.
 */
export function AgreementDelete({ agreementId }: { agreementId: string }) {
  const router = useRouter();
  const online = useIsOnline();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [remainingVisits, setRemainingVisits] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Only worth the round trip once the operator has actually reached for
  // the delete.
  useEffect(() => {
    if (!confirming) return;
    let active = true;
    void getAgreementDeleteImpactAction(agreementId).then((res) => {
      if (active) setRemainingVisits(res.remainingVisits);
    });
    return () => {
      active = false;
    };
  }, [confirming, agreementId]);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const res = await wrappedDeleteAgreement(agreementId);
      if (!res.success) {
        setError(res.message ?? "Failed to delete agreement");
        setConfirming(false);
        return;
      }
      // Mirror into Dexie so the customer panel's agreements list drops it
      // without waiting for the next sync pull.
      try {
        await db.agreements.update(agreementId, {
          deleted_at: new Date().toISOString(),
        });
      } catch {
        // Non-fatal — the next sync pull reconciles it.
      }
      router.push(ROUTES.AGREEMENTS);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">
        This agreement is cancelled. Deleting it removes it from the
        agreements list and the customer record. The signed contract PDF
        stays in Documents.
      </p>

      {confirming ? (
        <div className="space-y-2">
          {remainingVisits !== null && remainingVisits > 0 && (
            <p className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800">
              {remainingVisits === 1
                ? "1 visit from this agreement is still on the calendar"
                : `${remainingVisits} visits from this agreement are still on the calendar`}
              . Deleting the agreement leaves{" "}
              {remainingVisits === 1 ? "it" : "them"} there. Cancel or delete{" "}
              {remainingVisits === 1 ? "it" : "them"} from the calendar
              separately.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-600">
              Delete this cancelled agreement?
            </span>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isPending || !online}
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              {isPending ? "Deleting…" : "Yes, delete"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={isPending}
              className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
            >
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={!online}
          title={!online ? "Needs internet" : undefined}
          className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300"
        >
          Delete agreement
        </button>
      )}

      {!online && <p className="text-xs text-gray-400">Needs internet.</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

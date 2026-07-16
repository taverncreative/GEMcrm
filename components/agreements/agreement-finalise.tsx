"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SignaturePad } from "@/components/ui/signature-pad";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { todayUk } from "@/lib/utils/today-uk";
import { ROUTES } from "@/lib/constants/routes";
import {
  finaliseDraftAgreementAction,
  discardDraftAgreementAction,
} from "@/app/(app)/agreements/[id]/actions";

/**
 * Finalise / discard panel for a DRAFT agreement (Slice 2).
 *
 * Finalise opens the signature step the draft skipped: both signature pads
 * (reused from the wizard), the signee name, and the signed date. On
 * confirm the server flips the draft active, generates the scheduled
 * visits, regenerates the signed PDF over the review copy, and auto-sends
 * it to the customer. Discard soft-deletes the draft after an explicit
 * confirm. Both are online-only, like the rest of the agreement flow.
 */
export function AgreementFinalise({
  agreementId,
  defaultSignatoryName,
}: {
  agreementId: string;
  defaultSignatoryName: string | null;
}) {
  const router = useRouter();
  const online = useIsOnline();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [gemSig, setGemSig] = useState("");
  const [clientSig, setClientSig] = useState("");
  const [signatoryName, setSignatoryName] = useState(
    defaultSignatoryName ?? ""
  );
  const [signedDate, setSignedDate] = useState(todayUk());
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  function finalise() {
    setError(null);
    // Mirror the server's requirements so offline-ish mistakes surface
    // inline instead of as a round-trip failure.
    if (!gemSig) return setError("GEM Services signature is required.");
    if (!clientSig) return setError("Client signature is required.");
    if (!signatoryName.trim()) return setError("Signee name is required.");
    startTransition(async () => {
      try {
        const res = await finaliseDraftAgreementAction(agreementId, {
          client_signature: clientSig,
          gem_signature: gemSig,
          client_signatory_name: signatoryName,
          signed_date: signedDate,
        });
        if (res.success) {
          // The page re-renders as an active agreement (badge, status
          // actions, signed PDF, visits list).
          router.refresh();
        } else {
          setError(res.message ?? "Failed to finalise");
        }
      } catch {
        setError("Couldn't reach the server. Try again online.");
      }
    });
  }

  function discard() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await discardDraftAgreementAction(agreementId);
        if (res.success) {
          router.push(ROUTES.AGREEMENTS);
          router.refresh();
        } else {
          setError(res.message ?? "Failed to discard");
          setConfirmDiscard(false);
        }
      } catch {
        setError("Couldn't reach the server. Try again online.");
        setConfirmDiscard(false);
      }
    });
  }

  const inputClass =
    "mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";

  if (!open) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-gray-500">
          When the customer is ready, capture both signatures to make this
          agreement live. Scheduled visits and the signed contract PDF are
          created at that point.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={!online}
            title={!online ? "Needs internet" : undefined}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            Finalise agreement
          </button>
          {confirmDiscard ? (
            <span className="inline-flex items-center gap-2 text-sm">
              <span className="text-gray-600">Discard this draft?</span>
              <button
                type="button"
                onClick={discard}
                disabled={isPending || !online}
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                {isPending ? "Discarding…" : "Yes, discard"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDiscard(false)}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Keep it
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDiscard(true)}
              disabled={!online}
              title={!online ? "Needs internet" : undefined}
              className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Discard draft
            </button>
          )}
        </div>
        {!online && <p className="text-xs text-gray-400">Needs internet.</p>}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SignaturePad
        label="Signed By GEM Services *"
        onSignature={setGemSig}
        onClear={() => setGemSig("")}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="finalise-signed-date"
            className="block text-sm font-medium text-gray-700"
          >
            Date
          </label>
          <input
            id="finalise-signed-date"
            type="date"
            value={signedDate}
            onChange={(e) => setSignedDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor="finalise-signatory-name"
            className="block text-sm font-medium text-gray-700"
          >
            Name Of Signee <span className="text-red-500">*</span>
          </label>
          <input
            id="finalise-signatory-name"
            type="text"
            value={signatoryName}
            onChange={(e) => setSignatoryName(e.target.value)}
            placeholder="Full name of person signing"
            className={inputClass}
          />
        </div>
      </div>
      <SignaturePad
        label="Signed By Client *"
        onSignature={setClientSig}
        onClear={() => setClientSig("")}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={finalise}
          disabled={isPending || !online}
          title={!online ? "Needs internet" : undefined}
          className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Finalising…" : "Confirm and make active"}
        </button>
      </div>
      {!online && <p className="text-xs text-gray-400">Needs internet.</p>}
    </div>
  );
}

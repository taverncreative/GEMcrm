"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SignaturePad } from "@/components/ui/signature-pad";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { todayUk } from "@/lib/utils/today-uk";
import { ROUTES } from "@/lib/constants/routes";
import {
  loadFinaliseDraft,
  saveFinaliseDraft,
  clearFinaliseDraft,
  type AgreementFinaliseDraft,
} from "@/lib/db/agreement-finalise-drafts";
import {
  finaliseDraftAgreementAction,
  deleteAgreementAction,
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
interface AgreementFinaliseProps {
  agreementId: string;
  defaultSignatoryName: string | null;
}

/**
 * Outer wrapper: gates render on the finalise-draft read so the body's
 * useState initial values get the draft if there is one.
 *
 * A one-shot load rather than useLiveQuery, matching the agreement
 * wizard: this panel writes its own draft on a debounce, and a reactive
 * query would re-render the tree on every save for no benefit — the body
 * owns the state from mount onwards.
 */
export function AgreementFinalise(props: AgreementFinaliseProps) {
  const [draft, setDraft] = useState<
    AgreementFinaliseDraft | null | undefined
  >(undefined);

  useEffect(() => {
    let alive = true;
    void loadFinaliseDraft(props.agreementId).then((d) => {
      if (alive) setDraft(d ?? null);
    });
    return () => {
      alive = false;
    };
  }, [props.agreementId]);

  // `undefined` = the IDB read is still in flight. It resolves in
  // milliseconds; hold a similar footprint so the card doesn't jump.
  if (draft === undefined) {
    return (
      <div className="animate-pulse space-y-2">
        <div className="h-8 w-full max-w-md rounded bg-gray-100" />
        <div className="h-9 w-44 rounded-lg bg-gray-100" />
      </div>
    );
  }

  return <AgreementFinaliseBody {...props} draft={draft} />;
}

function AgreementFinaliseBody({
  agreementId,
  defaultSignatoryName,
  draft,
}: AgreementFinaliseProps & {
  /** null if no draft exists, the stored draft otherwise. */
  draft: AgreementFinaliseDraft | null;
}) {
  const router = useRouter();
  const online = useIsOnline();
  const [isPending, startTransition] = useTransition();
  // Re-open the panel automatically when a draft came back. Otherwise a
  // reload would show the collapsed "Finalise agreement" button with no
  // sign that the signatures survived, and the operator would open it,
  // find the pads filled, and have no idea why — or worse, assume the
  // signatures were lost and ask the customer to sign again, which is
  // the exact outcome this whole change exists to prevent.
  const [open, setOpen] = useState(draft !== null);
  const [gemSig, setGemSig] = useState(draft?.gem_signature ?? "");
  const [clientSig, setClientSig] = useState(draft?.client_signature ?? "");
  const [signatoryName, setSignatoryName] = useState(
    draft?.signatory_name ?? defaultSignatoryName ?? ""
  );
  const [signedDate, setSignedDate] = useState(draft?.signed_date ?? todayUk());
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // The data URLs the pads are MOUNTED with, held constant for the life
  // of the mount. Passing the live gemSig / clientSig back in would make
  // a pad repaint its own output on every resize, over strokes still
  // being drawn.
  //
  // useState, not useRef: this is read during render (it is a prop), and
  // a never-updated state initialiser is the idiomatic way to freeze a
  // mount-time value the render output depends on.
  const [initialSigs] = useState({
    gem: draft?.gem_signature ?? "",
    client: draft?.client_signature ?? "",
  });

  // ── Draft auto-save ──
  //
  // Mirror the panel's state to IndexedDB ~500ms after the last change.
  // Nothing is written until there is something worth keeping, so merely
  // opening the panel on an agreement never leaves a ghost row.
  const draftSavedOnceRef = useRef(draft !== null);
  useEffect(() => {
    if (!draftSavedOnceRef.current) {
      const hasContent =
        gemSig !== "" || clientSig !== "" || signatoryName.trim() !== "";
      if (!hasContent) return;
      draftSavedOnceRef.current = true;
    }
    const t = setTimeout(() => {
      void saveFinaliseDraft({
        agreement_id: agreementId,
        gem_signature: gemSig,
        client_signature: clientSig,
        signatory_name: signatoryName,
        signed_date: signedDate,
      });
    }, 500);
    return () => clearTimeout(t);
  }, [agreementId, gemSig, clientSig, signatoryName, signedDate]);

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
          // Signed and live — the draft has done its job. Best-effort:
          // a clear that fails must never turn a successful finalise
          // into an error on screen; the stale row is harmless because
          // the panel is gone once the agreement is active.
          await clearFinaliseDraft(agreementId);
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
        // Draft is one of the two deletable statuses (the other is
        // cancelled, handled by AgreementDelete on the detail page).
        const res = await deleteAgreementAction(agreementId);
        if (res.success) {
          // The agreement is gone, so there is nothing left to sign —
          // drop any captured signatures with it rather than leaving
          // them orphaned in IndexedDB.
          await clearFinaliseDraft(agreementId);
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
        initialDataUrl={initialSigs.gem}
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
        initialDataUrl={initialSigs.client}
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

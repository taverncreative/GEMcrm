"use client";

import { useTransition } from "react";
import { setJobNeedsInvoiceLocal } from "@/lib/actions/needs-invoice";

/**
 * Job-detail toggle for the "Invoices required" checklist flag — the
 * recovery path if the operator forgot the sheet's "Invoice required"
 * checkbox (or wants to change their mind). Local-first: the wrapped
 * action writes Dexie optimistically, so the button reflects the new
 * state instantly (via the parent's useLiveQuery) and works offline.
 *
 * `needsInvoice` comes from the live Dexie row, so no local state is
 * needed — the parent re-renders on the applyLocal write.
 */
export function NeedsInvoiceToggle({
  jobId,
  needsInvoice,
}: {
  jobId: string;
  needsInvoice: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      await setJobNeedsInvoiceLocal(jobId, !needsInvoice);
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      aria-pressed={needsInvoice}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
        needsInvoice
          ? "border-brand bg-brand-soft text-brand-darker hover:bg-brand hover:text-white"
          : "border-gray-200 text-gray-700 hover:bg-gray-50"
      }`}
    >
      {needsInvoice ? (
        <>
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
          Marked for invoicing
        </>
      ) : (
        "Mark for invoicing"
      )}
    </button>
  );
}

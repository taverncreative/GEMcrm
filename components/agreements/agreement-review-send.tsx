"use client";

import { useState, useTransition } from "react";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { parseAndValidateRecipients } from "@/lib/validation/recipients";
import { sendAgreementReviewAction } from "@/app/(app)/agreements/[id]/actions";

/**
 * Send the UNSIGNED review copy of a DRAFT agreement to one or more
 * recipients so the customer can read it before signing. Mirrors
 * AgreementSend, but calls sendAgreementReviewAction (which renders the
 * watermarked review PDF on demand). Online-only; re-runnable.
 */
export function AgreementReviewSend({
  agreementId,
  defaultEmail,
}: {
  agreementId: string;
  defaultEmail: string | null;
}) {
  const online = useIsOnline();
  const [isPending, startTransition] = useTransition();
  const [recipients, setRecipients] = useState(defaultEmail ?? "");
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  function send() {
    setError(null);
    const parsed = parseAndValidateRecipients(recipients);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    startTransition(async () => {
      try {
        const res = await sendAgreementReviewAction(agreementId, parsed.emails);
        if (res.success) {
          setSentTo(res.emailedTo ?? parsed.emails.join(", "));
        } else {
          setError(res.message ?? "Failed to send");
        }
      } catch {
        setError("Couldn't reach the server. Try again online.");
      }
    });
  }

  return (
    <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
      <p className="text-xs text-gray-500">
        Send the customer an unsigned copy to read before signing. It is
        watermarked and shows no signatures. You sign together on the visit.
      </p>
      {sentTo && (
        <p className="text-xs text-emerald-700">
          Review copy sent to <span className="font-medium">{sentTo}</span>. You
          can send again below.
        </p>
      )}
      <label
        htmlFor="agreement-review-recipients"
        className="block text-xs font-medium text-gray-600"
      >
        Email review copy to
      </label>
      <input
        id="agreement-review-recipients"
        type="text"
        value={recipients}
        onChange={(e) => {
          setRecipients(e.target.value);
          if (error) setError(null);
        }}
        placeholder="name@example.com, second@example.com"
        className="block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-gray-400">
          Separate multiple emails with commas. They all go on one email.
        </p>
        <button
          type="button"
          onClick={send}
          disabled={isPending || !online}
          title={!online ? "Needs internet" : undefined}
          className="shrink-0 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Sending…" : sentTo ? "Send again" : "Send for review"}
        </button>
      </div>
      {!online && <p className="text-xs text-gray-400">Needs internet.</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

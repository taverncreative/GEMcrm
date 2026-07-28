"use client";

import { useState } from "react";
import { emailDocumentAction } from "@/app/(app)/reports/actions";
import { getCustomerDetailAction } from "@/app/(app)/customers/actions";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { parseAndValidateRecipients } from "@/lib/validation/recipients";
import type { DocumentKind } from "@/lib/data/documents";

interface EmailDocumentButtonProps {
  kind: DocumentKind;
  /** The underlying row id (unprefixed) the send action addresses. */
  docId: string;
  /** Human name of the document, shown in the dialogs. */
  title: string;
  /** Address to prefill with no round-trip. Preferred over customerId when
   *  set — a quote carries its own bill-to address, which may deliberately
   *  differ from the customer record's. */
  prefillEmail?: string | null;
  /** Fallback prefill: fetch this customer's email when prefillEmail is empty.
   *  Null for a prospect quote, which has no linked customer row. */
  customerId?: string | null;
  /** "row" is the compact chip in the Documents table; "primary" is the
   *  page-level action button on a document's own detail page. */
  variant?: "row" | "primary";
  /** Fired after a successful send — the quote detail page refreshes so the
   *  Draft badge becomes Sent without a manual reload. */
  onSent?: () => void;
}

/**
 * Email one stored document to whoever needs it — Nate's own suggestion, and
 * the answer to "the customer got it, nobody else did".
 *
 * The compose step is a dialog rather than an inline panel because the
 * Documents table's actions live in a narrow right-aligned cell, and the
 * success state is a full dialog too — the same standard as the print-basket
 * confirmation, so a send can't be mistaken for nothing having happened.
 * Online-only, like the sibling row actions.
 *
 * Shared by the Documents list and the quote detail page so both entry points
 * offer the identical composer, the identical confirmation, and the identical
 * send path (emailDocumentAction). There is deliberately no second send
 * pipeline: attachment loading, lazy quote-PDF generation, recipient
 * validation and the operator BCC all live behind that one action.
 */
export function EmailDocumentButton({
  kind,
  docId,
  title,
  prefillEmail,
  customerId,
  variant = "row",
  onSent,
}: EmailDocumentButtonProps) {
  const online = useIsOnline();
  const [open, setOpen] = useState(false);
  const [recipients, setRecipients] = useState("");
  const [prefilled, setPrefilled] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ to: string; label: string } | null>(null);

  function openComposer() {
    setError(null);
    setOpen(true);
    if (prefilled) return;
    // A known address wins outright — no round-trip, and it respects a quote
    // addressed somewhere other than the customer record.
    const known = prefillEmail?.trim();
    if (known) {
      setPrefilled(true);
      setRecipients((current) => (current ? current : known));
      return;
    }
    // Otherwise fall back to the linked customer, which needs a fetch (rows
    // carry {id, name} only). A failure just leaves the box empty.
    if (customerId) {
      setPrefilled(true);
      void getCustomerDetailAction(customerId).then((detail) => {
        const email = detail?.customer?.email;
        if (email) setRecipients((current) => (current ? current : email));
      });
    }
  }

  async function send() {
    setError(null);
    const parsed = parseAndValidateRecipients(recipients);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setSending(true);
    const res = await emailDocumentAction(kind, docId, parsed.emails);
    setSending(false);
    if (res.success) {
      setOpen(false);
      setRecipients("");
      setPrefilled(false);
      setSent({
        to: res.emailedTo ?? parsed.emails.join(", "),
        label: res.label ?? title,
      });
      onSent?.();
    } else {
      setError(res.message ?? "Failed to send.");
    }
  }

  const buttonClass =
    variant === "primary"
      ? "inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      : "inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50";

  return (
    <>
      <button
        type="button"
        onClick={openComposer}
        disabled={!online}
        title={online ? "Email this document" : "Online required"}
        className={buttonClass}
      >
        <svg
          className={variant === "primary" ? "h-4 w-4" : "h-3.5 w-3.5"}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"
          />
        </svg>
        Email
      </button>

      {/* Compose */}
      {open && (
        <div
          className="fixed inset-0 z-[70]"
          role="dialog"
          aria-modal="true"
          aria-label={`Email ${title}`}
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-6 pb-[max(env(safe-area-inset-bottom),1.5rem)] text-left shadow-xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-[28rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
            <h2 className="text-base font-semibold text-gray-900">
              Email this document
            </h2>
            <p className="mt-1 text-sm text-gray-500">{title}</p>
            <label
              htmlFor={`doc-to-${kind}-${docId}`}
              className="mt-4 mb-1 block text-xs font-medium text-gray-600"
            >
              Send to
            </label>
            <input
              id={`doc-to-${kind}-${docId}`}
              type="text"
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder="name@example.com, second@example.com"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
            <p className="mt-1 text-xs text-gray-400">
              Separate multiple emails with commas. They all go on one email,
              with the document attached.
            </p>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={send}
                disabled={sending || !online}
                className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success — the print-basket standard: a panel that stays put until
          it's dismissed, not a note that can be scrolled past. */}
      {sent && (
        <div
          className="fixed inset-0 z-[70]"
          role="dialog"
          aria-modal="true"
          aria-label="Document sent"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setSent(null)}
            aria-hidden="true"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-6 pb-[max(env(safe-area-inset-bottom),1.5rem)] text-center shadow-xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-[28rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <svg
                className="h-7 w-7 text-green-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m4.5 12.75 6 6 9-13.5"
                />
              </svg>
            </div>
            <h2 className="mt-4 text-lg font-semibold text-gray-900">
              Document sent
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              <span className="font-medium text-gray-900">{sent.label}</span> was
              emailed to {sent.to}, with the PDF attached.
            </p>
            <button
              type="button"
              onClick={() => setSent(null)}
              className="mt-5 w-full rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}

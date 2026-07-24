"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useBasket } from "@/components/library/basket-context";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { proxyAssetUrl } from "@/lib/storage/asset-url";
import { prettyType } from "@/lib/library/file-types";
import { parseAndValidateRecipients } from "@/lib/validation/recipients";
import { clampQuantity } from "@/lib/validation/print-order";
import {
  emailLibraryDocumentAction,
  softDeleteLibraryDocumentAction,
} from "@/app/(app)/library/actions";
import type { LibraryDocument } from "@/types/database";

/** One document in the library list — download, email, add-to-basket, and
 *  (single operator) soft-delete. */
export function LibraryDocumentRow({ doc }: { doc: LibraryDocument }) {
  const router = useRouter();
  const online = useIsOnline();
  const basket = useBasket();

  const [qty, setQty] = useState(1);
  const [emailOpen, setEmailOpen] = useState(false);
  const [recipients, setRecipients] = useState("");
  const [sending, setSending] = useState(false);
  const [emailResult, setEmailResult] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const downloadUrl = `${proxyAssetUrl(doc.file_path)}?download=1`;
  const basketQty = basket.quantityOf(doc.id);

  async function sendEmail() {
    setEmailError(null);
    setEmailResult(null);
    const parsed = parseAndValidateRecipients(recipients);
    if (!parsed.ok) {
      setEmailError(parsed.error);
      return;
    }
    setSending(true);
    const res = await emailLibraryDocumentAction(doc.id, parsed.emails);
    setSending(false);
    if (res.success) {
      setEmailResult(`Sent to ${res.emailedTo}`);
      setRecipients("");
      setEmailOpen(false);
    } else {
      setEmailError(res.message ?? "Failed to send.");
    }
  }

  async function remove() {
    if (!window.confirm(`Remove “${doc.label}” from the library?`)) return;
    setRemoving(true);
    const res = await softDeleteLibraryDocumentAction(doc.id);
    if (res.success) {
      router.refresh();
    } else {
      setRemoving(false);
      window.alert(res.message ?? "Failed to remove document.");
    }
  }

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">{doc.label}</p>
          <p className="mt-0.5 text-xs text-gray-400">
            {prettyType(doc.file_name)} · {doc.file_name}
          </p>
        </div>
        <button
          type="button"
          onClick={remove}
          disabled={removing || !online}
          className="shrink-0 text-xs font-medium text-gray-400 hover:text-red-600 disabled:opacity-50"
          title={online ? "Remove from library" : "Online required"}
        >
          {removing ? "Removing…" : "Remove"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={downloadUrl}
          download={doc.file_name}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Download
        </a>

        <button
          type="button"
          onClick={() => {
            setEmailOpen((v) => !v);
            setEmailResult(null);
            setEmailError(null);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
          </svg>
          Email
        </button>

        <div className="ml-auto flex items-center gap-2">
          <label className="sr-only" htmlFor={`qty-${doc.id}`}>
            Quantity
          </label>
          <input
            id={`qty-${doc.id}`}
            type="number"
            min={1}
            max={10000}
            value={qty}
            onChange={(e) => setQty(clampQuantity(Number(e.target.value)))}
            className="w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-xs focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
          <button
            type="button"
            onClick={() => basket.add(doc.id, doc.label, qty)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark"
          >
            Add to basket
          </button>
        </div>
      </div>

      {basketQty > 0 && (
        <p className="mt-2 text-xs font-medium text-brand-darker">
          In basket: {basketQty}
        </p>
      )}

      {emailResult && (
        <p className="mt-2 text-xs font-medium text-green-600">{emailResult}</p>
      )}

      {emailOpen && (
        <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
          <label htmlFor={`to-${doc.id}`} className="mb-1 block text-xs font-medium text-gray-600">
            Send this document to
          </label>
          <input
            id={`to-${doc.id}`}
            type="text"
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            placeholder="name@example.com, second@example.com"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
          <p className="mt-1 text-xs text-gray-400">
            Separate multiple emails with commas. They all go on one email.
          </p>
          {emailError && <p className="mt-1 text-xs text-red-600">{emailError}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEmailOpen(false)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={sendEmail}
              disabled={sending || !online}
              className="rounded-lg bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

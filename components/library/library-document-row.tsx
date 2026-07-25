"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useBasket } from "@/components/library/basket-context";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { proxyAssetUrl } from "@/lib/storage/asset-url";
import { isPreviewable, prettyType } from "@/lib/library/file-types";
import { parseAndValidateRecipients } from "@/lib/validation/recipients";
import { clampQuantity } from "@/lib/validation/print-order";
import {
  emailLibraryDocumentAction,
  requestDocumentEditAction,
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
  const [editOpen, setEditOpen] = useState(false);
  const [editNote, setEditNote] = useState("");
  const [requestingEdit, setRequestingEdit] = useState(false);
  const [editResult, setEditResult] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  // proxyAssetUrl only returns null for an empty stored value; a library row
  // always has a file_path, so fall back to the raw path rather than widening
  // every consumer to string | null.
  const inlineUrl = proxyAssetUrl(doc.file_path) ?? doc.file_path;
  const downloadUrl = `${inlineUrl}?download=1`;
  // Inline disposition is the proxy's default (no ?download=1), so a PDF or
  // image opens in the browser's own viewer. Word/Excel can't render inline,
  // so Quick view points at the download for those instead of us building a
  // viewer for two file types.
  const canPreview = isPreviewable(doc.file_name);
  const quickViewUrl = canPreview ? inlineUrl : downloadUrl;
  const basketQty = basket.quantityOf(doc.id);

  async function requestEdit() {
    setEditError(null);
    setRequestingEdit(true);
    const res = await requestDocumentEditAction(doc.id, editNote);
    setRequestingEdit(false);
    if (res.success) {
      setEditNote("");
      setEditOpen(false);
      setEditResult(`Edit request sent for “${doc.label}”.`);
    } else {
      setEditError(res.message ?? "Could not send the request. Try again.");
    }
  }

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
          href={quickViewUrl}
          {...(canPreview
            ? { target: "_blank", rel: "noopener noreferrer" }
            : { download: doc.file_name })}
          title={
            canPreview
              ? "Open this document in a new tab"
              : `${prettyType(doc.file_name)} files can't preview in the browser. This downloads a copy.`
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
          Quick view
        </a>

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

        <button
          type="button"
          onClick={() => {
            setEditOpen((v) => !v);
            setEditResult(null);
            setEditError(null);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
          </svg>
          Request edit
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
            onClick={() => {
              basket.add(doc.id, doc.label, qty);
              // Back to 1 once it's in the basket. The typed number lingering
              // in the box after an add (and after the order was confirmed and
              // the basket emptied) is what made it read like nothing had
              // happened; "In basket" below is the single source of truth now.
              setQty(1);
            }}
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

      {/* Same confirmation standard as the print-order success state: an
          unmissable block that stays put, not a fading inline note. */}
      {editResult && (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-green-800">{editResult}</p>
            <p className="mt-0.5 text-xs text-green-700">
              John gets the document name and its ID, so he knows exactly
              which one you mean.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditResult(null)}
            className="ml-auto shrink-0 text-xs font-medium text-green-700 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {editOpen && (
        <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
          <label htmlFor={`edit-${doc.id}`} className="mb-1 block text-xs font-medium text-gray-600">
            What needs changing? (optional)
          </label>
          <textarea
            id={`edit-${doc.id}`}
            rows={3}
            value={editNote}
            onChange={(e) => setEditNote(e.target.value)}
            placeholder="e.g. the phone number on page 2 is out of date"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
          <p className="mt-1 text-xs text-gray-400">
            Sends “{doc.label}” and its document ID to John.
          </p>
          {editError && <p className="mt-1 text-xs text-red-600">{editError}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={requestEdit}
              disabled={requestingEdit || !online}
              className="rounded-lg bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {requestingEdit ? "Sending…" : "Send request"}
            </button>
          </div>
        </div>
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

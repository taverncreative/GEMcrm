"use client";

import { useState } from "react";
import type { Customer } from "@/types/database";
import type { DocAction, DocReadiness } from "@/lib/documents/doc-readiness";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The fields the prompt hands back to be saved on the customer record.
 *  Mirrors `CustomerDocDetails` in lib/data/customers (kept structural so
 *  this presentational component carries no server import). */
export interface DocDetailsDraft {
  email?: string;
  address_line_1?: string;
  address_line_2?: string;
  town?: string;
  county?: string;
  postcode?: string;
}

/**
 * The document-completeness prompt (Pass 2). Shown only when the readiness
 * rule says a required field is missing. Asks for just the missing bits —
 * an email when sending — plus an optional, skippable postal address, saves
 * them once to the customer record, then lets the original action proceed.
 *
 * Presentational: it owns the form state + client validation and calls
 * `onSubmit` (which persists + closes) / `onCancel`. The save itself lives
 * in the provider so the imperative API stays the one source of truth.
 */
export function CustomerDocReadyPrompt({
  customer,
  action,
  readiness,
  onSubmit,
  onCancel,
}: {
  customer: Customer;
  action: DocAction;
  readiness: DocReadiness;
  onSubmit: (details: DocDetailsDraft) => Promise<{ success: boolean; error?: string }>;
  onCancel: () => void;
}) {
  const needEmail = readiness.required.includes("email");
  const offerAddress = readiness.optional.includes("address");

  const [email, setEmail] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [town, setTown] = useState("");
  const [county, setCounty] = useState("");
  const [postcode, setPostcode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const anyAddress =
    !!(line1.trim() || line2.trim() || town.trim() || county.trim() || postcode.trim());

  async function handleSave() {
    if (needEmail && !EMAIL_RE.test(email.trim())) {
      setError("Enter a valid email address");
      return;
    }
    setError(null);
    setSaving(true);

    const details: DocDetailsDraft = {};
    if (needEmail) details.email = email.trim();
    // Address is all-or-nothing: only persist it if the operator typed
    // something, and never overwrite an existing address with blanks.
    if (offerAddress && anyAddress) {
      details.address_line_1 = line1;
      details.address_line_2 = line2;
      details.town = town;
      details.county = county;
      details.postcode = postcode;
    }

    const res = await onSubmit(details);
    if (!res.success) {
      setSaving(false);
      setError(res.error ?? "Couldn't save — try again.");
    }
    // On success the provider unmounts this prompt and resumes the action.
  }

  const inputClass =
    "mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
  const labelClass = "block text-xs font-medium text-gray-600";
  const cta = action === "send" ? "Save and send" : "Save and continue";

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={saving ? undefined : onCancel}
      />

      <div className="relative flex h-full w-full flex-col bg-white shadow-xl sm:h-auto sm:max-h-[90vh] sm:max-w-md sm:rounded-2xl">
        <div className="shrink-0 border-b px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">
            {needEmail ? "Add an email to send" : "A few details first"}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {needEmail
              ? `${customer.name} has no email on file. Add one to send this document.`
              : `Add any missing details for ${customer.name}.`}
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {needEmail && (
            <div>
              <label htmlFor="dr-email" className={labelClass}>
                Email <span className="text-red-500">*</span>
              </label>
              <input
                id="dr-email"
                type="email"
                value={email}
                autoFocus
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleSave();
                  }
                }}
                placeholder="customer@example.co.uk"
                className={inputClass}
              />
            </div>
          )}

          {offerAddress && (
            <div className="rounded-lg border border-dashed border-gray-200 p-3">
              <p className="text-xs font-medium text-gray-600">
                Postal address{" "}
                <span className="font-normal text-gray-400">
                  (optional — leave blank to skip)
                </span>
              </p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <input
                    type="text"
                    value={line1}
                    onChange={(e) => setLine1(e.target.value)}
                    placeholder="Address line 1"
                    className={inputClass}
                  />
                </div>
                <div className="sm:col-span-2">
                  <input
                    type="text"
                    value={line2}
                    onChange={(e) => setLine2(e.target.value)}
                    placeholder="Address line 2"
                    className={inputClass}
                  />
                </div>
                <input
                  type="text"
                  value={town}
                  onChange={(e) => setTown(e.target.value)}
                  placeholder="Town"
                  className={inputClass}
                />
                <input
                  type="text"
                  value={county}
                  onChange={(e) => setCounty(e.target.value)}
                  placeholder="County"
                  className={inputClass}
                />
                <input
                  type="text"
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                  placeholder="Postcode"
                  className={inputClass}
                />
              </div>
            </div>
          )}

          <p className="text-xs text-gray-400">
            Saved to {customer.name}&rsquo;s record — we won&rsquo;t ask again.
          </p>

          {error && (
            <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-gray-100 bg-white px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:pb-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="min-h-[44px] rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 sm:min-h-0"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="min-h-[44px] rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50 sm:min-h-0"
          >
            {saving ? "Saving…" : cta}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";
import {
  deleteCustomerAction,
  getDeleteImpactAction,
} from "@/app/(app)/customers/actions";
import type { DeleteImpact } from "@/lib/data/customers";

interface DeleteCustomerConfirmProps {
  customerId: string;
  customerName: string;
  open: boolean;
  onClose: () => void;
  /** Called after a successful delete, before the parent panel closes. */
  onDeleted: () => void;
}

/**
 * Two-step delete confirmation:
 *   1. Show the impact (sites, jobs, agreements, invoices that will go too)
 *   2. Require the user to type the customer name to enable the delete button
 *
 * This is intentional friction — accidental deletes here would cascade
 * across the whole CRM. The type-the-name pattern is the same gate GitHub
 * uses for repo deletes.
 */
export function DeleteCustomerConfirm({
  customerId,
  customerName,
  open,
  onClose,
  onDeleted,
}: DeleteCustomerConfirmProps) {
  const [impact, setImpact] = useState<DeleteImpact | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) {
      setImpact(null);
      setConfirmText("");
      setError(null);
      return;
    }
    void getDeleteImpactAction(customerId).then(setImpact);
  }, [open, customerId]);

  if (!open) return null;

  const matches = confirmText.trim() === customerName.trim();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteCustomerAction(customerId);
      if (res.success) {
        onDeleted();
      } else {
        setError(res.message ?? "Failed to delete");
      }
    });
  }

  return (
    <div
      // z-index above the side panel so the modal floats over it
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="px-6 pt-6">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
            <svg
              className="h-5 w-5 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m0 3.75h.007v.008H12v-.008Zm0-12.75c5.385 0 9.75 4.365 9.75 9.75s-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12 6.615 2.25 12 2.25Z"
              />
            </svg>
          </div>
          <h2 className="text-center text-lg font-semibold text-gray-900">
            Delete {customerName}?
          </h2>
          <p className="mt-2 text-center text-sm text-gray-500">
            This permanently removes the customer and everything attached.
          </p>

          {impact && (
            <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
              <p className="text-xs uppercase tracking-wider text-gray-500">
                Will be deleted:
              </p>
              <ul className="mt-2 space-y-1 text-gray-700">
                <ImpactRow label="Sites" count={impact.sites} />
                <ImpactRow label="Jobs / bookings" count={impact.jobs} />
                <ImpactRow label="Agreements" count={impact.agreements} />
                <ImpactRow label="Invoices" count={impact.invoices} />
              </ul>
            </div>
          )}

          <p className="mt-4 text-xs text-gray-500">
            Type{" "}
            <span className="font-mono text-gray-900">{customerName}</span>{" "}
            to confirm.
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoFocus
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
            placeholder={customerName}
          />

          {error && (
            <p className="mt-2 text-sm text-red-600">{error}</p>
          )}
        </div>

        <div className="mt-6 flex gap-2 border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!matches || isPending}
            className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPending ? "Deleting…" : "Delete forever"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImpactRow({ label, count }: { label: string; count: number }) {
  return (
    <li className="flex items-center justify-between">
      <span>{label}</span>
      <span className={count > 0 ? "font-semibold text-gray-900" : "text-gray-400"}>
        {count}
      </span>
    </li>
  );
}

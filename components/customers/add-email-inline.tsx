"use client";

import { useState, useTransition } from "react";
import { setCustomerEmailAction } from "@/app/(app)/customers/actions";
import { wrapAction } from "@/lib/actions/wrap";
import { db } from "@/lib/db";

// Wrapped (L3): the inline "Add email" works identically offline —
// applyLocal updates the Dexie customer row (any useLiveQuery consumer
// re-renders immediately: banners disappear, "Complete & Email"
// enables) and the outbox replays setCustomerEmailAction when online.
export const wrappedSetCustomerEmail = wrapAction(setCustomerEmailAction, {
  actionName: "setCustomerEmailAction",
  entityType: "customer",
  entityId: ([customerId]) => customerId,
  applyLocal: async ([customerId, email]) => {
    await db.customers.update(customerId, {
      email: (email as string).trim().toLowerCase(),
      updated_at: new Date().toISOString(),
    });
  },
});

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One-field email capture for a customer with no address on file.
 *  Used on the service-sheet entry banner and the view-only email
 *  status line. */
export function AddCustomerEmailInline({
  customerId,
  cta = "Save email",
  onSaved,
}: {
  customerId: string;
  cta?: string;
  onSaved?: (email: string) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    const email = value.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      setError("Enter a valid email address");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await wrappedSetCustomerEmail(customerId, email);
      if (!res.success) {
        setError(res.error ?? "Failed to save email");
        return;
      }
      onSaved?.(email);
    });
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          placeholder="customer@example.co.uk"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
        />
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="shrink-0 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {isPending ? "Saving…" : cta}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

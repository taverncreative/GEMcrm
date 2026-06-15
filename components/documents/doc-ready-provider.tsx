"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import type { Customer } from "@/types/database";
import {
  customerDocReadiness,
  type DocAction,
  type DocReadiness,
} from "@/lib/documents/doc-readiness";
import { setCustomerDocDetailsAction } from "@/app/(app)/customers/actions";
import { wrapAction } from "@/lib/actions/wrap";
import { db } from "@/lib/db";
import {
  CustomerDocReadyPrompt,
  type DocDetailsDraft,
} from "./customer-doc-ready-prompt";

// Local-first save: applyLocal writes the email/address straight to the
// Dexie customer row (every useLiveQuery consumer re-renders immediately —
// banners clear, the document re-renders with the address), and the outbox
// replays setCustomerDocDetailsAction when online. Same contract as the
// inline "Add email" affordance, extended to cover the postal address.
const wrappedSaveDocDetails = wrapAction(setCustomerDocDetailsAction, {
  actionName: "setCustomerDocDetailsAction",
  entityType: "customer",
  entityId: ([customerId]) => customerId as string,
  applyLocal: async ([customerId, details]) => {
    const d = details as DocDetailsDraft;
    const patch: Record<string, string | null> = {
      updated_at: new Date().toISOString(),
    };
    if (d.email !== undefined) patch.email = d.email.trim().toLowerCase();
    for (const key of [
      "address_line_1",
      "address_line_2",
      "town",
      "county",
      "postcode",
    ] as const) {
      if (d[key] !== undefined) patch[key] = d[key]!.trim() || null;
    }
    await db.customers.update(customerId as string, patch);
  },
});

/**
 * The imperative entry point. Resolves `true` if the action may proceed
 * (the customer was already ready, or the operator filled in the missing
 * bits and saved) and `false` if they cancelled.
 */
export type EnsureCustomerDocReady = (
  customer: Customer,
  action: DocAction
) => Promise<boolean>;

const DocReadyContext = createContext<EnsureCustomerDocReady | null>(null);

interface PendingPrompt {
  customer: Customer;
  action: DocAction;
  readiness: DocReadiness;
  resolve: (proceed: boolean) => void;
}

/**
 * Document-completeness gate provider (Pass 2). Mounted once at the app
 * shell; exposes {@link useEnsureCustomerDocReady}. Holds the single prompt
 * instance + the pending promise resolver, so any call site can `await`
 * readiness with no modal plumbing of its own.
 */
export function DocReadyProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingPrompt | null>(null);

  const ensure = useCallback<EnsureCustomerDocReady>((customer, action) => {
    const readiness = customerDocReadiness(customer, action);
    // Already complete → no prompt, proceed straight away.
    if (readiness.ready) return Promise.resolve(true);
    // Otherwise show the prompt and hand the resolver to its buttons.
    return new Promise<boolean>((resolve) => {
      setPending({ customer, action, readiness, resolve });
    });
  }, []);

  async function handleSubmit(details: DocDetailsDraft) {
    if (!pending) return { success: false, error: "No prompt open" };
    const res = await wrappedSaveDocDetails(pending.customer.id, details);
    if (res.success) {
      pending.resolve(true);
      setPending(null);
    }
    return res;
  }

  function handleCancel() {
    pending?.resolve(false);
    setPending(null);
  }

  return (
    <DocReadyContext.Provider value={ensure}>
      {children}
      {pending && (
        <CustomerDocReadyPrompt
          customer={pending.customer}
          action={pending.action}
          readiness={pending.readiness}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      )}
    </DocReadyContext.Provider>
  );
}

/**
 * Hook for call sites: `const ensureReady = useEnsureCustomerDocReady()`,
 * then `if (await ensureReady(customer, "send")) { ...run the action... }`.
 */
export function useEnsureCustomerDocReady(): EnsureCustomerDocReady {
  const ctx = useContext(DocReadyContext);
  if (!ctx) {
    throw new Error(
      "useEnsureCustomerDocReady must be used within a <DocReadyProvider>"
    );
  }
  return ctx;
}

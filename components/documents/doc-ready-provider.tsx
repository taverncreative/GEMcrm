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
  type DocTarget,
  type DocReadiness,
} from "@/lib/documents/doc-readiness";
import { setCustomerDocDetailsAction } from "@/app/(app)/customers/actions";
import { db } from "@/lib/db";
import {
  CustomerDocReadyPrompt,
  type DocDetailsDraft,
} from "./customer-doc-ready-prompt";

const ADDRESS_KEYS = [
  "address_line_1",
  "address_line_2",
  "town",
  "county",
  "postcode",
] as const;

/** Merge the prompt's draft onto a customer object (for the returned, fresh
 *  customer) and into a Dexie patch (for the optimistic local mirror). */
function applyDraft(customer: Customer, details: DocDetailsDraft) {
  const merged: Customer = { ...customer };
  const patch: Record<string, string | null> = {
    updated_at: new Date().toISOString(),
  };
  if (details.email !== undefined) {
    const email = details.email.trim().toLowerCase();
    merged.email = email;
    patch.email = email;
  }
  for (const key of ADDRESS_KEYS) {
    if (details[key] !== undefined) {
      const value = details[key]!.trim() || null;
      merged[key] = value;
      patch[key] = value;
    }
  }
  return { merged, patch };
}

/**
 * What the gate resolves with. `proceed` says whether to run the action;
 * `customer` is the FRESH customer (with any saved email/address merged in)
 * so the caller never fires on the stale pre-prompt record; `saved` is true
 * when the prompt actually persisted something (the invoice send uses it to
 * regenerate the PDF so the new bill-to lands before sending).
 */
export interface EnsureDocReadyResult {
  proceed: boolean;
  customer: Customer;
  saved: boolean;
}

export type EnsureCustomerDocReady = (
  customer: Customer,
  target: DocTarget
) => Promise<EnsureDocReadyResult>;

const DocReadyContext = createContext<EnsureCustomerDocReady | null>(null);

interface PendingPrompt {
  customer: Customer;
  target: DocTarget;
  readiness: DocReadiness;
  resolve: (result: EnsureDocReadyResult) => void;
}

/**
 * Document-completeness gate provider (Pass 2). Mounted once at the app
 * shell; exposes {@link useEnsureCustomerDocReady}. Holds the single prompt
 * instance + the pending promise resolver, so any call site can `await`
 * readiness with no modal plumbing of its own.
 */
export function DocReadyProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingPrompt | null>(null);

  const ensure = useCallback<EnsureCustomerDocReady>((customer, target) => {
    const readiness = customerDocReadiness(customer, target);
    // Already complete → no prompt, proceed straight away on the same record.
    if (readiness.ready) {
      return Promise.resolve({ proceed: true, customer, saved: false });
    }
    // Otherwise show the prompt and hand the resolver to its buttons.
    return new Promise<EnsureDocReadyResult>((resolve) => {
      setPending({ customer, target, readiness, resolve });
    });
  }, []);

  async function handleSubmit(details: DocDetailsDraft) {
    if (!pending) return { success: false, error: "No prompt open" };
    const { merged, patch } = applyDraft(pending.customer, details);

    // Persist SERVER-side and await it, so the very next thing the caller
    // does (a send action that re-reads the customer) sees the fresh email —
    // not the stale pre-prompt row. The prompt only ever appears for a SEND,
    // which is online-only, so a direct awaited write is the right contract.
    const res = await setCustomerDocDetailsAction(pending.customer.id, details);
    if (!res.success) {
      return { success: false, error: res.message };
    }
    // Mirror into Dexie so offline-first UIs (useLiveQuery) refresh too.
    await db.customers.update(pending.customer.id, patch);

    pending.resolve({ proceed: true, customer: merged, saved: true });
    setPending(null);
    return { success: true };
  }

  function handleCancel() {
    pending?.resolve({ proceed: false, customer: pending.customer, saved: false });
    setPending(null);
  }

  return (
    <DocReadyContext.Provider value={ensure}>
      {children}
      {pending && (
        <CustomerDocReadyPrompt
          customer={pending.customer}
          target={pending.target}
          readiness={pending.readiness}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      )}
    </DocReadyContext.Provider>
  );
}

// Fail-open fallback when no provider is mounted: proceed without a prompt.
// The provider is always mounted in the app shell, so prod always gets the
// real gate; this keeps the hook usable in isolation (unit tests that render
// a wired component standalone) and leans on the server-side guards — which
// stay in place as backstops — to catch a genuinely missing email.
const PROCEED_FALLBACK: EnsureCustomerDocReady = (customer) =>
  Promise.resolve({ proceed: true, customer, saved: false });

/**
 * Hook for call sites: `const ensureReady = useEnsureCustomerDocReady()`,
 * then `const { proceed, customer } = await ensureReady(customer, {verb,doc})`.
 * Proceed if true; the returned `customer` carries any freshly-saved fields.
 */
export function useEnsureCustomerDocReady(): EnsureCustomerDocReady {
  return useContext(DocReadyContext) ?? PROCEED_FALLBACK;
}

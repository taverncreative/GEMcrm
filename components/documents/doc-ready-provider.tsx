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
import { captureDocDetails } from "@/lib/documents/capture-doc-details";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import {
  CustomerDocReadyPrompt,
  type DocDetailsDraft,
} from "./customer-doc-ready-prompt";

/**
 * What the gate resolves with. `proceed` says whether to run the action;
 * `customer` is the FRESH customer (with any saved email/address merged in)
 * so the caller never fires on the stale pre-prompt record; `saved` is true
 * when the prompt actually persisted something (the invoice send uses it to
 * regenerate the PDF so the new bill-to lands before sending); `deferred` is
 * true when that save was captured OFFLINE (optimistic — not on the server
 * yet) so the caller knows a send must wait for it to sync.
 */
export interface EnsureDocReadyResult {
  proceed: boolean;
  customer: Customer;
  saved: boolean;
  deferred: boolean;
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
 * readiness with no modal plumbing of its own. The save is offline-aware
 * (see {@link captureDocDetails}) so a field operator can capture the email
 * at completion even with no signal.
 */
export function DocReadyProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const online = useIsOnline();

  const ensure = useCallback<EnsureCustomerDocReady>((customer, target) => {
    const readiness = customerDocReadiness(customer, target);
    // Already complete → no prompt, proceed straight away on the same record.
    if (readiness.ready) {
      return Promise.resolve({
        proceed: true,
        customer,
        saved: false,
        deferred: false,
      });
    }
    // Otherwise show the prompt and hand the resolver to its buttons.
    return new Promise<EnsureDocReadyResult>((resolve) => {
      setPending({ customer, target, readiness, resolve });
    });
  }, []);

  async function handleSubmit(details: DocDetailsDraft) {
    if (!pending) return { success: false, error: "No prompt open" };
    const res = await captureDocDetails(pending.customer, details, online);
    if (!res.success) {
      return { success: false, error: res.error };
    }
    pending.resolve({
      proceed: true,
      customer: res.customer,
      saved: true,
      deferred: res.deferred,
    });
    setPending(null);
    return { success: true };
  }

  function handleCancel() {
    pending?.resolve({
      proceed: false,
      customer: pending.customer,
      saved: false,
      deferred: false,
    });
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
  Promise.resolve({ proceed: true, customer, saved: false, deferred: false });

/**
 * Hook for call sites: `const ensureReady = useEnsureCustomerDocReady()`,
 * then `const { proceed, customer } = await ensureReady(customer, {verb,doc})`.
 * Proceed if true; the returned `customer` carries any freshly-saved fields.
 */
export function useEnsureCustomerDocReady(): EnsureCustomerDocReady {
  return useContext(DocReadyContext) ?? PROCEED_FALLBACK;
}

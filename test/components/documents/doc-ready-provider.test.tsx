/**
 * Document-completeness prompt — imperative API contract.
 *
 * Pins the await-able `ensureCustomerDocReady(customer, target)` promise:
 *   - already ready (has email) → resolves proceed:true, NO prompt shown;
 *   - missing email, ONLINE  → prompt; Save → server write + Dexie, proceed;
 *   - missing email, OFFLINE → prompt; Save → optimistic Dexie + outbox
 *     enqueue (no direct server call), resolves deferred:true;
 *   - missing email → Cancel → resolves proceed:false (no write).
 *
 * Real Dexie + outbox (fake-indexeddb); the server action and the
 * online/offline signal are mocked at the boundary.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/app/(app)/customers/actions", () => ({
  setCustomerDocDetailsAction: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/lib/hooks/use-is-online", () => ({
  useIsOnline: vi.fn(() => true),
}));

import { setCustomerDocDetailsAction } from "@/app/(app)/customers/actions";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import {
  DocReadyProvider,
  useEnsureCustomerDocReady,
  type EnsureDocReadyResult,
} from "@/components/documents/doc-ready-provider";
import { db } from "@/lib/db";
import type { Customer } from "@/types/database";
import type { DocTarget } from "@/lib/documents/doc-readiness";

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "c-1",
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    deleted_at: null,
    name: "Acme Pest Co",
    company_name: null,
    email: null,
    phone: null,
    customer_type: "domestic",
    google_review_received: false,
    review_request_snoozed_until: null,
    review_email_sent_at: null,
    mobile: null,
    position: null,
    address: null,
    address_line_1: null,
    address_line_2: null,
    town: null,
    county: null,
    postcode: null,
    website: null,
    notes: null,
    annual_contract_value: null,
    ...overrides,
  };
}

function Harness({
  customer,
  target,
  onResult,
}: {
  customer: Customer;
  target: DocTarget;
  onResult: (result: EnsureDocReadyResult) => void;
}) {
  const ensureReady = useEnsureCustomerDocReady();
  return (
    <button onClick={async () => onResult(await ensureReady(customer, target))}>
      run
    </button>
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(useIsOnline).mockReturnValue(true);
  await db.customers.clear();
  await db.outbox.clear();
});

describe("ensureCustomerDocReady (imperative API)", () => {
  it("already ready (email on file) → proceed, NO prompt shown", async () => {
    const onResult = vi.fn();
    render(
      <DocReadyProvider>
        <Harness
          customer={makeCustomer({ email: "ops@acme.co.uk" })}
          target={{ verb: "send", doc: "invoice" }}
          onResult={onResult}
        />
      </DocReadyProvider>
    );

    await userEvent.click(screen.getByRole("button", { name: "run" }));

    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith(
        expect.objectContaining({ proceed: true, saved: false })
      )
    );
    expect(screen.queryByText(/add an email to send/i)).toBeNull();
  });

  it("ONLINE missing email → prompt; Save writes server + Dexie, deferred:false", async () => {
    await db.customers.put(makeCustomer({ id: "c-1", email: null }));
    const onResult = vi.fn();
    render(
      <DocReadyProvider>
        <Harness
          customer={makeCustomer({ id: "c-1", email: null })}
          target={{ verb: "send", doc: "invoice" }}
          onResult={onResult}
        />
      </DocReadyProvider>
    );

    await userEvent.click(screen.getByRole("button", { name: "run" }));
    const field = await screen.findByPlaceholderText(/customer@example/i);
    await userEvent.type(field, "ops@acme.co.uk");
    await userEvent.click(screen.getByRole("button", { name: /save and send/i }));

    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith(
        expect.objectContaining({ proceed: true, saved: true, deferred: false })
      )
    );
    // Online: direct server write happened, plus the Dexie mirror.
    expect(setCustomerDocDetailsAction).toHaveBeenCalledWith("c-1", {
      email: "ops@acme.co.uk",
    });
    expect((await db.customers.get("c-1"))!.email).toBe("ops@acme.co.uk");
    // Nothing queued — it's already on the server.
    expect(await db.outbox.count()).toBe(0);
  });

  it("OFFLINE missing email → prompt; Save captures optimistically + enqueues (deferred)", async () => {
    vi.mocked(useIsOnline).mockReturnValue(false);
    await db.customers.put(makeCustomer({ id: "c-1", email: null }));
    const onResult = vi.fn();
    render(
      <DocReadyProvider>
        <Harness
          customer={makeCustomer({ id: "c-1", email: null })}
          target={{ verb: "send", doc: "report" }}
          onResult={onResult}
        />
      </DocReadyProvider>
    );

    await userEvent.click(screen.getByRole("button", { name: "run" }));
    const field = await screen.findByPlaceholderText(/customer@example/i);
    await userEvent.type(field, "field@acme.co.uk");
    await userEvent.click(screen.getByRole("button", { name: /save and send/i }));

    // Captured but deferred — caller knows a send must wait for sync.
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith(
        expect.objectContaining({ proceed: true, saved: true, deferred: true })
      )
    );
    // Optimistic local write landed immediately.
    expect((await db.customers.get("c-1"))!.email).toBe("field@acme.co.uk");
    // NOT written directly to the server — queued for replay instead.
    expect(setCustomerDocDetailsAction).not.toHaveBeenCalled();
    const entries = await db.outbox.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0].action_name).toBe("setCustomerDocDetailsAction");
    expect(entries[0].args).toEqual(["c-1", { email: "field@acme.co.uk" }]);
  });

  it("Cancel → proceed:false, no write", async () => {
    await db.customers.put(makeCustomer({ id: "c-1", email: null }));
    const onResult = vi.fn();
    render(
      <DocReadyProvider>
        <Harness
          customer={makeCustomer({ id: "c-1", email: null })}
          target={{ verb: "send", doc: "invoice" }}
          onResult={onResult}
        />
      </DocReadyProvider>
    );

    await userEvent.click(screen.getByRole("button", { name: "run" }));
    await screen.findByPlaceholderText(/customer@example/i);
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith(
        expect.objectContaining({ proceed: false })
      )
    );
    expect((await db.customers.get("c-1"))!.email).toBeNull();
    expect(await db.outbox.count()).toBe(0);
  });
});

/**
 * Document-completeness prompt — imperative API contract (Pass 2A).
 *
 * Pins the await-able `ensureCustomerDocReady(customer, action)` promise:
 *   - already ready (has email) → resolves true with NO prompt shown;
 *   - missing email → prompt shown; Save → persists to Dexie + resolves true;
 *   - missing email → Cancel → resolves false (no write).
 *
 * Real wrapAction + Dexie (fake-indexeddb); only the server action at the
 * boundary is mocked (it drags in next/headers via requireUser).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/app/(app)/customers/actions", () => ({
  setCustomerDocDetailsAction: vi.fn(async () => ({ success: true })),
}));

import {
  DocReadyProvider,
  useEnsureCustomerDocReady,
} from "@/components/documents/doc-ready-provider";
import { db } from "@/lib/db";
import type { Customer } from "@/types/database";
import type { DocAction } from "@/lib/documents/doc-readiness";

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
  action,
  onResult,
}: {
  customer: Customer;
  action: DocAction;
  onResult: (proceed: boolean) => void;
}) {
  const ensureReady = useEnsureCustomerDocReady();
  return (
    <button onClick={async () => onResult(await ensureReady(customer, action))}>
      run
    </button>
  );
}

beforeEach(async () => {
  await db.customers.clear();
  await db.outbox.clear();
});

describe("ensureCustomerDocReady (imperative API)", () => {
  it("already ready (email on file) → resolves true, NO prompt shown", async () => {
    const onResult = vi.fn();
    render(
      <DocReadyProvider>
        <Harness
          customer={makeCustomer({ email: "ops@acme.co.uk" })}
          action="send"
          onResult={onResult}
        />
      </DocReadyProvider>
    );

    await userEvent.click(screen.getByRole("button", { name: "run" }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    // No prompt — the action proceeded straight away.
    expect(screen.queryByText(/add an email to send/i)).toBeNull();
  });

  it("missing email → prompt; Save persists to Dexie and resolves true", async () => {
    await db.customers.put(makeCustomer({ id: "c-1", email: null }));
    const onResult = vi.fn();
    render(
      <DocReadyProvider>
        <Harness
          customer={makeCustomer({ id: "c-1", email: null })}
          action="send"
          onResult={onResult}
        />
      </DocReadyProvider>
    );

    await userEvent.click(screen.getByRole("button", { name: "run" }));

    // Prompt appears asking only for the missing email.
    const field = await screen.findByPlaceholderText(/customer@example/i);
    await userEvent.type(field, "ops@acme.co.uk");
    await userEvent.click(screen.getByRole("button", { name: /save and send/i }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    // Saved optimistically to the local customer row.
    const saved = await db.customers.get("c-1");
    expect(saved!.email).toBe("ops@acme.co.uk");
  });

  it("missing email → Cancel → resolves false, no write", async () => {
    await db.customers.put(makeCustomer({ id: "c-1", email: null }));
    const onResult = vi.fn();
    render(
      <DocReadyProvider>
        <Harness
          customer={makeCustomer({ id: "c-1", email: null })}
          action="send"
          onResult={onResult}
        />
      </DocReadyProvider>
    );

    await userEvent.click(screen.getByRole("button", { name: "run" }));
    await screen.findByPlaceholderText(/customer@example/i);
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    const after = await db.customers.get("c-1");
    expect(after!.email).toBeNull();
  });
});

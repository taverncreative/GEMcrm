/**
 * Phase A — customers list page tests.
 *
 * Pre-conversion the page was RSC and threw `[getCustomerListItems]
 * "TypeError: fetch failed"` offline. Now it's a client component
 * reading from Dexie via useLiveQuery; this suite pins the
 * conversion's invariants:
 *
 *   (a) seeded Dexie renders the customer list
 *   (b) the type filter (URL `?type=`) routes correctly
 *   (c) the search predicate (URL `?q=`) matches the server's
 *       `name|company_name ilike` behaviour
 *   (d) soft-deleted customers are excluded
 *   (e) the Add Customer link disables when offline
 *   (f) the Invoices column is gone (slice 2b)
 *
 * Dexie is the real fake-indexeddb instance from the harness;
 * server-action mocks intercept getInvoiceCountsForCustomersAction.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Module mocks (hoisted) ───────────────────────────────────────

// Pin a router that records pushes (CustomerSearch + CustomersTabs
// push URL params; we don't assert on these here, but the mocks
// keep them from crashing during render).
const pushMock = vi.fn();
const replaceMock = vi.fn();
let searchParamsMock: URLSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => searchParamsMock,
  usePathname: () => "/customers",
}));

// invoiceCountsMock is the one assertion target; other action
// exports pass through via importOriginal so transitively-imported
// modules (DeleteCustomerConfirm, CustomerSidePanel, etc) don't fall
// over on missing references during render.
// Typed as the real action signature so `mockResolvedValue(...)`
// elsewhere stays type-safe.
const invoiceCountsMock = vi.fn(
  async (_customerIds: string[]): Promise<Record<string, number>> => ({})
);
vi.mock("@/app/(app)/customers/actions", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/app/(app)/customers/actions")
  >();
  return {
    ...actual,
    getInvoiceCountsForCustomersAction: (customerIds: string[]) =>
      invoiceCountsMock(customerIds),
  };
});

vi.mock("@/components/sync/sync-state-pill", () => ({
  SyncStatePill: () => <span data-testid="mock-sync-pill" />,
}));

// ─── Imports (AFTER mocks) ────────────────────────────────────────

import CustomersPage from "@/app/(app)/customers/page";
import { db } from "@/lib/db";
import type { Customer, Site } from "@/types/database";

const FIXED_NOW = "2026-06-01T10:00:00.000Z";

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "cust-1",
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    deleted_at: null,
    name: "Test Customer",
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

function makeSite(overrides: Partial<Site> = {}): Site {
  return {
    id: "site-1",
    customer_id: "cust-1",
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    deleted_at: null,
    address_line_1: "1 Test Lane",
    address_line_2: null,
    town: "Testville",
    county: null,
    postcode: "TT1 1TT",
    ...overrides,
  };
}

beforeEach(async () => {
  await db.customers.clear();
  await db.sites.clear();
  await db.jobs.clear();
  await db.agreements.clear();
  await db.tasks.clear();
  searchParamsMock = new URLSearchParams();
  invoiceCountsMock.mockClear();
  invoiceCountsMock.mockResolvedValue({});
  // Default: online.
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});

function setOffline() {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  window.dispatchEvent(new Event("offline"));
}

// ─── (a) renders seeded Dexie data ────────────────────────────────

describe("CustomersPage — Dexie reads", () => {
  it("renders one row per Dexie customer", async () => {
    await db.customers.put(makeCustomer({ id: "c-1", name: "Acme Pest Co" }));
    await db.customers.put(
      makeCustomer({ id: "c-2", name: "Beta Holdings", customer_type: "commercial" })
    );
    await db.sites.put(makeSite({ customer_id: "c-1" }));

    render(<CustomersPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Acme Pest Co").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Beta Holdings").length).toBeGreaterThan(0);
    });
  });
});

// ─── (b) URL ?type= filter ────────────────────────────────────────

describe("CustomersPage — type filter via ?type=", () => {
  it("?type=commercial shows only commercial customers", async () => {
    await db.customers.put(
      makeCustomer({ id: "c-1", name: "Acme", customer_type: "commercial" })
    );
    await db.customers.put(
      makeCustomer({ id: "c-2", name: "Beta", customer_type: "domestic" })
    );

    searchParamsMock = new URLSearchParams({ type: "commercial" });
    render(<CustomersPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Acme").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("Beta")).toBeNull();
  });
});

// ─── (c) URL ?q= search ───────────────────────────────────────────

describe("CustomersPage — search via ?q=", () => {
  it("?q=acme matches name (case-insensitive)", async () => {
    await db.customers.put(makeCustomer({ id: "c-1", name: "Acme Pest" }));
    await db.customers.put(makeCustomer({ id: "c-2", name: "Brillo Ltd" }));

    searchParamsMock = new URLSearchParams({ q: "ACME" });
    render(<CustomersPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Acme Pest").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("Brillo Ltd")).toBeNull();
  });

  it("?q= matches company_name too", async () => {
    await db.customers.put(
      makeCustomer({
        id: "c-1",
        name: "Bob Jones",
        company_name: "Acme Holdings",
        customer_type: "commercial",
      })
    );
    await db.customers.put(makeCustomer({ id: "c-2", name: "Brillo Ltd" }));

    searchParamsMock = new URLSearchParams({ q: "acme" });
    render(<CustomersPage />);

    await waitFor(() => {
      // company_name "Acme Holdings" matches — Bob Jones (the contact) shows up.
      expect(screen.getAllByText("Bob Jones").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("Brillo Ltd")).toBeNull();
  });
});

// ─── (d) soft-deleted excluded ────────────────────────────────────

describe("CustomersPage — soft-delete exclusion", () => {
  it("does not show customers with deleted_at set", async () => {
    await db.customers.put(
      makeCustomer({ id: "c-active", name: "Active Customer" })
    );
    await db.customers.put(
      makeCustomer({
        id: "c-deleted",
        name: "Deleted Customer",
        deleted_at: FIXED_NOW,
      })
    );

    render(<CustomersPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Active Customer").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("Deleted Customer")).toBeNull();
  });
});

// ─── (e) Add Customer guard ───────────────────────────────────────

describe("CustomersPage — Add Customer guard", () => {
  it("Add Customer is an enabled link when online", async () => {
    await db.customers.put(makeCustomer());
    render(<CustomersPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Test Customer").length).toBeGreaterThan(0);
    });

    const link = screen.getByText("Add Customer").closest("a, span");
    expect(link?.tagName).toBe("A");
    expect(link).not.toHaveAttribute("aria-disabled", "true");
  });

  it("Add Customer is a disabled span (with tooltip) when offline", async () => {
    await db.customers.put(makeCustomer());

    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });

    render(<CustomersPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Test Customer").length).toBeGreaterThan(0);
    });

    const node = screen.getByText("Add Customer").closest("a, span");
    expect(node?.tagName).toBe("SPAN");
    expect(node).toHaveAttribute("aria-disabled", "true");
    expect(node).toHaveAttribute("title", "Online required");
  });
});

// ─── (f) the Invoices column is gone (slice 2b) ───────────────────

describe("CustomersPage — no invoice column", () => {
  it("renders no Invoices header and never fetches invoice counts", async () => {
    await db.customers.put(makeCustomer({ id: "c-1", name: "Test Customer" }));

    render(<CustomersPage />);

    await waitFor(() => {
      expect(screen.getAllByText("Test Customer").length).toBeGreaterThan(0);
    });

    // The column and its online-only per-customer count both went with the
    // rest of the invoice UI. Nothing offline-vs-online about it any more:
    // there is simply no invoice read on this page.
    expect(screen.queryByText("Invoices")).toBeNull();
    expect(invoiceCountsMock).not.toHaveBeenCalled();
  });
});

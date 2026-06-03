/**
 * Surface 3 — customer side panel component tests.
 *
 * Covers the Dexie-backed read paths, the loading/not-found gate, the
 * archived-job filter (Gap B), the online-required guards on write
 * controls, and the Documents section's offline notice (Gap A).
 *
 * Mocked away:
 *
 *   - Server actions (`setReviewReceivedAction`,
 *     `setCustomerTypeAction`, `getServiceReportsForCustomerAction`).
 *     Only their existence matters — we never assert on the call
 *     payload at this layer; the guard tests assert on UI state
 *     (disabled / tooltip) which proves the action never fires.
 *   - BookingModal / InvoiceCreatorModal / DeleteCustomerConfirm —
 *     swapped for stubs since their internals (preset customer
 *     prefills, modal portals) aren't what we're testing here.
 *   - SyncStatePill — same reason.
 *
 * The Dexie singleton is the real one (fake-indexeddb harness). Each
 * test seeds the rows it needs and asserts on the panel's render.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Module mocks (hoisted) ───────────────────────────────────────

// Mocks are typed broadly via the wildcard signature so each test's
// mockResolvedValue can return either the success-result shape OR an
// array of reports without a parametric type fight. Without this the
// inferred return type collapses to `never` after the first call and
// later `.mockResolvedValue([...])` calls fail to compile.
type AnyAsyncFn = (...args: unknown[]) => Promise<unknown>;
const setReviewReceivedMock = vi.fn<AnyAsyncFn>(async () => ({ success: true }));
const setCustomerTypeMock = vi.fn<AnyAsyncFn>(async () => ({ success: true }));
const getReportsMock = vi.fn<AnyAsyncFn>(async () => []);
vi.mock("@/app/(app)/customers/actions", () => ({
  setReviewReceivedAction: (...a: unknown[]) => setReviewReceivedMock(...a),
  setCustomerTypeAction: (...a: unknown[]) => setCustomerTypeMock(...a),
  getServiceReportsForCustomerAction: (...a: unknown[]) => getReportsMock(...a),
}));

vi.mock("@/components/bookings/booking-modal", () => ({
  BookingModal: () => <div data-testid="mock-booking-modal" />,
}));
vi.mock("@/components/invoices/invoice-creator-modal", () => ({
  InvoiceCreatorModal: () => <div data-testid="mock-invoice-modal" />,
}));
vi.mock("@/components/customers/delete-customer-confirm", () => ({
  DeleteCustomerConfirm: () => <div data-testid="mock-delete-confirm" />,
}));
vi.mock("@/components/sync/sync-state-pill", () => ({
  SyncStatePill: () => <div data-testid="mock-sync-pill" />,
}));

// ─── Imports (AFTER mocks) ────────────────────────────────────────

import { CustomerSidePanel } from "@/components/customers/customer-side-panel";
import { db } from "@/lib/db";
import type {
  Agreement,
  Customer,
  Job,
  Site,
  Task,
} from "@/types/database";

// ─── Fixture builders ─────────────────────────────────────────────

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

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    site_id: "site-1",
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    deleted_at: null,
    job_date: "2026-05-15",
    job_time: null,
    call_type: "routine",
    pest_species: ["Mice"],
    findings: null,
    recommendations: null,
    treatment: null,
    pesticides_used: null,
    risk_level: null,
    risk_comments: null,
    technician_signature_url: null,
    client_signature_url: null,
    job_status: "completed",
    agreement_id: null,
    environmental_risk: null,
    environmental_comments: null,
    protected_species_present: false,
    method_used: [],
    photo_urls: [],
    client_present: false,
    client_name: null,
    report_notes: null,
    value: null,
    is_invoiced: false,
    is_paid: false,
    reference_number: null,
    parent_job_id: null,
    is_archived: false,
    ...overrides,
  };
}

function makeAgreement(overrides: Partial<Agreement> = {}): Agreement {
  return {
    id: "agr-1",
    customer_id: "cust-1",
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    deleted_at: null,
    reference_number: "PMA-001",
    status: "active",
    contract_pdf_url: null,
    end_date: null,
    ...overrides,
  } as Agreement;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "tsk-1",
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    deleted_at: null,
    title: "Test follow-up",
    task_type: "follow_up",
    status: "pending",
    due_date: null,
    priority: "normal",
    related_customer_id: "cust-1",
    ...overrides,
  } as Task;
}

beforeEach(async () => {
  await db.customers.clear();
  await db.sites.clear();
  await db.jobs.clear();
  await db.agreements.clear();
  await db.tasks.clear();
  setReviewReceivedMock.mockClear();
  setCustomerTypeMock.mockClear();
  getReportsMock.mockClear();
  getReportsMock.mockResolvedValue([]);
  // Default browser state: online. Tests that need offline flip
  // navigator.onLine + fire the event explicitly.
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

// ─── (a) Reads from Dexie ─────────────────────────────────────────

describe("CustomerSidePanel — reads from Dexie", () => {
  it("renders the customer header + sites + jobs + agreements + tasks from seeded Dexie data", async () => {
    await db.customers.put(makeCustomer({ name: "Acme Pest Co" }));
    await db.sites.put(makeSite({ address_line_1: "12 High St" }));
    await db.jobs.put(makeJob({ id: "job-past", job_date: "2026-05-01" }));
    await db.jobs.put(
      makeJob({
        id: "job-upcoming",
        job_date: "2026-07-01",
        job_status: "scheduled",
      })
    );
    await db.agreements.put(makeAgreement({ reference_number: "PMA-A" }));
    await db.tasks.put(makeTask({ title: "Send invoice reminder" }));

    render(<CustomerSidePanel customerId="cust-1" onClose={vi.fn()} />);

    // Header shows the customer name from Dexie.
    await waitFor(() => {
      expect(screen.getByText("Acme Pest Co")).toBeInTheDocument();
    });

    // Sites section shows the address.
    expect(screen.getByText("12 High St")).toBeInTheDocument();

    // Upcoming + past jobs split shows the count in the section title.
    // The Section component renders the count in parentheses on the
    // upcoming title; we just look for the page text containing it.
    // Wrap past jobs in waitFor because the jobs query resolves AFTER
    // the customer query (chained on siteIds), and the section is
    // gated on `pastJobs.length > 0` so it only appears once the
    // resolved data lands.
    expect(screen.getByText(/Upcoming visits/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Past jobs/i)).toBeInTheDocument();
    });

    // Agreement reference is visible. With no contract_pdf_url, the
    // PMA-A reference appears in BOTH the Agreements section AND the
    // Suggestions section's "Sign + generate agreement PDF" link, so
    // getAllByText is the right matcher here.
    expect(screen.getAllByText("PMA-A").length).toBeGreaterThan(0);

    // Task title visible.
    expect(screen.getByText("Send invoice reminder")).toBeInTheDocument();
  });
});

// ─── (b) Loading state ───────────────────────────────────────────

describe("CustomerSidePanel — loading state", () => {
  it("shows the skeleton (not the not-found block) while useLiveQuery is in flight", async () => {
    // Nothing seeded yet — but render with a customerId that doesn't
    // exist. We want to verify the FIRST render shows the skeleton,
    // not the not-found message.
    render(<CustomerSidePanel customerId="cust-nonexistent" onClose={vi.fn()} />);

    // The header skeleton is the animate-pulse div. We can detect it
    // by class — there's no role for it. Also the not-found copy
    // must NOT be present yet.
    expect(
      screen.queryByText(/Customer not found/i)
    ).not.toBeInTheDocument();

    // After the useLiveQuery resolves (still no row), we should land
    // on not-found. This proves the skeleton was just a transient
    // state, not stuck.
    await waitFor(() => {
      expect(
        screen.getByText(/Customer not found/i)
      ).toBeInTheDocument();
    });
  });
});

// ─── (c) Not-found / soft-deleted ─────────────────────────────────

describe("CustomerSidePanel — not-found / soft-deleted", () => {
  it("shows 'Customer not found' when the customer is missing from Dexie", async () => {
    render(<CustomerSidePanel customerId="cust-missing" onClose={vi.fn()} />);
    await waitFor(() => {
      expect(
        screen.getByText(/Customer not found/i)
      ).toBeInTheDocument();
    });
  });

  it("treats a soft-deleted customer the same as not-found", async () => {
    await db.customers.put(
      makeCustomer({ id: "cust-deleted", deleted_at: FIXED_NOW })
    );
    render(<CustomerSidePanel customerId="cust-deleted" onClose={vi.fn()} />);
    await waitFor(() => {
      expect(
        screen.getByText(/Customer not found/i)
      ).toBeInTheDocument();
    });
    // The customer's name must NOT appear — we treat it as missing.
    expect(screen.queryByText(/Test Customer/i)).toBeNull();
  });
});

// ─── (d) Gap B: archived jobs filtered ────────────────────────────

describe("CustomerSidePanel — Gap B archive filter", () => {
  it("does NOT show an archived job even when its Dexie row is otherwise valid", async () => {
    await db.customers.put(makeCustomer());
    await db.sites.put(makeSite());
    await db.jobs.put(
      makeJob({
        id: "job-active",
        reference_number: "REF-ACTIVE",
        is_archived: false,
      })
    );
    await db.jobs.put(
      makeJob({
        id: "job-archived",
        reference_number: "REF-ARCHIVED",
        is_archived: true,
      })
    );

    render(<CustomerSidePanel customerId="cust-1" onClose={vi.fn()} />);

    // Active job shows up.
    await waitFor(() => {
      expect(screen.getByText("REF-ACTIVE")).toBeInTheDocument();
    });
    // Archived job MUST NOT.
    expect(screen.queryByText("REF-ARCHIVED")).toBeNull();
  });
});

// ─── (e) Online vs offline guards ─────────────────────────────────

describe("CustomerSidePanel — online-required guards", () => {
  it("buttons are enabled when online", async () => {
    await db.customers.put(makeCustomer());
    render(<CustomerSidePanel customerId="cust-1" onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Test Customer")).toBeInTheDocument();
    });

    // Desktop action bar.
    const bookingBtn = screen.getAllByRole("button", { name: /New Booking/i })[0];
    const invoiceBtn = screen.getByRole("button", { name: /Create Invoice/i });
    const deleteBtn = screen.getByRole("button", { name: /Delete customer/i });
    expect(bookingBtn).not.toBeDisabled();
    expect(invoiceBtn).not.toBeDisabled();
    expect(deleteBtn).not.toBeDisabled();

    // Type toggle buttons (Commercial/Domestic) also enabled.
    const commercialBtn = screen.getByRole("button", { name: "Commercial" });
    const domesticBtn = screen.getByRole("button", { name: "Domestic" });
    expect(commercialBtn).not.toBeDisabled();
    expect(domesticBtn).not.toBeDisabled();

    // Review checkbox.
    const reviewCheckbox = screen.getByRole("checkbox");
    expect(reviewCheckbox).not.toBeDisabled();
  });

  it("Invoice + Delete stay disabled offline; New Booking + toggles do NOT", async () => {
    await db.customers.put(makeCustomer());
    render(<CustomerSidePanel customerId="cust-1" onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Test Customer")).toBeInTheDocument();
    });

    // Flip offline AFTER the panel mounted so we exercise the
    // event-listener path the useIsOnline hook exposes.
    setOffline();

    // Create Invoice + Delete remain online-only — those multi-entity
    // writes aren't wrapped (Invoice/Agreement out of scope; Delete is
    // a cascade). They stay disabled with the tooltip.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Create Invoice/i })
      ).toBeDisabled();
    });
    expect(
      screen.getByRole("button", { name: /Delete customer/i })
    ).toBeDisabled();

    // New Booking is now offline-capable (step 8) — NOT disabled.
    const bookingBtn = screen.getAllByRole("button", {
      name: /New Booking/i,
    })[0];
    expect(bookingBtn).not.toBeDisabled();
    expect(bookingBtn).not.toHaveAttribute("title", "Online required");

    // The single-entity toggles (type, review) are local-first too.
    expect(
      screen.getByRole("button", { name: "Commercial" })
    ).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Domestic" })
    ).not.toBeDisabled();
    expect(screen.getByRole("checkbox")).not.toBeDisabled();
  });
});

// ─── (g) Local-first toggles — instant UI feedback ────────────────

describe("CustomerSidePanel — local-first toggles", () => {
  it("review checkbox flips immediately when clicked (Dexie applyLocal lands first)", async () => {
    await db.customers.put(
      makeCustomer({ id: "cust-rev", google_review_received: false })
    );
    // Tell our mock to behave like a working server — the wrapper
    // fires it in the background; the local write is what we assert.
    setReviewReceivedMock.mockResolvedValue({ success: true });

    render(<CustomerSidePanel customerId="cust-rev" onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Test Customer")).toBeInTheDocument();
    });

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    // Click. With wrapAction, applyLocal writes Dexie BEFORE the
    // server call, so useLiveQuery should re-render with checked=true
    // within a tick — no waiting on the (mocked) server.
    checkbox.click();

    await waitFor(() => {
      const reflowed = screen.getByRole("checkbox") as HTMLInputElement;
      expect(reflowed.checked).toBe(true);
    });

    // And the underlying Dexie row reflects the change too — proof
    // that applyLocal actually ran, not just optimistic component
    // state.
    const row = await db.customers.get("cust-rev");
    expect(row?.google_review_received).toBe(true);
  });

  it("type segmented control flips immediately when clicked", async () => {
    await db.customers.put(
      makeCustomer({ id: "cust-typ", customer_type: "domestic" })
    );
    setCustomerTypeMock.mockResolvedValue({ success: true });

    render(<CustomerSidePanel customerId="cust-typ" onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Test Customer")).toBeInTheDocument();
    });

    // Click "Commercial" — applyLocal updates Dexie → useLiveQuery
    // emits → the "Commercial" button gains the active class.
    const commercialBtn = screen.getByRole("button", { name: "Commercial" });
    commercialBtn.click();

    await waitFor(async () => {
      const row = await db.customers.get("cust-typ");
      expect(row?.customer_type).toBe("commercial");
    });
  });
});

// ─── (f) Documents section — Gap A behaviour ──────────────────────

describe("CustomerSidePanel — Documents (Gap A)", () => {
  it("renders agreement PDFs from Dexie unconditionally", async () => {
    await db.customers.put(makeCustomer());
    await db.agreements.put(
      makeAgreement({
        reference_number: "PMA-DOC",
        contract_pdf_url: "https://example.com/agreement.pdf",
      })
    );

    render(<CustomerSidePanel customerId="cust-1" onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Test Customer")).toBeInTheDocument();
    });

    // The agreement PDF list entry shows.
    expect(screen.getByText("Pest Management Agreement")).toBeInTheDocument();
    // Reference number appears twice (panel agreements section + docs
    // section). At least one occurrence is enough.
    expect(screen.getAllByText("PMA-DOC").length).toBeGreaterThan(0);
  });

  it("shows the 'online required' notice for service report PDFs when offline", async () => {
    await db.customers.put(makeCustomer());
    // Pre-flip offline so the panel mounts with the right state.
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });

    render(<CustomerSidePanel customerId="cust-1" onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Test Customer")).toBeInTheDocument();
    });

    // The notice is the canonical Surface-3 Gap A signal.
    expect(
      screen.getByText(/Service report PDFs.*online required/i)
    ).toBeInTheDocument();

    // The online-only fetch MUST NOT have been invoked.
    expect(getReportsMock).not.toHaveBeenCalled();
  });

  it("DOES invoke the online-only fetch when online (and shows whatever it returns)", async () => {
    await db.customers.put(makeCustomer());
    getReportsMock.mockResolvedValue([
      {
        id: "rep-1",
        job_id: "job-1",
        pdf_url: "https://example.com/report.pdf",
        created_at: FIXED_NOW,
      },
    ]);

    render(<CustomerSidePanel customerId="cust-1" onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Test Customer")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(getReportsMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText("Service Report")).toBeInTheDocument();
    });
  });
});

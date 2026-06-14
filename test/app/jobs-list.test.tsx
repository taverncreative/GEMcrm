/**
 * Phase B — jobs list page tests.
 *
 * Pre-conversion the page was RSC calling `getAllJobs` server-side
 * and threw `TypeError: fetch failed` offline. Now a client component
 * with chained useLiveQuery; this suite pins the conversion's
 * invariants:
 *
 *   (a) seeded Dexie renders jobs (joined with site + customer)
 *   (b) ?filter=today / ?filter=upcoming route correctly
 *   (c) ?status= routes correctly
 *   (d) ?q= search matches customer name, company, site address,
 *       postcode (mirrors getAllJobs's cross-table predicate)
 *   (e) Surface 3 Gap B: is_archived jobs are NOT shown
 *   (f) soft-deleted excluded
 *   (g) StartJobButton disabled offline
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";

let searchParamsMock: URLSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => searchParamsMock,
  usePathname: () => "/jobs",
}));

vi.mock("@/components/sync/sync-state-pill", () => ({
  SyncStatePill: () => <span data-testid="mock-sync-pill" />,
}));

vi.mock("@/components/bookings/booking-modal", () => ({
  BookingModal: () => <div data-testid="mock-booking-modal" />,
}));

vi.mock("@/components/invoices/invoice-creator-modal", () => ({
  InvoiceCreatorModal: () => <div data-testid="mock-invoice-modal" />,
}));

// The page batch-fetches invoice statuses for the chips through this
// server action; the real module drags in next/headers + the PDF stack,
// neither of which exists under vitest.
vi.mock("@/app/(app)/invoices/actions", () => ({
  getInvoiceStatusesForJobsAction: vi.fn(async () => ({})),
}));

// JobsStatusTabs + JobsFilter are router-pushers; they don't need
// their inner logic exercised here.
vi.mock("@/components/jobs/jobs-status-tabs", () => ({
  JobsStatusTabs: () => <div data-testid="mock-status-tabs" />,
}));
vi.mock("@/components/jobs/jobs-filter", () => ({
  JobsFilter: () => <div data-testid="mock-jobs-filter" />,
}));

import JobsPage from "@/app/(app)/jobs/page";
import { db } from "@/lib/db";
import type { Customer, Job, Site } from "@/types/database";

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
    job_date: "2026-06-15",
    job_time: null,
    job_time_end: null,
    capture_note: null,
    call_type: "routine",
    pest_species: [],
    findings: null,
    recommendations: null,
    treatment: null,
    pesticides_used: null,
    risk_level: null,
    risk_comments: null,
    technician_signature_url: null,
    client_signature_url: null,
    job_status: "scheduled",
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
    report_emailed_to: null,
    report_emailed_at: null,
    reference_number: "JOB-001",
    parent_job_id: null,
    is_archived: false,
    ...overrides,
  };
}

beforeEach(async () => {
  await db.jobs.clear();
  await db.sites.clear();
  await db.customers.clear();
  searchParamsMock = new URLSearchParams();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});

// ─── (a) renders seeded data ──────────────────────────────────────

describe("JobsPage — Dexie reads", () => {
  it("renders one row per joined job/site/customer", async () => {
    await db.customers.put(makeCustomer({ id: "c-1", name: "Acme Pest Co" }));
    await db.sites.put(makeSite({ id: "s-1", customer_id: "c-1" }));
    await db.jobs.put(
      makeJob({ id: "j-1", site_id: "s-1", reference_number: "REF-001" })
    );

    render(<JobsPage />);

    await waitFor(() => {
      expect(screen.getByText("REF-001")).toBeInTheDocument();
    });
    expect(screen.getByText("Acme Pest Co")).toBeInTheDocument();
  });
});

// ─── (b) date filters ─────────────────────────────────────────────

describe("JobsPage — date filter via ?filter=", () => {
  it("?filter=today shows only jobs dated today (todayUk)", async () => {
    // Today's date depends on the harness; just assert relative
    // ordering using two known-distant dates. The job dated 2099
    // should never match today.
    await db.customers.put(makeCustomer());
    await db.sites.put(makeSite());
    await db.jobs.put(
      makeJob({ id: "j-past", reference_number: "PAST", job_date: "2020-01-01" })
    );
    await db.jobs.put(
      makeJob({
        id: "j-future",
        reference_number: "FUTURE",
        job_date: "2099-12-31",
      })
    );

    searchParamsMock = new URLSearchParams({ filter: "today" });
    render(<JobsPage />);

    // Wait for the page to settle. Neither matches today.
    await waitFor(() => {
      expect(screen.getByText("No jobs found.")).toBeInTheDocument();
    });
    expect(screen.queryByText("PAST")).toBeNull();
    expect(screen.queryByText("FUTURE")).toBeNull();
  });

  it("?filter=upcoming shows only jobs in the future", async () => {
    await db.customers.put(makeCustomer());
    await db.sites.put(makeSite());
    await db.jobs.put(
      makeJob({ id: "j-past", reference_number: "PAST", job_date: "2020-01-01" })
    );
    await db.jobs.put(
      makeJob({
        id: "j-future",
        reference_number: "FUTURE",
        job_date: "2099-12-31",
      })
    );

    searchParamsMock = new URLSearchParams({ filter: "upcoming" });
    render(<JobsPage />);

    await waitFor(() => {
      expect(screen.getByText("FUTURE")).toBeInTheDocument();
    });
    expect(screen.queryByText("PAST")).toBeNull();
  });
});

// ─── (c) status filter ────────────────────────────────────────────

describe("JobsPage — status filter via ?status=", () => {
  it("?status=completed only shows completed jobs", async () => {
    await db.customers.put(makeCustomer());
    await db.sites.put(makeSite());
    await db.jobs.put(
      makeJob({
        id: "j-sched",
        reference_number: "SCHED",
        job_status: "scheduled",
      })
    );
    await db.jobs.put(
      makeJob({
        id: "j-done",
        reference_number: "DONE",
        job_status: "completed",
      })
    );

    searchParamsMock = new URLSearchParams({ status: "completed" });
    render(<JobsPage />);

    await waitFor(() => {
      expect(screen.getByText("DONE")).toBeInTheDocument();
    });
    expect(screen.queryByText("SCHED")).toBeNull();
  });

  it("?status=open shows scheduled AND in_progress, hides completed", async () => {
    await db.customers.put(makeCustomer());
    await db.sites.put(makeSite());
    await db.jobs.put(
      makeJob({ id: "j-s", reference_number: "SCHED", job_status: "scheduled" })
    );
    await db.jobs.put(
      makeJob({
        id: "j-p",
        reference_number: "INPROG",
        job_status: "in_progress",
      })
    );
    await db.jobs.put(
      makeJob({ id: "j-d", reference_number: "DONE", job_status: "completed" })
    );

    searchParamsMock = new URLSearchParams({ status: "open" });
    render(<JobsPage />);

    await waitFor(() => {
      expect(screen.getByText("SCHED")).toBeInTheDocument();
    });
    expect(screen.getByText("INPROG")).toBeInTheDocument();
    expect(screen.queryByText("DONE")).toBeNull();
  });

  it("defaults to Open when no status param (completed hidden)", async () => {
    await db.customers.put(makeCustomer());
    await db.sites.put(makeSite());
    await db.jobs.put(
      makeJob({ id: "j-s", reference_number: "SCHED", job_status: "scheduled" })
    );
    await db.jobs.put(
      makeJob({ id: "j-d", reference_number: "DONE", job_status: "completed" })
    );

    // no status param
    render(<JobsPage />);

    await waitFor(() => {
      expect(screen.getByText("SCHED")).toBeInTheDocument();
    });
    expect(screen.queryByText("DONE")).toBeNull();
  });
});

// ─── (c2) date sort toggle (Date column header) ───────────────────

describe("JobsPage — date sort toggle", () => {
  it("defaults to soonest-first and flips to latest-first on header click", async () => {
    await db.customers.put(makeCustomer());
    await db.sites.put(makeSite());
    await db.jobs.put(
      makeJob({ id: "j-e", reference_number: "EARLY", job_date: "2026-01-01" })
    );
    await db.jobs.put(
      makeJob({ id: "j-l", reference_number: "LATE", job_date: "2026-12-31" })
    );

    render(<JobsPage />);

    // Default asc (soonest first): EARLY appears before LATE in the table.
    await waitFor(() => {
      expect(screen.getByText("EARLY")).toBeInTheDocument();
    });
    const before = screen.getByRole("table").textContent ?? "";
    expect(before.indexOf("EARLY")).toBeLessThan(before.indexOf("LATE"));

    // Toggle via the Date column header → desc (latest first).
    await userEvent.click(
      screen.getByRole("button", { name: /sort.*latest first/i })
    );

    await waitFor(() => {
      const after = screen.getByRole("table").textContent ?? "";
      expect(after.indexOf("LATE")).toBeLessThan(after.indexOf("EARLY"));
    });
  });
});

// ─── (d) search across customer + site ────────────────────────────

describe("JobsPage — search via ?q=", () => {
  it("matches customer name (case-insensitive)", async () => {
    await db.customers.put(makeCustomer({ id: "c-1", name: "Acme Pest" }));
    await db.customers.put(makeCustomer({ id: "c-2", name: "Brillo Ltd" }));
    await db.sites.put(makeSite({ id: "s-1", customer_id: "c-1" }));
    await db.sites.put(makeSite({ id: "s-2", customer_id: "c-2" }));
    await db.jobs.put(
      makeJob({ id: "j-1", site_id: "s-1", reference_number: "ACME-1" })
    );
    await db.jobs.put(
      makeJob({ id: "j-2", site_id: "s-2", reference_number: "BRILLO-1" })
    );

    searchParamsMock = new URLSearchParams({ q: "ACME" });
    render(<JobsPage />);

    await waitFor(() => {
      expect(screen.getByText("ACME-1")).toBeInTheDocument();
    });
    expect(screen.queryByText("BRILLO-1")).toBeNull();
  });

  it("matches site postcode", async () => {
    await db.customers.put(makeCustomer());
    await db.sites.put(makeSite({ id: "s-1", postcode: "AB1 2CD" }));
    await db.sites.put(makeSite({ id: "s-2", postcode: "ZZ9 9ZZ" }));
    await db.jobs.put(
      makeJob({ id: "j-1", site_id: "s-1", reference_number: "AB-MATCH" })
    );
    await db.jobs.put(
      makeJob({ id: "j-2", site_id: "s-2", reference_number: "ZZ-OTHER" })
    );

    searchParamsMock = new URLSearchParams({ q: "ab1" });
    render(<JobsPage />);

    await waitFor(() => {
      expect(screen.getByText("AB-MATCH")).toBeInTheDocument();
    });
    expect(screen.queryByText("ZZ-OTHER")).toBeNull();
  });
});

// ─── (e) is_archived hidden ───────────────────────────────────────

describe("JobsPage — Gap B (is_archived)", () => {
  it("does NOT show jobs with is_archived=true", async () => {
    await db.customers.put(makeCustomer());
    await db.sites.put(makeSite());
    await db.jobs.put(
      makeJob({
        id: "j-active",
        reference_number: "ACTIVE",
        is_archived: false,
      })
    );
    await db.jobs.put(
      makeJob({
        id: "j-archived",
        reference_number: "ARCHIVED",
        is_archived: true,
      })
    );

    render(<JobsPage />);

    await waitFor(() => {
      expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    });
    expect(screen.queryByText("ARCHIVED")).toBeNull();
  });
});

// ─── (f) soft-deleted excluded ────────────────────────────────────

describe("JobsPage — soft-delete exclusion", () => {
  it("does NOT show soft-deleted jobs", async () => {
    await db.customers.put(makeCustomer());
    await db.sites.put(makeSite());
    await db.jobs.put(
      makeJob({
        id: "j-live",
        reference_number: "LIVE",
        deleted_at: null,
      })
    );
    await db.jobs.put(
      makeJob({
        id: "j-deleted",
        reference_number: "GONE",
        deleted_at: FIXED_NOW,
      })
    );

    render(<JobsPage />);

    await waitFor(() => {
      expect(screen.getByText("LIVE")).toBeInTheDocument();
    });
    expect(screen.queryByText("GONE")).toBeNull();
  });
});

// ─── (g) StartJobButton stays enabled offline (New Booking is now ──
//        offline-capable, step 8) ─────────────────────────────────

describe("JobsPage — StartJobButton (New Booking offline-capable)", () => {
  it("StartJobButton is enabled when online", async () => {
    await db.customers.put(makeCustomer());
    await db.sites.put(makeSite());

    render(<JobsPage />);

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /New Booking/i });
      expect(btn).not.toBeDisabled();
    });
  });

  it("StartJobButton STAYS enabled offline (local-first booking)", async () => {
    await db.customers.put(makeCustomer());
    await db.sites.put(makeSite());

    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });

    render(<JobsPage />);

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /New Booking/i });
      // No online guard anymore — the modal is local-first.
      expect(btn).not.toBeDisabled();
      expect(btn).not.toHaveAttribute("title", "Online required");
    });
  });
});

// ─── (h) drafts on the Open tab (Track 1b) ────────────────────────

describe("JobsPage — drafts on the Open tab", () => {
  it("interleaves a draft by date; shows phrase + Draft badge; no checkbox; links to /upgrade", async () => {
    await db.customers.put(makeCustomer({ id: "c-1", name: "Acme" }));
    await db.sites.put(makeSite({ id: "s-1", customer_id: "c-1" }));
    // Two bookings bracketing the draft's date.
    await db.jobs.put(
      makeJob({
        id: "b-early",
        site_id: "s-1",
        reference_number: "BOOK-EARLY",
        job_date: "2026-06-12",
      })
    );
    await db.jobs.put(
      makeJob({
        id: "b-late",
        site_id: "s-1",
        reference_number: "BOOK-LATE",
        job_date: "2026-06-18",
      })
    );
    // A draft dated between them — null site, status draft, no ref.
    await db.jobs.put(
      makeJob({
        id: "d-1",
        site_id: null,
        job_status: "draft",
        reference_number: null,
        capture_note: "Sarah, wasps, Folkestone",
        job_date: "2026-06-15",
      })
    );

    render(<JobsPage />); // default = Open

    await waitFor(() => {
      expect(
        screen.getByText("Sarah, wasps, Folkestone")
      ).toBeInTheDocument();
    });
    // Real bookings still render.
    expect(screen.getByText("BOOK-EARLY")).toBeInTheDocument();
    expect(screen.getByText("BOOK-LATE")).toBeInTheDocument();

    // Interleaved by date: EARLY < draft phrase < LATE in document order.
    const table = screen.getByRole("table").textContent ?? "";
    expect(table.indexOf("BOOK-EARLY")).toBeLessThan(
      table.indexOf("Sarah, wasps, Folkestone")
    );
    expect(table.indexOf("Sarah, wasps, Folkestone")).toBeLessThan(
      table.indexOf("BOOK-LATE")
    );

    // Badged "Draft".
    expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);

    // The only forward action is Upgrade → /jobs/d-1/upgrade.
    const upgrade = screen.getByRole("link", { name: /upgrade/i });
    expect(upgrade).toHaveAttribute("href", "/jobs/d-1/upgrade");

    // No checkbox anywhere on the Open tab — a draft can never carry a
    // selection / completion affordance.
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("does NOT show drafts on the Completed tab", async () => {
    await db.customers.put(makeCustomer());
    await db.sites.put(makeSite());
    await db.jobs.put(
      makeJob({
        id: "done",
        reference_number: "DONE",
        job_status: "completed",
        findings: "f",
        recommendations: "r",
        pesticides_used: "p",
        risk_level: "low",
        risk_comments: "rc",
        pest_species: ["Wasps"],
        method_used: ["Survey"],
      })
    );
    await db.jobs.put(
      makeJob({
        id: "d-1",
        site_id: null,
        job_status: "draft",
        reference_number: null,
        capture_note: "Sarah, wasps, Folkestone",
        job_date: "2026-06-15",
      })
    );

    searchParamsMock = new URLSearchParams({ status: "completed" });
    render(<JobsPage />);

    await waitFor(() => {
      expect(screen.getByText("DONE")).toBeInTheDocument();
    });
    expect(screen.queryByText("Sarah, wasps, Folkestone")).toBeNull();
  });

  it("Drafts tab routes each row to /upgrade (not the job detail page)", async () => {
    await db.jobs.put(
      makeJob({
        id: "d-1",
        site_id: null,
        job_status: "draft",
        reference_number: null,
        capture_note: "Sarah, wasps, Folkestone",
        job_date: "2026-06-15",
      })
    );

    searchParamsMock = new URLSearchParams({ status: "draft" });
    render(<JobsPage />);

    await waitFor(() => {
      expect(
        screen.getByText("Sarah, wasps, Folkestone")
      ).toBeInTheDocument();
    });
    const link = screen.getByRole("link", {
      name: /Sarah, wasps, Folkestone/i,
    });
    expect(link).toHaveAttribute("href", "/jobs/d-1/upgrade");
  });
});

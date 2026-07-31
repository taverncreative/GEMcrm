/**
 * Job detail — "Following up on" context panel (+ the reverse note).
 *
 * A follow-up job carries `parent_job_id`; the panel surfaces the parent
 * visit's sheet inline so the operator knows what he's following up on
 * before he starts. The rules under test:
 *
 *   - parent_job_id set + parent in Dexie → panel with customer, parent
 *     date, an inline summary, and a link to the parent's sheet
 *   - products in that summary come from the OPERATOR helper (BRAND
 *     names) — this is Nate's screen, not the customer PDF
 *   - parent_job_id null (manual follow-up, or any normal job) → nothing
 *   - parent_job_id set but the parent isn't available locally → nothing
 *     (no panel, no crash)
 *   - the reverse note appears on the PARENT and links to the follow-up
 *
 * Real Dexie via fake-indexeddb, leaf components mocked — same harness as
 * job-detail-fill-link.test.tsx.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

let paramsMock: { id: string } = { id: "job-follow" };
vi.mock("next/navigation", () => ({
  useParams: () => paramsMock,
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/jobs/job-follow",
}));

// Offline: proves the panel renders from Dexie alone (the report fetch
// effect is skipped entirely).
vi.mock("@/lib/hooks/use-is-online", () => ({
  useIsOnline: () => false,
}));

vi.mock("@/app/(app)/jobs/[id]/actions", () => ({
  getReportByJobIdAction: vi.fn(async () => null),
  updateJobStatusAction: vi.fn(async () => ({
    success: true,
    errors: {},
    message: null,
  })),
  getJobDeleteImpactAction: vi.fn(async () => ({
    invoiceNumber: null,
    followUps: 0,
  })),
  deleteJobAction: vi.fn(async () => ({ success: true })),
  setJobNeedsInvoiceAction: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/components/sync/sync-state-pill", () => ({
  SyncStatePill: () => <span data-testid="mock-sync-pill" />,
}));
vi.mock("@/components/smart-back-button", () => ({
  SmartBackButton: () => <span data-testid="mock-back" />,
}));
vi.mock("@/components/jobs/report-actions", () => ({
  ReportActions: () => <div data-testid="mock-report-actions" />,
}));

import JobDetailPage from "@/app/(app)/jobs/[id]/page";
import { db } from "@/lib/db";
import type { Customer, Job, Site } from "@/types/database";

const FIXED_NOW = "2026-06-01T10:00:00.000Z";

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
    needs_invoice: false,
    report_emailed_to: null,
    report_emailed_at: null,
    reference_number: "00042",
    parent_job_id: null,
    is_archived: false,
    ...overrides,
  };
}

/** The completed visit being followed up on — a filled sheet. */
function makeParent(overrides: Partial<Job> = {}): Job {
  return makeJob({
    id: "job-parent",
    job_date: "2026-06-15",
    job_status: "completed",
    call_type: "callout",
    reference_number: "00042",
    pest_species: ["Wasps"],
    findings: "Active wasp nest in the roof void, north gable.",
    recommendations: "Re-check in two weeks.",
    treatment: "Dusted the nest entry point.",
    report_notes: "Loft hatch is behind the boiler cupboard.",
    products_used: [
      {
        product_id: "prod-1",
        brand_name: "Ficam W",
        chemical_name: "Bendiocarb",
        quantity: "30g",
      },
    ],
    ...overrides,
  });
}

/** The follow-up itself — chained to the parent. */
function makeFollowUp(overrides: Partial<Job> = {}): Job {
  return makeJob({
    id: "job-follow",
    job_date: "2026-06-29",
    job_status: "scheduled",
    call_type: "followup",
    reference_number: "00042-1",
    parent_job_id: "job-parent",
    ...overrides,
  });
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

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "cust-1",
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    deleted_at: null,
    name: "Bramley Kitchens",
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

beforeEach(async () => {
  await db.jobs.clear();
  await db.sites.clear();
  await db.customers.clear();
  await db.customers.put(makeCustomer());
  await db.sites.put(makeSite());
  paramsMock = { id: "job-follow" };
});

describe("JobDetailPage — Following up on panel", () => {
  it("renders the parent customer + visit date, the inline summary and a link to the parent's sheet", async () => {
    await db.jobs.bulkPut([makeParent(), makeFollowUp()]);

    render(<JobDetailPage />);

    // Header sentence: who + which visit.
    expect(
      await screen.findByText(
        /Following up on: Bramley Kitchens — visit of 15 Jun 2026/
      )
    ).toBeInTheDocument();

    // Inline summary — the previous sheet's key fields.
    expect(
      screen.getByText(/Active wasp nest in the roof void/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Dusted the nest entry point/)).toBeInTheDocument();
    expect(
      screen.getByText(/Loft hatch is behind the boiler cupboard/)
    ).toBeInTheDocument();

    // Link out to the full read-only sheet of the PARENT.
    expect(
      screen.getByRole("link", { name: /view previous sheet/i })
    ).toHaveAttribute("href", "/jobs/job-parent/complete");
  });

  it("shows products with BRAND names (operator helper), never the chemical", async () => {
    await db.jobs.bulkPut([makeParent(), makeFollowUp()]);

    render(<JobDetailPage />);

    // Operator helper → "brand — quantity".
    expect(await screen.findByText(/Ficam W — 30g/)).toBeInTheDocument();
    // The customer-facing helper would have rendered the chemical name.
    expect(screen.queryByText(/Bendiocarb/)).toBeNull();
  });

  it("falls back to the legacy free-text products on a pre-047 sheet", async () => {
    await db.jobs.bulkPut([
      makeParent({ products_used: [], pesticides_used: "Contrac Blox, 4 baits" }),
      makeFollowUp(),
    ]);

    render(<JobDetailPage />);

    expect(
      await screen.findByText(/Contrac Blox, 4 baits/)
    ).toBeInTheDocument();
  });

  it("renders NOTHING for a job with no parent (manual follow-up or normal job)", async () => {
    // call_type "followup" but parent_job_id null — the manual booking case.
    await db.jobs.put(
      makeFollowUp({ call_type: "followup", parent_job_id: null })
    );

    render(<JobDetailPage />);

    // Wait for the page to settle on something we know renders.
    await waitFor(() => {
      expect(screen.getByText("Visit Details")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Following up on/)).toBeNull();
    expect(screen.queryByRole("link", { name: /view previous sheet/i })).toBeNull();
  });

  it("renders NOTHING when the parent isn't available locally", async () => {
    // parent_job_id points at a row that was never pulled / was deleted.
    await db.jobs.put(makeFollowUp());

    render(<JobDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("Visit Details")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Following up on/)).toBeNull();
  });

  it("treats a soft-deleted parent as absent", async () => {
    await db.jobs.bulkPut([
      makeParent({ deleted_at: FIXED_NOW }),
      makeFollowUp(),
    ]);

    render(<JobDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("Visit Details")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Following up on/)).toBeNull();
  });
});

describe("JobDetailPage — reverse follow-up note", () => {
  it("shows 'Follow-up scheduled' on the parent, linking to the follow-up", async () => {
    paramsMock = { id: "job-parent" };
    await db.jobs.bulkPut([makeParent(), makeFollowUp()]);

    render(<JobDetailPage />);

    expect(await screen.findByText(/Follow-up scheduled:/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /29 Jun 2026/ })
    ).toHaveAttribute("href", "/jobs/job-follow");
  });

  it("shows no note on a visit with no follow-ups", async () => {
    paramsMock = { id: "job-parent" };
    await db.jobs.put(makeParent());

    render(<JobDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("Visit Details")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Follow-up scheduled:/)).toBeNull();
  });
});

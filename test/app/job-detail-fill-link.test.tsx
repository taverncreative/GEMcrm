/**
 * Job detail — "Fill Service Sheet" link gating (1a hygiene fix).
 *
 * The detail page offers a "Fill Service Sheet" link for non-completed
 * jobs only:
 *
 *   - scheduled  → "Fill Service Sheet" present, pointing at /complete
 *   - completed  → NO "Fill Service Sheet" (job is done)
 *
 * Real Dexie via fake-indexeddb (matches the jobs-list suite); leaf
 * components + the report server action are mocked — they drag in
 * next/headers / the PDF stack that vitest can't stand up, and are not
 * under test here.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

let paramsMock: { id: string } = { id: "job-1" };
vi.mock("next/navigation", () => ({
  useParams: () => paramsMock,
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/jobs/job-1",
}));

// Offline so the report-fetch effect is skipped; the action is mocked
// regardless because its module is imported at the top of the page (and by
// JobStatusActions, which also pulls updateJobStatusAction from it).
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
  // Pulled in via DeleteJobConfirm (header delete control). Not under test
  // here, but the page imports the module at the top so they must exist.
  getJobDeleteImpactAction: vi.fn(async () => ({
    invoiceNumber: null,
    followUps: 0,
  })),
  deleteJobAction: vi.fn(async () => ({ success: true })),
  // Pulled in via NeedsInvoiceToggle (completed-job header control).
  setJobNeedsInvoiceAction: vi.fn(async () => ({ success: true })),
}));

// Leaf components not under test — render nothing.
vi.mock("@/components/sync/sync-state-pill", () => ({
  SyncStatePill: () => <span data-testid="mock-sync-pill" />,
}));
vi.mock("@/components/smart-back-button", () => ({
  SmartBackButton: () => <span data-testid="mock-back" />,
}));
vi.mock("@/components/jobs/report-actions", () => ({
  ReportActions: () => <div data-testid="mock-report-actions" />,
}));
vi.mock("@/components/invoices/create-invoice-button", () => ({
  CreateInvoiceButton: () => <div data-testid="mock-create-invoice" />,
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
    reference_number: "JOB-001",
    parent_job_id: null,
    is_archived: false,
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

beforeEach(async () => {
  await db.jobs.clear();
  await db.sites.clear();
  await db.customers.clear();
  paramsMock = { id: "job-1" };
});

describe("JobDetailPage — Fill Service Sheet gating", () => {
  it("shows 'Fill Service Sheet' (→ /complete) for a scheduled booking", async () => {
    await db.customers.put(makeCustomer());
    await db.sites.put(makeSite());
    await db.jobs.put(
      makeJob({ id: "job-1", job_status: "scheduled" })
    );

    render(<JobDetailPage />);

    const fill = await screen.findByRole("link", {
      name: /fill service sheet/i,
    });
    expect(fill).toHaveAttribute("href", "/jobs/job-1/complete");
  });

  it("does NOT show 'Fill Service Sheet' for a completed job", async () => {
    await db.customers.put(makeCustomer());
    await db.sites.put(makeSite());
    await db.jobs.put(
      makeJob({
        id: "job-1",
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

    render(<JobDetailPage />);

    // The completed badge renders via JobStatusActions; once it's present the
    // page has settled and we can assert the absence of the fill link.
    await waitFor(() => {
      expect(screen.getByText(/completed/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/fill service sheet/i)).toBeNull();
  });
});

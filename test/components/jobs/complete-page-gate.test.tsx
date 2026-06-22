/**
 * Whitelist gate tests for app/(app)/jobs/[id]/complete/page.tsx.
 *
 * After the lock-fix commit, the page renders the editable
 * ServiceSheetForm ONLY when the job's job_status is in the
 * FILLABLE_STATUSES set (currently {"scheduled", "in_progress"}).
 * Any other status — including "completed" — routes to the
 * read-only ServiceSheetViewOnly display.
 *
 * These tests are the structural regression suite for that gate.
 * The fourth test simulates the actual bug-report path: a Dexie row
 * starts at in_progress (form mounted), then flips to "completed"
 * mid-render (approve commit), and the form must unmount and be
 * replaced by the view-only display — with no flash of the
 * editable form lingering.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

// Stub heavy children to keep render fast and focused.
vi.mock("@/components/ui/signature-pad", () => ({
  SignaturePad: () => <div data-testid="mock-sigpad" />,
}));
vi.mock("@/components/ui/photo-upload", () => ({
  PhotoUpload: () => <div data-testid="mock-photo-upload" />,
}));
vi.mock("@/components/sync/sync-state-pill", () => ({
  SyncStatePill: () => <div data-testid="mock-sync-pill" />,
}));

// Pin useParams to the seeded job id; setup.ts's default returns
// "test-job-id" already, but be explicit.
vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>(
    "next/navigation"
  );
  return {
    ...actual,
    useParams: () => ({ id: "completed-job-id" }),
    useRouter: () => ({
      push: vi.fn(),
      replace: vi.fn(),
      refresh: vi.fn(),
      back: vi.fn(),
      prefetch: vi.fn(),
    }),
  };
});

import CompleteServiceSheetPage from "@/app/(app)/jobs/[id]/complete/page";
import { db } from "@/lib/db";
import type { Job, Site, Customer } from "@/types/database";

const FIXED_NOW = "2026-06-01T10:00:00.000Z";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "completed-job-id",
    site_id: "site-1",
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    deleted_at: null,
    job_date: "2026-06-01",
    job_time: null,
    job_time_end: null,
    capture_note: null,
    call_type: "routine",
    pest_species: ["Mice"],
    findings: "Saved findings text",
    recommendations: "Saved recommendations text",
    treatment: null,
    pesticides_used: "Saved pesticides",
    risk_level: "low",
    risk_comments: "Saved risk comments",
    technician_signature_url: null,
    client_signature_url: null,
    job_status: "completed",
    agreement_id: null,
    environmental_risk: null,
    environmental_comments: null,
    protected_species_present: false,
    method_used: ["Rodenticide Used"],
    photo_urls: [],
    client_present: false,
    client_name: null,
    report_notes: null,
    value: null,
    is_invoiced: false,
    is_paid: false,
    report_emailed_to: null,
    report_emailed_at: null,
    reference_number: null,
    parent_job_id: null,
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
    address_line_2: "",
    town: "Test Town",
    county: "Test County",
    postcode: "TT1 1TT",
    notes: null,
    contact_name: null,
    contact_phone: null,
    contact_email: null,
    ...overrides,
  } as Site;
}

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "cust-1",
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    deleted_at: null,
    name: "Test Customer",
    company_name: null,
    // Complete by default so the whitelist-gate tests isolate STATUS from
    // the service-sheet completeness gate (which needs name/phone/email +
    // a usable site address). Tests that exercise the completeness gate
    // override phone/email back to null.
    email: "test@example.com",
    phone: "01234 567890",
    address_line_1: null,
    address_line_2: null,
    town: null,
    county: null,
    postcode: null,
    customer_type: "domestic",
    notes: null,
    website: null,
    pma_required: false,
    ...overrides,
  } as Customer;
}

beforeEach(async () => {
  await db.jobs.clear();
  await db.sites.clear();
  await db.customers.clear();
  await db.service_sheet_drafts.clear();
});

describe("complete page — whitelist gate", () => {
  it("shows the view-only display when job_status='completed'", async () => {
    await db.jobs.put(
      makeJob({
        job_status: "completed",
        findings: "Saved findings text",
        recommendations: "Saved recommendations text",
      })
    );
    await db.sites.put(makeSite());
    await db.customers.put(makeCustomer());

    render(<CompleteServiceSheetPage />);

    // The locked view must appear with the saved data displayed
    // read-only. The "Service sheet completed" banner is the
    // visible affordance the operator sees.
    await waitFor(() => {
      expect(
        screen.getByText(/Service sheet completed/i)
      ).toBeInTheDocument();
    });
    // Saved sheet data is visible as read-only content.
    expect(screen.getByText("Saved findings text")).toBeInTheDocument();
    expect(
      screen.getByText("Saved recommendations text")
    ).toBeInTheDocument();

    // And the editable form's giveaway elements must NOT appear.
    expect(screen.queryByLabelText(/^Findings/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Complete Service Sheet/i })
    ).toBeNull();
  });

  it("shows the editable form when job_status='in_progress'", async () => {
    await db.jobs.put(makeJob({ job_status: "in_progress" }));
    await db.sites.put(makeSite());
    await db.customers.put(makeCustomer());

    render(<CompleteServiceSheetPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/^Findings/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Service sheet completed/i)).toBeNull();
  });

  it("shows the editable form when job_status='scheduled'", async () => {
    await db.jobs.put(makeJob({ job_status: "scheduled" }));
    await db.sites.put(makeSite());
    await db.customers.put(makeCustomer());

    render(<CompleteServiceSheetPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/^Findings/i)).toBeInTheDocument();
    });
  });

  it(
    "post-approve regression: form unmounts and view-only takes over when " +
      "Dexie's job_status flips to completed mid-render",
    async () => {
      // Operator opens /complete on a job that's still in_progress.
      // They fill, approve. handleApprove writes Dexie to "completed"
      // (and per the offline-pwa rules, that write is what surface-1
      // observed when the "Fill Service Sheet" button hid). Browser
      // back returns them to /complete: pre-fix, the editable form
      // could briefly remount and present the saved data as editable.
      // Post-fix the whitelist gate refuses to mount the form for any
      // non-fill-able status.
      await db.jobs.put(
        makeJob({
          job_status: "in_progress",
          findings: "Sheet content from in-progress save",
        })
      );
      await db.sites.put(makeSite());
      await db.customers.put(makeCustomer());

      render(<CompleteServiceSheetPage />);

      // Form is up.
      await waitFor(() => {
        expect(screen.getByLabelText(/^Findings/i)).toBeInTheDocument();
      });
      // Sanity: locked view NOT present yet.
      expect(screen.queryByText(/Service sheet completed/i)).toBeNull();

      // Approve commits. Dexie row flips to completed (the local
      // mirror in handleApprove). useLiveQuery emits, page re-renders,
      // whitelist gate refuses the form, view-only takes over.
      await db.jobs.update("completed-job-id", { job_status: "completed" });

      await waitFor(() => {
        expect(
          screen.getByText(/Service sheet completed/i)
        ).toBeInTheDocument();
      });

      // The form's giveaway elements must be gone. If the form had
      // lingered (race window the bug report was about), Findings
      // would still be in the DOM.
      expect(screen.queryByLabelText(/^Findings/i)).toBeNull();
      expect(
        screen.queryByRole("button", { name: /Complete Service Sheet/i })
      ).toBeNull();

      // The saved sheet content shows up in the read-only display.
      expect(
        screen.getByText("Sheet content from in-progress save")
      ).toBeInTheDocument();
    }
  );

  it(
    "completeness gate: an under-filled customer is blocked with the missing " +
      "items instead of the form",
    async () => {
      // A relaxed-booking customer: fillable status, but no phone/email.
      await db.jobs.put(makeJob({ job_status: "scheduled" }));
      await db.sites.put(makeSite());
      await db.customers.put(makeCustomer({ phone: null, email: null }));

      render(<CompleteServiceSheetPage />);

      // The blocking panel shows, listing the missing contact details…
      await waitFor(() => {
        expect(
          screen.getByText(/Before filling the service sheet/i)
        ).toBeInTheDocument();
      });
      expect(screen.getByText(/a phone number/i)).toBeInTheDocument();
      expect(screen.getByText(/an email address/i)).toBeInTheDocument();
      // …and the editable form is NOT mounted.
      expect(screen.queryByLabelText(/^Findings/i)).toBeNull();
    }
  );

  it(
    "completeness gate: a bare site (no address) is blocked on the site address",
    async () => {
      await db.jobs.put(makeJob({ job_status: "scheduled" }));
      await db.sites.put(makeSite({ address_line_1: null, town: null }));
      await db.customers.put(makeCustomer());

      render(<CompleteServiceSheetPage />);

      await waitFor(() => {
        expect(
          screen.getByText(/Before filling the service sheet/i)
        ).toBeInTheDocument();
      });
      expect(screen.getByText(/a site address/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/^Findings/i)).toBeNull();
    }
  );

  it(
    "robustness: an unexpected status value (corruption / future enum) " +
      "defaults to view-only, never the editable form",
    async () => {
      // This is the safety property of choosing a WHITELIST rather
      // than a blacklist: an unknown status value (e.g. someone adds
      // a "cancelled" status server-side but forgets to update the
      // client gate) cannot accidentally render the editable form.
      // The cast bypasses TS so we can stuff a string the enum
      // doesn't know about — exactly what would happen in a future
      // mismatch.
      await db.jobs.put(
        makeJob({
          job_status: "cancelled" as Job["job_status"],
        })
      );
      await db.sites.put(makeSite());
      await db.customers.put(makeCustomer());

      render(<CompleteServiceSheetPage />);

      await waitFor(() => {
        expect(
          screen.getByText(/Service sheet completed/i)
        ).toBeInTheDocument();
      });
      expect(screen.queryByLabelText(/^Findings/i)).toBeNull();
    }
  );
});

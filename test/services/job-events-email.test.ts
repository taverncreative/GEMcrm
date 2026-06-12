/**
 * Single-owner email rule (hardened after the Generate-Report scare).
 *
 * The ONLY thing that ever emails a customer is the service sheet's
 * explicit "Complete & Email" choice — the approval action's own send
 * block. Pins:
 *
 *   1. onJobCompleted sends NOTHING by default — the status-dropdown
 *      completion path (updateJobStatusAction) therefore cannot email,
 *      even when a report PDF exists and the customer has an email.
 *   2. The explicit opt-in (`sendReportEmail: true`) still works, so a
 *      future caller can deliberately re-enable it.
 *   3. approveServiceSheetAction with sendEmail: true sends EXACTLY one
 *      email; with sendEmail: false it sends none — onJobCompleted
 *      contributes zero in both cases.
 *
 * All data-layer modules are stubbed; the email module is a recorder.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendServiceReportMock = vi.fn(async () => ({ success: true }));

vi.mock("@/lib/services/email", () => ({
  // The recorder ignores its args; the cast lets the mock module's
  // pass-through satisfy the real signature without unused params.
  sendServiceReport: (...args: unknown[]) =>
    (sendServiceReportMock as unknown as (...a: unknown[]) => Promise<unknown>)(
      ...args
    ),
}));
vi.mock("@/lib/data/tasks", () => ({
  hasPendingTaskOfType: vi.fn(async () => false),
  createTask: vi.fn(async () => ({})),
}));
vi.mock("@/lib/data/customers", () => ({
  getCustomerById: vi.fn(async () => ({
    id: "cust1",
    name: "Test Customer",
    email: "customer@example.test",
  })),
}));
vi.mock("@/lib/data/sites", () => ({
  getSiteById: vi.fn(async () => ({
    id: "site1",
    customer_id: "cust1",
    address_line_1: "1 Test Way",
  })),
}));
vi.mock("@/lib/data/reports", () => ({
  // A report with a PDF exists — the exact precondition under which the
  // old auto-send fired (and mailed placeholder PDFs).
  getReportByJobId: vi.fn(async () => ({
    id: "rep1",
    job_id: "job1",
    pdf_url: "https://example.test/report.pdf",
  })),
  createReport: vi.fn(async () => ({})),
}));
vi.mock("@/lib/data/jobs", () => ({
  finalizeServiceSheet: vi.fn(async (id: string) => ({
    id,
    site_id: "site1",
    job_status: "completed",
    pest_species: [],
  })),
  saveServiceSheet: vi.fn(),
  // Filled sheet — these tests pin EMAIL behaviour; the L0 invariant
  // (approve rejects unfilled sheets) is pinned separately in
  // approve-sheet-guard.test.ts, so here the guard must pass.
  getJobById: vi.fn(async (id: string) => ({
    id,
    site_id: "site1",
    job_status: "in_progress",
    findings: "f",
    recommendations: "r",
    pesticides_used: "None",
    risk_level: "low",
    risk_comments: "none",
    pest_species: ["Rat"],
    method_used: ["Inspection"],
  })),
  createBooking: vi.fn(async () => ({})),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => ({ id: "op" })),
}));

import { onJobCompleted } from "@/lib/services/job-events";
import { approveServiceSheetAction } from "@/app/(app)/jobs/[id]/complete/actions";

const JOB = {
  id: "job1",
  site_id: "site1",
  job_status: "completed",
  value: null,
  is_invoiced: true, // keep the auto-invoice branch out of these pins
  pest_species: [],
} as never;

const CTX = { customerId: "cust1", siteId: "site1" };

beforeEach(() => {
  sendServiceReportMock.mockClear();
});

describe("onJobCompleted — auto-send is dead by default", () => {
  it("default opts → NO email, even with a report PDF + customer email present", async () => {
    await onJobCompleted(JOB, CTX);
    expect(sendServiceReportMock).not.toHaveBeenCalled();
  });

  it("explicit sendReportEmail: false → no email", async () => {
    await onJobCompleted(JOB, CTX, { sendReportEmail: false });
    expect(sendServiceReportMock).not.toHaveBeenCalled();
  });

  it("explicit sendReportEmail: true → the opt-in still works (one send)", async () => {
    await onJobCompleted(JOB, CTX, { sendReportEmail: true });
    expect(sendServiceReportMock).toHaveBeenCalledTimes(1);
  });
});

describe("approveServiceSheetAction — Complete & Email is the single owner", () => {
  it("sendEmail: true → EXACTLY one email", async () => {
    const res = await approveServiceSheetAction("job1", { sendEmail: true });
    expect(res.success).toBe(true);
    expect(sendServiceReportMock).toHaveBeenCalledTimes(1);
  });

  it("sendEmail: false → NO email at all", async () => {
    const res = await approveServiceSheetAction("job1", { sendEmail: false });
    expect(res.success).toBe(true);
    expect(sendServiceReportMock).not.toHaveBeenCalled();
  });
});

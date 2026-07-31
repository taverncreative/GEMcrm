/**
 * onJobCompleted creates NO invoice (slice 2a, 2026-07-31).
 *
 * This file used to pin the opposite: a completed job with a value
 * auto-created an invoice and rendered its PDF inline. Nate does his real
 * invoicing in QuickBooks and never used the in-app one — prod accumulated
 * 9 invoices, 0 ever sent, the most recent minted three days before this
 * change off a £2 job — so the whole path was removed. The replacement is
 * the `needs_invoice` checklist (migration 041), which touches no invoice
 * table at all.
 *
 * The file is KEPT rather than deleted, inverted into a regression guard:
 * it is the thing that fails if anyone re-adds invoice creation to job
 * completion. The invoice modules are still mocked so that a re-introduced
 * import would be observable here rather than hitting a real client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/constants/feature-flags", () => ({
  REVIEW_REQUESTS_ENABLED: false,
}));
vi.mock("@/lib/data/tasks", () => ({
  hasPendingTaskOfType: vi.fn(async () => false),
  createTask: vi.fn(async () => ({})),
}));
vi.mock("@/lib/data/customers", () => ({
  getCustomerById: vi.fn(async () => ({ id: "cust1", name: "Nat", email: null })),
}));
vi.mock("@/lib/data/sites", () => ({
  getSiteById: vi.fn(async () => ({
    id: "site1",
    customer_id: "cust1",
    address_line_1: "1 Test Way",
  })),
}));
vi.mock("@/lib/data/reports", () => ({
  getReportByJobId: vi.fn(async () => null),
}));

const createInvoiceForJob = vi.fn(async () => ({ id: "inv1" }));
const getInvoiceByJobId = vi.fn(async () => null);
vi.mock("@/lib/data/invoices", () => ({
  getInvoiceByJobId: (...a: unknown[]) => getInvoiceByJobId(...(a as [])),
  createInvoiceForJob: (...a: unknown[]) => createInvoiceForJob(...(a as [])),
}));

const renderAndStoreInvoicePdf = vi.fn(async () => ({
  pdfUrl: "https://x/inv.pdf",
  customerId: "cust1",
}));
vi.mock("@/lib/services/invoice-pdf", () => ({
  renderAndStoreInvoicePdf: (...a: unknown[]) =>
    renderAndStoreInvoicePdf(...(a as [])),
}));
vi.mock("@/lib/services/email", () => ({
  sendServiceReport: vi.fn(async () => ({ success: true })),
}));

import { onJobCompleted } from "@/lib/services/job-events";

const CTX = { customerId: "cust1", siteId: "site1" };
const valuedJob = {
  id: "job1",
  site_id: "site1",
  job_status: "completed",
  value: 105,
  is_invoiced: false,
  pest_species: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("onJobCompleted no longer creates invoices", () => {
  it("a completed job WITH a value creates no invoice and no PDF", async () => {
    await onJobCompleted(valuedJob as never, CTX);
    expect(createInvoiceForJob).not.toHaveBeenCalled();
    expect(renderAndStoreInvoicePdf).not.toHaveBeenCalled();
    // Not even a lookup: the whole block is gone, not merely guarded.
    expect(getInvoiceByJobId).not.toHaveBeenCalled();
  });

  it("a large value changes nothing — the amount was never the gate", async () => {
    await onJobCompleted({ ...valuedJob, value: 5000 } as never, CTX);
    expect(createInvoiceForJob).not.toHaveBeenCalled();
  });

  it("a completed job with NO value likewise creates nothing", async () => {
    await onJobCompleted({ ...valuedJob, value: null } as never, CTX);
    expect(createInvoiceForJob).not.toHaveBeenCalled();
    expect(renderAndStoreInvoicePdf).not.toHaveBeenCalled();
  });

  it("an already-invoiced job creates nothing (unchanged)", async () => {
    await onJobCompleted({ ...valuedJob, is_invoiced: true } as never, CTX);
    expect(createInvoiceForJob).not.toHaveBeenCalled();
    expect(renderAndStoreInvoicePdf).not.toHaveBeenCalled();
  });

  it("completion still resolves cleanly with the invoice step gone", async () => {
    await expect(
      onJobCompleted(valuedJob as never, CTX)
    ).resolves.toBeUndefined();
  });
});

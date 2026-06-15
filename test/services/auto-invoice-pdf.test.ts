/**
 * onJobCompleted auto-invoice (migration 037): when a completed job has a
 * value and isn't already invoiced, the side-effect must create the invoice
 * AND render+store its PDF inline, so an auto-invoice comes out complete
 * rather than bare. PDF generation is best-effort — a render failure is
 * swallowed and never blocks completion.
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

describe("onJobCompleted auto-invoice PDF", () => {
  it("creates the invoice AND renders its PDF inline", async () => {
    await onJobCompleted(valuedJob as never, CTX);
    expect(createInvoiceForJob).toHaveBeenCalledWith("job1", "cust1", 105);
    expect(renderAndStoreInvoicePdf).toHaveBeenCalledWith("inv1");
  });

  it("a PDF render failure is swallowed (never blocks completion)", async () => {
    renderAndStoreInvoicePdf.mockRejectedValueOnce(new Error("chromium boom"));
    await expect(
      onJobCompleted(valuedJob as never, CTX)
    ).resolves.toBeUndefined();
    expect(createInvoiceForJob).toHaveBeenCalledTimes(1);
  });

  it("no value / already invoiced → no invoice, no PDF", async () => {
    await onJobCompleted(
      { ...valuedJob, is_invoiced: true } as never,
      CTX
    );
    expect(createInvoiceForJob).not.toHaveBeenCalled();
    expect(renderAndStoreInvoicePdf).not.toHaveBeenCalled();
  });
});

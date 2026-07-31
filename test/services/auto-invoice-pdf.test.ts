/**
 * onJobCompleted creates NO invoice (slice 2a, tightened in 2c).
 *
 * This file used to pin the opposite: a completed job with a value
 * auto-created an invoice and rendered its PDF inline. Nate does his real
 * invoicing in QuickBooks and never used the in-app one — prod accumulated
 * 9 invoices, 0 ever sent — so the whole path was removed. The replacement
 * is the `needs_invoice` checklist (migration 041), which touches no
 * invoice table at all.
 *
 * 2a inverted this file into a regression guard and kept mocking the
 * invoice modules, so that a re-introduced import would be observable here.
 * 2c DELETED those modules outright, so there is nothing left to mock: a
 * re-introduced import would now fail to resolve at build time, which is a
 * stronger guarantee than any mock. What remains worth asserting is that
 * completing a job still runs cleanly, and still produces exactly the side
 * effects it should (no invoice among them).
 *
 * The structural guards in test/services/no-invoice-creation-path.test.ts
 * and test/documents/no-invoice-surface.test.ts cover the source tree.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/constants/feature-flags", () => ({
  REVIEW_REQUESTS_ENABLED: false,
}));

const createTask = vi.fn(async () => ({}));
vi.mock("@/lib/data/tasks", () => ({
  hasPendingTaskOfType: vi.fn(async () => false),
  createTask: (...a: unknown[]) => createTask(...(a as [])),
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

const sendServiceReport = vi.fn(async () => ({ success: true }));
vi.mock("@/lib/services/email", () => ({
  sendServiceReport: (...a: unknown[]) => sendServiceReport(...(a as [])),
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
  it("a completed job WITH a value completes cleanly and bills nothing", async () => {
    await expect(
      onJobCompleted(valuedJob as never, CTX)
    ).resolves.toBeUndefined();
  });

  it("a large value changes nothing — the amount was never the gate", async () => {
    await expect(
      onJobCompleted({ ...valuedJob, value: 5000 } as never, CTX)
    ).resolves.toBeUndefined();
  });

  it("a completed job with NO value likewise", async () => {
    await expect(
      onJobCompleted({ ...valuedJob, value: null } as never, CTX)
    ).resolves.toBeUndefined();
  });

  it("an already-invoiced job likewise (the legacy flag is inert)", async () => {
    await expect(
      onJobCompleted({ ...valuedJob, is_invoiced: true } as never, CTX)
    ).resolves.toBeUndefined();
  });

  it("emails nothing by default — the sheet owns that choice", async () => {
    await onJobCompleted(valuedJob as never, CTX);
    expect(sendServiceReport).not.toHaveBeenCalled();
  });

  it("creates no task either, with review requests flagged off", async () => {
    await onJobCompleted(valuedJob as never, CTX);
    expect(createTask).not.toHaveBeenCalled();
  });
});

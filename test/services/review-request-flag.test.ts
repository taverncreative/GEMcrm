/**
 * REVIEW_REQUESTS_ENABLED gate (client request, 2026-06).
 *
 * Completing a job must NOT auto-create a "review_request" task while the
 * flag is off — and MUST again when it's on (proving the logic is gated,
 * not ripped out, so re-enabling is a one-line change). The flag module is
 * mocked via a live getter so both states run in one file; every other
 * onJobCompleted dependency is stubbed and the job carries no value/report,
 * so the ONLY createTask the test could observe is the review one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const flag = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/lib/constants/feature-flags", () => ({
  get REVIEW_REQUESTS_ENABLED() {
    return flag.enabled;
  },
}));

const createTaskMock = vi.fn(async () => ({}));
vi.mock("@/lib/data/tasks", () => ({
  hasPendingTaskOfType: vi.fn(async () => false),
  createTask: (...args: unknown[]) =>
    (createTaskMock as unknown as (...a: unknown[]) => Promise<unknown>)(
      ...args
    ),
}));
vi.mock("@/lib/data/customers", () => ({
  getCustomerById: vi.fn(async () => ({
    id: "cust1",
    name: "Test Customer",
    email: null,
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
  getReportByJobId: vi.fn(async () => null),
}));
vi.mock("@/lib/data/invoices", () => ({
  getInvoiceByJobId: vi.fn(async () => null),
  createInvoiceForJob: vi.fn(async () => ({})),
}));
vi.mock("@/lib/services/email", () => ({
  sendServiceReport: vi.fn(async () => ({ success: true })),
}));

import { onJobCompleted } from "@/lib/services/job-events";

// value null + is_invoiced true → invoice branch skipped; no report +
// default sendReportEmail → no email. So review is the only possible task.
const JOB = {
  id: "job1",
  site_id: "site1",
  job_status: "completed",
  value: null,
  is_invoiced: true,
  pest_species: [],
} as never;
const CTX = { customerId: "cust1", siteId: "site1" };

const reviewTaskCalls = (): Array<[{ task_type?: string }]> => {
  const calls = createTaskMock.mock.calls as unknown as Array<
    [{ task_type?: string }]
  >;
  return calls.filter((c) => c[0]?.task_type === "review_request");
};

beforeEach(() => {
  createTaskMock.mockClear();
  flag.enabled = false;
});

describe("REVIEW_REQUESTS_ENABLED gate", () => {
  it("OFF → completing a job creates NO review_request task", async () => {
    flag.enabled = false;
    await onJobCompleted(JOB, CTX);
    expect(reviewTaskCalls()).toHaveLength(0);
  });

  it("ON → completing a job DOES create a review_request task (logic intact, reversible)", async () => {
    flag.enabled = true;
    await onJobCompleted(JOB, CTX);
    const calls = reviewTaskCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][0].task_type).toBe("review_request");
  });
});

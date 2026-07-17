/**
 * L3 email truthfulness — server side.
 *
 * Pins:
 *   1. approve + sendEmail with an address → exactly one send, outcome
 *      RECORDED (markReportEmailed) — truth written only on success.
 *   2. send failure → completion still succeeds, nothing recorded
 *      (replay safety: email problems never fail/strand a completion).
 *   3. no-address completion → exactly ONE "Email service report…"
 *      follow-up task; deduped on replay; and the completion succeeds.
 *   4. sendReportNowAction is multi-recipient: one send to the given
 *      list, records the joined string, re-send is allowed (guard
 *      relaxed), and any invalid address hard-blocks the send.
 *   5. setCustomerEmailAction validates and normalises.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendServiceReportMock = vi.fn(
  async (): Promise<{ success: boolean; error?: string }> => ({ success: true })
);
const markReportEmailedMock = vi.fn(async () => undefined);
const createTaskMock = vi.fn(async () => ({}));
const hasPendingEmailReportTaskMock = vi.fn(async () => false);
const getJobByIdMock = vi.fn();
const updateCustomerEmailMock = vi.fn(async () => undefined);
const getCustomerByIdMock = vi.fn();

const FILLED_FIELDS = {
  findings: "f",
  recommendations: "r",
  pesticides_used: "None",
  risk_level: "low",
  risk_comments: "none",
  pest_species: ["Rat"],
  method_used: ["Inspection"],
};

vi.mock("@/lib/data/jobs", () => ({
  finalizeServiceSheet: vi.fn(async (id: string) => ({
    id,
    site_id: "site1",
    job_status: "completed",
    value: null,
    is_invoiced: true,
    ...FILLED_FIELDS,
  })),
  saveServiceSheet: vi.fn(),
  getJobById: (...args: unknown[]) =>
    (getJobByIdMock as unknown as (...a: unknown[]) => Promise<unknown>)(
      ...args
    ),
  markReportEmailed: (...args: unknown[]) =>
    (markReportEmailedMock as unknown as (...a: unknown[]) => Promise<unknown>)(
      ...args
    ),
  createBooking: vi.fn(async () => ({})),
}));
vi.mock("@/lib/data/tasks", () => ({
  hasPendingTaskOfType: vi.fn(async () => true), // review task exists → skip
  hasPendingEmailReportTask: (...args: unknown[]) =>
    (hasPendingEmailReportTaskMock as unknown as (
      ...a: unknown[]
    ) => Promise<unknown>)(...args),
  createTask: (...args: unknown[]) =>
    (createTaskMock as unknown as (...a: unknown[]) => Promise<unknown>)(
      ...args
    ),
}));
vi.mock("@/lib/data/sites", () => ({
  getSiteById: vi.fn(async () => ({
    id: "site1",
    customer_id: "cust1",
    address_line_1: "1 Test Way",
    town: "Testville",
  })),
}));
vi.mock("@/lib/data/customers", () => ({
  getCustomerById: (...args: unknown[]) =>
    (getCustomerByIdMock as unknown as (...a: unknown[]) => Promise<unknown>)(
      ...args
    ),
  updateCustomerEmail: (...args: unknown[]) =>
    (updateCustomerEmailMock as unknown as (
      ...a: unknown[]
    ) => Promise<unknown>)(...args),
}));
vi.mock("@/lib/data/reports", () => ({
  getReportByJobId: vi.fn(async () => ({
    id: "rep1",
    job_id: "job1",
    pdf_url: "https://example.test/service-sheet.pdf",
  })),
  createReport: vi.fn(async () => ({})),
}));
vi.mock("@/lib/services/email", () => ({
  sendServiceReport: (...args: unknown[]) =>
    (sendServiceReportMock as unknown as (...a: unknown[]) => Promise<unknown>)(
      ...args
    ),
}));
vi.mock("@/lib/pdf/generate-job-report", () => ({
  generateJobReport: vi.fn(async () => Buffer.from("pdf")),
}));
vi.mock("@/lib/storage/upload", () => ({
  uploadPdf: vi.fn(async () => "https://example.test/service-sheet.pdf"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => ({ id: "op" })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}));

import { approveServiceSheetAction } from "@/app/(app)/jobs/[id]/complete/actions";
import { sendReportNowAction } from "@/app/(app)/jobs/[id]/report/actions";
import { setCustomerEmailAction } from "@/app/(app)/customers/actions";

const JOB = {
  id: "job1",
  site_id: "site1",
  job_status: "in_progress",
  report_emailed_to: null,
  value: null,
  is_invoiced: true,
  ...FILLED_FIELDS,
};

const WITH_EMAIL = { id: "cust1", name: "Test", email: "c@example.test" };
const NO_EMAIL = { id: "cust1", name: "Test", email: null };

beforeEach(() => {
  sendServiceReportMock.mockClear();
  sendServiceReportMock.mockResolvedValue({ success: true });
  markReportEmailedMock.mockClear();
  createTaskMock.mockClear();
  hasPendingEmailReportTaskMock.mockClear();
  hasPendingEmailReportTaskMock.mockResolvedValue(false);
  getJobByIdMock.mockReset();
  getJobByIdMock.mockResolvedValue(JOB);
  getCustomerByIdMock.mockReset();
  getCustomerByIdMock.mockResolvedValue(WITH_EMAIL);
  updateCustomerEmailMock.mockClear();
});

describe("approve — outcome recorded only on a real send", () => {
  it("sendEmail with address → one send, recorded", async () => {
    const res = await approveServiceSheetAction("job1", { sendEmail: true });
    expect(res.success).toBe(true);
    expect(sendServiceReportMock).toHaveBeenCalledTimes(1);
    expect(markReportEmailedMock).toHaveBeenCalledTimes(1);
    expect(markReportEmailedMock).toHaveBeenCalledWith(
      "job1",
      "c@example.test"
    );
    expect(res.emailedTo).toBe("c@example.test");
  });

  it("send FAILURE → completion still succeeds, nothing recorded", async () => {
    sendServiceReportMock.mockResolvedValue({ success: false, error: "down" });
    const res = await approveServiceSheetAction("job1", { sendEmail: true });
    expect(res.success).toBe(true);
    expect(markReportEmailedMock).not.toHaveBeenCalled();
    expect(res.emailedTo ?? null).toBeNull();
  });
});

describe("approve — no-address completion surfaces a task, exactly once", () => {
  it("creates ONE 'Email service report' follow-up task and still completes", async () => {
    getCustomerByIdMock.mockResolvedValue(NO_EMAIL);
    const res = await approveServiceSheetAction("job1", { sendEmail: false });
    expect(res.success).toBe(true);
    expect(createTaskMock).toHaveBeenCalledTimes(1);
    const arg = (createTaskMock.mock.calls[0] as unknown[])[0] as {
      title: string;
    };
    expect(arg.title).toMatch(/^Email service report/);
    expect(sendServiceReportMock).not.toHaveBeenCalled();
  });

  it("replay (pending task already exists) → no duplicate task", async () => {
    getCustomerByIdMock.mockResolvedValue(NO_EMAIL);
    hasPendingEmailReportTaskMock.mockResolvedValue(true);
    const res = await approveServiceSheetAction("job1", { sendEmail: false });
    expect(res.success).toBe(true);
    expect(createTaskMock).not.toHaveBeenCalled();
  });
});

describe("sendReportNowAction — multi-recipient", () => {
  it("sends to the given recipients (one send) and records the joined list", async () => {
    const res = await sendReportNowAction("job1", [
      "a@example.test",
      "b@example.test",
    ]);
    expect(res.success).toBe(true);
    expect(res.emailedTo).toBe("a@example.test, b@example.test");
    // One send, recipient list forwarded to sendServiceReport as the 3rd arg
    // (4th arg: the job date for the attachment filename — undefined here,
    // the mocked job has no job_date).
    expect(sendServiceReportMock).toHaveBeenCalledTimes(1);
    expect(sendServiceReportMock).toHaveBeenCalledWith(
      WITH_EMAIL,
      "https://example.test/service-sheet.pdf",
      ["a@example.test", "b@example.test"],
      undefined
    );
    expect(markReportEmailedMock).toHaveBeenCalledWith(
      "job1",
      "a@example.test, b@example.test"
    );
  });

  it("re-send after a prior send is ALLOWED (guard relaxed)", async () => {
    getJobByIdMock.mockResolvedValue({
      ...JOB,
      report_emailed_to: "old@example.test",
    });
    const res = await sendReportNowAction("job1", ["new@example.test"]);
    expect(res.success).toBe(true);
    expect(res.emailedTo).toBe("new@example.test");
    expect(sendServiceReportMock).toHaveBeenCalledTimes(1); // NOT a no-op
    expect(markReportEmailedMock).toHaveBeenCalledWith(
      "job1",
      "new@example.test"
    );
  });

  it("one invalid address → hard-block, nothing sent, names the bad one", async () => {
    const res = await sendReportNowAction("job1", [
      "a@example.test",
      "not-an-email",
    ]);
    expect(res.success).toBe(false);
    expect(res.message).toContain("not-an-email");
    expect(sendServiceReportMock).not.toHaveBeenCalled();
    expect(markReportEmailedMock).not.toHaveBeenCalled();
  });

  it("empty recipient list → blocked, nothing sent", async () => {
    const res = await sendReportNowAction("job1", []);
    expect(res.success).toBe(false);
    expect(sendServiceReportMock).not.toHaveBeenCalled();
  });
});

describe("setCustomerEmailAction — the inline Add email", () => {
  it("invalid address → rejected, no write", async () => {
    const res = await setCustomerEmailAction("cust1", "not-an-email");
    expect(res.success).toBe(false);
    expect(updateCustomerEmailMock).not.toHaveBeenCalled();
  });

  it("valid address → saved (trimmed)", async () => {
    const res = await setCustomerEmailAction("cust1", "  New@Example.test ");
    expect(res.success).toBe(true);
    expect(updateCustomerEmailMock).toHaveBeenCalledWith(
      "cust1",
      "New@Example.test".trim()
    );
  });
});

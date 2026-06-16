/**
 * Offline complete-with-send → reconnect, the full canonical sequence.
 *
 * Drives the REAL drain over two queued entries — an offline email capture
 * (setCustomerDocDetailsAction) and the completion (completeServiceSheetAction)
 * — through the real registry, with the data layer + side-effects doubled at
 * the boundary (email, PDF, tasks, reports). The customer store is STATEFUL:
 * the email-save writes it, the completion reads it, so the assertions hinge
 * on the email landing FIRST.
 *
 *   - Happy : email entered at the prompt → queued before the completion →
 *     drain lands the email first → the completion replay finds it, SENDS the
 *     report, does NOT create the no-email task, no duplicate.
 *   - Cancel: prompt cancelled (no email) → only the completion is queued →
 *     replay finds no email → NO send, the no-email follow-up task IS created
 *     (the manual send-now path takes over once an email is added).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  customers: {} as Record<
    string,
    { id: string; name: string; email: string | null }
  >,
  sendServiceReport: vi.fn(
    async (): Promise<{ success: boolean }> => ({ success: true })
  ),
  createTask: vi.fn(async () => ({})),
  hasPendingEmailReportTask: vi.fn(async () => false),
  markReportEmailed: vi.fn(async () => undefined),
}));

const FILLED = {
  findings: "All clear",
  recommendations: "Maintain",
  pesticides_used: "None",
  risk_level: "low",
  risk_comments: "Low risk",
  pest_species: ["Rat"],
  method_used: ["Inspection"],
};
const JOB = {
  id: "job1",
  site_id: "site1",
  job_status: "in_progress",
  report_emailed_to: null,
  value: null,
  is_invoiced: true,
  ...FILLED,
};

vi.mock("@/lib/data/jobs", () => ({
  getJobById: vi.fn(async () => JOB),
  saveServiceSheet: vi.fn(async () => JOB),
  finalizeServiceSheet: vi.fn(async () => ({ ...JOB, job_status: "completed" })),
  markReportEmailed: h.markReportEmailed,
  createBooking: vi.fn(async () => ({})),
}));
vi.mock("@/lib/data/tasks", () => ({
  hasPendingEmailReportTask: h.hasPendingEmailReportTask,
  createTask: h.createTask,
  hasPendingTaskOfType: vi.fn(async () => true), // review task exists → skip
}));
vi.mock("@/lib/data/sites", () => ({
  getSiteById: vi.fn(async () => ({
    id: "site1",
    customer_id: "cust1",
    address_line_1: "1 Test Way",
  })),
}));
vi.mock("@/lib/data/customers", () => ({
  getCustomerById: vi.fn(async (id: string) => h.customers[id] ?? null),
  updateCustomerDocDetails: vi.fn(
    async (id: string, details: { email?: string }) => {
      const c = h.customers[id];
      if (c && details.email !== undefined) {
        c.email = details.email.trim().toLowerCase();
      }
    }
  ),
}));
vi.mock("@/lib/data/reports", () => ({
  getReportByJobId: vi.fn(async () => ({
    id: "rep1",
    job_id: "job1",
    pdf_url: "https://example.test/r.pdf",
  })),
  createReport: vi.fn(async () => ({})),
}));
vi.mock("@/lib/services/email", () => ({
  sendServiceReport: h.sendServiceReport,
}));
vi.mock("@/lib/pdf/generate-job-report", () => ({
  generateJobReport: vi.fn(async () => Buffer.from("pdf")),
}));
vi.mock("@/lib/storage/upload", () => ({
  uploadPdf: vi.fn(async () => "https://example.test/r.pdf"),
}));
vi.mock("@/lib/services/job-events", () => ({
  onJobCompleted: vi.fn(async () => undefined),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => ({ id: "op" })),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));

import { enqueueAction } from "@/lib/db/outbox";
import { drainOutbox } from "@/lib/sync/push";
import { db } from "@/lib/db";

// What the wrapped completion stores as outbox args — a filled sheet that
// passes ServiceSheetSchema, with finalize + send_email on.
const COMPLETION_ARGS: Record<string, string> = {
  job_id: "job1",
  call_type: "routine",
  pest_species: JSON.stringify(["Rat"]),
  method_used: JSON.stringify(["Inspection"]),
  findings: "All clear",
  recommendations: "Maintain",
  report_notes: "",
  pesticides_used: "None",
  risk_level: "low",
  risk_comments: "Low risk",
  photo_data_urls: "[]",
  technician_signature: "data:image/png;base64,AAA",
  client_present: "false",
  client_signature: "",
  client_name: "",
  finalize: "true",
  send_email: "true",
};

beforeEach(async () => {
  h.sendServiceReport.mockClear();
  h.sendServiceReport.mockResolvedValue({ success: true });
  h.createTask.mockClear();
  h.hasPendingEmailReportTask.mockClear();
  h.hasPendingEmailReportTask.mockResolvedValue(false);
  h.markReportEmailed.mockClear();
  h.customers = { cust1: { id: "cust1", name: "BSK Ltd", email: null } };
  await db.outbox.clear();
});

describe("offline complete-with-send → reconnect", () => {
  it("email entered → drains first → completion sends, no task, no duplicate", async () => {
    // Offline: the gate captured the email (queued FIRST), then the
    // completion was dispatched (queued second).
    await enqueueAction({
      action_name: "setCustomerDocDetailsAction",
      args: ["cust1", { email: "ops@bsk.test" }],
      entity_type: "customer",
      entity_id: "cust1",
    });
    await enqueueAction({
      action_name: "completeServiceSheetAction",
      args: COMPLETION_ARGS,
      entity_type: "job",
      entity_id: "job1",
    });
    expect(await db.outbox.count()).toBe(2);
    expect(h.customers.cust1.email).toBeNull(); // nothing synced yet

    // Reconnect: real drain.
    const res = await drainOutbox();
    expect(res.succeeded).toBe(2);
    expect(res.failed).toBe(0);

    // The email-save landed FIRST, so the completion replay found the email…
    expect(h.customers.cust1.email).toBe("ops@bsk.test");
    expect(h.sendServiceReport).toHaveBeenCalledTimes(1);
    expect(h.markReportEmailed).toHaveBeenCalledWith("job1", "ops@bsk.test");
    // …and did NOT fall back to the no-email task.
    expect(h.createTask).not.toHaveBeenCalled();
    // Both entries drained cleanly — no stuck, no duplicate.
    expect(await db.outbox.count()).toBe(0);
  });

  it("prompt cancelled (no email) → completion replays → no send, no-email task IS created", async () => {
    // Only the completion is queued — the operator declined to add an email.
    await enqueueAction({
      action_name: "completeServiceSheetAction",
      args: COMPLETION_ARGS,
      entity_type: "job",
      entity_id: "job1",
    });

    const res = await drainOutbox();
    expect(res.succeeded).toBe(1);

    // No email on file → nothing sent; the follow-up task is the backstop
    // (manual send-now handles it once an email is added).
    expect(h.sendServiceReport).not.toHaveBeenCalled();
    expect(h.createTask).toHaveBeenCalledTimes(1);
    const taskArg = (h.createTask.mock.calls[0] as unknown[])[0] as {
      title: string;
    };
    expect(taskArg.title).toMatch(/^Email service report/);
    expect(await db.outbox.count()).toBe(0);
  });
});

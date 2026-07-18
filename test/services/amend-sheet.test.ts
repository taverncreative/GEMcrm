/**
 * L2 amend flow — completeServiceSheetAction with amend="true".
 *
 * Amend edits an ALREADY-COMPLETED sheet: fields update, the PDF
 * regenerates, job_status is never touched, and the completion side
 * effects (finalize → onJobCompleted review task / invoice) never
 * re-fire. Email goes out only on the explicit "Save & Email" choice —
 * default OFF.
 *
 * Also pins the re-drain distinction: a non-amend finalize entry
 * replayed against a completed job is still SKIPPED (crash-recovery
 * protection), while an amend entry against the same completed job is
 * NOT skipped — its save runs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const finalizeServiceSheetMock = vi.fn();
const saveServiceSheetMock = vi.fn();
const getJobByIdMock = vi.fn();
const generateJobReportMock = vi.fn(async () => Buffer.from("pdf"));
const sendServiceReportMock = vi.fn(async () => ({ success: true }));

vi.mock("@/lib/data/jobs", () => ({
  finalizeServiceSheet: (...args: unknown[]) =>
    (finalizeServiceSheetMock as unknown as (...a: unknown[]) => Promise<unknown>)(
      ...args
    ),
  saveServiceSheet: (...args: unknown[]) =>
    (saveServiceSheetMock as unknown as (...a: unknown[]) => Promise<unknown>)(
      ...args
    ),
  getJobById: (...args: unknown[]) =>
    (getJobByIdMock as unknown as (...a: unknown[]) => Promise<unknown>)(
      ...args
    ),
  createBooking: vi.fn(async () => ({})),
  markReportEmailed: vi.fn(async () => undefined),
}));
vi.mock("@/lib/data/sites", () => ({
  getSiteById: vi.fn(async () => ({
    id: "site1",
    customer_id: "cust1",
    address_line_1: "1 Test Way",
  })),
}));
vi.mock("@/lib/data/customers", () => ({
  getCustomerById: vi.fn(async () => ({
    id: "cust1",
    name: "Test Customer",
    email: "customer@example.test",
  })),
}));
vi.mock("@/lib/data/reports", () => ({
  getReportByJobId: vi.fn(async () => ({
    id: "rep1",
    job_id: "job1",
    pdf_url: "https://example.test/service-sheet.pdf",
  })),
  createReport: vi.fn(async () => ({})),
}));
vi.mock("@/lib/data/tasks", () => ({
  hasPendingTaskOfType: vi.fn(async () => true),
  hasPendingEmailReportTask: vi.fn(async () => false),
  createTask: vi.fn(async () => ({})),
}));
vi.mock("@/lib/services/email", () => ({
  sendServiceReport: (...args: unknown[]) =>
    (sendServiceReportMock as unknown as (...a: unknown[]) => Promise<unknown>)(
      ...args
    ),
}));
vi.mock("@/lib/pdf/generate-job-report", () => ({
  generateJobReport: (...args: unknown[]) =>
    (generateJobReportMock as unknown as (...a: unknown[]) => Promise<unknown>)(
      ...args
    ),
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

import { revalidatePath } from "next/cache";
import { completeServiceSheetAction } from "@/app/(app)/jobs/[id]/complete/actions";

const COMPLETED_JOB = {
  id: "job1",
  site_id: "site1",
  job_status: "completed",
  findings: "Original findings",
  recommendations: "Original recommendations",
  pesticides_used: "None",
  risk_level: "low",
  risk_comments: "None",
  pest_species: ["Rat"],
  method_used: ["Inspection"],
  value: null,
  is_invoiced: true,
};

const INITIAL = { success: false, errors: {}, message: null };

/** Zod-valid sheet payload; flags supplied per test. */
const sheetFormData = (flags: Record<string, string>) => {
  const fd = new FormData();
  fd.set("job_id", "job1");
  fd.set("call_type", "routine");
  fd.set("pest_species", JSON.stringify(["Rat"]));
  fd.set("findings", "Amended findings");
  fd.set("recommendations", "Amended recommendations");
  fd.set("method_used", JSON.stringify(["Inspection"]));
  fd.set("pesticides_used", "None");
  fd.set("risk_level", "low");
  fd.set("risk_comments", "None");
  fd.set("technician_signature", "data:image/png;base64,sig");
  for (const [k, v] of Object.entries(flags)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  finalizeServiceSheetMock.mockReset();
  saveServiceSheetMock.mockReset();
  saveServiceSheetMock.mockResolvedValue({ ...COMPLETED_JOB });
  getJobByIdMock.mockReset();
  getJobByIdMock.mockResolvedValue(COMPLETED_JOB);
  generateJobReportMock.mockClear();
  sendServiceReportMock.mockClear();
  vi.mocked(revalidatePath).mockClear();
});

describe("amend entries — not skipped, no finalize, PDF regenerates", () => {
  it("amend on a completed job → fields saved + PDF regenerated, finalize never runs", async () => {
    const res = await completeServiceSheetAction(
      INITIAL,
      sheetFormData({ amend: "true" })
    );

    expect(res.success).toBe(true);
    expect(res.finalized).toBe(false);
    expect(saveServiceSheetMock).toHaveBeenCalledTimes(1);
    expect(generateJobReportMock).toHaveBeenCalledTimes(1);
    expect(finalizeServiceSheetMock).not.toHaveBeenCalled();
  });

  // Perf (revalidatePath slice 1): the amend path returns before the finalize
  // branch, and the job detail/list are Dexie-live, so it must NOT purge the
  // client router cache (prefetch stampede). The fresh-finalize path keeps its
  // revalidate via approveServiceSheetAction — that's Slice 4, untouched here.
  it("amend does NOT call revalidatePath", async () => {
    await completeServiceSheetAction(INITIAL, sheetFormData({ amend: "true" }));
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("amend email default OFF → nothing sent", async () => {
    await completeServiceSheetAction(INITIAL, sheetFormData({ amend: "true" }));
    expect(sendServiceReportMock).not.toHaveBeenCalled();
  });

  it("amend with explicit Save & Email → exactly one send", async () => {
    await completeServiceSheetAction(
      INITIAL,
      sheetFormData({ amend: "true", send_email: "true" })
    );
    expect(sendServiceReportMock).toHaveBeenCalledTimes(1);
  });
});

describe("crash-recovery re-drain protection stays intact for non-amend entries", () => {
  it("finalize entry replayed against a completed job → skipped (no re-finalize, no email)", async () => {
    const res = await completeServiceSheetAction(
      INITIAL,
      sheetFormData({ finalize: "true", send_email: "true" })
    );

    expect(res.success).toBe(true);
    expect(res.finalized).toBe(true); // reported as done…
    expect(finalizeServiceSheetMock).not.toHaveBeenCalled(); // …without re-running
    expect(sendServiceReportMock).not.toHaveBeenCalled();
  });
});

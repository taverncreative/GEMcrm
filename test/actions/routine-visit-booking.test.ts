/**
 * "Schedule next routine visit" (Sign-off card) — the approve action's
 * booking side effects. Pins:
 *   - routine booking: call_type "routine", the chosen date, NO parent
 *     (fresh top-level reference), inherited pests, same site;
 *   - follow-up + routine ticked together → BOTH bookings created (the
 *     follow-up keeps its parent_job_id chaining);
 *   - a JobClashError on either booking is surfaced as a NAMED warning
 *     while the completion still succeeds (bookings stay best-effort);
 *   - the cadence default helper: 365/frequency days, else 30.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const createBookingMock = vi.fn(
  async (_input: {
    site_id: string;
    job_date: string;
    call_type: string;
    parent_job_id?: string;
    pest_species: string[];
  }) => ({})
);

vi.mock("@/lib/data/jobs", () => ({
  finalizeServiceSheet: vi.fn(async (id: string) => ({
    id,
    site_id: "site1",
    job_status: "completed",
    value: null,
    is_invoiced: true,
    pest_species: ["Rat"],
    findings: "f",
    recommendations: "r",
    pesticides_used: "None",
    risk_level: "low",
    risk_comments: "none",
    method_used: ["Inspection"],
  })),
  saveServiceSheet: vi.fn(),
  getJobById: vi.fn(async () => ({
    id: "job1",
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
  markReportEmailed: vi.fn(),
  createBooking: (...a: unknown[]) =>
    (createBookingMock as unknown as (...x: unknown[]) => Promise<unknown>)(
      ...a
    ),
  // Defined inside the factory (vi.mock is hoisted above top-level vars);
  // the action's `instanceof JobClashError` resolves against THIS class.
  JobClashError: class JobClashError extends Error {},
}));
vi.mock("@/lib/data/tasks", () => ({
  hasPendingTaskOfType: vi.fn(async () => true),
  hasPendingEmailReportTask: vi.fn(async () => true),
  createTask: vi.fn(async () => ({})),
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
  getCustomerById: vi.fn(async () => ({
    id: "cust1",
    name: "Test",
    email: "c@example.test",
  })),
  updateCustomerEmail: vi.fn(),
}));
vi.mock("@/lib/data/reports", () => ({
  getReportByJobId: vi.fn(async () => ({
    id: "rep1",
    job_id: "job1",
    pdf_url: "https://example.test/sheet.pdf",
  })),
  createReport: vi.fn(async () => ({})),
}));
vi.mock("@/lib/services/email", () => ({
  sendServiceReport: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/lib/services/job-events", () => ({
  onJobCompleted: vi.fn(async () => undefined),
}));
vi.mock("@/lib/pdf/generate-job-report", () => ({
  generateJobReport: vi.fn(async () => Buffer.from("pdf")),
}));
vi.mock("@/lib/storage/upload", () => ({
  uploadPdf: vi.fn(async () => "https://example.test/sheet.pdf"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => ({ id: "op" })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}));

import { approveServiceSheetAction } from "@/app/(app)/jobs/[id]/complete/actions";
import { JobClashError } from "@/lib/data/jobs";
import { nextRoutineOffsetDays } from "@/lib/services/agreement-schedule";

beforeEach(() => {
  createBookingMock.mockReset();
  createBookingMock.mockResolvedValue({});
});

describe("approveServiceSheetAction — routine visit booking", () => {
  it("books the routine: call_type routine, chosen date, NO parent, inherited pests", async () => {
    const res = await approveServiceSheetAction("job1", {
      scheduleRoutine: true,
      routineDate: "2026-08-15",
    });
    expect(res.success).toBe(true);
    expect(res.warnings).toBeUndefined();
    expect(createBookingMock).toHaveBeenCalledTimes(1);
    const arg = createBookingMock.mock.calls[0][0];
    expect(arg.call_type).toBe("routine");
    expect(arg.job_date).toBe("2026-08-15");
    expect(arg.site_id).toBe("site1");
    expect(arg.parent_job_id).toBe(""); // fresh top-level reference
    expect(arg.pest_species).toEqual(["Rat"]);
  });

  it("both cards ticked → both bookings, follow-up chained + routine not", async () => {
    const res = await approveServiceSheetAction("job1", {
      scheduleFollowUp: true,
      followUpDate: "2026-08-01",
      scheduleRoutine: true,
      routineDate: "2026-10-01",
    });
    expect(res.success).toBe(true);
    expect(createBookingMock).toHaveBeenCalledTimes(2);
    const [followUp, routine] = createBookingMock.mock.calls.map((c) => c[0]);
    expect(followUp.call_type).toBe("followup");
    expect(followUp.parent_job_id).toBe("job1");
    expect(routine.call_type).toBe("routine");
    expect(routine.parent_job_id).toBe("");
  });

  it("a clash surfaces a NAMED warning and completion still succeeds", async () => {
    createBookingMock.mockRejectedValueOnce(new JobClashError("clash"));
    const res = await approveServiceSheetAction("job1", {
      scheduleRoutine: true,
      routineDate: "2026-08-15",
    });
    expect(res.success).toBe(true); // best-effort: completion unharmed
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings![0]).toContain("Routine visit on 2026-08-15");
    expect(res.warnings![0]).toContain("already has a routine visit");
  });

  it("one clash of two: the other booking still lands, warning names the failed one", async () => {
    createBookingMock
      .mockRejectedValueOnce(new JobClashError("clash")) // follow-up fails
      .mockResolvedValueOnce({}); // routine lands
    const res = await approveServiceSheetAction("job1", {
      scheduleFollowUp: true,
      followUpDate: "2026-08-01",
      scheduleRoutine: true,
      routineDate: "2026-10-01",
    });
    expect(res.success).toBe(true);
    expect(createBookingMock).toHaveBeenCalledTimes(2);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings![0]).toContain("Follow-up visit on 2026-08-01");
  });
});

describe("nextRoutineOffsetDays — the cadence default", () => {
  it("follows the agreement cadence: 365/frequency", () => {
    expect(nextRoutineOffsetDays(4)).toBe(91); // quarterly
    expect(nextRoutineOffsetDays(12)).toBe(30); // monthly
    expect(nextRoutineOffsetDays(52)).toBe(7); // weekly
  });

  it("defaults to 30 days with no agreement", () => {
    expect(nextRoutineOffsetDays(null)).toBe(30);
    expect(nextRoutineOffsetDays(undefined)).toBe(30);
    expect(nextRoutineOffsetDays(0)).toBe(30);
  });
});

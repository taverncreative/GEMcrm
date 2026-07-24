/**
 * Unfilled-sheet gate on report generation (follow-on to the
 * Generate-Report scare).
 *
 * A report PDF must never be produced from an unfilled service sheet —
 * it renders as a placeholder. The gate lives in two places that must
 * agree:
 *
 *   1. isServiceSheetFilled — the shared predicate (button disabled
 *      state + server action both use it). Filled = every content
 *      field ServiceSheetSchema requires, signature excluded.
 *   2. generateReportAction — rejects an unfilled job server-side
 *      WITHOUT invoking the PDF pipeline, so a stale page can't slip
 *      a placeholder through.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const generateJobReportMock = vi.fn(async () => Buffer.from("pdf"));
const uploadPdfMock = vi.fn(async () => "https://example.test/r.pdf");
const createReportMock = vi.fn(async () => ({}));
const getJobByIdMock = vi.fn();

vi.mock("@/lib/pdf/generate-job-report", () => ({
  generateJobReport: (...args: unknown[]) =>
    (generateJobReportMock as unknown as (...a: unknown[]) => Promise<unknown>)(
      ...args
    ),
}));
vi.mock("@/lib/storage/upload", () => ({
  uploadPdf: (...args: unknown[]) =>
    (uploadPdfMock as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
}));
vi.mock("@/lib/data/reports", () => ({
  createReport: (...args: unknown[]) =>
    (createReportMock as unknown as (...a: unknown[]) => Promise<unknown>)(
      ...args
    ),
  getReportByJobId: vi.fn(async () => null),
}));
vi.mock("@/lib/data/jobs", () => ({
  getJobById: (...args: unknown[]) =>
    (getJobByIdMock as unknown as (...a: unknown[]) => Promise<unknown>)(
      ...args
    ),
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
    email: null,
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => ({ id: "op" })),
}));

import { isServiceSheetFilled } from "@/lib/validation/service-sheet";
import { generateReportAction } from "@/app/(app)/jobs/[id]/report/actions";
import { INITIAL_ACTION_STATE } from "@/types/actions";

// Migration 047: products/pesticides are NO LONGER required — a survey visit
// with zero products is a valid completed sheet. isServiceSheetFilled + the DB
// constraint + ServiceSheetSchema all dropped that field together.
const FILLED = {
  findings: "Evidence of rodent activity in loft",
  recommendations: "Proof external entry points",
  risk_level: "low",
  risk_comments: "No access risks",
  pest_species: ["Rat"],
  method_used: ["Inspection"],
};

const UNFILLED = {
  findings: null,
  recommendations: null,
  risk_level: null,
  risk_comments: null,
  pest_species: [] as string[],
  method_used: [] as string[],
};

const formDataFor = (jobId: string) => {
  const fd = new FormData();
  fd.set("job_id", jobId);
  return fd;
};

beforeEach(() => {
  generateJobReportMock.mockClear();
  uploadPdfMock.mockClear();
  createReportMock.mockClear();
  getJobByIdMock.mockReset();
});

describe("isServiceSheetFilled", () => {
  it("true for a sheet completed through the app's flow", () => {
    expect(isServiceSheetFilled(FILLED)).toBe(true);
  });

  it("false for an untouched sheet (dropdown-completed job)", () => {
    expect(isServiceSheetFilled(UNFILLED)).toBe(false);
  });

  it("false when any single required content field is missing", () => {
    expect(isServiceSheetFilled({ ...FILLED, findings: null })).toBe(false);
    expect(isServiceSheetFilled({ ...FILLED, findings: "   " })).toBe(false);
    expect(isServiceSheetFilled({ ...FILLED, recommendations: null })).toBe(
      false
    );
    expect(isServiceSheetFilled({ ...FILLED, risk_level: null })).toBe(false);
    expect(isServiceSheetFilled({ ...FILLED, risk_comments: null })).toBe(
      false
    );
    expect(isServiceSheetFilled({ ...FILLED, pest_species: [] })).toBe(false);
    expect(isServiceSheetFilled({ ...FILLED, method_used: [] })).toBe(false);
  });

  it("stays filled with NO products (a valid survey/inspection visit)", () => {
    // FILLED carries no products at all — migration 047 makes that valid.
    expect(isServiceSheetFilled(FILLED)).toBe(true);
  });
});

describe("generateReportAction — server-side gate", () => {
  it("unfilled sheet → rejected, PDF pipeline never invoked", async () => {
    getJobByIdMock.mockResolvedValue({ id: "job1", site_id: "site1", ...UNFILLED });

    const res = await generateReportAction(
      INITIAL_ACTION_STATE,
      formDataFor("job1")
    );

    expect(res.success).toBe(false);
    expect(res.message).toMatch(/sheet not filled/i);
    expect(generateJobReportMock).not.toHaveBeenCalled();
    expect(uploadPdfMock).not.toHaveBeenCalled();
    expect(createReportMock).not.toHaveBeenCalled();
  });

  it("filled sheet → report generated, uploaded, recorded", async () => {
    getJobByIdMock.mockResolvedValue({ id: "job1", site_id: "site1", ...FILLED });

    const res = await generateReportAction(
      INITIAL_ACTION_STATE,
      formDataFor("job1")
    );

    expect(res.success).toBe(true);
    expect(generateJobReportMock).toHaveBeenCalledTimes(1);
    expect(uploadPdfMock).toHaveBeenCalledTimes(1);
    expect(createReportMock).toHaveBeenCalledTimes(1);
  });
});

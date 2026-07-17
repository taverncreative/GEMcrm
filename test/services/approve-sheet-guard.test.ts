/**
 * L0 server invariant: a job can only become completed with a FILLED
 * service sheet. approveServiceSheetAction is the choke point — every
 * completion route funnels through it (the combined sheet path, the
 * two-step approve, and outbox replays of either), so pinning it here
 * makes completed × unfilled unreachable through any action.
 *
 * Pins:
 *   1. Standalone approve on an unfilled sheet → rejected, job NEVER
 *      finalized (the stranded-job shape can't be created any more).
 *   2. Approve on a filled sheet → proceeds (invariant doesn't
 *      over-block the legitimate flow).
 *   3. Combined path with a filled submission → finalized.
 *   4. Replay of a stale unfilled-finalize entry → rejected at Zod
 *      before any write; the action returns success:false (a non-throw
 *      failure), which is what the outbox retries and then surfaces in
 *      the conflicts inbox — never a silent empty completion.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const finalizeServiceSheetMock = vi.fn();
const saveServiceSheetMock = vi.fn();
const getJobByIdMock = vi.fn();
const getSiteByIdMock = vi.fn();

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
  getSiteById: (...args: unknown[]) =>
    (getSiteByIdMock as unknown as (...a: unknown[]) => Promise<unknown>)(
      ...args
    ),
}));
vi.mock("@/lib/data/customers", () => ({
  // The customer DOES carry an address — proving the guard reads the SITE
  // only, so the customer-address fallback can't satisfy completion.
  getCustomerById: vi.fn(async () => ({
    id: "cust1",
    name: "Test Customer",
    email: null,
    address_line_1: "99 Customer Home",
    town: "Customerton",
  })),
}));
vi.mock("@/lib/data/reports", () => ({
  getReportByJobId: vi.fn(async () => null),
  createReport: vi.fn(async () => ({})),
}));
vi.mock("@/lib/data/tasks", () => ({
  hasPendingTaskOfType: vi.fn(async () => true), // review task exists → skip
  hasPendingEmailReportTask: vi.fn(async () => false),
  createTask: vi.fn(async () => ({})),
}));
vi.mock("@/lib/services/email", () => ({
  sendServiceReport: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/lib/pdf/generate-job-report", () => ({
  generateJobReport: vi.fn(async () => Buffer.from("pdf")),
}));
vi.mock("@/lib/storage/upload", () => ({
  uploadPdf: vi.fn(async () => "https://example.test/r.pdf"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => ({ id: "op" })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}));

import {
  approveServiceSheetAction,
  completeServiceSheetAction,
} from "@/app/(app)/jobs/[id]/complete/actions";

const FILLED_JOB = {
  id: "job1",
  site_id: "site1",
  job_status: "in_progress",
  findings: "Evidence of rodent activity",
  recommendations: "Proof entry points",
  pesticides_used: "None",
  risk_level: "low",
  risk_comments: "None",
  pest_species: ["Rat"],
  method_used: ["Inspection"],
  value: null,
  is_invoiced: true,
};

const UNFILLED_JOB = {
  ...FILLED_JOB,
  findings: null,
  recommendations: null,
  pesticides_used: null,
  risk_level: null,
  risk_comments: null,
  pest_species: [] as string[],
  method_used: [] as string[],
};

/** A full, Zod-valid finalize submission (the combined path). */
const filledFormData = () => {
  const fd = new FormData();
  fd.set("job_id", "job1");
  fd.set("call_type", "routine");
  fd.set("pest_species", JSON.stringify(["Rat"]));
  fd.set("findings", "Evidence of rodent activity");
  fd.set("recommendations", "Proof entry points");
  fd.set("method_used", JSON.stringify(["Inspection"]));
  fd.set("pesticides_used", "None");
  fd.set("risk_level", "low");
  fd.set("risk_comments", "None");
  fd.set("technician_signature", "data:image/png;base64,sig");
  fd.set("finalize", "true");
  return fd;
};

/** A stale unfilled-finalize replay: finalize=true, sheet fields empty. */
const unfilledFormData = () => {
  const fd = new FormData();
  fd.set("job_id", "job1");
  fd.set("finalize", "true");
  return fd;
};

const INITIAL = { success: false, errors: {}, message: null };

beforeEach(() => {
  finalizeServiceSheetMock.mockReset();
  finalizeServiceSheetMock.mockImplementation(async (id: unknown) => ({
    ...FILLED_JOB,
    id,
    job_status: "completed",
  }));
  saveServiceSheetMock.mockReset();
  saveServiceSheetMock.mockResolvedValue({ ...FILLED_JOB });
  getJobByIdMock.mockReset();
  // Default: the SITE carries a usable address (line 1 + town).
  getSiteByIdMock.mockReset();
  getSiteByIdMock.mockResolvedValue({
    id: "site1",
    customer_id: "cust1",
    address_line_1: "1 Test Way",
    town: "Testville",
  });
});

describe("approveServiceSheetAction — L0 filled-sheet invariant", () => {
  it("unfilled sheet → rejected, finalize never runs", async () => {
    getJobByIdMock.mockResolvedValue(UNFILLED_JOB);

    const res = await approveServiceSheetAction("job1");

    expect(res.success).toBe(false);
    expect(res.message).toMatch(/sheet not filled/i);
    expect(finalizeServiceSheetMock).not.toHaveBeenCalled();
  });

  it("filled sheet → finalize proceeds", async () => {
    getJobByIdMock.mockResolvedValue(FILLED_JOB);

    const res = await approveServiceSheetAction("job1");

    expect(res.success).toBe(true);
    expect(finalizeServiceSheetMock).toHaveBeenCalledTimes(1);
  });
});

describe("approveServiceSheetAction — L0 site-address invariant", () => {
  it("site has NO address → rejected even though the customer has one; finalize never runs", async () => {
    getJobByIdMock.mockResolvedValue(FILLED_JOB);
    getSiteByIdMock.mockResolvedValue({
      id: "site1",
      customer_id: "cust1",
      address_line_1: null,
      town: null,
    });

    const res = await approveServiceSheetAction("job1");

    expect(res.success).toBe(false);
    expect(res.message).toMatch(/site has no address/i);
    expect(finalizeServiceSheetMock).not.toHaveBeenCalled();
  });

  it("site has line 1 but no town → rejected", async () => {
    getJobByIdMock.mockResolvedValue(FILLED_JOB);
    getSiteByIdMock.mockResolvedValue({
      id: "site1",
      customer_id: "cust1",
      address_line_1: "1 Test Way",
      town: "   ", // whitespace is blank
    });

    const res = await approveServiceSheetAction("job1");

    expect(res.success).toBe(false);
    expect(finalizeServiceSheetMock).not.toHaveBeenCalled();
  });

  it("site has line 1 + town → finalize proceeds", async () => {
    getJobByIdMock.mockResolvedValue(FILLED_JOB);
    // default mock already carries a usable address

    const res = await approveServiceSheetAction("job1");

    expect(res.success).toBe(true);
    expect(finalizeServiceSheetMock).toHaveBeenCalledTimes(1);
  });
});

describe("completeServiceSheetAction — combined path and stale replays", () => {
  it("filled submission with finalize → saved and finalized", async () => {
    getJobByIdMock.mockResolvedValue(FILLED_JOB);

    const res = await completeServiceSheetAction(INITIAL, filledFormData());

    expect(res.success).toBe(true);
    expect(res.finalized).toBe(true);
    expect(saveServiceSheetMock).toHaveBeenCalledTimes(1);
    expect(finalizeServiceSheetMock).toHaveBeenCalledTimes(1);
  });

  it("stale unfilled-finalize replay → rejected before any write (outbox sees failure → conflicts inbox)", async () => {
    getJobByIdMock.mockResolvedValue(UNFILLED_JOB);

    const res = await completeServiceSheetAction(INITIAL, unfilledFormData());

    expect(res.success).toBe(false);
    // Zod field errors — the rejection happens at validation, before
    // saveServiceSheet or finalize can touch the job.
    expect(Object.keys(res.errors).length).toBeGreaterThan(0);
    expect(saveServiceSheetMock).not.toHaveBeenCalled();
    expect(finalizeServiceSheetMock).not.toHaveBeenCalled();
  });

  it("offline replay whose server SITE has no address → NOT finalized, returns failure (→ conflicts inbox)", async () => {
    // A filled, Zod-valid submission replays on the server, but the
    // server's copy of the site has no address (e.g. the site-edit outbox
    // entry hasn't replayed yet). The sheet fields save (in_progress), but
    // the address guard blocks finalize: the action returns success:false,
    // so the outbox entry stays alive and, after retries, lands in the
    // conflicts inbox — never a silent address-less completion.
    getJobByIdMock.mockResolvedValue(FILLED_JOB);
    getSiteByIdMock.mockResolvedValue({
      id: "site1",
      customer_id: "cust1",
      address_line_1: null,
      town: null,
    });

    const res = await completeServiceSheetAction(INITIAL, filledFormData());

    expect(res.success).toBe(false);
    expect(res.message).toMatch(/site has no address/i);
    // Save ran (idempotent, in_progress); finalize did NOT — the job stays
    // un-completed until a site address exists.
    expect(saveServiceSheetMock).toHaveBeenCalledTimes(1);
    expect(finalizeServiceSheetMock).not.toHaveBeenCalled();
  });
});

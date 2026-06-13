/**
 * Quick job capture (Q2) — server action.
 *
 * captureQuickJobAction creates a DRAFT job from a phrase + date +
 * window, with no customer/site. Pins:
 *   1. valid input → createDraftJob called with the parsed fields and
 *      the client job id (so server == local on replay).
 *   2. blank phrase → rejected, nothing created (no contentless ghost).
 *   3. missing date → rejected (job_date is NOT NULL).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const createDraftJobMock = vi.fn(async () => ({ id: "job1" }));

vi.mock("@/lib/data/jobs", () => ({
  createDraftJob: (...args: unknown[]) =>
    (createDraftJobMock as unknown as (...a: unknown[]) => Promise<unknown>)(
      ...args
    ),
  // Other exports referenced by the actions module at import time.
  createBooking: vi.fn(),
  JobClashError: class JobClashError extends Error {},
}));
vi.mock("@/lib/data/customers", () => ({
  createCustomer: vi.fn(),
  getCustomerById: vi.fn(),
  searchCustomers: vi.fn(),
  getCustomers: vi.fn(),
}));
vi.mock("@/lib/data/sites", () => ({
  createSite: vi.fn(),
  getSiteById: vi.fn(),
  getSitesByCustomer: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => ({ id: "op" })),
}));

import { captureQuickJobAction } from "@/app/(app)/bookings/actions";

const INITIAL = { success: false, errors: {}, message: null };

const fd = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

beforeEach(() => {
  createDraftJobMock.mockClear();
});

describe("captureQuickJobAction", () => {
  it("valid → creates a draft with the parsed fields + client id", async () => {
    const res = await captureQuickJobAction(
      INITIAL,
      fd({
        job_id: "client-uuid-1",
        capture_note: "Sarah, Wasps, Folkestone",
        job_date: "2026-06-20",
        job_time: "09:00",
        job_time_end: "12:00",
      })
    );

    expect(res.success).toBe(true);
    expect(createDraftJobMock).toHaveBeenCalledTimes(1);
    const [input, opts] = createDraftJobMock.mock.calls[0] as unknown as [
      Record<string, string>,
      { id?: string },
    ];
    expect(input).toMatchObject({
      capture_note: "Sarah, Wasps, Folkestone",
      job_date: "2026-06-20",
      job_time: "09:00",
      job_time_end: "12:00",
    });
    expect(opts.id).toBe("client-uuid-1");
  });

  it("blank phrase → rejected, nothing created", async () => {
    const res = await captureQuickJobAction(
      INITIAL,
      fd({ capture_note: "   ", job_date: "2026-06-20" })
    );
    expect(res.success).toBe(false);
    expect(res.errors.capture_note).toBeTruthy();
    expect(createDraftJobMock).not.toHaveBeenCalled();
  });

  it("missing date → rejected", async () => {
    const res = await captureQuickJobAction(
      INITIAL,
      fd({ capture_note: "Wasps", job_date: "" })
    );
    expect(res.success).toBe(false);
    expect(res.errors.job_date).toBeTruthy();
    expect(createDraftJobMock).not.toHaveBeenCalled();
  });
});

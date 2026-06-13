/**
 * upgradeDraftToBookingAction (Q3) — server action.
 *
 * Reuses createQuickBookingAction's customer → site resolution, then swaps
 * the final step from createBooking (INSERT) to upgradeDraftJob (guarded
 * UPDATE on the draft addressed by `draft_job_id`). Pins:
 *   1. valid existing customer+site → upgradeDraftJob called with the draft
 *      id and the resolved booking; success;
 *   2. missing draft_job_id → rejected, no upgrade attempted;
 *   3. a JobClashError surfaces as the SAME {success:false, errors:{job_date},
 *      message} shape createBooking's callers use, so it flows through the
 *      existing conflict-inbox path (classifyActionResult builds the message).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted so the (hoisted) vi.mock factory below can reference them.
const { FakeJobClashError, upgradeDraftJobMock } = vi.hoisted(() => {
  class FakeJobClashError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "JobClashError";
    }
  }
  return {
    FakeJobClashError,
    upgradeDraftJobMock: vi.fn(
      async () => ({ id: "draft-1", job_status: "scheduled" }) as unknown
    ),
  };
});

vi.mock("@/lib/data/jobs", () => ({
  upgradeDraftJob: (...args: unknown[]) =>
    (upgradeDraftJobMock as unknown as (...a: unknown[]) => Promise<unknown>)(
      ...args
    ),
  createBooking: vi.fn(),
  createDraftJob: vi.fn(),
  JobClashError: FakeJobClashError,
}));
vi.mock("@/lib/data/customers", () => ({
  createCustomer: vi.fn(async () => ({ id: "cust-new" })),
  getCustomerById: vi.fn(async () => ({ id: "cust-existing" })),
  searchCustomers: vi.fn(),
  getCustomers: vi.fn(),
}));
vi.mock("@/lib/data/sites", () => ({
  createSite: vi.fn(async () => ({ id: "site-new" })),
  getSiteById: vi.fn(async () => ({
    id: "site-existing",
    customer_id: "cust-existing",
  })),
  getSitesByCustomer: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => ({ id: "op" })),
}));

import { upgradeDraftToBookingAction } from "@/app/(app)/bookings/actions";

const INITIAL = { success: false, errors: {}, message: null };

const fd = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

const existingFields = {
  draft_job_id: "draft-1",
  mode_customer: "existing",
  mode_site: "existing",
  customer_id: "cust-existing",
  site_id: "site-existing",
  job_date: "2026-07-01",
  call_type: "routine",
};

beforeEach(() => {
  vi.clearAllMocks();
  upgradeDraftJobMock.mockResolvedValue({
    id: "draft-1",
    job_status: "scheduled",
  });
});

describe("upgradeDraftToBookingAction", () => {
  it("existing customer+site → upgrades the draft, returns success", async () => {
    const res = await upgradeDraftToBookingAction(INITIAL, fd(existingFields));

    expect(res.success).toBe(true);
    expect(upgradeDraftJobMock).toHaveBeenCalledTimes(1);
    const [draftId, booking] = upgradeDraftJobMock.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(draftId).toBe("draft-1");
    expect(booking).toMatchObject({
      site_id: "site-existing",
      job_date: "2026-07-01",
      call_type: "routine",
    });
  });

  it("missing draft_job_id → rejected, no upgrade attempted", async () => {
    const res = await upgradeDraftToBookingAction(
      INITIAL,
      fd({
        mode_customer: "existing",
        mode_site: "existing",
        customer_id: "cust-existing",
        site_id: "site-existing",
        job_date: "2026-07-01",
        call_type: "routine",
      })
    );

    expect(res.success).toBe(false);
    expect(res.message).toBe("Missing draft job id");
    expect(upgradeDraftJobMock).not.toHaveBeenCalled();
  });

  it("clash → {success:false, errors:{job_date}, message} (flows to conflict inbox)", async () => {
    upgradeDraftJobMock.mockRejectedValueOnce(
      new FakeJobClashError(
        "A booking of this call type already exists for this site on this date."
      )
    );

    const res = await upgradeDraftToBookingAction(INITIAL, fd(existingFields));

    expect(res.success).toBe(false);
    expect(res.errors.job_date).toBeTruthy();
    expect(res.message).toContain("already exists");
  });
});

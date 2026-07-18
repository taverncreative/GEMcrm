/**
 * L1 single-completion-route rule, server side.
 *
 * updateJobStatusAction may move a job to in_progress and NOTHING else:
 * completion exists only through the service sheet (whose L0 invariant
 * requires a filled sheet). A stale outbox replay carrying
 * status=completed from an old client build must land here and be
 * rejected — never silently complete a job.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const updateJobStatusMock = vi.fn(async () => undefined);

vi.mock("@/lib/data/jobs", () => ({
  updateJobStatus: (...args: unknown[]) =>
    (updateJobStatusMock as unknown as (...a: unknown[]) => Promise<unknown>)(
      ...args
    ),
  getJobById: vi.fn(async () => null),
}));
vi.mock("@/lib/data/reports", () => ({
  getReportByJobId: vi.fn(async () => null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => ({ id: "op" })),
}));

import { revalidatePath } from "next/cache";
import { updateJobStatusAction } from "@/app/(app)/jobs/[id]/actions";

const INITIAL = { success: false, errors: {}, message: null };

const fd = (status: string) => {
  const f = new FormData();
  f.set("job_id", "job1");
  f.set("status", status);
  return f;
};

beforeEach(() => {
  updateJobStatusMock.mockClear();
  vi.mocked(revalidatePath).mockClear();
});

describe("updateJobStatusAction — L1 target restriction", () => {
  it("completed → rejected with the sheet message, no write", async () => {
    const res = await updateJobStatusAction(INITIAL, fd("completed"));
    expect(res.success).toBe(false);
    expect(res.message).toBe("Complete this job via its service sheet.");
    expect(updateJobStatusMock).not.toHaveBeenCalled();
  });

  it("scheduled (downgrade) → invalid, no write", async () => {
    const res = await updateJobStatusAction(INITIAL, fd("scheduled"));
    expect(res.success).toBe(false);
    expect(res.message).toBe("Invalid status");
    expect(updateJobStatusMock).not.toHaveBeenCalled();
  });

  it("in_progress → accepted, written once", async () => {
    const res = await updateJobStatusAction(INITIAL, fd("in_progress"));
    expect(res.success).toBe(true);
    expect(updateJobStatusMock).toHaveBeenCalledTimes(1);
    expect(updateJobStatusMock).toHaveBeenCalledWith("job1", "in_progress");
  });

  // Perf (revalidatePath slice 1): jobs list + detail are Dexie-live and the
  // status button wrote the change to Dexie optimistically, so the action must
  // NOT purge the client router cache (prefetch stampede).
  it("does NOT call revalidatePath on a successful status change", async () => {
    await updateJobStatusAction(INITIAL, fd("in_progress"));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

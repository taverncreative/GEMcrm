/**
 * rescheduleJob (data fn) + rescheduleJobAction — the date/time move.
 *
 * Pins, against an in-memory `jobs` table whose supabase stub honours the
 * exact `.update(payload).eq("id").neq("job_status","completed")` chain:
 *   1. it writes job_date + job_time + job_time_end + updated_at;
 *   2. blank times fold to null (emptyToNull), a set time is kept;
 *   3. a COMPLETED job is never moved (the neq guard matches zero rows);
 *   4. a 23505 (partial-unique clash on the new slot) surfaces as
 *      JobClashError — the server backstop;
 *   5. the action requires auth and returns success on the happy path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;

let jobsRows: Row[] = [];
let forcedError: { code: string; message: string } | null = null;

// Builder honouring update(payload).eq().neq(), awaited for { data, error }.
function makeTable() {
  let payload: Row | null = null;
  const filters: Array<(r: Row) => boolean> = [];
  const builder = {
    update(p: Row) {
      payload = p;
      return builder;
    },
    eq(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return builder;
    },
    neq(col: string, val: unknown) {
      filters.push((r) => r[col] !== val);
      return builder;
    },
    // Thenable: applying the update resolves to the PostgREST-shaped result.
    then(resolve: (v: { data: Row[] | null; error: unknown }) => void) {
      if (forcedError) {
        resolve({ data: null, error: forcedError });
        return;
      }
      const matched = jobsRows.filter((r) => filters.every((f) => f(r)));
      for (const r of matched) Object.assign(r, payload);
      resolve({ data: matched.map((r) => ({ ...r })), error: null });
    },
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => makeTable() }),
}));

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(async () => ({ id: "op" })),
}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: requireUserMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { revalidatePath } from "next/cache";
import { rescheduleJob, JobClashError } from "@/lib/data/jobs";
import { rescheduleJobAction } from "@/app/(app)/jobs/[id]/actions";

const SCHEDULED = "11111111-1111-4111-8111-111111111111";
const DONE = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  forcedError = null;
  requireUserMock.mockReset();
  requireUserMock.mockResolvedValue({ id: "op" });
  vi.mocked(revalidatePath).mockClear();
  jobsRows = [
    {
      id: SCHEDULED,
      job_status: "scheduled",
      job_date: "2026-07-01",
      job_time: "09:00:00",
      job_time_end: "10:00:00",
      updated_at: "2026-07-01T00:00:00.000Z",
    },
    {
      id: DONE,
      job_status: "completed",
      job_date: "2026-07-01",
      job_time: "09:00:00",
      job_time_end: null,
      updated_at: "2026-07-01T00:00:00.000Z",
    },
  ];
});

describe("rescheduleJob", () => {
  it("moves date + time window and stamps updated_at", async () => {
    await rescheduleJob(SCHEDULED, {
      job_date: "2026-07-05",
      job_time: "13:00",
      job_time_end: "14:30",
    });
    const row = jobsRows.find((r) => r.id === SCHEDULED)!;
    expect(row.job_date).toBe("2026-07-05");
    expect(row.job_time).toBe("13:00");
    expect(row.job_time_end).toBe("14:30");
    expect(row.updated_at).not.toBe("2026-07-01T00:00:00.000Z");
  });

  it("folds a blank time window to null (all-day)", async () => {
    await rescheduleJob(SCHEDULED, {
      job_date: "2026-07-05",
      job_time: "",
      job_time_end: "",
    });
    const row = jobsRows.find((r) => r.id === SCHEDULED)!;
    expect(row.job_date).toBe("2026-07-05");
    expect(row.job_time).toBeNull();
    expect(row.job_time_end).toBeNull();
  });

  it("never moves a completed job (neq guard matches zero rows)", async () => {
    await rescheduleJob(DONE, {
      job_date: "2026-07-05",
      job_time: "13:00",
      job_time_end: "",
    });
    const row = jobsRows.find((r) => r.id === DONE)!;
    expect(row.job_date).toBe("2026-07-01"); // untouched
    expect(row.job_time).toBe("09:00:00");
  });

  it("maps a 23505 partial-unique clash to JobClashError", async () => {
    forcedError = { code: "23505", message: "duplicate key" };
    await expect(
      rescheduleJob(SCHEDULED, {
        job_date: "2026-07-05",
        job_time: "13:00",
        job_time_end: "",
      })
    ).rejects.toBeInstanceOf(JobClashError);
  });
});

describe("rescheduleJobAction", () => {
  function fd(fields: Record<string, string>) {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  }

  it("requires auth — rejects and writes nothing when unauthenticated", async () => {
    requireUserMock.mockRejectedValueOnce(new Error("Unauthorized"));
    await expect(
      rescheduleJobAction(
        { success: false, errors: {}, message: null },
        fd({ job_id: SCHEDULED, job_date: "2026-07-05" })
      )
    ).rejects.toThrow("Unauthorized");
    expect(jobsRows.find((r) => r.id === SCHEDULED)!.job_date).toBe("2026-07-01");
  });

  it("moves the job and returns success on the happy path", async () => {
    const res = await rescheduleJobAction(
      { success: false, errors: {}, message: null },
      fd({
        job_id: SCHEDULED,
        job_date: "2026-07-09",
        job_time: "11:00",
        job_time_end: "",
      })
    );
    expect(res.success).toBe(true);
    const row = jobsRows.find((r) => r.id === SCHEDULED)!;
    expect(row.job_date).toBe("2026-07-09");
    expect(row.job_time).toBe("11:00");
  });

  // Perf (revalidatePath slice 1): the reschedule modal wrote the new date to
  // Dexie and the job detail/list re-render off useLiveQuery, so the action
  // must NOT purge the client router cache (prefetch stampede).
  it("does NOT call revalidatePath on a successful reschedule", async () => {
    await rescheduleJobAction(
      { success: false, errors: {}, message: null },
      fd({ job_id: SCHEDULED, job_date: "2026-07-09", job_time: "11:00", job_time_end: "" })
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a missing date without touching the table", async () => {
    const res = await rescheduleJobAction(
      { success: false, errors: {}, message: null },
      fd({ job_id: SCHEDULED, job_date: "" })
    );
    expect(res.success).toBe(false);
    expect(res.message).toBeTruthy();
    expect(jobsRows.find((r) => r.id === SCHEDULED)!.job_date).toBe("2026-07-01");
  });
});

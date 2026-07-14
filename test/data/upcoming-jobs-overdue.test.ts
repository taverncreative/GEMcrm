/**
 * getUpcomingJobs — overdue visits stay on the list (Nate's "red and angry").
 *
 * The list is now "things still on my plate": scheduled/in_progress,
 * non-deleted, non-archived jobs from a 90-DAY FLOOR onwards, most-overdue
 * first. Pins:
 *   - a past-date scheduled job WITHIN 90 days is included (it used to drop
 *     off once its date passed);
 *   - a scheduled job OLDER than 90 days is excluded (no ancient bookings);
 *   - a COMPLETED past job is excluded (done means gone);
 *   - deleted / archived jobs never appear;
 *   - order is ascending job_date (most-overdue at the top).
 *
 * The supabase stub honours the exact chain the data layer uses:
 *   select("*..").is().gte().in().eq().order().order().limit()
 * Filters are AND-ed; orders applied in call order; limit resolves.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

type Row = Record<string, unknown>;

let jobRows: Row[] = [];

// Pin "today" to 2026-07-12 so the 90-day floor is deterministic. The floor
// dateUkOffset(-90) lands on 2026-04-13.
vi.mock("@/lib/utils/today-uk", () => ({
  todayUk: () => "2026-07-12",
  dateUkOffset: (n: number) => {
    const base = new Date("2026-07-12T12:00:00Z");
    base.setUTCDate(base.getUTCDate() + n);
    return base.toISOString().slice(0, 10);
  },
}));

function makeQuery() {
  const filters: Array<(r: Row) => boolean> = [];
  const orders: Array<{ col: string; ascending: boolean }> = [];

  const matched = () => {
    let rows = jobRows.filter((r) => filters.every((f) => f(r)));
    for (const o of [...orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const av = a[o.col] as string | number;
        const bv = b[o.col] as string | number;
        if (av === bv) return 0;
        const cmp = av < bv ? -1 : 1;
        return o.ascending ? cmp : -cmp;
      });
    }
    return rows;
  };

  const builder = {
    select() {
      return builder;
    },
    is(col: string, val: unknown) {
      filters.push((r) => (r[col] ?? null) === val);
      return builder;
    },
    gte(col: string, val: unknown) {
      filters.push((r) => (r[col] as string) >= (val as string));
      return builder;
    },
    in(col: string, vals: unknown[]) {
      filters.push((r) => vals.includes(r[col]));
      return builder;
    },
    eq(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return builder;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orders.push({ col, ascending: opts?.ascending ?? true });
      return builder;
    },
    limit(n: number) {
      return Promise.resolve({ data: matched().slice(0, n), error: null });
    },
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => makeQuery() }),
}));

import { getUpcomingJobs } from "@/lib/data/jobs";

const base = {
  deleted_at: null,
  is_archived: false,
  created_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  jobRows = [
    // Overdue but within 90 days (7 days ago) — MUST stay visible.
    { id: "overdue_recent", job_date: "2026-07-05", job_status: "scheduled", ...base },
    // Overdue, in_progress, within 90 days — also stays.
    { id: "overdue_inprog", job_date: "2026-06-20", job_status: "in_progress", ...base },
    // Older than 90 days (Jan 1, ~192 days) — dropped by the floor.
    { id: "ancient", job_date: "2026-01-01", job_status: "scheduled", ...base },
    // Today — normal.
    { id: "today", job_date: "2026-07-12", job_status: "scheduled", ...base },
    // Future — normal.
    { id: "future", job_date: "2026-08-01", job_status: "scheduled", ...base },
    // Completed in the recent past — done means gone.
    { id: "completed_recent", job_date: "2026-07-05", job_status: "completed", ...base },
    // Archived / deleted recent scheduled — never appear.
    { id: "archived", job_date: "2026-07-05", job_status: "scheduled", ...base, is_archived: true },
    { id: "deleted", job_date: "2026-07-05", job_status: "scheduled", ...base, deleted_at: "2026-07-06T00:00:00Z" },
  ];
});

describe("getUpcomingJobs — overdue visits within the 90-day floor stay", () => {
  it("includes a past-date scheduled job within 90 days", async () => {
    const ids = (await getUpcomingJobs(500)).map((j) => j.id);
    expect(ids).toContain("overdue_recent");
    expect(ids).toContain("overdue_inprog");
  });

  it("excludes a scheduled job older than 90 days", async () => {
    const ids = (await getUpcomingJobs(500)).map((j) => j.id);
    expect(ids).not.toContain("ancient");
  });

  it("excludes a completed past job", async () => {
    const ids = (await getUpcomingJobs(500)).map((j) => j.id);
    expect(ids).not.toContain("completed_recent");
  });

  it("excludes archived and deleted jobs", async () => {
    const ids = (await getUpcomingJobs(500)).map((j) => j.id);
    expect(ids).not.toContain("archived");
    expect(ids).not.toContain("deleted");
  });

  it("returns the survivors most-overdue first (ascending date)", async () => {
    const ids = (await getUpcomingJobs(500)).map((j) => j.id);
    expect(ids).toEqual([
      "overdue_inprog", // 2026-06-20
      "overdue_recent", // 2026-07-05
      "today", // 2026-07-12
      "future", // 2026-08-01
    ]);
  });
});

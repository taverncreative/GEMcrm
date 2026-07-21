/**
 * findJobsInRangeLocal — the offline-first input to the "resolve jobs when
 * blocking" list. Reads the Dexie jobs mirror against fake-indexeddb (the
 * offline path — no server), pinning:
 *   - a single-day range and a multi-day range both catch jobs on/within
 *     their bounds (inclusive), and NOT jobs the day either side;
 *   - only LIVE, actionable jobs surface — soft-deleted, archived,
 *     completed and draft jobs are excluded; scheduled + in_progress kept;
 *   - each row resolves the customer name from the Dexie site→customer chain;
 *   - blank / inverted range → [].
 */
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { findJobsInRangeLocal } from "@/lib/db/lookups";
import type { Customer, Job, Site } from "@/types/database";

function addJob(over: Partial<Job> & { id: string; job_date: string }) {
  return db.jobs.add({
    site_id: "site-A",
    job_status: "scheduled",
    call_type: "routine",
    is_archived: false,
    deleted_at: null,
    agreement_id: null,
    job_time: null,
    job_time_end: null,
    ...over,
  } as unknown as Job);
}

beforeEach(async () => {
  await db.jobs.clear();
  await db.sites.clear();
  await db.customers.clear();
});

describe("findJobsInRangeLocal — range detection", () => {
  beforeEach(async () => {
    await addJob({ id: "before", job_date: "2026-07-26" });
    await addJob({ id: "start", job_date: "2026-07-27" });
    await addJob({ id: "mid", job_date: "2026-07-29" });
    await addJob({ id: "end", job_date: "2026-07-31" });
    await addJob({ id: "after", job_date: "2026-08-01" });
  });

  it("multi-day range includes only jobs within [27, 31] inclusive", async () => {
    const got = await findJobsInRangeLocal("2026-07-27", "2026-07-31");
    expect(got.map((r) => r.job.id)).toEqual(["start", "mid", "end"]);
  });

  it("is sorted soonest-first", async () => {
    const got = await findJobsInRangeLocal("2026-07-27", "2026-07-31");
    expect(got.map((r) => r.job.job_date)).toEqual([
      "2026-07-27",
      "2026-07-29",
      "2026-07-31",
    ]);
  });

  it("single-day range catches only that day's job", async () => {
    const got = await findJobsInRangeLocal("2026-07-29", "2026-07-29");
    expect(got.map((r) => r.job.id)).toEqual(["mid"]);
  });

  it("excludes the days either side of the range", async () => {
    const got = await findJobsInRangeLocal("2026-07-27", "2026-07-31");
    const ids = got.map((r) => r.job.id);
    expect(ids).not.toContain("before");
    expect(ids).not.toContain("after");
  });
});

describe("findJobsInRangeLocal — only live, actionable jobs", () => {
  beforeEach(async () => {
    await addJob({ id: "scheduled", job_date: "2026-07-29", job_status: "scheduled" });
    await addJob({ id: "in_progress", job_date: "2026-07-29", job_status: "in_progress" });
    await addJob({ id: "completed", job_date: "2026-07-29", job_status: "completed" });
    await addJob({ id: "draft", job_date: "2026-07-29", job_status: "draft" });
    await addJob({ id: "deleted", job_date: "2026-07-29", deleted_at: "2026-07-10T00:00:00Z" });
    await addJob({ id: "archived", job_date: "2026-07-29", is_archived: true });
  });

  it("keeps scheduled + in_progress, drops completed/draft/deleted/archived", async () => {
    const got = await findJobsInRangeLocal("2026-07-29", "2026-07-29");
    expect(got.map((r) => r.job.id).sort()).toEqual(["in_progress", "scheduled"]);
  });
});

describe("findJobsInRangeLocal — customer name resolution", () => {
  it("resolves the name via the Dexie site → customer chain", async () => {
    await db.customers.add({ id: "cust-1", name: "BSK Ltd" } as unknown as Customer);
    await db.sites.add({ id: "site-1", customer_id: "cust-1" } as unknown as Site);
    await addJob({ id: "j1", job_date: "2026-07-29", site_id: "site-1" });

    const got = await findJobsInRangeLocal("2026-07-29", "2026-07-29");
    expect(got).toHaveLength(1);
    expect(got[0].customerName).toBe("BSK Ltd");
  });

  it("falls back to a neutral label when the chain can't resolve", async () => {
    await addJob({ id: "j1", job_date: "2026-07-29", site_id: "missing-site" });
    const got = await findJobsInRangeLocal("2026-07-29", "2026-07-29");
    expect(got[0].customerName).toBe("another booking");
  });
});

describe("findJobsInRangeLocal — empty / invalid range", () => {
  it("returns [] for a blank start or end", async () => {
    await addJob({ id: "j1", job_date: "2026-07-29" });
    expect(await findJobsInRangeLocal("", "2026-07-29")).toEqual([]);
    expect(await findJobsInRangeLocal("2026-07-29", "")).toEqual([]);
  });

  it("returns [] when end is before start", async () => {
    await addJob({ id: "j1", job_date: "2026-07-29" });
    expect(await findJobsInRangeLocal("2026-07-31", "2026-07-27")).toEqual([]);
  });
});

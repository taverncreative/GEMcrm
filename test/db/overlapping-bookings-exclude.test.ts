/**
 * findOverlappingBookingsLocal — the non-blocking time-overlap advisory,
 * and specifically its `excludeJobId` wiring that Reschedule relies on: a
 * job must never flag as clashing with ITSELF when you change only its
 * time. The parameter existed "edit-ready but unwired" until reschedule
 * passed the job's own id.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { findOverlappingBookingsLocal } from "@/lib/db/lookups";
import type { Job } from "@/types/database";

const DATE = "2026-07-01";

function add(over: Record<string, unknown>) {
  return db.jobs.add({
    site_id: "site-A",
    job_date: DATE,
    job_time: "09:00:00",
    job_time_end: "10:00:00",
    is_archived: false,
    deleted_at: null,
    agreement_id: null,
    ...over,
  } as unknown as Job);
}

beforeEach(async () => {
  await db.jobs.clear();
});

describe("findOverlappingBookingsLocal — excludeJobId (self-clash guard)", () => {
  it("a job does NOT clash with itself when only its time changes", async () => {
    await add({ id: "self", job_time: "09:00:00", job_time_end: "10:00:00" });
    // Move it within the same overlapping window; excluding its own id must
    // leave nothing to clash with.
    const clashes = await findOverlappingBookingsLocal(
      { job_date: DATE, job_time: "09:30", job_time_end: "10:30" },
      "self"
    );
    expect(clashes).toEqual([]);
  });

  it("WITHOUT the exclude, the same move would flag itself (proves the param does the work)", async () => {
    await add({ id: "self", job_time: "09:00:00", job_time_end: "10:00:00" });
    const clashes = await findOverlappingBookingsLocal({
      job_date: DATE,
      job_time: "09:30",
      job_time_end: "10:30",
    });
    expect(clashes.map((c) => c.id)).toContain("self");
  });

  it("still flags a genuine clash with ANOTHER booking (exclude only skips self)", async () => {
    await add({ id: "self", job_time: "09:00:00", job_time_end: "10:00:00" });
    await add({ id: "other", job_time: "09:30:00", job_time_end: "11:00:00" });
    const clashes = await findOverlappingBookingsLocal(
      { job_date: DATE, job_time: "09:15", job_time_end: "10:15" },
      "self"
    );
    const ids = clashes.map((c) => c.id);
    expect(ids).toContain("other");
    expect(ids).not.toContain("self");
  });

  it("an untimed move never warns", async () => {
    await add({ id: "other" });
    const clashes = await findOverlappingBookingsLocal(
      { job_date: DATE, job_time: null, job_time_end: null },
      "self"
    );
    expect(clashes).toEqual([]);
  });
});

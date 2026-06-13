/**
 * findClashingJobLocal (Q3c) — the offline Dexie mirror of the server's
 * partial unique index idx_jobs_site_date_unique. The booking + upgrade
 * modals call it before the optimistic write to block a duplicate inline
 * (online AND offline) instead of letting it become a stuck outbox entry.
 *
 * Predicate parity with the index:
 *   UNIQUE (site_id, job_date, call_type)
 *   WHERE is_archived=false AND agreement_id IS NULL AND deleted_at IS NULL
 */
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { findClashingJobLocal } from "@/lib/db/lookups";
import type { Job } from "@/types/database";

const SITE = "site-A";
const DATE = "2026-07-01";

// Minimal rows — findClashingJobLocal only reads id/site_id/job_date/
// call_type/is_archived/deleted_at/agreement_id, and Dexie stores partials.
function add(over: Record<string, unknown>) {
  return db.jobs.add({
    site_id: SITE,
    job_date: DATE,
    call_type: "routine",
    is_archived: false,
    deleted_at: null,
    agreement_id: null,
    ...over,
  } as unknown as Job);
}

beforeEach(async () => {
  await db.jobs.clear();
});

describe("findClashingJobLocal", () => {
  it("finds a live job at the same site + date + call_type", async () => {
    await add({ id: "live-1" });
    const hit = await findClashingJobLocal(SITE, DATE, "routine");
    expect(hit?.id).toBe("live-1");
  });

  it("ignores archived / soft-deleted / agreement rows (mirrors the partial index)", async () => {
    await add({ id: "arch", is_archived: true });
    await add({ id: "del", deleted_at: "2026-01-01T00:00:00Z" });
    await add({ id: "agr", agreement_id: "a-1" });
    const hit = await findClashingJobLocal(SITE, DATE, "routine");
    expect(hit).toBeUndefined();
  });

  it("no clash for a different date or a different call_type", async () => {
    await add({ id: "live-1" });
    expect(
      await findClashingJobLocal(SITE, "2026-07-02", "routine")
    ).toBeUndefined();
    expect(await findClashingJobLocal(SITE, DATE, "callout")).toBeUndefined();
  });

  it("excludeJobId skips the draft's own row (upgrade self-clash guard)", async () => {
    await add({ id: "self" });
    expect(
      await findClashingJobLocal(SITE, DATE, "routine", "self")
    ).toBeUndefined();
  });

  it("returns undefined for blank inputs", async () => {
    expect(await findClashingJobLocal("", DATE, "routine")).toBeUndefined();
    expect(await findClashingJobLocal(SITE, "", "routine")).toBeUndefined();
    expect(await findClashingJobLocal(SITE, DATE, "")).toBeUndefined();
  });
});

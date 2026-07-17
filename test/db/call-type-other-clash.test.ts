/**
 * The call_type "Other" description is OUTSIDE the duplicate-booking key:
 * findClashingJobLocal keys on [site_id+job_date+call_type] (mirroring the
 * server partial-unique idx_jobs_site_date_unique), which does not include
 * call_type_other_desc. So two same-day "Other" jobs at one site still
 * clash even when their descriptions differ — adding the column changed no
 * uniqueness behaviour.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { findClashingJobLocal } from "@/lib/db/lookups";
import type { Job } from "@/types/database";

const SITE = "site-A";
const DATE = "2026-07-01";

function add(over: Record<string, unknown>) {
  return db.jobs.add({
    site_id: SITE,
    job_date: DATE,
    call_type: "other",
    is_archived: false,
    deleted_at: null,
    agreement_id: null,
    ...over,
  } as unknown as Job);
}

beforeEach(async () => {
  await db.jobs.clear();
});

describe("two same-day 'Other' jobs still clash", () => {
  it("clashes regardless of a differing description", async () => {
    await add({ id: "first", call_type_other_desc: "Insect identification" });
    // A second "Other" booking the same day, DIFFERENT description, still
    // collides — the description is not part of the uniqueness key.
    const hit = await findClashingJobLocal(SITE, DATE, "other");
    expect(hit?.id).toBe("first");
  });

  it("still clashes when neither carries a description", async () => {
    await add({ id: "bare", call_type_other_desc: null });
    const hit = await findClashingJobLocal(SITE, DATE, "other");
    expect(hit?.id).toBe("bare");
  });
});

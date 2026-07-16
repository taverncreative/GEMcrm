/**
 * generateAgreementJobs — the finalise-time visit generation.
 *
 * Pins:
 *   - an ACTIVE 8/yr agreement generates exactly 8 scheduled routine jobs
 *     on the even-year-spread from start_date (months 0,2,3,5,6,8,9,11 —
 *     not the old bunched monthly interval);
 *   - a second run is a no-op (jobs already exist → idempotent);
 *   - a DRAFT generates nothing (the status gate the draft flow relies on).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Agreement } from "@/types/database";

let existingCount = 0;
const insertedBatches: Array<Array<Record<string, unknown>>> = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        eq: async () => ({ count: existingCount, error: null }),
      }),
      insert: async (rows: Array<Record<string, unknown>>) => {
        insertedBatches.push(rows);
        return { error: null };
      },
    }),
  })),
}));

import { generateAgreementJobs } from "@/lib/services/agreement-events";

const AGREEMENT = {
  id: "a1",
  site_id: "s1",
  status: "active",
  start_date: "2026-07-16",
  visit_frequency: 8,
  pest_species: ["Rats"],
} as unknown as Agreement;

beforeEach(() => {
  existingCount = 0;
  insertedBatches.length = 0;
});

describe("generateAgreementJobs", () => {
  it("8/yr active agreement: 8 scheduled routine jobs, even spread from start_date", async () => {
    await generateAgreementJobs(AGREEMENT);

    expect(insertedBatches).toHaveLength(1);
    const jobs = insertedBatches[0];
    expect(jobs).toHaveLength(8);

    // round(i * 12 / 8) months from 2026-07-16: 0,2,3,5,6,8,9,11.
    expect(jobs.map((j) => j.job_date)).toEqual([
      "2026-07-16",
      "2026-09-16",
      "2026-10-16",
      "2026-12-16",
      "2027-01-16",
      "2027-03-16",
      "2027-04-16",
      "2027-06-16",
    ]);
    for (const j of jobs) {
      expect(j.agreement_id).toBe("a1");
      expect(j.site_id).toBe("s1");
      expect(j.job_status).toBe("scheduled");
      expect(j.call_type).toBe("routine");
      expect(j.pest_species).toEqual(["Rats"]);
    }
  });

  it("is idempotent: jobs already exist → nothing inserted", async () => {
    existingCount = 8;
    await generateAgreementJobs(AGREEMENT);
    expect(insertedBatches).toHaveLength(0);
  });

  it("a draft generates nothing", async () => {
    await generateAgreementJobs({
      ...AGREEMENT,
      status: "draft",
    } as Agreement);
    expect(insertedBatches).toHaveLength(0);
  });
});

/**
 * findBlockedPeriodsForDateLocal — the offline-first input to the Slice 2
 * non-blocking booking advisory ("You've marked yourself off that day").
 *
 * Reads the Dexie `blocked_periods` mirror against the fake-indexeddb
 * harness (which IS the offline path — no server), pinning:
 *   - a single-day block triggers on its exact date;
 *   - a multi-day range triggers on any date within [start, end] inclusive,
 *     and NOT on the days either side;
 *   - the reason returned is the block's title (what the banner shows);
 *   - soft-deleted blocks never trigger (mirrors the SELECT RLS);
 *   - a blank date returns [] (no advisory);
 *   - overlapping blocks all surface (Slice 1 permits them).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { findBlockedPeriodsForDateLocal } from "@/lib/db/lookups";
import type { BlockedPeriod } from "@/types/database";

function add(over: Partial<BlockedPeriod> & { id: string }) {
  return db.blocked_periods.add({
    id: over.id,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    deleted_at: over.deleted_at ?? null,
    start_date: over.start_date ?? "2026-07-23",
    end_date: over.end_date ?? "2026-07-23",
    title: over.title ?? "Day off",
    created_by: over.created_by ?? null,
  } as BlockedPeriod);
}

beforeEach(async () => {
  await db.blocked_periods.clear();
});

describe("findBlockedPeriodsForDateLocal — single-day block", () => {
  beforeEach(() => add({ id: "b1", title: "Fishing at Bewl Water", start_date: "2026-07-23", end_date: "2026-07-23" }));

  it("triggers on the exact day, returning the reason", async () => {
    const hits = await findBlockedPeriodsForDateLocal("2026-07-23");
    expect(hits).toHaveLength(1);
    expect(hits[0].reason).toBe("Fishing at Bewl Water");
  });

  it("does not trigger the day before or after", async () => {
    expect(await findBlockedPeriodsForDateLocal("2026-07-22")).toEqual([]);
    expect(await findBlockedPeriodsForDateLocal("2026-07-24")).toEqual([]);
  });
});

describe("findBlockedPeriodsForDateLocal — multi-day range (inclusive)", () => {
  beforeEach(() => add({ id: "b2", title: "Benidorm holiday", start_date: "2026-07-27", end_date: "2026-07-31" }));

  it("triggers on the first day (inclusive start)", async () => {
    const hits = await findBlockedPeriodsForDateLocal("2026-07-27");
    expect(hits.map((h) => h.reason)).toEqual(["Benidorm holiday"]);
  });

  it("triggers on a middle day", async () => {
    expect((await findBlockedPeriodsForDateLocal("2026-07-29"))[0]?.reason).toBe(
      "Benidorm holiday"
    );
  });

  it("triggers on the last day (inclusive end)", async () => {
    expect(await findBlockedPeriodsForDateLocal("2026-07-31")).toHaveLength(1);
  });

  it("does not trigger the day before the range or after it", async () => {
    expect(await findBlockedPeriodsForDateLocal("2026-07-26")).toEqual([]);
    expect(await findBlockedPeriodsForDateLocal("2026-08-01")).toEqual([]);
  });
});

describe("findBlockedPeriodsForDateLocal — exclusions & edges", () => {
  it("ignores a soft-deleted block", async () => {
    await add({
      id: "d1",
      title: "Cancelled off",
      start_date: "2026-07-23",
      end_date: "2026-07-23",
      deleted_at: "2026-07-10T00:00:00.000Z",
    });
    expect(await findBlockedPeriodsForDateLocal("2026-07-23")).toEqual([]);
  });

  it("returns [] for a blank date (no advisory)", async () => {
    await add({ id: "b1" });
    expect(await findBlockedPeriodsForDateLocal("")).toEqual([]);
  });

  it("returns [] when no block covers the date", async () => {
    await add({ id: "b1", start_date: "2026-07-23", end_date: "2026-07-23" });
    expect(await findBlockedPeriodsForDateLocal("2026-06-15")).toEqual([]);
  });

  it("surfaces every overlapping block on the same day", async () => {
    await add({ id: "b1", title: "Fishing", start_date: "2026-07-29", end_date: "2026-07-29" });
    await add({ id: "b2", title: "Benidorm holiday", start_date: "2026-07-27", end_date: "2026-07-31" });
    const hits = await findBlockedPeriodsForDateLocal("2026-07-29");
    expect(hits.map((h) => h.reason).sort()).toEqual(["Benidorm holiday", "Fishing"]);
  });
});

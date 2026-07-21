/**
 * Block-out day schema (migration 046).
 *
 * BlockedPeriodSchema backs the "Block out days" form and the server action.
 * Contract: a required free-text title, a required start_date (YYYY-MM-DD),
 * and an OPTIONAL end_date that (a) defaults to the start when blank — so a
 * single-day block is one tap — and (b) must be >= start_date, mirroring the
 * SQL CHECK so client and DB guards agree.
 */
import { describe, it, expect } from "vitest";
import { BlockedPeriodSchema } from "@/lib/validation/blocked-period";

describe("BlockedPeriodSchema — title", () => {
  const base = { start_date: "2026-07-21" };

  it("requires a non-empty title", () => {
    expect(BlockedPeriodSchema.safeParse({ ...base, title: "" }).success).toBe(
      false
    );
    expect(
      BlockedPeriodSchema.safeParse({ ...base, title: "   " }).success
    ).toBe(false);
  });

  it("accepts and trims a reason", () => {
    const res = BlockedPeriodSchema.safeParse({
      ...base,
      title: "  Fishing at Bewl Water  ",
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.title).toBe("Fishing at Bewl Water");
  });

  it("rejects a title over 200 chars", () => {
    expect(
      BlockedPeriodSchema.safeParse({ ...base, title: "x".repeat(201) }).success
    ).toBe(false);
  });
});

describe("BlockedPeriodSchema — single day (end blank → start)", () => {
  it("defaults end_date to start_date when omitted", () => {
    const res = BlockedPeriodSchema.safeParse({
      title: "Day off",
      start_date: "2026-07-21",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.start_date).toBe("2026-07-21");
      expect(res.data.end_date).toBe("2026-07-21");
    }
  });

  it("treats an empty-string end_date as single day", () => {
    const res = BlockedPeriodSchema.safeParse({
      title: "Day off",
      start_date: "2026-07-21",
      end_date: "",
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.end_date).toBe("2026-07-21");
  });
});

describe("BlockedPeriodSchema — multi-day range", () => {
  it("accepts a valid forward range", () => {
    const res = BlockedPeriodSchema.safeParse({
      title: "Benidorm holiday",
      start_date: "2026-08-03",
      end_date: "2026-08-07",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.start_date).toBe("2026-08-03");
      expect(res.data.end_date).toBe("2026-08-07");
    }
  });

  it("accepts end_date == start_date (a one-day explicit range)", () => {
    expect(
      BlockedPeriodSchema.safeParse({
        title: "x",
        start_date: "2026-08-03",
        end_date: "2026-08-03",
      }).success
    ).toBe(true);
  });
});

describe("BlockedPeriodSchema — end >= start guard", () => {
  it("rejects an end_date before start_date", () => {
    const res = BlockedPeriodSchema.safeParse({
      title: "Backwards",
      start_date: "2026-08-07",
      end_date: "2026-08-03",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path[0] === "end_date")).toBe(true);
    }
  });
});

describe("BlockedPeriodSchema — malformed dates", () => {
  it("rejects a non-ISO start_date", () => {
    expect(
      BlockedPeriodSchema.safeParse({ title: "x", start_date: "21/07/2026" })
        .success
    ).toBe(false);
  });

  it("rejects a date-time start_date (date-only contract)", () => {
    expect(
      BlockedPeriodSchema.safeParse({
        title: "x",
        start_date: "2026-07-21T09:00",
      }).success
    ).toBe(false);
  });

  it("rejects a malformed end_date", () => {
    expect(
      BlockedPeriodSchema.safeParse({
        title: "x",
        start_date: "2026-07-21",
        end_date: "not-a-date",
      }).success
    ).toBe(false);
  });
});

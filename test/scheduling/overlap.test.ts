import { describe, it, expect } from "vitest";
import {
  findClashingBookings,
  type BookingTimes,
} from "@/lib/scheduling/overlap";

/**
 * The overlap rule (lib/scheduling/overlap). A clash needs both bookings
 * on the same job_date AND both timed; windows are half-open [start, end).
 *
 * Each test feeds one `candidate` plus a list of `existing` rows and
 * asserts exactly which existing rows come back. Rows carry an `id` so the
 * generic return is checked by identity, not just length.
 */

const DAY = "2026-06-23";
const OTHER_DAY = "2026-06-24";

type Row = BookingTimes & { id: string };

function row(
  id: string,
  job_time: string | null,
  job_time_end: string | null,
  job_date: string = DAY
): Row {
  return { id, job_date, job_time, job_time_end };
}

function ids(rows: Row[]): string[] {
  return rows.map((r) => r.id);
}

describe("findClashingBookings", () => {
  it("flags two overlapping windows on the same day", () => {
    const candidate = row("c", "10:00", "11:00");
    const existing = [row("a", "10:30", "11:30")];
    expect(ids(findClashingBookings(candidate, existing))).toEqual(["a"]);
  });

  it("does NOT flag windows that merely touch (end == next start, half-open)", () => {
    // 10:00–11:00 then 11:00–12:00 — back-to-back, not a double-booking.
    const candidate = row("c", "11:00", "12:00");
    const existing = [row("a", "10:00", "11:00")];
    expect(findClashingBookings(candidate, existing)).toEqual([]);
  });

  it("does NOT flag fully-separate windows", () => {
    const candidate = row("c", "09:00", "09:30");
    const existing = [row("a", "14:00", "15:00")];
    expect(findClashingBookings(candidate, existing)).toEqual([]);
  });

  it("flags a window fully containing another", () => {
    const candidate = row("c", "09:00", "17:00");
    const existing = [row("a", "12:00", "13:00")];
    expect(ids(findClashingBookings(candidate, existing))).toEqual(["a"]);
  });

  it("flags an instant that falls INSIDE another booking's window", () => {
    // candidate has no end → instant at 10:30, existing window covers it.
    const candidate = row("c", "10:30", null);
    const existing = [row("a", "10:00", "11:00")];
    expect(ids(findClashingBookings(candidate, existing))).toEqual(["a"]);
  });

  it("flags an instant at the exact START of a window (start inclusive)", () => {
    const candidate = row("c", "10:00", null);
    const existing = [row("a", "10:00", "11:00")];
    expect(ids(findClashingBookings(candidate, existing))).toEqual(["a"]);
  });

  it("does NOT flag an instant at the exact END of a window (end exclusive)", () => {
    const candidate = row("c", "11:00", null);
    const existing = [row("a", "10:00", "11:00")];
    expect(findClashingBookings(candidate, existing)).toEqual([]);
  });

  it("does NOT flag an instant OUTSIDE a window", () => {
    const candidate = row("c", "12:00", null);
    const existing = [row("a", "10:00", "11:00")];
    expect(findClashingBookings(candidate, existing)).toEqual([]);
  });

  it("flags symmetrically: a window candidate covering an existing instant", () => {
    const candidate = row("c", "10:00", "11:00");
    const existing = [row("a", "10:30", null)];
    expect(ids(findClashingBookings(candidate, existing))).toEqual(["a"]);
  });

  it("does NOT flag two instants, even at the exact same time (no invented slot)", () => {
    // Per spec: an instant clashes only with a covering WINDOW. Two
    // zero-width instants never clash — flagged behaviour for John.
    const candidate = row("c", "10:00", null);
    const existing = [row("a", "10:00", null)];
    expect(findClashingBookings(candidate, existing)).toEqual([]);
  });

  it("never clashes when the CANDIDATE is untimed (relaxed booking)", () => {
    const candidate = row("c", null, null);
    const existing = [row("a", "10:00", "11:00")];
    expect(findClashingBookings(candidate, existing)).toEqual([]);
  });

  it("never clashes against an untimed EXISTING booking", () => {
    const candidate = row("c", "10:00", "11:00");
    const existing = [row("a", null, null)];
    expect(findClashingBookings(candidate, existing)).toEqual([]);
  });

  it("does NOT flag an overlapping window on a DIFFERENT day", () => {
    const candidate = row("c", "10:00", "11:00", DAY);
    const existing = [row("a", "10:00", "11:00", OTHER_DAY)];
    expect(findClashingBookings(candidate, existing)).toEqual([]);
  });

  it("returns only the clashing subset from a mixed list", () => {
    const candidate = row("c", "10:00", "11:00");
    const existing = [
      row("overlap", "10:30", "11:30"), // clashes
      row("touch", "11:00", "12:00"), // touches end → no
      row("untimed", null, null), // untimed → no
      row("otherday", "10:15", "10:45", OTHER_DAY), // wrong day → no
      row("inside", "10:45", null), // instant inside → clashes
    ];
    expect(ids(findClashingBookings(candidate, existing)).sort()).toEqual(
      ["inside", "overlap"].sort()
    );
  });

  it("treats end == start as an instant, not a zero-width window", () => {
    // existing 'a' has end == start (10:00–10:00) → instant at 10:00.
    // candidate window 09:00–10:00 is half-open, so 10:00 is NOT covered.
    const candidate = row("c", "09:00", "10:00");
    const existing = [row("a", "10:00", "10:00")];
    expect(findClashingBookings(candidate, existing)).toEqual([]);
  });

  it("compares HH:MM and HH:MM:SS equivalently (no string-order bug)", () => {
    // existing stored with seconds (server round-trip), candidate without.
    const candidate = row("c", "10:00", "10:30");
    const existing = [row("a", "10:00:00", "10:15:00")];
    expect(ids(findClashingBookings(candidate, existing))).toEqual(["a"]);
  });

  it("treats an unparseable time as untimed (no false clash)", () => {
    const candidate = row("c", "not-a-time", null);
    const existing = [row("a", "10:00", "11:00")];
    expect(findClashingBookings(candidate, existing)).toEqual([]);
  });

  it("returns empty for no existing bookings", () => {
    const candidate = row("c", "10:00", "11:00");
    expect(findClashingBookings(candidate, [])).toEqual([]);
  });
});

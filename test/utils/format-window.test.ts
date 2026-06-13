/**
 * formatWindow (Q1) — the arrival-window display helper shared by the
 * jobs list, jobs-today, and (Q2) quick capture.
 */
import { describe, it, expect } from "vitest";
import { formatWindow, formatJobTime } from "@/lib/utils/format-time";

describe("formatWindow", () => {
  it("start + end → an en-dashed window", () => {
    expect(formatWindow("09:00", "12:00")).toBe("09:00–12:00");
  });

  it("trims Postgres seconds on both ends", () => {
    expect(formatWindow("09:00:00", "12:00:00")).toBe("09:00–12:00");
  });

  it("start only → single time (backward-compatible with pre-window rows)", () => {
    expect(formatWindow("14:30", null)).toBe("14:30");
    expect(formatWindow("14:30:00", "")).toBe("14:30");
  });

  it("no start → All day", () => {
    expect(formatWindow(null, null)).toBe("All day");
    expect(formatWindow("", "12:00")).toBe("All day");
  });

  it("end <= start collapses to the single start time (defensive)", () => {
    expect(formatWindow("12:00", "12:00")).toBe("12:00");
    expect(formatWindow("12:00", "09:00")).toBe("12:00");
  });

  it("agrees with formatJobTime on the single-time / all-day cases", () => {
    expect(formatWindow("09:00", null)).toBe(formatJobTime("09:00"));
    expect(formatWindow(null, null)).toBe(formatJobTime(null));
  });
});

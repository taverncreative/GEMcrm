import { describe, it, expect } from "vitest";
import { agreementVisitDates } from "@/lib/services/agreement-schedule";

/**
 * Visit-spread table for agreement job generation.
 *
 * Regression for the 8-visits/year bug: the old
 * floor(12/frequency) interval turned every non-divisor of 12 into
 * consecutive-month bunching (8/yr → monthly for 8 months, then a
 * 4-month gap; 26/yr → 26 MONTHLY visits spilling over two years).
 * The invariants below pin the corrected behaviour for every legal
 * frequency 1-52.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

describe("agreementVisitDates — full 1-52 frequency table", () => {
  for (let frequency = 1; frequency <= 52; frequency++) {
    it(`${frequency}/yr: right count, strictly increasing, spans <1 year, even gaps`, () => {
      const dates = agreementVisitDates("2026-08-01", frequency);

      // Exactly one job per contracted visit.
      expect(dates).toHaveLength(frequency);

      // First visit is the start date itself.
      expect(dates[0]).toBe("2026-08-01");

      const ts = dates.map(toUtc);

      // Strictly increasing — no duplicate or reordered dates.
      for (let i = 1; i < ts.length; i++) {
        expect(ts[i]).toBeGreaterThan(ts[i - 1]);
      }

      // Whole schedule fits inside one contract year.
      const lastOffsetDays = (ts[ts.length - 1] - ts[0]) / DAY_MS;
      expect(lastOffsetDays).toBeLessThan(365);

      // Even spread: no gap more than ~2x the ideal interval, so the
      // old bunch-then-gap shape (e.g. 8/yr's 4-month dead tail within
      // a 1-month cadence) can't come back.
      if (frequency > 1) {
        const ideal = 365 / frequency;
        for (let i = 1; i < ts.length; i++) {
          const gap = (ts[i] - ts[i - 1]) / DAY_MS;
          expect(gap).toBeLessThanOrEqual(Math.ceil(ideal * 2));
        }
        // The year is actually USED: last visit lands in the final
        // interval of the year, not months early.
        expect(lastOffsetDays).toBeGreaterThanOrEqual(365 - ideal - 31);
      }
    });
  }

  it("divisors of 12 keep the exact legacy month spread", () => {
    // These were correct under the old floor() maths — pin them.
    expect(agreementVisitDates("2026-08-01", 1)).toEqual(["2026-08-01"]);
    expect(agreementVisitDates("2026-08-01", 2)).toEqual([
      "2026-08-01",
      "2027-02-01",
    ]);
    expect(agreementVisitDates("2026-08-01", 3)).toEqual([
      "2026-08-01",
      "2026-12-01",
      "2027-04-01",
    ]);
    expect(agreementVisitDates("2026-08-01", 4)).toEqual([
      "2026-08-01",
      "2026-11-01",
      "2027-02-01",
      "2027-05-01",
    ]);
    expect(agreementVisitDates("2026-08-01", 6)).toEqual([
      "2026-08-01",
      "2026-10-01",
      "2026-12-01",
      "2027-02-01",
      "2027-04-01",
      "2027-06-01",
    ]);
    expect(agreementVisitDates("2026-08-01", 12).slice(0, 3)).toEqual([
      "2026-08-01",
      "2026-09-01",
      "2026-10-01",
    ]);
  });

  it("8/yr spans the year: months 0,2,3,5,6,8,9,11 (the Nate case)", () => {
    expect(agreementVisitDates("2026-08-01", 8)).toEqual([
      "2026-08-01",
      "2026-10-01",
      "2026-11-01",
      "2027-01-01",
      "2027-02-01",
      "2027-04-01",
      "2027-05-01",
      "2027-07-01",
    ]);
  });

  it("26/yr is ~fortnightly within one year, not monthly over two", () => {
    const dates = agreementVisitDates("2026-08-01", 26);
    const ts = dates.map(toUtc);
    for (let i = 1; i < ts.length; i++) {
      const gap = (ts[i] - ts[i - 1]) / DAY_MS;
      expect(gap).toBeGreaterThanOrEqual(14);
      expect(gap).toBeLessThanOrEqual(15);
    }
    expect((ts[25] - ts[0]) / DAY_MS).toBeLessThan(365);
  });

  it("month-end start dates clamp instead of rolling over", () => {
    // 31 Jan + 1 month must be 28 Feb (2026 is not a leap year),
    // never 2/3 Mar. Old Date.setMonth rolled over.
    const monthly = agreementVisitDates("2026-01-31", 12);
    expect(monthly[1]).toBe("2026-02-28");
    expect(monthly[3]).toBe("2026-04-30");
    // Day is HELD, not permanently shortened: 31-day months get the 31st back.
    expect(monthly[2]).toBe("2026-03-31");
    expect(monthly[4]).toBe("2026-05-31");
    // Leap year February keeps the 29th.
    expect(agreementVisitDates("2028-01-31", 12)[1]).toBe("2028-02-29");
  });

  it("rejects garbage without throwing", () => {
    expect(agreementVisitDates("not-a-date", 8)).toEqual([]);
    expect(agreementVisitDates("2026-08-01", 0)).toEqual([]);
    expect(agreementVisitDates("2026-08-01", 1.5)).toEqual([]);
  });
});

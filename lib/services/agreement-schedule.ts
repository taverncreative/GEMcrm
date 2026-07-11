/**
 * Pure visit-schedule maths for agreement job generation.
 *
 * Kept free of any Supabase/server imports so the full 1-52
 * visits-per-year table is unit-testable (see
 * test/services/agreement-schedule.test.ts). generateAgreementJobs
 * (lib/services/agreement-events.ts) is the only production consumer.
 */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Days in a 1-based month (Feb 2024 → 29). */
function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/**
 * The full visit schedule for an agreement: `frequency` ISO dates
 * (YYYY-MM-DD) spread evenly across ONE year from `startDate`.
 *
 * - frequency <= 12: month-anchored. Visit i lands
 *   Math.round((i * 12) / frequency) months after the start, so any
 *   frequency spans the whole year (8/yr → months 0,2,3,5,6,8,9,11)
 *   instead of the old floor(12/f) bunching (8/yr → monthly for 8
 *   months then a 4-month gap). Divisors of 12 keep their exact
 *   legacy spread (4/yr → 0,3,6,9).
 * - frequency > 12: sub-monthly cadences can't be month-anchored, so
 *   visit i lands Math.round((i * 365) / frequency) days after the
 *   start (26/yr → every ~14 days), all within the year.
 *
 * The day-of-month is HELD, not rolled: a 31st start clamps to each
 * target month's length (31 Jan → 28/29 Feb), never spilling into the
 * following month like Date.setMonth does.
 *
 * All arithmetic is pure calendar maths on the date string — no
 * timezones involved, so a UK operator and a UTC server agree.
 */
export function agreementVisitDates(
  startDate: string,
  frequency: number
): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startDate);
  if (!m || !Number.isInteger(frequency) || frequency < 1) return [];
  const y0 = Number(m[1]);
  const m0 = Number(m[2]);
  const d0 = Number(m[3]);

  const dates: string[] = [];
  for (let i = 0; i < frequency; i++) {
    if (frequency <= 12) {
      const monthsFromStart = Math.round((i * 12) / frequency);
      const totalMonth0 = m0 - 1 + monthsFromStart;
      const year = y0 + Math.floor(totalMonth0 / 12);
      const month = (totalMonth0 % 12) + 1;
      const day = Math.min(d0, daysInMonth(year, month));
      dates.push(`${year}-${pad(month)}-${pad(day)}`);
    } else {
      const daysFromStart = Math.round((i * 365) / frequency);
      const dt = new Date(Date.UTC(y0, m0 - 1, d0 + daysFromStart));
      dates.push(
        `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(
          dt.getUTCDate()
        )}`
      );
    }
  }
  return dates;
}

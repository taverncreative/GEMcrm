/**
 * Booking overlap rule (pure) — the heart of the non-blocking "this
 * booking clashes" warning (Nate Q3).
 *
 * A clash needs BOTH bookings to be on the SAME `job_date` AND to carry a
 * start time (`job_time`). Untimed / "relaxed" bookings (job_time null)
 * never participate, on either side — so the relaxed flow is untouched.
 *
 * Window semantics are HALF-OPEN, `[start, end)`:
 *   - A booking with an explicit `job_time_end` uses its real window.
 *   - A booking with a start but NO end is assumed to last
 *     {@link DEFAULT_BOOKING_DURATION_MINUTES} minutes — its window is
 *     `[job_time, job_time + default)`. So two bookings both starting 09:00
 *     with no end DO clash (each is treated as 09:00–10:00), while 09:00
 *     (no end) vs 10:30 does NOT (10:30 is outside the assumed hour). The
 *     assumption lives ONLY here — `job_time_end` is never written back.
 *   - Two windows clash when their intervals overlap. Touching ends do NOT
 *     clash: a booking ending exactly when the next starts (end == start)
 *     is fine — no double-booking.
 *   - A start in the last hour of the day clamps its assumed end to
 *     end-of-day rather than wrapping past midnight.
 *
 * Times are compared by parsing "HH:MM" / "HH:MM:SS" to seconds, so a row
 * stored as "09:00" (local create) and one as "09:00:00" (server
 * round-trip) compare equal — string compare would wrongly order them.
 * An unparseable / out-of-range time is treated as untimed (no clash),
 * keeping the function total and false-positive-free.
 *
 * Pure and dependency-free so it unit-tests in isolation; the Dexie-backed
 * caller (findOverlappingBookingsLocal) feeds it same-day rows.
 */

/**
 * How long a timed booking with no explicit end is assumed to last, for
 * clash detection only. Display/logic constant — never persisted to the
 * row. Tune here if the assumed slot length should change.
 */
export const DEFAULT_BOOKING_DURATION_MINUTES = 60;

/** Half-open upper bound of a day in seconds (24:00, exclusive). */
const END_OF_DAY_SECONDS = 24 * 3600;

/** The scheduling shape this rule reads off a booking / job row. */
export interface BookingTimes {
  /** "YYYY-MM-DD". */
  job_date: string;
  /** Start clock time "HH:MM" or "HH:MM:SS". null = untimed (relaxed). */
  job_time: string | null;
  /** Window end "HH:MM" / "HH:MM:SS". null (or <= start) = no explicit end,
   *  so the default-duration window is assumed. */
  job_time_end: string | null;
}

/** A resolved half-open interval in seconds-since-midnight. */
interface Interval {
  start: number;
  end: number;
}

/** "HH:MM" / "HH:MM:SS" → seconds since midnight; null if blank/invalid. */
function toSeconds(time: string | null): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] ? Number(m[3]) : 0;
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return hh * 3600 + mm * 60 + ss;
}

/**
 * Map a booking to its half-open window, or null when it can't participate
 * in a clash (untimed / unparseable start). An end that isn't strictly
 * after the start (missing, equal, or malformed) falls back to the
 * default-duration window, clamped to end-of-day so a late start doesn't
 * wrap past midnight.
 */
function toInterval(b: BookingTimes): Interval | null {
  const start = toSeconds(b.job_time);
  if (start === null) return null;
  const rawEnd = toSeconds(b.job_time_end);
  const end =
    rawEnd !== null && rawEnd > start
      ? rawEnd
      : Math.min(
          start + DEFAULT_BOOKING_DURATION_MINUTES * 60,
          END_OF_DAY_SECONDS
        );
  return { start, end };
}

/** Whether two half-open windows overlap (touching ends do not). */
function intervalsClash(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Of `existing`, the bookings that clash with `candidate`. Generic over
 * the row type so callers get their own rows back (with ids, customer,
 * etc.) to name the conflict. Empty array = no clash.
 */
export function findClashingBookings<T extends BookingTimes>(
  candidate: BookingTimes,
  existing: readonly T[]
): T[] {
  const a = toInterval(candidate);
  if (!a) return [];
  return existing.filter((e) => {
    if (e.job_date !== candidate.job_date) return false;
    const b = toInterval(e);
    if (!b) return false;
    return intervalsClash(a, b);
  });
}

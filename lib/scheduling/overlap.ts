/**
 * Booking overlap rule (pure) — the heart of the non-blocking "this
 * booking clashes" warning (Nate Q3).
 *
 * A clash needs BOTH bookings to be on the SAME `job_date` AND to carry a
 * start time (`job_time`). Untimed / "relaxed" bookings (job_time null)
 * never participate, on either side — so the relaxed flow is untouched.
 *
 * Window semantics are HALF-OPEN, `[start, end)`:
 *   - Two windows clash when their intervals overlap. Touching ends do NOT
 *     clash: a booking ending exactly when the next starts (end == start)
 *     is fine — no double-booking.
 *   - A timed booking with NO end is treated as a single instant. It
 *     clashes only when the OTHER booking's window strictly covers that
 *     instant (start <= instant < end). We do NOT invent a default slot
 *     length for it.
 *   - Two instants never clash, even at the exact same time — neither side
 *     carries a window to "cover" the other (a direct consequence of not
 *     inventing a slot length). [Flagged for John: if same-instant
 *     bookings should warn, that's a deliberate extension of this rule.]
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

/** The scheduling shape this rule reads off a booking / job row. */
export interface BookingTimes {
  /** "YYYY-MM-DD". */
  job_date: string;
  /** Start clock time "HH:MM" or "HH:MM:SS". null = untimed (relaxed). */
  job_time: string | null;
  /** Window end "HH:MM" / "HH:MM:SS". null (or <= start) = single instant. */
  job_time_end: string | null;
}

/** A resolved interval in seconds-since-midnight. `end === null` = instant. */
interface Interval {
  start: number;
  end: number | null;
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
 * Map a booking to its interval, or null when it can't participate in a
 * clash (untimed / unparseable start). An end that isn't strictly after
 * the start collapses to an instant — covers the "end == start" zero-width
 * window and any malformed end.
 */
function toInterval(b: BookingTimes): Interval | null {
  const start = toSeconds(b.job_time);
  if (start === null) return null;
  const rawEnd = toSeconds(b.job_time_end);
  const end = rawEnd !== null && rawEnd > start ? rawEnd : null;
  return { start, end };
}

/** Whether two resolved intervals clash under the half-open rule. */
function intervalsClash(a: Interval, b: Interval): boolean {
  if (a.end !== null && b.end !== null) {
    // Two windows: overlap iff each starts before the other ends.
    return a.start < b.end && b.start < a.end;
  }
  if (a.end !== null && b.end === null) {
    // a is a window, b an instant: window covers instant?
    return a.start <= b.start && b.start < a.end;
  }
  if (a.end === null && b.end !== null) {
    return b.start <= a.start && a.start < b.end;
  }
  // Two instants: no covering window on either side → never clash.
  return false;
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

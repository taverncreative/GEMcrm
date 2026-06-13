/**
 * Format a Postgres `time` value (e.g. "09:30:00" or "09:30") for display.
 *
 * Returns "HH:MM" (24-hour clock) — short and unambiguous for an operator
 * scanning a list of jobs. Returns "All day" when the column is null so
 * the widget rows still have a left-aligned anchor and don't visually
 * shift width row-to-row.
 */
export function formatJobTime(value: string | null | undefined): string {
  if (!value) return "All day";
  // Trim seconds if Postgres returns "HH:MM:SS".
  const trimmed = value.length >= 5 ? value.slice(0, 5) : value;
  return trimmed;
}

/**
 * Format an arrival WINDOW (Q1) for display.
 *
 *   start + end  → "09:00–12:00"   (an arrival window)
 *   start only   → "09:00"          (a single booked time)
 *   neither      → "All day"        (no specific time)
 *
 * `start` is `job_time` (also the soonest-first sort key); `end` is
 * `job_time_end`. An en dash separates the ends. A window whose end
 * equals/precedes its start collapses to the single start time (belt:
 * the picker prevents this, but old/odd data renders sanely).
 */
export function formatWindow(
  start: string | null | undefined,
  end: string | null | undefined
): string {
  if (!start) return "All day";
  const s = start.length >= 5 ? start.slice(0, 5) : start;
  if (!end) return s;
  const e = end.length >= 5 ? end.slice(0, 5) : end;
  if (e <= s) return s;
  return `${s}–${e}`;
}

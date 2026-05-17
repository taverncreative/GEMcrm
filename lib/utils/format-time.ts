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

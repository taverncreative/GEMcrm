/**
 * UK timezone-aware "today" helper.
 *
 * Why this exists: previously the codebase used
 *   `new Date().toISOString().split("T")[0]`
 * which always returns the UTC date. For a UK user at 00:30 BST the
 * server (UTC) sees 23:30 *yesterday*, so "Jobs today" / "Tasks due
 * today" / "due_date defaults to today" would all show yesterday's data.
 *
 * Use these instead anywhere a date string for "now in the UK" is wanted.
 * Europe/London is the correct zone all year — `Intl.DateTimeFormat`
 * handles BST/GMT switching automatically.
 */

const LONDON: Intl.DateTimeFormatOptions = {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
};

/**
 * Today's date in the UK, as ISO `YYYY-MM-DD`. Matches what a SQL
 * `date` column expects and `.eq("job_date", today)` style comparisons.
 */
export function todayUk(): string {
  return dateUk(new Date());
}

/**
 * A specific `Date` rendered as `YYYY-MM-DD` in UK time.
 *
 * `Intl.DateTimeFormat("en-GB")` produces "dd/mm/yyyy" so we re-arrange
 * to the SQL/ISO form.
 */
export function dateUk(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", LONDON).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Today's date in the UK with `daysOffset` added. Negative offsets work too.
 * Equivalent to `dateUk(date_n_days_from_now)`.
 */
export function dateUkOffset(daysOffset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysOffset);
  return dateUk(d);
}

/**
 * Shared UK date formatting for OPERATOR surfaces.
 *
 * Why this exists: the date format was inlined as a local
 * `toLocaleDateString("en-GB", { ... })` at ~30 call sites, so a change
 * to "how a date reads" had to be made 30 times. This is the one place
 * an operator-facing date format lives; extend it rather than inlining
 * a new shape.
 *
 * Customer-facing output (PDF templates, emails) deliberately keeps its
 * own formatting — those read differently from an operator list and
 * should not move when an operator surface does.
 */

interface ShortDateOptions {
  /** Include the weekday ("Fri 24 Jul"). Default true. */
  weekday?: boolean;
  /** Include the year ("24 Jul 2026"). Default false. */
  year?: boolean;
}

/**
 * A short scannable date for an operator list.
 *
 *   default            → "Fri 24 Jul"
 *   { year: true }     → "Fri 24 Jul 2026"
 *   { weekday: false } → "24 Jul"
 *
 * The weekday is on by default: on a rolling list of visits the day of
 * the week is what an operator actually plans around, and the short form
 * costs about three characters.
 */
export function formatShortDate(
  value: string | Date,
  options: ShortDateOptions = {}
): string {
  const { weekday = true, year = false } = options;
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString("en-GB", {
    ...(weekday ? { weekday: "short" as const } : {}),
    day: "numeric",
    month: "short",
    ...(year ? { year: "numeric" as const } : {}),
  });
}

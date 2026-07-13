/**
 * "Other" free-text encoding for pill-based multi-selects that are backed
 * by a plain string[] column (jobs.pest_species, jobs.method_used,
 * agreements.pest_species).
 *
 * Selecting the "Other" pill reveals a free-text box; the description is
 * folded into the array as "Other: <desc>" at the storage boundary. No
 * schema change is needed, and every downstream renderer that prints the
 * array strings as-is (service-sheet view, PDF tags, agreement + site
 * pest lists) surfaces the description for free.
 *
 * The UI keeps the bare "Other" pill in the selected list and holds the
 * description in its own state; encode folds it in on the way out
 * (hidden input), split extracts it on the way in (initial seed). Shared
 * by the service sheet and the booking/agreement pest selectors so the
 * encode/decode contract never drifts between them.
 */

export const OTHER_PILL = "Other";

/** Fold the free-text back into the array for storage. A bare "Other"
 *  (empty description) is left as-is so callers' validation can catch it. */
export function encodeOther(pills: string[], otherText: string): string[] {
  const t = otherText.trim();
  return pills.map((p) => (p === OTHER_PILL && t ? `Other: ${t}` : p));
}

/** Inverse of encodeOther: split a stored array (which may carry an
 *  encoded "Other: <desc>" entry) back into the bare pill list plus the
 *  extracted description. Round-trips with encodeOther. */
export function splitOther(items: string[]): {
  pills: string[];
  otherText: string;
} {
  let otherText = "";
  const pills = items.map((item) => {
    if (item === OTHER_PILL) return OTHER_PILL;
    const m = /^Other:\s*([\s\S]*)$/.exec(item);
    if (m) {
      otherText = m[1];
      return OTHER_PILL;
    }
    return item;
  });
  return { pills, otherText };
}

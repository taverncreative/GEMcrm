/**
 * Storage rule for the call-type "Other" free-text description.
 *
 * jobs.call_type is a scalar with a CHECK constraint, so (unlike the pest
 * and treatment-method "Other", which fold "Other: <desc>" into their
 * text[] columns — see lib/utils/other-describe.ts) the description lives
 * in its own column, jobs.call_type_other_desc.
 *
 * The description is kept ONLY when the call type is actually "other".
 * When the type is anything else, this returns null so a stale description
 * can never linger after the operator switches the call type away from
 * "other". A blank/whitespace description also collapses to null.
 *
 * Shared by every write path (createBooking, writeServiceSheet, and the
 * booking modal's optimistic Dexie write) so the rule can't drift between
 * them.
 */
export function callTypeOtherDescForStorage(
  callType: string | null | undefined,
  desc: string | null | undefined
): string | null {
  if (callType !== "other") return null;
  const trimmed = desc?.trim();
  return trimmed ? trimmed : null;
}

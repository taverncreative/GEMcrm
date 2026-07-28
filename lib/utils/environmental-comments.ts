/**
 * Storage rule for the Environmental Risk Assessment (ERA) free text.
 *
 * The ERA lives in jobs.environmental_comments — migration 007's unused
 * column, adopted by the ERA feature rather than adding a duplicate one.
 * There is no era_required column: PRESENCE OF THIS TEXT IS THE FLAG. Every
 * read surface (customer PDF, job detail, view-only sheet) renders the ERA
 * section when it is non-null and omits it entirely when it is null, so the
 * vast majority of sheets — which need no ERA — look exactly as they did
 * before the feature existed.
 *
 * That only holds if the write side is disciplined: the text is kept ONLY
 * when the operator's "Environmental risk assessment" tick is on. Untick and
 * this returns null, so text typed and then abandoned never reaches the row
 * and never surfaces on a customer PDF. Blank/whitespace collapses to null
 * for the same reason.
 *
 * Shared by writeServiceSheet and the form's optimistic Dexie write, so the
 * two cannot disagree about what an unticked sheet stores — mirroring
 * callTypeOtherDescForStorage.
 */
export function environmentalCommentsForStorage(
  eraRequired: boolean | null | undefined,
  comments: string | null | undefined
): string | null {
  if (!eraRequired) return null;
  const trimmed = comments?.trim();
  return trimmed ? trimmed : null;
}

/**
 * What cancelling an agreement does to its visits.
 *
 * A PURE function over rows the caller already has, deliberately: the
 * cancel confirm dialog reads the agreement's visits from Dexie
 * (useLiveQuery) rather than asking the server. Cancelling is
 * offline-capable, so a dialog that could only count via a server action
 * would leave its confirm button disabled in a van with no signal — the one
 * situation the offline-first work exists for. The local store is also
 * exactly what the operator's calendar is rendering, so the numbers in the
 * dialog and the visits on screen can never disagree.
 *
 * The server RPC (cancel_agreement_visits, migration 051) stays the
 * authority on what is actually removed. This is the preview, and the two
 * are kept in step by construction: the predicate below is the same one the
 * RPC applies, and the same one applyLocal mirrors into Dexie.
 */

export interface AgreementCancelImpact {
  /** Scheduled visits on or after the cut-off. These are the ones removed. */
  removed: number;
  /** Of those, how many fall ON the cut-off day — named separately in the
   *  dialog because "today" is the one an operator might still be planning
   *  to do. */
  today: number;
  /** Scheduled visits BEFORE the cut-off. These stay: a missed visit still
   *  needs writing up, and it's already on the overdue list. */
  past: number;
  /** Completed visits. Never touched, and said so in the dialog. */
  completed: number;
  /** In-progress visits (a sheet being filled right now). Never touched. */
  inProgress: number;
}

/** The shape this needs off a job row. Kept structural so it accepts a
 *  Dexie `Job` and a plain test fixture alike. */
export interface CancelImpactJob {
  job_date: string;
  job_status: string;
  deleted_at?: string | null;
}

/**
 * `fromDate` is the cut-off the operator's device captured when the dialog
 * opened, not "now" — so the preview counts exactly the set the write will
 * remove, even if an offline replay lands days later.
 *
 * Already-deleted rows are ignored, so re-opening the dialog after a cancel
 * reads zeroes rather than repeating itself.
 */
export function agreementCancelImpact(
  jobs: CancelImpactJob[],
  fromDate: string
): AgreementCancelImpact {
  const live = jobs.filter((j) => !j.deleted_at);
  const scheduled = live.filter((j) => j.job_status === "scheduled");

  return {
    // Mirrors the RPC predicate exactly: scheduled AND job_date >= cut-off.
    // ISO date strings compare lexicographically, so a plain >= is correct.
    removed: scheduled.filter((j) => j.job_date >= fromDate).length,
    today: scheduled.filter((j) => j.job_date === fromDate).length,
    past: scheduled.filter((j) => j.job_date < fromDate).length,
    completed: live.filter((j) => j.job_status === "completed").length,
    inProgress: live.filter((j) => j.job_status === "in_progress").length,
  };
}

import { createClient } from "@/lib/supabase/server";
import { agreementVisitDates } from "@/lib/services/agreement-schedule";
import { newId } from "@/lib/utils/id";
import type { Agreement } from "@/types/database";

/**
 * Check if jobs already exist for this agreement.
 *
 * REGENERATION TRAP — read before wiring this to anything new.
 *
 * This counts through the USER-SCOPED client (anon key + the operator's
 * cookie), so RLS applies and the jobs SELECT policy (029) filters
 * `deleted_at IS NULL`. Soft-deleted visits are therefore INVISIBLE to this
 * count.
 *
 * That matters now that cancelling an agreement soft-deletes its future
 * visits (migration 051). If a future "regenerate on reactivate" feature
 * called generateAgreementJobs for a previously-cancelled agreement, this
 * guard would read zero, conclude no visits exist, and generate a fresh set
 * from the agreement's ORIGINAL `start_date` — which by then is in the
 * past. The result is a pile of past-dated "scheduled" visits alongside the
 * soft-deleted originals.
 *
 * This is very likely what already happened to the live active agreement,
 * which carries 23 soft-deleted visits (a complete duplicate series on the
 * 16th of each month, plus duplicated 27th-series rows) beside its 8 live
 * ones.
 *
 * Not fixed here, deliberately: nothing calls generateAgreementJobs on a
 * status change today (only create and draft-finalise), so there is no live
 * bug to fix. Any future regeneration work needs a guard that survives soft
 * deletes AND a start date rebased on today, not just this function.
 */
async function hasJobsForAgreement(agreementId: string): Promise<boolean> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("agreement_id", agreementId);

  if (error) {
    console.error("[hasJobsForAgreement]", error.code, error.message);
    return false;
  }

  return (count ?? 0) > 0;
}

/**
 * Auto-generate scheduled jobs based on agreement frequency.
 *
 * Visit dates come from agreementVisitDates (agreement-schedule.ts):
 * an even spread across one year from start_date for ANY 1-52
 * visits-per-year, month-anchored up to 12/yr and day-based above.
 * (The old floor(12/frequency) interval bunched every non-divisor of
 * 12 into consecutive months — 8/yr generated monthly visits.)
 *
 * Prevents duplicates: skips if jobs already exist for this agreement.
 * Only generates for active agreements.
 */
export async function generateAgreementJobs(
  agreement: Agreement
): Promise<void> {
  if (!agreement.visit_frequency || !agreement.start_date) return;
  if (agreement.status !== "active") return;

  const exists = await hasJobsForAgreement(agreement.id);
  if (exists) return;

  const jobs = agreementVisitDates(
    agreement.start_date,
    agreement.visit_frequency
  ).map((jobDate) => ({
    id: newId(),
    site_id: agreement.site_id,
    job_date: jobDate,
    call_type: "routine" as const,
    pest_species: agreement.pest_species ?? [],
    job_status: "scheduled" as const,
    agreement_id: agreement.id,
  }));

  if (jobs.length === 0) return;

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("jobs").insert(jobs);

    if (error) {
      console.error("[generateAgreementJobs]", error.code, error.message);
    }
  } catch (err) {
    console.error("[generateAgreementJobs] Failed:", err);
  }
}

import { createClient } from "@/lib/supabase/server";
import { agreementVisitDates } from "@/lib/services/agreement-schedule";
import { newId } from "@/lib/utils/id";
import type { Agreement } from "@/types/database";

/**
 * Check if jobs already exist for this agreement.
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

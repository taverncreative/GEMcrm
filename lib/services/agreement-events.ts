import { createClient } from "@/lib/supabase/server";
import { dateUk } from "@/lib/utils/today-uk";
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
 * Uses month-based cadence: intervalMonths = floor(12 / frequency).
 *
 * Examples:
 *  12 visits/year → monthly (every 1 month)
 *   6 visits/year → every 2 months
 *   4 visits/year → quarterly (every 3 months)
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

  const frequency = agreement.visit_frequency;
  const intervalMonths = Math.max(1, Math.floor(12 / frequency));

  const jobs = [];
  for (let i = 0; i < frequency; i++) {
    const jobDate = new Date(agreement.start_date);
    jobDate.setMonth(jobDate.getMonth() + intervalMonths * i);

    jobs.push({
      site_id: agreement.site_id,
      job_date: dateUk(jobDate),
      call_type: "routine" as const,
      pest_species: agreement.pest_species ?? [],
      job_status: "scheduled" as const,
      agreement_id: agreement.id,
    });
  }

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

"use server";

import { revalidatePath } from "next/cache";
import { updateJobStatus } from "@/lib/data/jobs";
import { onJobCompleted } from "@/lib/services/job-events";
import { getJobById } from "@/lib/data/jobs";
import { getSiteById } from "@/lib/data/sites";
import { getReportByJobId } from "@/lib/data/reports";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionState } from "@/types/actions";
import type { JobStatus, Report } from "@/types/database";

const VALID_STATUSES: JobStatus[] = ["scheduled", "in_progress", "completed"];

export async function updateJobStatusAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireUser();
  const jobId = formData.get("job_id") as string;
  const status = formData.get("status") as string;

  if (!jobId) {
    return { success: false, errors: {}, message: "Missing job ID" };
  }

  if (!VALID_STATUSES.includes(status as JobStatus)) {
    return { success: false, errors: {}, message: "Invalid status" };
  }

  try {
    const job = await updateJobStatus(jobId, status as JobStatus);

    if (status === "completed") {
      const site = await getSiteById(job.site_id);
      if (site) {
        // sendReportEmail: false — completing via the status dropdown
        // must never email the customer. The auto-send here once mailed
        // the NEWEST report row, which can be a placeholder PDF from
        // the Generate Report button on an unfilled sheet. The sheet's
        // explicit "Complete & Email" is the only sender.
        await onJobCompleted(
          job,
          {
            customerId: site.customer_id,
            siteId: job.site_id,
          },
          { sendReportEmail: false }
        );
      }
    }
  } catch (err) {
    return {
      success: false,
      errors: {},
      message: err instanceof Error ? err.message : "Failed to update status",
    };
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  return { success: true, errors: {}, message: null };
}

/**
 * Read action for the job detail page (step 7 conversion).
 *
 * Reports are not in the syncable set (audit decision) — the offline
 * store never holds them. When the job detail page renders, it reads
 * the job/site/customer from Dexie via `useLiveQuery` but fetches the
 * report metadata server-side via this action on first online mount.
 *
 * Returns null if no report exists (or if the read fails). The detail
 * page renders a "PDF will be generated when synced" placeholder in
 * either case offline.
 */
export async function getReportByJobIdAction(
  jobId: string
): Promise<Report | null> {
  await requireUser();
  if (!jobId) return null;
  try {
    return await getReportByJobId(jobId);
  } catch {
    return null;
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { updateJobStatus } from "@/lib/data/jobs";
import { onJobCompleted } from "@/lib/services/job-events";
import { getJobById } from "@/lib/data/jobs";
import { getSiteById } from "@/lib/data/sites";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionState } from "@/types/actions";
import type { JobStatus } from "@/types/database";

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
        await onJobCompleted(job, {
          customerId: site.customer_id,
          siteId: job.site_id,
        });
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

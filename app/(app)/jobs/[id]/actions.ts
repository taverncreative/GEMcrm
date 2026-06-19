"use server";

import { revalidatePath } from "next/cache";
import {
  updateJobStatus,
  getJobById,
  deleteJob,
  getJobDeleteImpact,
} from "@/lib/data/jobs";
import type { JobDeleteImpact } from "@/lib/data/jobs";
import { getReportByJobId } from "@/lib/data/reports";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionState } from "@/types/actions";
import type { Report } from "@/types/database";

/**
 * L1 single-completion-route rule: the ONLY status this action moves a
 * job to is `in_progress` (Start Job / Start). Completion happens
 * exclusively through the service sheet (completeServiceSheetAction →
 * approveServiceSheetAction), whose L0 invariant requires a filled
 * sheet — so a one-tap empty completion is unreachable, online or via
 * outbox replay (a stale completed entry from an old client replays
 * here and is rejected into the conflicts inbox).
 */
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

  if (status === "completed") {
    return {
      success: false,
      errors: {},
      message: "Complete this job via its service sheet.",
    };
  }

  if (status !== "in_progress") {
    return { success: false, errors: {}, message: "Invalid status" };
  }

  try {
    await updateJobStatus(jobId, "in_progress");
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

/**
 * Impact preview for the delete-job confirm dialog — whether the job is on
 * an invoice (which will stand) and how many follow-up jobs link to it.
 */
export async function getJobDeleteImpactAction(
  jobId: string
): Promise<JobDeleteImpact> {
  await requireUser();
  return getJobDeleteImpact(jobId);
}

/**
 * Soft-delete a job. Online-only (mirrors customer delete); `requireUser`
 * gates it. The job's invoice/report/follow-ups are left in place — the job
 * just stops surfacing once `deleted_at` is set (see {@link deleteJob}).
 */
export async function deleteJobAction(
  jobId: string
): Promise<{ success: boolean; message?: string }> {
  await requireUser();
  if (!jobId) return { success: false, message: "Missing job id" };
  try {
    await deleteJob(jobId);
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/jobs");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to delete job",
    };
  }
}

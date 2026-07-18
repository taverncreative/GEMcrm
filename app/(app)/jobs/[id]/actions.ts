"use server";

import {
  updateJobStatus,
  rescheduleJob,
  setJobNeedsInvoice,
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

  // No revalidatePath — the jobs list and job detail are Dexie-live
  // (useLiveQuery) and the status button's applyLocal already wrote the new
  // status to Dexie, so they re-render off that. See setJobNeedsInvoiceAction
  // for the rationale (avoids the client-cache purge / prefetch stampede).
  return { success: true, errors: {}, message: null };
}

/**
 * Reschedule a job — move its date + time window. Offline-first: the
 * modal writes Dexie optimistically and enqueues ONE outbox entry, so
 * this runs on replay (and on an online submit via drainOutbox). The
 * data fn is guarded to never touch a completed job.
 */
export async function rescheduleJobAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireUser();
  const jobId = formData.get("job_id") as string;
  const jobDate = formData.get("job_date") as string;
  const jobTime = (formData.get("job_time") as string) ?? "";
  const jobTimeEnd = (formData.get("job_time_end") as string) ?? "";

  if (!jobId) {
    return { success: false, errors: {}, message: "Missing job ID" };
  }
  if (!jobDate) {
    return { success: false, errors: {}, message: "Pick a date" };
  }

  try {
    await rescheduleJob(jobId, {
      job_date: jobDate,
      job_time: jobTime,
      job_time_end: jobTimeEnd,
    });
  } catch (err) {
    return {
      success: false,
      errors: {},
      message: err instanceof Error ? err.message : "Failed to reschedule job",
    };
  }

  // No revalidatePath — the reschedule modal's applyLocal already wrote the
  // new date to Dexie and the Dexie-live job detail/list re-render off it.
  return { success: true, errors: {}, message: null };
}

/**
 * Toggle the "Invoices required" checklist flag on a job (migration 041).
 * Direct-call, wrapped local-first via wrapAction at the call site so the
 * flag round-trips offline (optimistic Dexie write + one outbox entry).
 */
export async function setJobNeedsInvoiceAction(
  jobId: string,
  needsInvoice: boolean
): Promise<{ success: boolean; message?: string }> {
  await requireUser();
  if (!jobId) return { success: false, message: "Missing job id" };
  try {
    await setJobNeedsInvoice(jobId, needsInvoice);
    // No revalidatePath. Both surfaces that show this flag read Dexie via
    // useLiveQuery — the job-detail NeedsInvoiceToggle and the dashboard
    // jobs-to-invoice tile — and the wrapAction call site already wrote the
    // flag to Dexie optimistically, so they re-render off that. A
    // revalidatePath here purges the whole client router cache (Next docs:
    // "purge the Client Cache … all previously visited pages refresh"),
    // which in production stampedes a re-prefetch of every link on the page
    // — the app-wide sluggishness — while refreshing a server render neither
    // surface reads. See feature-request-form for the same fix.
    return { success: true };
  } catch (err) {
    return {
      success: false,
      message:
        err instanceof Error ? err.message : "Failed to update invoice flag",
    };
  }
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
    // No revalidatePath — the delete-confirm dialog mirrors the soft-delete
    // into Dexie and calls router.refresh() itself, so the Dexie-live jobs
    // list drops the row without a client-cache purge / prefetch stampede.
    return { success: true };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to delete job",
    };
  }
}

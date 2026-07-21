import { db } from "@/lib/db";

/**
 * Apply the CANCEL action from the block-out resolve-jobs list.
 *
 * Soft-deletes each chosen job via an injected delete function (the block-out
 * modal passes `wrapDirectCallGracefully(deleteJobAction)` — the same
 * soft_delete_job RPC path the job-detail delete uses). On success it mirrors
 * `deleted_at` into the Dexie job row so the offline-first views drop it
 * immediately, matching DeleteJobConfirm.
 *
 * Dependency-injected delete fn so this stays a pure, unit-testable unit and
 * the caller owns the graceful-failure wrapping.
 *
 * BEST-EFFORT + NON-BLOCKING: a job whose delete fails (e.g. offline — job
 * soft-delete is online-only) is collected into `failures`, never thrown. The
 * caller runs this AFTER the block itself has saved, so the block-out is never
 * gated by a job-action failure (decision 4).
 *
 * Job soft-delete is online-only today (deleteJobAction hits the RPC directly,
 * not the outbox), so offline every id lands in `failures` with the graceful
 * "connection lost" message — the caller surfaces that without blocking.
 */
export interface CancelJobsResult {
  cancelled: string[];
  failures: Array<{ id: string; message: string }>;
}

export async function applyJobCancellations(
  jobIds: string[],
  deleteJob: (id: string) => Promise<{ success: boolean; message?: string }>
): Promise<CancelJobsResult> {
  const cancelled: string[] = [];
  const failures: Array<{ id: string; message: string }> = [];

  for (const id of jobIds) {
    let res: { success: boolean; message?: string };
    try {
      res = await deleteJob(id);
    } catch (err) {
      failures.push({
        id,
        message: err instanceof Error ? err.message : "Couldn't cancel job",
      });
      continue;
    }

    if (res.success) {
      // Mirror the soft-delete into Dexie so the calendar / lists drop it
      // without waiting for the next sync pull (the server row is updated).
      try {
        await db.jobs.update(id, { deleted_at: new Date().toISOString() });
      } catch {
        // Non-fatal — the next sync pull reconciles it.
      }
      cancelled.push(id);
    } else {
      failures.push({ id, message: res.message ?? "Couldn't cancel job" });
    }
  }

  return { cancelled, failures };
}

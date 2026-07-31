import { createClient } from "@/lib/supabase/server";
import { newId } from "@/lib/utils/id";
import type { Report } from "@/types/database";

export async function getReportByJobId(jobId: string): Promise<Report | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reports")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null;
    }
    console.error("[getReportByJobId]", error.code, error.message);
    throw new Error(`Failed to fetch report: ${error.message}`);
  }

  return data;
}

/**
 * Soft-delete a service sheet — sets `deleted_at = now()`.
 *
 * Goes through the `soft_delete_report` SECURITY DEFINER RPC (migration
 * 049), matching soft_delete_job / soft_delete_agreement. Strictly speaking
 * the RPC is not FORCED here the way it is for the core five: the `reports`
 * SELECT policy is a plain `using (true)` with no self-hiding `deleted_at is
 * null` predicate, so a direct `.update()` would not hit the 42501 catch-22
 * documented in CLAUDE.md (same position as library_documents). It is used
 * anyway so every soft-delete in the app has one shape, and so a future
 * tightening of the reports SELECT policy can't silently break this path.
 *
 * The stored PDF is deliberately LEFT in the `reports` bucket — consistent
 * with every other delete in the app (see the storage note on
 * {@link deleteCustomer}). The row stops surfacing because
 * `list_report_documents` filters `deleted_at is null`.
 *
 * SOFT ONLY. There is no hard-delete counterpart and there must not be:
 * migration 039 revoked hard DELETE on the core five specifically so no
 * cascade could wipe reports, and 049 extends that revoke to `reports`
 * itself. A signed service sheet is a record of work performed.
 */
export async function softDeleteReport(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("soft_delete_report", { p_id: id });
  if (error) {
    console.error("[softDeleteReport]", error.code, error.message);
    throw new Error(`Failed to delete service sheet: ${error.message}`);
  }
}

export async function createReport(
  jobId: string,
  pdfUrl: string
): Promise<Report> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reports")
    .insert({
      id: newId(),
      job_id: jobId,
      report_type: "service",
      pdf_url: pdfUrl,
    })
    .select()
    .single();

  if (error) {
    console.error("[createReport]", error.code, error.message);
    throw new Error(`Failed to create report: ${error.message}`);
  }

  return data;
}

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

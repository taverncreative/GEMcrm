import { createClient } from "@/lib/supabase/server";
import type { JobWithContext } from "@/lib/data/jobs";
import type { Task } from "@/types/database";

/**
 * Jobs within a date range (inclusive), for calendar display.
 * Returns jobs with site + customer context.
 */
export async function getJobsInRange(
  startDate: string,
  endDate: string
): Promise<JobWithContext[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("*, site:sites!inner(*, customer:customers!inner(*))")
    .gte("job_date", startDate)
    .lte("job_date", endDate)
    .order("job_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[getJobsInRange]", error.code, error.message);
    throw new Error(`Failed to fetch calendar jobs: ${error.message}`);
  }

  return (data ?? []) as unknown as JobWithContext[];
}

/**
 * Pending tasks with a due_date in the range. Used alongside jobs on calendar.
 */
export async function getTasksInRange(
  startDate: string,
  endDate: string
): Promise<Task[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("status", "pending")
    .gte("due_date", startDate)
    .lte("due_date", endDate)
    .order("priority_order", { ascending: false })
    .order("due_date", { ascending: true });

  if (error) {
    console.error("[getTasksInRange]", error.code, error.message);
    return [];
  }

  return data ?? [];
}

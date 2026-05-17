import { createClient } from "@/lib/supabase/server";
import { todayUk, dateUkOffset } from "@/lib/utils/today-uk";

export interface DailyStats {
  jobsCompletedToday: number;
  tasksCompletedToday: number;
}

export async function getDailyStats(): Promise<DailyStats> {
  const supabase = await createClient();
  const today = todayUk();

  const [jobsResult, tasksResult] = await Promise.all([
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("job_status", "completed")
      .eq("job_date", today),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("status", "complete")
      .eq("due_date", today),
  ]);

  return {
    jobsCompletedToday: jobsResult.count ?? 0,
    tasksCompletedToday: tasksResult.count ?? 0,
  };
}

export interface DailySummaryRow {
  id: string;
  summary_date: string;
  jobs_completed: number;
  tasks_completed: number;
  created_at: string;
}

export async function getRecentSummaries(
  days: number = 30
): Promise<DailySummaryRow[]> {
  const supabase = await createClient();
  const cutoff = dateUkOffset(-days);

  const { data, error } = await supabase
    .from("daily_summaries")
    .select("*")
    .gte("summary_date", cutoff)
    .order("summary_date", { ascending: false });

  if (error) {
    console.error("[getRecentSummaries]", error.code, error.message);
    throw new Error(`Failed to fetch summaries: ${error.message}`);
  }

  return data;
}

export async function finishDay(): Promise<void> {
  const supabase = await createClient();
  const today = todayUk();
  const stats = await getDailyStats();

  const { error } = await supabase
    .from("daily_summaries")
    .upsert(
      {
        summary_date: today,
        jobs_completed: stats.jobsCompletedToday,
        tasks_completed: stats.tasksCompletedToday,
      },
      { onConflict: "summary_date" }
    );

  if (error) {
    console.error("[finishDay]", error.code, error.message);
    throw new Error(`Failed to save daily summary: ${error.message}`);
  }
}

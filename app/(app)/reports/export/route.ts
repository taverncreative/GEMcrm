import { getRecentSummaries } from "@/lib/data/daily-stats";
import { todayUk } from "@/lib/utils/today-uk";
import { requireUser } from "@/lib/auth/require-user";

export async function GET() {
  await requireUser();
  const summaries = await getRecentSummaries(30);

  const header = "Date,Jobs Completed,Tasks Completed,Total";
  const rows = summaries.map((row) => {
    const date = row.summary_date;
    const total = row.jobs_completed + row.tasks_completed;
    return `${date},${row.jobs_completed},${row.tasks_completed},${total}`;
  });

  const csv = [header, ...rows].join("\n");
  const today = todayUk();

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="gemcrm-report-${today}.csv"`,
    },
  });
}

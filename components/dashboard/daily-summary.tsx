import { FinishDayButton } from "@/components/dashboard/finish-day-button";
import type { DailyStats } from "@/lib/data/daily-stats";

interface DailySummaryProps {
  stats: DailyStats;
  allDone: boolean;
}

export function DailySummary({ stats, allDone }: DailySummaryProps) {
  const hasActivity = stats.jobsCompletedToday > 0 || stats.tasksCompletedToday > 0;

  if (!allDone && !hasActivity) return null;

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
        Today&apos;s progress
      </h2>

      <div className="mt-4 flex gap-6">
        <StatBlock
          value={stats.jobsCompletedToday}
          label={stats.jobsCompletedToday === 1 ? "job completed" : "jobs completed"}
          color="text-brand-darker"
        />
        <StatBlock
          value={stats.tasksCompletedToday}
          label={stats.tasksCompletedToday === 1 ? "task done" : "tasks done"}
          color="text-blue-600"
        />
      </div>

      {allDone && hasActivity && (
        <div className="mt-4 flex items-center justify-between rounded-lg bg-brand-soft px-4 py-3">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            <span className="text-sm font-medium text-brand-darker">
              All done — great work today
            </span>
          </div>
          <FinishDayButton />
        </div>
      )}
    </div>
  );
}

function StatBlock({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: string;
}) {
  return (
    <div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

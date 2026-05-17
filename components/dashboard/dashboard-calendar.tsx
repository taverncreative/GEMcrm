import Link from "next/link";
import { ROUTES } from "@/lib/constants/routes";
import { JOB_STATUS_COLORS } from "@/lib/constants/job-labels";
import type { JobWithContext } from "@/lib/data/jobs";
import type { Task, JobStatus } from "@/types/database";

interface DashboardCalendarProps {
  jobs: JobWithContext[];
  tasks: Task[];
  /** Reference date — month rendered is the one containing this. */
  monthStart: Date;
}

function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Compact 5-week month grid for the dashboard.
 * No prev/next nav — the dashboard always shows the current month.
 * Days are clickable links that filter the Jobs list for that day.
 */
export function DashboardCalendar({
  jobs,
  tasks,
  monthStart,
}: DashboardCalendarProps) {
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();

  const jobsByDate = new Map<string, JobWithContext[]>();
  for (const j of jobs) {
    const existing = jobsByDate.get(j.job_date) ?? [];
    existing.push(j);
    jobsByDate.set(j.job_date, existing);
  }
  const tasksByDate = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.due_date) continue;
    const existing = tasksByDate.get(t.due_date) ?? [];
    existing.push(t);
    tasksByDate.set(t.due_date, existing);
  }

  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekdayOfFirst = (firstOfMonth.getDay() + 6) % 7; // 0 = Mon
  const gridStart = new Date(year, month, 1 - weekdayOfFirst);
  const totalCells = Math.ceil((weekdayOfFirst + daysInMonth) / 7) * 7;

  const cells: Date[] = [];
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }

  const todayKey = toKey(new Date());
  const weekdayLabels = ["M", "T", "W", "T", "F", "S", "S"];
  const monthLabel = firstOfMonth.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="rounded-xl bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-medium text-gray-700">{monthLabel}</h3>
      </div>

      <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50">
        {weekdayLabels.map((l, i) => (
          <div
            key={i}
            className="px-1 py-1.5 text-center text-[9px] font-semibold uppercase tracking-wider text-gray-400"
          >
            {l}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((date, idx) => {
          const key = toKey(date);
          const inMonth = date.getMonth() === month;
          const isToday = key === todayKey;
          const dayJobs = jobsByDate.get(key) ?? [];
          const dayTasks = tasksByDate.get(key) ?? [];
          const total = dayJobs.length + dayTasks.length;

          const top = dayJobs[0];
          const dotColor = top
            ? JOB_STATUS_COLORS[top.job_status as JobStatus]
            : dayTasks.length > 0
              ? "bg-purple-100 text-purple-700"
              : "";

          return (
            <Link
              key={idx}
              href={`${ROUTES.JOBS}?date=${key}`}
              className={`flex h-14 flex-col items-center justify-center border-b border-r border-gray-100 text-xs hover:bg-gray-50 ${
                inMonth ? "" : "bg-gray-50/50 text-gray-300"
              } ${(idx + 1) % 7 === 0 ? "border-r-0" : ""} ${
                idx >= cells.length - 7 ? "border-b-0" : ""
              }`}
            >
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium ${
                  isToday ? "bg-brand text-white" : ""
                }`}
              >
                {date.getDate()}
              </span>
              {total > 0 && inMonth && (
                <span
                  className={`mt-0.5 inline-flex h-2 min-w-[12px] items-center justify-center rounded-full px-1 text-[8px] font-semibold ${
                    dotColor || "bg-gray-100 text-gray-600"
                  }`}
                >
                  {total}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

import Link from "next/link";
import { ROUTES } from "@/lib/constants/routes";
import { JOB_STATUS_COLORS } from "@/lib/constants/job-labels";
import { formatAddress } from "@/lib/utils/format-address";
import { customerDisplayName } from "@/lib/utils/customer-display-name";
import { CalendarTaskChip } from "@/components/calendar/calendar-task-chip";
import type { JobWithContext } from "@/lib/data/jobs";
import type { JobStatus, Task } from "@/types/database";

interface MonthCalendarProps {
  year: number;
  month: number; // 0-11
  jobs: JobWithContext[];
  tasks: Task[];
}

function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMonthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

export function MonthCalendar({ year, month, jobs, tasks }: MonthCalendarProps) {
  // Group jobs + tasks by date key for O(1) lookup during grid render.
  const jobsByDate = new Map<string, JobWithContext[]>();
  for (const job of jobs) {
    const existing = jobsByDate.get(job.job_date);
    if (existing) existing.push(job);
    else jobsByDate.set(job.job_date, [job]);
  }

  const tasksByDate = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.due_date) continue;
    const existing = tasksByDate.get(task.due_date);
    if (existing) existing.push(task);
    else tasksByDate.set(task.due_date, [task]);
  }

  // Build grid: start from Monday of week containing day 1.
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // UK-style: week starts Monday. getDay() returns 0 (Sun) to 6 (Sat).
  const weekdayOfFirst = (firstOfMonth.getDay() + 6) % 7; // 0 = Mon
  const gridStart = new Date(year, month, 1 - weekdayOfFirst);

  const totalDays = weekdayOfFirst + daysInMonth;
  const totalCells = Math.ceil(totalDays / 7) * 7;

  const cells: Date[] = [];
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }

  const prevMonth = new Date(year, month - 1, 1);
  const nextMonth = new Date(year, month + 1, 1);
  const todayKey = toKey(new Date());

  const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  function monthParam(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <Link
            href={`${ROUTES.CALENDAR}?m=${monthParam(prevMonth)}`}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Previous month"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 19.5 8.25 12l7.5-7.5"
              />
            </svg>
          </Link>
          <h2 className="text-base font-semibold text-gray-900">
            {formatMonthLabel(year, month)}
          </h2>
          <Link
            href={`${ROUTES.CALENDAR}?m=${monthParam(nextMonth)}`}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Next month"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m8.25 4.5 7.5 7.5-7.5 7.5"
              />
            </svg>
          </Link>
        </div>
        <Link
          href={ROUTES.CALENDAR}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          Today
        </Link>
      </div>

      {/* Weekday row */}
      <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50">
        {weekdayLabels.map((label) => (
          <div
            key={label}
            className="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-gray-500"
          >
            {label}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7">
        {cells.map((date, idx) => {
          const key = toKey(date);
          const isCurrentMonth = date.getMonth() === month;
          const isToday = key === todayKey;
          const dayJobs = jobsByDate.get(key) ?? [];
          const dayTasks = tasksByDate.get(key) ?? [];
          const totalItems = dayJobs.length + dayTasks.length;

          return (
            <div
              key={idx}
              className={`min-h-24 border-b border-r border-gray-100 p-1.5 sm:min-h-28 ${
                isCurrentMonth ? "bg-white" : "bg-gray-50/50"
              } ${(idx + 1) % 7 === 0 ? "border-r-0" : ""} ${
                idx >= cells.length - 7 ? "border-b-0" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                    isToday
                      ? "bg-brand text-white"
                      : isCurrentMonth
                      ? "text-gray-700"
                      : "text-gray-300"
                  }`}
                >
                  {date.getDate()}
                </span>
                {totalItems > 0 && !isToday && (
                  <span className="text-[10px] text-gray-400">{totalItems}</span>
                )}
              </div>
              <div className="mt-1 space-y-0.5">
                {dayJobs.slice(0, 2).map((job) => {
                  const statusColor =
                    JOB_STATUS_COLORS[job.job_status as JobStatus] ??
                    "bg-gray-100 text-gray-700";
                  // Past-dated scheduled jobs are "service sheets to fill" — flag amber.
                  const serviceSheetMissing =
                    job.job_date < todayKey && job.job_status !== "completed";
                  const icon =
                    job.job_status === "completed"
                      ? "✓"
                      : job.job_status === "in_progress"
                        ? "◐"
                        : serviceSheetMissing
                          ? "!"
                          : "○";
                  const iconClass = serviceSheetMissing
                    ? "bg-amber-100 text-amber-700"
                    : statusColor;
                  return (
                    <Link
                      key={job.id}
                      href={ROUTES.jobDetail(job.id)}
                      className={`flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] font-medium hover:opacity-80 ${iconClass}`}
                      title={`${customerDisplayName(job.site.customer)} — ${formatAddress(job.site)}${serviceSheetMissing ? " · service sheet not filled" : ""}`}
                    >
                      <span aria-hidden="true" className="font-bold">
                        {icon}
                      </span>
                      <span className="truncate">
                        {customerDisplayName(job.site.customer)}
                      </span>
                    </Link>
                  );
                })}
                {dayTasks.slice(0, Math.max(1, 3 - Math.min(dayJobs.length, 2))).map(
                  (task) => (
                    <CalendarTaskChip key={task.id} task={task} />
                  )
                )}
                {totalItems > 3 && (
                  <p className="px-1 text-[10px] text-gray-400">
                    +{totalItems - 3} more
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

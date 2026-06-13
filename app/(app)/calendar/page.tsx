import Link from "next/link";
import { getJobsInRange, getTasksInRange } from "@/lib/data/calendar";
import { MonthCalendar } from "@/components/calendar/month-calendar";
import { StartJobButton } from "@/components/jobs/start-job-button";
import { ROUTES } from "@/lib/constants/routes";
import { JOB_STATUS_LABELS } from "@/lib/constants/job-labels";
import { formatAddress } from "@/lib/utils/format-address";
import { dateUk } from "@/lib/utils/today-uk";
import type { JobStatus } from "@/types/database";

interface CalendarPageProps {
  searchParams: Promise<{ m?: string }>;
}

// Parse "YYYY-MM" into year/month. Falls back to current month.
function parseMonthParam(
  value: string | undefined
): { year: number; month: number } {
  if (value) {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (match) {
      const y = Number(match[1]);
      const m = Number(match[2]) - 1;
      if (Number.isInteger(y) && y >= 1970 && y <= 2100 && m >= 0 && m <= 11) {
        return { year: y, month: m };
      }
    }
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

function rangeForMonth(year: number, month: number): {
  start: string;
  end: string;
} {
  // Include leading days from previous month and trailing from next to fill the grid.
  const first = new Date(year, month, 1);
  const weekdayOfFirst = (first.getDay() + 6) % 7; // 0 = Mon
  const gridStart = new Date(year, month, 1 - weekdayOfFirst);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((weekdayOfFirst + daysInMonth) / 7) * 7;
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridStart.getDate() + totalCells - 1);

  return {
    start: dateUk(gridStart),
    end: dateUk(gridEnd),
  };
}

export default async function CalendarPage({
  searchParams,
}: CalendarPageProps) {
  const { m } = await searchParams;
  const { year, month } = parseMonthParam(m);
  const { start, end } = rangeForMonth(year, month);

  const [jobs, tasks] = await Promise.all([
    getJobsInRange(start, end),
    getTasksInRange(start, end),
  ]);

  // Split this-month jobs for the side list
  const firstOfMonth = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const lastOfMonth = `${year}-${String(month + 1).padStart(2, "0")}-${String(
    lastDay
  ).padStart(2, "0")}`;

  const thisMonthJobs = jobs.filter(
    (j) => j.job_date >= firstOfMonth && j.job_date <= lastOfMonth
  );
  const thisMonthTasks = tasks.filter(
    (t) => t.due_date && t.due_date >= firstOfMonth && t.due_date <= lastOfMonth
  );

  // Counts per status. `draft` is tracked so the type stays exhaustive,
  // but drafts are unconfirmed jottings — kept out of the month "glance"
  // panel (see the filtered render below) until upgraded.
  const counts: Record<JobStatus, number> = {
    scheduled: 0,
    in_progress: 0,
    completed: 0,
    draft: 0,
  };
  for (const j of thisMonthJobs) {
    const st = j.job_status as JobStatus;
    if (st in counts) counts[st]++;
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Calendar</h1>
        </div>
        <StartJobButton label="New Booking" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        <MonthCalendar year={year} month={month} jobs={jobs} tasks={tasks} />

        <aside className="space-y-6">
          {/* Month stats */}
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <h3 className="text-sm font-medium text-gray-500">
              This month at a glance
            </h3>
            <dl className="mt-3 space-y-2">
              {(Object.keys(counts) as JobStatus[])
                .filter((st) => st !== "draft")
                .map((st) => (
                  <div
                    key={st}
                    className="flex items-center justify-between text-sm"
                  >
                    <dt className="text-gray-600">{JOB_STATUS_LABELS[st]}</dt>
                    <dd className="font-semibold text-gray-900">{counts[st]}</dd>
                  </div>
                ))}
              <div className="flex items-center justify-between text-sm">
                <dt className="text-gray-600">Pending tasks</dt>
                <dd className="font-semibold text-gray-900">
                  {thisMonthTasks.length}
                </dd>
              </div>
              <div className="flex items-center justify-between border-t border-gray-100 pt-2 text-sm">
                <dt className="text-gray-500">Total items</dt>
                <dd className="font-semibold text-gray-900">
                  {thisMonthJobs.length + thisMonthTasks.length}
                </dd>
              </div>
            </dl>
          </div>

          {/* Legend */}
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <h3 className="text-sm font-medium text-gray-500">Legend</h3>
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-blue-100 text-[9px] font-bold text-blue-700">
                  ○
                </span>
                <span className="text-gray-600">Scheduled booking</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-amber-100 text-[9px] font-bold text-amber-700">
                  ◐
                </span>
                <span className="text-gray-600">In progress</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-brand-soft text-[9px] font-bold text-brand-darker">
                  ✓
                </span>
                <span className="text-gray-600">Completed</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-amber-100 text-[9px] font-bold text-amber-700">
                  !
                </span>
                <span className="text-gray-600">Service sheet missing</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded bg-purple-100 ring-1 ring-purple-200" />
                <span className="text-gray-600">Pending task</span>
              </div>
            </div>
          </div>

          {/* Upcoming list */}
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-500">Upcoming jobs</h3>
              <Link
                href={ROUTES.JOBS}
                className="text-xs font-medium text-brand-darker hover:text-brand-darker"
              >
                All jobs →
              </Link>
            </div>
            {thisMonthJobs.length === 0 ? (
              <p className="mt-3 text-sm text-gray-400">
                No jobs scheduled this month.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {thisMonthJobs.slice(0, 6).map((job) => (
                  <li key={job.id}>
                    <Link
                      href={ROUTES.jobDetail(job.id)}
                      className="block rounded-lg border border-gray-100 px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      <p className="font-medium text-gray-900">
                        {new Date(job.job_date).toLocaleDateString("en-GB", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                      </p>
                      <p className="truncate text-xs text-gray-500">
                        {job.site.customer.name} · {formatAddress(job.site)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

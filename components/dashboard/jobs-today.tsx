import { WidgetCard } from "./widget-card";
import { formatJobTime } from "@/lib/utils/format-time";
import { ROUTES } from "@/lib/constants/routes";
import type { JobWithContext } from "@/lib/data/jobs";
import Link from "next/link";

interface JobsTodayProps {
  jobs: JobWithContext[];
}

/**
 * Today's bookings, sorted by time. Calm-pass: each row is a single
 * tap-through link showing only the time (when set) + customer name. The
 * previous per-row context (address, call type, pest species) and the
 * inline status action / status pill have been removed to keep the row
 * quiet — status changes happen on the job itself now.
 */
export function JobsToday({ jobs }: JobsTodayProps) {
  // Sort: jobs with a time first (ascending), then untimed ("All day").
  const sorted = [...jobs].sort((a, b) => {
    if (a.job_time && b.job_time) return a.job_time.localeCompare(b.job_time);
    if (a.job_time) return -1;
    if (b.job_time) return 1;
    return 0;
  });

  return (
    <WidgetCard title="Jobs Today">
      {sorted.length === 0 ? (
        <div className="py-4 text-center">
          <p className="text-sm text-gray-400">No jobs scheduled for today.</p>
          <Link
            href={ROUTES.JOBS}
            className="mt-2 inline-block text-xs font-medium text-brand-darker hover:text-brand-darker"
          >
            View all jobs
          </Link>
        </div>
      ) : (
        <>
          <p className="text-3xl font-semibold text-gray-900">{sorted.length}</p>
          <ul className="mt-3 space-y-1.5">
            {sorted.slice(0, 6).map((job) => (
              <li key={job.id}>
                <Link
                  href={ROUTES.jobDetail(job.id)}
                  className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2 transition-colors hover:bg-gray-50"
                >
                  {job.job_time && (
                    <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-gray-700">
                      {formatJobTime(job.job_time)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                    {job.site.customer.name}
                  </span>
                </Link>
              </li>
            ))}
            {sorted.length > 6 && (
              <li className="pt-1 text-center">
                <Link
                  href={`${ROUTES.JOBS}?filter=today`}
                  className="text-xs font-medium text-gray-500 hover:text-gray-700"
                >
                  View all {sorted.length}
                </Link>
              </li>
            )}
          </ul>
        </>
      )}
    </WidgetCard>
  );
}

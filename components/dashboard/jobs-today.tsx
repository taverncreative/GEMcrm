import { WidgetCard } from "./widget-card";
import { formatAddress } from "@/lib/utils/format-address";
import { formatJobTime } from "@/lib/utils/format-time";
import { ROUTES } from "@/lib/constants/routes";
import {
  CALL_TYPE_LABELS,
  JOB_STATUS_COLORS,
  JOB_STATUS_LABELS,
} from "@/lib/constants/job-labels";
import { JobQuickAction } from "@/components/jobs/job-status-actions";
import type { JobWithContext } from "@/lib/data/jobs";
import type { CallType, JobStatus } from "@/types/database";
import Link from "next/link";

interface JobsTodayProps {
  jobs: JobWithContext[];
}

/**
 * Today's bookings, sorted by time. Each row shows:
 *   time · customer · address · call type · pest species
 *
 * The content area is a single `<Link>` to the job detail (so a tap
 * anywhere on the body drills in). The status-action button sits as a
 * sibling of the Link — not nested inside it — so we don't end up with
 * the invalid `<button>` inside `<a>` markup.
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
            {sorted.slice(0, 6).map((job) => {
              const callLabel = job.call_type
                ? CALL_TYPE_LABELS[job.call_type as CallType] ?? job.call_type
                : null;
              const pests = job.pest_species ?? [];
              return (
                <li
                  key={job.id}
                  className="group flex items-start gap-2 rounded-lg border border-gray-100 px-2 py-2 transition-colors hover:bg-gray-50"
                >
                  <Link
                    href={ROUTES.jobDetail(job.id)}
                    className="flex min-w-0 flex-1 items-start gap-3"
                  >
                    <span
                      className={`mt-0.5 shrink-0 rounded font-mono text-[11px] tabular-nums ${
                        job.job_time
                          ? "bg-gray-100 px-1.5 py-0.5 text-gray-700"
                          : "text-gray-400"
                      }`}
                    >
                      {formatJobTime(job.job_time)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-gray-900 group-hover:text-gray-700">
                          {job.site.customer.name}
                        </span>
                        {callLabel && (
                          <span className="shrink-0 text-[11px] text-gray-500">
                            · {callLabel}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-gray-500">
                        {formatAddress(job.site)}
                      </p>
                      {pests.length > 0 && (
                        <p className="mt-0.5 truncate text-xs text-gray-600">
                          {pests.join(", ")}
                        </p>
                      )}
                    </div>
                  </Link>
                  <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5 sm:flex-row sm:items-center sm:gap-1.5">
                    <JobQuickAction
                      jobId={job.id}
                      currentStatus={job.job_status as JobStatus}
                    />
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${JOB_STATUS_COLORS[job.job_status as JobStatus]}`}
                    >
                      {JOB_STATUS_LABELS[job.job_status as JobStatus]}
                    </span>
                  </div>
                </li>
              );
            })}
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

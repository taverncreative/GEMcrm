import Link from "next/link";
import { formatAddress } from "@/lib/utils/format-address";
import { ROUTES } from "@/lib/constants/routes";
import { JobQuickAction } from "@/components/jobs/job-status-actions";
import type { JobWithContext } from "@/lib/data/jobs";
import type { JobStatus } from "@/types/database";

interface OverdueJobsAlertProps {
  jobs: JobWithContext[];
}

export function OverdueJobsAlert({ jobs }: OverdueJobsAlertProps) {
  if (jobs.length === 0) return null;

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
      <div className="flex items-center gap-2">
        <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
        <h3 className="text-sm font-semibold text-red-800">
          {jobs.length} overdue job{jobs.length !== 1 ? "s" : ""}
        </h3>
      </div>
      <ul className="mt-3 space-y-2">
        {jobs.slice(0, 5).map((job) => (
          <li
            key={job.id}
            className="flex items-center justify-between gap-2 text-sm"
          >
            <div className="min-w-0 flex-1">
              <Link
                href={ROUTES.jobDetail(job.id)}
                className="font-medium text-red-800 hover:underline"
              >
                {job.site.customer.name}
              </Link>
              <span className="ml-2 text-red-600">
                {formatAddress(job.site)}
              </span>
              <span className="ml-2 text-red-500">
                {new Date(job.job_date).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                })}
              </span>
            </div>
            <JobQuickAction jobId={job.id} currentStatus={job.job_status as JobStatus} />
          </li>
        ))}
      </ul>
    </div>
  );
}

import Link from "next/link";
import { formatAddress } from "@/lib/utils/format-address";
import { formatJobTime } from "@/lib/utils/format-time";
import { ROUTES } from "@/lib/constants/routes";
import { CALL_TYPE_LABELS } from "@/lib/constants/job-labels";
import type { JobWithContext } from "@/lib/data/jobs";
import type { CallType } from "@/types/database";

interface ServiceSheetsToFillProps {
  jobs: JobWithContext[];
}

/**
 * Past-date bookings that don't yet have a completed Service Sheet.
 *
 * Each row surfaces full context — time, customer, address, call type,
 * pest species, follow-up flag — so the operator can decide what to fill
 * in next without clicking through. The row body is a single Link to the
 * job detail; the per-row "Fill" action sits as a sibling so we don't
 * end up with nested clickable elements. Review requests happen later
 * via the dedicated "Request review" widget, once the sheet is filled.
 */
export function ServiceSheetsToFill({ jobs }: ServiceSheetsToFillProps) {
  if (jobs.length === 0) {
    return (
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <h3 className="text-sm font-medium text-gray-500">Service sheets to fill</h3>
        <p className="mt-3 text-sm text-gray-400">
          Nothing waiting — all visits up to date.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-500">
          Service sheets to fill
        </h3>
        <span className="text-xs text-gray-400">{jobs.length}</span>
      </div>
      <ul className="space-y-2">
        {jobs.slice(0, 5).map((job) => {
          const isFollowUp = !!job.parent_job_id;
          const callType = job.call_type
            ? CALL_TYPE_LABELS[job.call_type as CallType] ?? job.call_type
            : null;
          const pests = job.pest_species ?? [];
          return (
            <li
              key={job.id}
              className="rounded-lg border border-gray-100 px-3 py-2.5 transition-colors hover:bg-gray-50"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <Link
                  href={ROUTES.jobDetail(job.id)}
                  className="min-w-0 flex-1"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-gray-900">
                      {job.site.customer.name}
                    </span>
                    {job.reference_number && (
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                          isFollowUp
                            ? "bg-blue-50 text-blue-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {job.reference_number}
                      </span>
                    )}
                    {isFollowUp && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700">
                        Follow up
                      </span>
                    )}
                    {callType && (
                      <span className="text-xs text-gray-500">· {callType}</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-gray-500">
                    {formatAddress(job.site)}
                    {" · "}
                    {new Date(job.job_date).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}
                    {job.job_time && (
                      <span className="ml-1 font-mono tabular-nums text-gray-600">
                        {formatJobTime(job.job_time)}
                      </span>
                    )}
                  </p>
                  {pests.length > 0 && (
                    <p className="mt-0.5 truncate text-xs text-gray-600">
                      {pests.join(", ")}
                    </p>
                  )}
                  {job.report_notes && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">
                      {job.report_notes}
                    </p>
                  )}
                </Link>
                <Link
                  href={`${ROUTES.jobDetail(job.id)}/complete`}
                  className="block w-full shrink-0 self-stretch rounded-lg bg-brand px-3 py-2 text-center text-xs font-medium text-white shadow-sm hover:bg-brand-dark sm:w-auto sm:self-start sm:py-1"
                >
                  Fill
                </Link>
              </div>
            </li>
          );
        })}
        {jobs.length > 5 && (
          <li className="pt-1 text-center">
            <Link
              href={`${ROUTES.JOBS}?filter=upcoming`}
              className="text-xs font-medium text-gray-500 hover:text-gray-700"
            >
              View all {jobs.length}
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}

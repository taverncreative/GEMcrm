import Link from "next/link";
import { ROUTES } from "@/lib/constants/routes";
import type { JobWithContext } from "@/lib/data/jobs";

interface ServiceSheetsToFillProps {
  jobs: JobWithContext[];
}

/**
 * Past-date bookings that don't yet have a completed Service Sheet.
 *
 * Calm-pass: each row is now a single tap target showing only the
 * customer name — the whole row links straight to the fill screen
 * (.../complete), with a subtle chevron as the tap affordance. The
 * previous per-row context (job ref, call type, address, pest species,
 * follow-up flag) and the standalone green "Fill" button are gone; the
 * operator reads the detail once they're on the sheet.
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
      <ul className="space-y-1.5">
        {jobs.slice(0, 5).map((job) => (
          <li key={job.id}>
            <Link
              href={`${ROUTES.jobDetail(job.id)}/complete`}
              className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2.5 transition-colors hover:bg-gray-50"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                {job.site.customer.name}
              </span>
              <ChevronRight />
            </Link>
          </li>
        ))}
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

function ChevronRight() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-gray-300"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  );
}

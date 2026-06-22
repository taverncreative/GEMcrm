import Link from "next/link";
import { ROUTES } from "@/lib/constants/routes";
import type { JobWithContext } from "@/lib/data/jobs";
import { customerDisplayName } from "@/lib/utils/customer-display-name";

interface JobsToInvoiceProps {
  jobs: JobWithContext[];
}

/** Whole-pound £ formatting, matching the Revenue widget's convention. */
function gbp(n: number): string {
  return `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

/**
 * Completed jobs that haven't been billed yet — Nate's "don't forget to
 * invoice" nudge, one stage downstream of "Service sheets to fill". Mirrors
 * that widget: each row is a single tap target (customer name + the job's
 * value) linking to the job detail, where the Create Invoice CTA lives. The
 * header carries the total still waiting to bill.
 */
export function JobsToInvoice({ jobs }: JobsToInvoiceProps) {
  if (jobs.length === 0) {
    return (
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <h3 className="text-sm font-medium text-gray-500">To invoice</h3>
        <p className="mt-3 text-sm text-gray-400">
          Nothing waiting — all completed jobs are billed.
        </p>
      </div>
    );
  }

  const total = jobs.reduce((sum, job) => sum + Number(job.value ?? 0), 0);

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-500">To invoice</h3>
        {/* Total still waiting to bill across the pending jobs. */}
        <span className="text-xs font-medium text-gray-500">{gbp(total)}</span>
      </div>
      <ul className="space-y-1.5">
        {jobs.slice(0, 5).map((job) => (
          <li key={job.id}>
            <Link
              href={ROUTES.jobDetail(job.id)}
              className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2.5 transition-colors hover:bg-gray-50"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                {customerDisplayName(job.site.customer)}
              </span>
              {job.value != null && (
                <span className="shrink-0 text-sm tabular-nums text-gray-500">
                  {gbp(Number(job.value))}
                </span>
              )}
              <ChevronRight />
            </Link>
          </li>
        ))}
        {jobs.length > 5 && (
          <li className="pt-1 text-center">
            <Link
              href={ROUTES.JOBS}
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

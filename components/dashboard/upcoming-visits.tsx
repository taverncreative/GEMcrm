import { WidgetCard } from "./widget-card";
import { CALL_TYPE_LABELS } from "@/lib/constants/job-labels";
import { formatJobTime } from "@/lib/utils/format-time";
import { formatAddress } from "@/lib/utils/format-address";
import { ROUTES } from "@/lib/constants/routes";
import type { JobWithContext } from "@/lib/data/jobs";
import type { CallType } from "@/types/database";
import Link from "next/link";

interface UpcomingVisitsProps {
  jobs: JobWithContext[];
}

const SHORT_DATE: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
};

/**
 * Upcoming bookings — next few scheduled visits from today onwards. Each
 * row is a single tap target that opens the job detail page. Surfaces
 * date + time + customer + address + call type + pest species so the
 * operator can scan the upcoming week without clicking in.
 */
export function UpcomingVisits({ jobs }: UpcomingVisitsProps) {
  return (
    <WidgetCard title="Upcoming Visits">
      {jobs.length === 0 ? (
        <div className="py-4 text-center">
          <p className="text-sm text-gray-400">No upcoming visits scheduled.</p>
          <Link
            href={ROUTES.CUSTOMERS}
            className="mt-2 inline-block text-xs font-medium text-brand-darker hover:text-brand-darker"
          >
            Add a customer
          </Link>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {jobs.map((job) => {
            const callLabel = job.call_type
              ? CALL_TYPE_LABELS[job.call_type as CallType] ?? job.call_type
              : null;
            const pests = job.pest_species ?? [];
            const dateLabel = new Date(job.job_date).toLocaleDateString(
              "en-GB",
              SHORT_DATE
            );
            return (
              <li key={job.id}>
                <Link
                  href={ROUTES.jobDetail(job.id)}
                  className="block rounded-lg border border-gray-100 px-3 py-2 transition-colors hover:bg-gray-50"
                >
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-semibold text-gray-700">
                        {dateLabel}
                      </p>
                      <p
                        className={`mt-0.5 font-mono text-[11px] tabular-nums ${
                          job.job_time ? "text-gray-600" : "text-gray-400"
                        }`}
                      >
                        {formatJobTime(job.job_time)}
                      </p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-gray-900">
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
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}

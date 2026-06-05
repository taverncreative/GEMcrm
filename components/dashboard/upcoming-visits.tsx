import { ROUTES } from "@/lib/constants/routes";
import type { JobWithContext } from "@/lib/data/jobs";
import Link from "next/link";

interface UpcomingVisitsProps {
  jobs: JobWithContext[];
}

const SHORT_DATE: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
};

type DueTone = "red" | "orange" | "green" | null;

// Bucket a visit date relative to today (date-only, no time-of-day drift).
//   red    = due now / overdue (on or before today)
//   orange = within the next 7 days
//   green  = within the next 30 days
//   null   = further out (no accent bar)
function dueTone(jobDate: string): DueTone {
  const [y, m, d] = jobDate.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const visit = new Date(y, m - 1, d);
  const days = Math.round((visit.getTime() - today.getTime()) / 86_400_000);
  if (days <= 0) return "red";
  if (days <= 7) return "orange";
  if (days <= 30) return "green";
  return null;
}

const BAR: Record<NonNullable<DueTone>, { cls: string; title: string }> = {
  red: { cls: "bg-red-500", title: "Due now / overdue" },
  orange: { cls: "bg-amber-500", title: "Due within 7 days" },
  green: { cls: "bg-emerald-500", title: "Due within 30 days" },
};

/**
 * Upcoming bookings — a FEATURED primary section near the top of the
 * dashboard (rendered outside the reorderable widget grid). The section
 * is given prominence: a strong heading and generous breathing room.
 *
 * Each ROW stays deliberately minimal — a thin full-height due-ness bar
 * on the left edge (red = due/overdue, orange = ≤7d, green = ≤30d, none
 * beyond), the date, and the customer name. The whole row taps through to
 * the job in a single hop.
 */
export function UpcomingVisits({ jobs }: UpcomingVisitsProps) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Upcoming visits</h2>
        {jobs.length > 0 && (
          <span className="text-xs font-medium text-gray-400">
            Next {jobs.length}
          </span>
        )}
      </div>

      {jobs.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm text-gray-400">No upcoming visits scheduled.</p>
          <Link
            href={ROUTES.CUSTOMERS}
            className="mt-2 inline-block text-xs font-medium text-brand-darker hover:text-brand-darker"
          >
            Add a customer
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {jobs.map((job) => {
            const tone = dueTone(job.job_date);
            const bar = tone ? BAR[tone] : null;
            const dateLabel = new Date(job.job_date).toLocaleDateString(
              "en-GB",
              SHORT_DATE
            );
            return (
              <li key={job.id}>
                <Link
                  href={ROUTES.jobDetail(job.id)}
                  className="relative flex items-center gap-3 overflow-hidden rounded-lg border border-gray-100 py-2.5 pl-4 pr-3 transition-colors hover:bg-gray-50"
                >
                  {/* Thin full-height due-ness bar on the left edge. */}
                  {bar && (
                    <span
                      className={`absolute inset-y-0 left-0 w-1 ${bar.cls}`}
                      title={bar.title}
                      aria-hidden="true"
                    />
                  )}
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-gray-700">
                    {dateLabel}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                    {job.site.customer.name}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

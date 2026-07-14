import { ROUTES } from "@/lib/constants/routes";
import type { JobWithContext } from "@/lib/data/jobs";
import { customerDisplayName } from "@/lib/utils/customer-display-name";
import Link from "next/link";
import { Fragment } from "react";

interface UpcomingVisitsProps {
  jobs: JobWithContext[];
}

const SHORT_DATE: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
};

// Whole days a visit is PAST today (date-only, no time-of-day drift).
//   > 0  = overdue by that many days (before today)
//   <= 0 = today or in the future
function overdueDays(jobDate: string): number {
  const [y, m, d] = jobDate.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return 0;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const visit = new Date(y, m - 1, d);
  return Math.round((today.getTime() - visit.getTime()) / 86_400_000);
}

type DueTone = "red" | "orange" | "green" | null;

// Accent bar for a NON-overdue (today/future) visit.
//   red    = due today
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
  red: { cls: "bg-red-500", title: "Due today" },
  orange: { cls: "bg-amber-500", title: "Due within 7 days" },
  green: { cls: "bg-emerald-500", title: "Due within 30 days" },
};

/**
 * Upcoming bookings — a FEATURED primary section near the top of the
 * dashboard (rendered outside the reorderable widget grid). The section
 * is given prominence: a strong heading and generous breathing room.
 *
 * The list is sorted most-overdue first. An OVERDUE visit (a scheduled or
 * in-progress job whose date has passed) stays here until it's done,
 * styled red/angry with an "Overdue by N days" label. A light "Overdue (N)"
 * divider marks the boundary above the first upcoming (today/future) visit.
 * Non-overdue rows stay minimal: a thin due-ness bar on the left edge
 * (red = today, orange = ≤7d, green = ≤30d, none beyond), date, customer.
 * The whole row taps through to the job in a single hop.
 */
export function UpcomingVisits({ jobs }: UpcomingVisitsProps) {
  const overdueCount = jobs.filter((j) => overdueDays(j.job_date) > 0).length;

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Upcoming visits</h2>
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
        // Single internally-scrolling list of ALL visits (was a 5-cap):
        // max-h shows ~7 rows and scrolls the rest, so the widget never
        // grows the page at hundreds-of-bookings volume. `pr-1` keeps the
        // scrollbar clear of the row content.
        <ul className="max-h-96 space-y-2 overflow-y-auto pr-1">
          {jobs.map((job, i) => {
            const overdue = overdueDays(job.job_date);
            const isOverdue = overdue > 0;
            // The boundary between the overdue block and the first
            // upcoming visit: show it once, above that first non-overdue row.
            const prevOverdue = i > 0 && overdueDays(jobs[i - 1].job_date) > 0;
            const showDivider = !isOverdue && prevOverdue;

            const tone = dueTone(job.job_date);
            const bar = tone ? BAR[tone] : null;
            const dateLabel = new Date(job.job_date).toLocaleDateString(
              "en-GB",
              SHORT_DATE
            );

            return (
              <Fragment key={job.id}>
                {showDivider && (
                  <li
                    className="flex items-center gap-2 px-1 pb-0.5 pt-1"
                    aria-hidden="true"
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-red-500">
                      Overdue ({overdueCount})
                    </span>
                    <span className="h-px flex-1 bg-gray-100" />
                  </li>
                )}
                <li>
                  <Link
                    href={ROUTES.jobDetail(job.id)}
                    className={`relative flex items-center gap-3 overflow-hidden rounded-lg border py-2.5 pl-4 pr-3 transition-colors ${
                      isOverdue
                        ? "border-red-200 bg-red-50 hover:bg-red-100"
                        : "border-gray-100 hover:bg-gray-50"
                    }`}
                  >
                    {/* Thin full-height accent bar on the left edge. Overdue
                        rows are always red; others follow the due-ness tone. */}
                    {(isOverdue || bar) && (
                      <span
                        className={`absolute inset-y-0 left-0 w-1 ${
                          isOverdue ? "bg-red-500" : bar!.cls
                        }`}
                        title={isOverdue ? "Overdue" : bar!.title}
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={`shrink-0 text-xs font-semibold tabular-nums ${
                        isOverdue ? "text-red-800" : "text-gray-700"
                      }`}
                    >
                      {dateLabel}
                    </span>
                    <span
                      className={`min-w-0 flex-1 truncate text-sm font-medium ${
                        isOverdue ? "text-red-900" : "text-gray-900"
                      }`}
                    >
                      {customerDisplayName(job.site.customer)}
                    </span>
                    {isOverdue && (
                      <span className="shrink-0 text-[11px] font-semibold text-red-600">
                        Overdue by {overdue} day{overdue !== 1 ? "s" : ""}
                      </span>
                    )}
                  </Link>
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}
    </section>
  );
}

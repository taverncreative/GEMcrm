import { Suspense } from "react";
import Link from "next/link";
import {
  getJobsToday,
  getUpcomingJobs,
  getRecentJobs,
  getBookingsMissingServiceSheet,
  getJobsReadyToInvoice,
} from "@/lib/data/jobs";
import { getJobsInRange, getTasksInRange } from "@/lib/data/calendar";
import { getRecentCustomers } from "@/lib/data/customers";
import {
  getTasksDueToday,
  getOverdueTasks,
  getCustomerContactTasks,
} from "@/lib/data/tasks";
import { getExpiringAgreements } from "@/lib/data/agreements";
import { getRevenueStats } from "@/lib/data/invoices";
import { getDailyStats } from "@/lib/data/daily-stats";
import { getReviewRequestCandidates } from "@/lib/data/reviews";
import { DailySummary } from "@/components/dashboard/daily-summary";
import { OverdueTasks } from "@/components/dashboard/overdue-tasks";
import { ServiceSheetsToFill } from "@/components/dashboard/service-sheets-to-fill";
import { JobsToInvoice } from "@/components/dashboard/jobs-to-invoice";
import { ExpiringAgreements } from "@/components/dashboard/expiring-agreements";
import { JobsToday } from "@/components/dashboard/jobs-today";
import { TasksDue } from "@/components/dashboard/tasks-due";
import { UpcomingVisits } from "@/components/dashboard/upcoming-visits";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { CustomersToContact } from "@/components/dashboard/customers-to-contact";
import { RevenueStatsWidget } from "@/components/dashboard/revenue-stats";
import { ReviewRequests } from "@/components/dashboard/review-requests";
import { WidgetFrame } from "@/components/dashboard/widget-frame";
import { DashboardCustomisationBar } from "@/components/dashboard/dashboard-customisation-bar";
import { DashboardGrid } from "@/components/dashboard/dashboard-grid";
import { DashboardCalendar } from "@/components/dashboard/dashboard-calendar";
import { ROUTES } from "@/lib/constants/routes";
import { dateUk } from "@/lib/utils/today-uk";
import { BUSINESS } from "@/lib/constants/branding";
import { REVIEW_REQUESTS_ENABLED } from "@/lib/constants/feature-flags";

async function DashboardWidgets() {
  // Note: domestic-review auto-send used to fire here on every dashboard
  // load. Now scheduled via Vercel cron at /api/cron/review-sends (see
  // vercel.json + CRON_SECRET env). Dashboard renders are side-effect free.

  // Build calendar range for the current month.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const calendarStart = (() => {
    const offset = (monthStart.getDay() + 6) % 7; // 0 = Mon
    const d = new Date(monthStart);
    d.setDate(d.getDate() - offset);
    return d;
  })();
  const calendarEnd = (() => {
    const d = new Date(calendarStart);
    const cellCount =
      Math.ceil(
        ((monthStart.getDay() + 6) % 7 + monthEnd.getDate()) / 7
      ) * 7;
    d.setDate(d.getDate() + cellCount - 1);
    return d;
  })();

  const [
    todayJobs,
    upcomingJobs,
    recentJobs,
    recentCustomers,
    tasksDue,
    overdueTasks,
    sheetsToFill,
    jobsToInvoice,
    expiringAgreements,
    contactTasks,
    revenueStats,
    dailyStats,
    reviewCandidates,
    calendarJobs,
    calendarTasks,
  ] = await Promise.all([
    getJobsToday(),
    // Upcoming visits is now a single internally-scrolling list (not a
    // 5-cap), so fetch a bounded-high planning horizon. 500 covers Nate's
    // hundreds-of-bookings route planning while keeping the RSC payload
    // bounded — tune if booking volume ever pushes past it.
    getUpcomingJobs(500),
    getRecentJobs(5),
    getRecentCustomers(5),
    getTasksDueToday(),
    getOverdueTasks(),
    getBookingsMissingServiceSheet(),
    getJobsReadyToInvoice(),
    getExpiringAgreements(30),
    getCustomerContactTasks(5),
    getRevenueStats(),
    getDailyStats(),
    getReviewRequestCandidates(10),
    getJobsInRange(dateUk(calendarStart), dateUk(calendarEnd)),
    getTasksInRange(dateUk(calendarStart), dateUk(calendarEnd)),
  ]);

  const allDone =
    todayJobs.length === 0 &&
    tasksDue.length === 0 &&
    overdueTasks.length === 0 &&
    sheetsToFill.length === 0;

  const hasData =
    todayJobs.length > 0 ||
    tasksDue.length > 0 ||
    overdueTasks.length > 0 ||
    sheetsToFill.length > 0 ||
    upcomingJobs.length > 0 ||
    recentJobs.length > 0 ||
    recentCustomers.length > 0;

  const hasUrgent = sheetsToFill.length > 0 || overdueTasks.length > 0;
  const hasAttention = expiringAgreements.length > 0;

  return (
    <>
      {/* No more red-alarm "Urgent" header — each operational widget lives
          in the main grid, where the user can reorder, minimise or remove
          them. Calmer framing: this is a to-do list, not an emergency. */}

      {/* Empty-state CTA */}
      {!hasData &&
        dailyStats.jobsCompletedToday === 0 &&
        dailyStats.tasksCompletedToday === 0 && (
          <div className="mb-6 rounded-xl border-2 border-dashed border-brand bg-brand-soft/50 p-10 text-center">
            <h2 className="text-xl font-semibold text-gray-900">
              Welcome to {BUSINESS.name}
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              Add your first customer and book a visit to get going.
            </p>
            <div className="mt-6">
              <Link
                href={`${ROUTES.CUSTOMERS}/new`}
                className="inline-flex items-center justify-center rounded-xl bg-brand px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-brand-dark"
              >
                Add Your First Customer
              </Link>
            </div>
          </div>
        )}

      {/* Featured: Upcoming visits — promoted out of the reorderable grid
          to a prominent, full-width section at the top of the dashboard.
          The section is featured; the rows inside stay minimal. */}
      <div className="mb-6">
        <UpcomingVisits jobs={upcomingJobs} />
      </div>

      {/* Reorderable widget grid — DnD + column-flow compacting. Revenue
          lives inside the grid as the default first card so the user can
          move it around like any other widget. */}
      <DashboardGrid
        widgets={[
          {
            id: "revenue-stats",
            node: (
              <WidgetFrame id="revenue-stats" title="Revenue">
                <RevenueStatsWidget stats={revenueStats} />
              </WidgetFrame>
            ),
          },
          {
            id: "service-sheets-to-fill",
            node: (
              <WidgetFrame
                id="service-sheets-to-fill"
                title="Service sheets to fill"
              >
                <ServiceSheetsToFill jobs={sheetsToFill} />
              </WidgetFrame>
            ),
          },
          {
            id: "jobs-to-invoice",
            node: (
              <WidgetFrame id="jobs-to-invoice" title="To invoice">
                <JobsToInvoice jobs={jobsToInvoice} />
              </WidgetFrame>
            ),
          },
          {
            id: "jobs-today",
            node: (
              <WidgetFrame id="jobs-today" title="Jobs today">
                <JobsToday jobs={todayJobs} />
              </WidgetFrame>
            ),
          },
          {
            id: "tasks-due",
            node: (
              <WidgetFrame id="tasks-due" title="Tasks due today">
                <TasksDue tasks={tasksDue} />
              </WidgetFrame>
            ),
          },
          // "Request review" widget — gated by REVIEW_REQUESTS_ENABLED (one
          // feature, one switch). OFF → omitted from the widgets array, so
          // DashboardGrid renders no slot for it and drops the id from any
          // saved layout cleanly (no gap). Flip the flag to bring it back
          // alongside the review-task auto-creation. Code kept intact.
          ...(REVIEW_REQUESTS_ENABLED
            ? [
                {
                  id: "review-requests",
                  node: (
                    <WidgetFrame id="review-requests" title="Request review">
                      <ReviewRequests candidates={reviewCandidates} />
                    </WidgetFrame>
                  ),
                },
              ]
            : []),
          {
            id: "customers-to-contact",
            node: (
              <WidgetFrame
                id="customers-to-contact"
                title="Customers to contact"
              >
                <CustomersToContact tasks={contactTasks} />
              </WidgetFrame>
            ),
          },
          {
            id: "pma-renewals",
            node: (
              <WidgetFrame id="pma-renewals" title="PMA renewals">
                <ExpiringAgreements agreements={expiringAgreements} />
              </WidgetFrame>
            ),
          },
          {
            id: "overdue-tasks",
            node: (
              <WidgetFrame id="overdue-tasks" title="Overdue tasks">
                <OverdueTasks tasks={overdueTasks} />
              </WidgetFrame>
            ),
          },
          {
            id: "recent-activity",
            node: (
              <WidgetFrame id="recent-activity" title="Recent activity">
                <RecentActivity
                  recentJobs={recentJobs}
                  recentCustomers={recentCustomers}
                />
              </WidgetFrame>
            ),
          },
          {
            id: "this-month-calendar",
            node: (
              <WidgetFrame
                id="this-month-calendar"
                title="This month calendar"
              >
                <DashboardCalendar
                  jobs={calendarJobs}
                  tasks={calendarTasks}
                  monthStart={monthStart}
                />
              </WidgetFrame>
            ),
          },
        ]}
      />

      {/* Daily summary stays out of the reorderable grid — bottom-of-day footer */}
      <div className="mt-6">
        <DailySummary stats={dailyStats} allDone={allDone} />
      </div>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <div className="animate-pulse space-y-3">
          <div className="h-3 w-24 rounded bg-gray-100" />
          <div className="h-6 w-48 rounded bg-gray-100" />
          <div className="h-4 w-32 rounded bg-gray-50" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-xl bg-white p-6 shadow-sm">
            <div className="animate-pulse space-y-3">
              <div className="h-4 w-24 rounded bg-gray-100" />
              <div className="h-8 w-16 rounded bg-gray-100" />
              <div className="h-4 w-full rounded bg-gray-50" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <DashboardCustomisationBar />
      </div>
      <div className="mt-6 space-y-6">
        <Suspense fallback={<DashboardSkeleton />}>
          <DashboardWidgets />
        </Suspense>
      </div>
    </div>
  );
}

import { Suspense } from "react";
import { getAllJobs } from "@/lib/data/jobs";
import { formatAddress } from "@/lib/utils/format-address";
import { CALL_TYPE_LABELS } from "@/lib/constants/job-labels";
import { ROUTES } from "@/lib/constants/routes";
import { JobsFilter } from "@/components/jobs/jobs-filter";
import { JobsStatusTabs } from "@/components/jobs/jobs-status-tabs";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { StartJobButton } from "@/components/jobs/start-job-button";
import { CreateInvoiceButton } from "@/components/invoices/create-invoice-button";
import Link from "next/link";
import type { CallType, JobStatus } from "@/types/database";

interface JobsPageProps {
  searchParams: Promise<{
    filter?: string;
    callType?: string;
    status?: string;
    q?: string;
  }>;
}

async function JobsTable({
  filter,
  callType,
  status,
  search,
}: {
  filter?: string;
  callType?: string;
  status?: string;
  search?: string;
}) {
  const dateFilter =
    filter === "today" || filter === "upcoming" ? filter : "all";
  // We deliberately don't expose in_progress in the tab UI — the operator
  // doesn't track that midpoint. But we still allow the value through if
  // someone deep-links it.
  const statusFilter =
    status === "scheduled" || status === "completed" || status === "in_progress"
      ? status
      : "all";

  const jobs = await getAllJobs({
    filter: dateFilter,
    callType: callType || undefined,
    status: statusFilter,
    search: search || undefined,
  });

  if (jobs.length === 0) {
    return (
      <div className="rounded-xl bg-white p-12 text-center shadow-sm">
        <p className="text-sm text-gray-500">No jobs found.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="px-4 py-3">Ref</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3 hidden sm:table-cell">Site</th>
              <th className="px-4 py-3 hidden md:table-cell">Type</th>
              <th className="px-4 py-3 hidden md:table-cell">Status</th>
              <th className="px-4 py-3 hidden lg:table-cell">Pest Species</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {jobs.map((job) => (
              <tr key={job.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 whitespace-nowrap">
                  <Link
                    href={ROUTES.jobDetail(job.id)}
                    className={`rounded px-1.5 py-0.5 font-mono text-xs ${
                      job.parent_job_id
                        ? "bg-blue-50 text-blue-700"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {job.reference_number ?? job.id.slice(0, 6)}
                  </Link>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <Link
                    href={ROUTES.jobDetail(job.id)}
                    className="font-medium text-gray-900 hover:text-gray-600"
                  >
                    {new Date(job.job_date).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={ROUTES.customerDetail(job.site.customer.id)}
                    className="text-gray-900 hover:text-gray-600"
                  >
                    {job.site.customer.name}
                  </Link>
                  {job.site.customer.company_name && (
                    <span className="ml-1 text-gray-400">
                      ({job.site.customer.company_name})
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 hidden sm:table-cell text-gray-600">
                  <Link
                    href={ROUTES.siteDetail(job.site.id)}
                    className="hover:text-gray-900"
                  >
                    {formatAddress(job.site)}
                  </Link>
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  {job.call_type && (
                    <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                      {CALL_TYPE_LABELS[job.call_type as CallType] ?? job.call_type}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <JobStatusBadge status={job.job_status as JobStatus} />
                </td>
                <td className="px-4 py-3 hidden lg:table-cell text-gray-600">
                  {job.pest_species.length > 0
                    ? job.pest_species.join(", ")
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function JobsTableSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm">
      <div className="animate-pulse">
        <div className="border-b border-gray-100 px-4 py-3">
          <div className="h-4 w-full rounded bg-gray-100" />
        </div>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="border-b border-gray-50 px-4 py-3">
            <div className="h-4 w-3/4 rounded bg-gray-50" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function JobsPage({ searchParams }: JobsPageProps) {
  const params = await searchParams;

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Jobs</h1>
          <p className="mt-1 text-sm text-gray-500">
            Bookings and completed service sheets.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CreateInvoiceButton />
          <StartJobButton />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Suspense fallback={null}>
          <JobsStatusTabs />
        </Suspense>
        <Suspense fallback={null}>
          <JobsFilter />
        </Suspense>
      </div>

      <div className="mt-4">
        <Suspense
          key={`${params.filter}-${params.callType}-${params.status}-${params.q}`}
          fallback={<JobsTableSkeleton />}
        >
          <JobsTable
            filter={params.filter}
            callType={params.callType}
            status={params.status}
            search={params.q}
          />
        </Suspense>
      </div>
    </div>
  );
}

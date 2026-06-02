"use client";

/**
 * Jobs list — step 8 Phase B, offline-converted.
 *
 * Same conversion shape as Phase A: previously RSC, calling
 * `getAllJobs` server-side which threw `[getAllJobs] "TypeError:
 * fetch failed"` offline. Now a client component reading from Dexie
 * via useLiveQuery; filter/sort/search applied in JS against the
 * synced rows. The jobs list is the OTHER core navigation entry
 * point for the field tech — once converted alongside the customers
 * list, the tech has their day's schedule + customer list accessible
 * with no signal.
 *
 * Data layer (mirrors `getAllJobs`):
 *
 *   - jobs        → !deleted_at && !is_archived (Surface 3 Gap B
 *                   convention)
 *   - sites       → join target for the customer + the address shown
 *                   in the table
 *   - customers   → join target for name + company_name + the search
 *                   predicate
 *
 * Filter / sort / search applied in JS — small volumes (the server
 * version capped at 100 rows; we match):
 *
 *   - ?filter=today    → j.job_date === today
 *   - ?filter=upcoming → j.job_date >= today
 *   - ?status=         → eq(job_status, x)
 *   - ?callType=       → eq(call_type, x)
 *   - ?q=              → ilike on site.address_line_1 | site.postcode
 *                        | customer.name | customer.company_name
 *   - sort             → job_date DESC, then created_at DESC
 *   - limit            → 100
 *
 * The search predicate matches the server's "find sites + customers
 * whose attributes match, then filter jobs to those sites" logic, but
 * collapsed into a per-row check now that the data is fully in
 * memory — same outcome, simpler code.
 *
 * Write entry points stay online-only via useIsOnline:
 *
 *   - StartJobButton  → opens BookingModal; multi-entity write,
 *                       entity_ids[] guard is the prereq for ever
 *                       wrapping it. Now gets the useIsOnline guard
 *                       (the existing button had none).
 *   - CreateInvoiceButton → already uses useIsOnline.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { formatAddress } from "@/lib/utils/format-address";
import { formatJobTime } from "@/lib/utils/format-time";
import { CALL_TYPE_LABELS } from "@/lib/constants/job-labels";
import { todayUk } from "@/lib/utils/today-uk";
import { ROUTES } from "@/lib/constants/routes";
import { JobsFilter } from "@/components/jobs/jobs-filter";
import { JobsStatusTabs } from "@/components/jobs/jobs-status-tabs";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { StartJobButton } from "@/components/jobs/start-job-button";
import { CreateInvoiceButton } from "@/components/invoices/create-invoice-button";
import { SyncStatePill } from "@/components/sync/sync-state-pill";
import type {
  CallType,
  Customer,
  Job,
  JobStatus,
  Site,
} from "@/types/database";

const JOBS_LIMIT = 100;

// Same shape `getAllJobs` produced — but populated in the client.
interface JobWithContext extends Job {
  site: Site & { customer: Customer };
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

function buildRows(args: {
  jobs: Job[];
  sites: Site[];
  customers: Customer[];
}): JobWithContext[] {
  const { jobs, sites, customers } = args;
  // O(n) lookup tables.
  const sitesById = new Map<string, Site>();
  for (const s of sites) {
    if (s.deleted_at) continue;
    sitesById.set(s.id, s);
  }
  const customersById = new Map<string, Customer>();
  for (const c of customers) {
    if (c.deleted_at) continue;
    customersById.set(c.id, c);
  }
  const out: JobWithContext[] = [];
  for (const j of jobs) {
    if (j.deleted_at) continue;
    if (j.is_archived) continue;
    const site = sitesById.get(j.site_id);
    if (!site) continue;
    const customer = customersById.get(site.customer_id);
    if (!customer) continue;
    out.push({ ...j, site: { ...site, customer } });
  }
  return out;
}

export default function JobsPage() {
  const params = useSearchParams();
  const filterParam = params.get("filter") ?? "all";
  const callTypeParam = params.get("callType") ?? undefined;
  const statusParam = params.get("status") ?? "all";
  const searchParam = params.get("q") ?? "";

  const filter: "today" | "upcoming" | "all" =
    filterParam === "today" || filterParam === "upcoming" ? filterParam : "all";
  const status: "scheduled" | "in_progress" | "completed" | "all" =
    statusParam === "scheduled" ||
    statusParam === "completed" ||
    statusParam === "in_progress"
      ? statusParam
      : "all";

  // ─── Chained Dexie reads ──────────────────────────────────────────

  const jobs = useLiveQuery(async () => db.jobs.toArray(), []);
  const sites = useLiveQuery(async () => db.sites.toArray(), []);
  const customers = useLiveQuery(async () => db.customers.toArray(), []);

  // ─── Derive + filter ──────────────────────────────────────────────

  const today = todayUk();
  const rows = useMemo<JobWithContext[] | null>(() => {
    if (jobs === undefined) return null;
    if (sites === undefined) return null;
    if (customers === undefined) return null;

    let list = buildRows({ jobs, sites, customers });

    if (filter === "today") {
      list = list.filter((j) => j.job_date === today);
    } else if (filter === "upcoming") {
      list = list.filter((j) => j.job_date >= today);
    }

    if (status !== "all") {
      list = list.filter((j) => j.job_status === status);
    }

    if (callTypeParam) {
      list = list.filter((j) => j.call_type === callTypeParam);
    }

    const q = searchParam.trim().toLowerCase();
    if (q.length > 0) {
      list = list.filter((j) => {
        const site = j.site;
        const cust = site.customer;
        const addr = site.address_line_1?.toLowerCase() ?? "";
        const post = site.postcode?.toLowerCase() ?? "";
        const name = cust.name?.toLowerCase() ?? "";
        const company = cust.company_name?.toLowerCase() ?? "";
        return (
          addr.includes(q) ||
          post.includes(q) ||
          name.includes(q) ||
          company.includes(q)
        );
      });
    }

    list.sort((a, b) => {
      const byDate = b.job_date.localeCompare(a.job_date);
      if (byDate !== 0) return byDate;
      return b.created_at.localeCompare(a.created_at);
    });

    return list.slice(0, JOBS_LIMIT);
  }, [jobs, sites, customers, filter, status, callTypeParam, searchParam, today]);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-gray-900">Jobs</h1>
            <SyncStatePill />
          </div>
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
        <JobsStatusTabs />
        <JobsFilter />
      </div>

      <div className="mt-4">
        {rows === null ? (
          <JobsTableSkeleton />
        ) : rows.length === 0 ? (
          <div className="rounded-xl bg-white p-12 text-center shadow-sm">
            <p className="text-sm text-gray-500">No jobs found.</p>
          </div>
        ) : (
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
                    <th className="px-4 py-3 hidden lg:table-cell">
                      Pest Species
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map((job) => (
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
                        <Link href={ROUTES.jobDetail(job.id)} className="block">
                          <span className="font-medium text-gray-900 hover:text-gray-600">
                            {new Date(job.job_date).toLocaleDateString(
                              "en-GB",
                              {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              }
                            )}
                          </span>
                          <span
                            className={`mt-0.5 block font-mono text-[11px] tabular-nums ${
                              job.job_time ? "text-gray-600" : "text-gray-400"
                            }`}
                          >
                            {formatJobTime(job.job_time)}
                          </span>
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
                            {CALL_TYPE_LABELS[job.call_type as CallType] ??
                              job.call_type}
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
        )}
      </div>
    </div>
  );
}

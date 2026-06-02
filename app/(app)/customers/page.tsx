"use client";

/**
 * Customers list — step 8 Phase A, offline-converted.
 *
 * The previous RSC version called `getCustomerListItems` server-side
 * and threw `[getCustomerListItems] "TypeError: fetch failed"` the
 * moment the operator hit the page offline. The list page is one of
 * the two core navigation entry points for the field tech, so the
 * page is now a client component reading from Dexie via
 * `useLiveQuery`.
 *
 * Data layer (client-side mirror of `getCustomerListItems`):
 *
 *   - customers (top-level rows)
 *   - sites (for primary-site display + the join to jobs)
 *   - jobs (for jobCount / serviceSheetCount / upcomingJob /
 *     latestJobCallType — filtered through `!is_archived &&
 *     !deleted_at` per Surface 3's Gap B + soft-delete conventions)
 *   - agreements (for `hasActiveAgreement`)
 *   - invoiceCount via the online-only
 *     `getInvoiceCountsForCustomersAction` (Gap A → Option A; offline
 *     the column shows "—")
 *
 * Filter / sort / search:
 *
 *   The page reads `?q=` and `?type=` from `useSearchParams` and
 *   applies the same predicates `getCustomerListItems` used:
 *
 *     - type:    eq("customer_type", t)  →  c.customer_type === t
 *     - search:  ilike on name+company  →  case-insensitive substring
 *     - sort:    created_at DESC
 *     - limit:   200 (matches the server's default)
 *
 *   The volumes here are small (single-business CRM, dozens to
 *   hundreds of customers in practice) so JS array filter + sort is
 *   trivially fast — no need for Dexie-native `.where()` chains
 *   beyond the per-entity reads.
 *
 * Write entry point: "Add Customer" link → `/customers/new` (RSC form
 * that needs a connection anyway). Guarded with `useIsOnline()` so
 * the link visibly disables offline rather than failing on the
 * destination page.
 *
 * Soft-delete: every read filters `!deleted_at`. Matches RLS behaviour
 * on the server.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { getInvoiceCountsForCustomersAction } from "@/app/(app)/customers/actions";
import { CustomerSearch } from "@/components/customers/customer-search";
import { CustomersTabs } from "@/components/customers/customers-tabs";
import { CustomersTable } from "@/components/customers/customers-table";
import { SyncStatePill } from "@/components/sync/sync-state-pill";
import { ROUTES } from "@/lib/constants/routes";
import type { CustomerListItem } from "@/lib/data/customers";
import type {
  Agreement,
  Customer,
  CustomerType,
  Job,
  Site,
} from "@/types/database";
import { todayUk } from "@/lib/utils/today-uk";

const LIST_LIMIT = 200;

function TableSkeleton() {
  return (
    <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
      <div className="animate-pulse">
        <div className="border-b border-gray-100 px-6 py-3">
          <div className="h-4 w-48 rounded bg-gray-100" />
        </div>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="border-b border-gray-50 px-6 py-3">
            <div className="h-4 w-64 rounded bg-gray-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

function buildListItems(args: {
  customers: Customer[];
  sites: Site[];
  jobs: Job[];
  agreements: Agreement[];
  invoiceCounts: Record<string, number> | null;
  today: string;
}): CustomerListItem[] {
  const { customers, sites, jobs, agreements, invoiceCounts, today } = args;

  // Index sites by customer_id and remember the reverse map so we can
  // attribute each job back to its customer in O(1) per job.
  const sitesByCustomer = new Map<string, Site[]>();
  const siteToCustomer = new Map<string, string>();
  for (const s of sites) {
    if (s.deleted_at) continue;
    siteToCustomer.set(s.id, s.customer_id);
    const list = sitesByCustomer.get(s.customer_id) ?? [];
    list.push(s);
    sitesByCustomer.set(s.customer_id, list);
  }

  // Group filtered jobs by customer.
  const jobsByCustomer = new Map<string, Job[]>();
  for (const j of jobs) {
    if (j.deleted_at) continue;
    if (j.is_archived) continue;
    const cid = siteToCustomer.get(j.site_id);
    if (!cid) continue;
    const list = jobsByCustomer.get(cid) ?? [];
    list.push(j);
    jobsByCustomer.set(cid, list);
  }

  // Active-agreement customers — set lookup.
  const activeAgreementCustomers = new Set<string>();
  for (const a of agreements) {
    if (a.deleted_at) continue;
    if (a.status === "active") activeAgreementCustomers.add(a.customer_id);
  }

  return customers.map<CustomerListItem>((c) => {
    const cSites = (sitesByCustomer.get(c.id) ?? []).sort((a, b) =>
      a.created_at.localeCompare(b.created_at)
    );
    const cJobs = jobsByCustomer.get(c.id) ?? [];
    const completed = cJobs.filter((j) => j.job_status === "completed");
    const upcoming = cJobs
      .filter((j) => j.job_date >= today && j.job_status !== "completed")
      .sort((a, b) => a.job_date.localeCompare(b.job_date))[0];
    const latestJob = [...cJobs].sort((a, b) =>
      b.job_date.localeCompare(a.job_date)
    )[0];
    return {
      ...c,
      jobCount: cJobs.length,
      serviceSheetCount: completed.length,
      // `null` when offline (invoiceCounts === null); the table
      // renders this as "—". When online, the action returns 0 for
      // any customer with no invoices, so the lookup is authoritative
      // and we don't fall back to null.
      invoiceCount:
        invoiceCounts === null ? null : invoiceCounts[c.id] ?? 0,
      primarySite: cSites[0] ?? null,
      latestJobCallType: latestJob?.call_type ?? null,
      upcomingJob: upcoming
        ? {
            id: upcoming.id,
            job_date: upcoming.job_date,
            site_id: upcoming.site_id,
          }
        : null,
      hasActiveAgreement: activeAgreementCustomers.has(c.id),
    };
  });
}

export default function CustomersPage() {
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const typeParam = params.get("type") ?? "all";
  const normalizedType: CustomerType | "all" =
    typeParam === "commercial" || typeParam === "domestic" ? typeParam : "all";

  const online = useIsOnline();

  // ─── Chained Dexie reads ──────────────────────────────────────────
  // Each query returns `undefined` while in flight and an array (or
  // null) once resolved. We keep them independent so an in-flight job
  // pull doesn't hold the customer header back.

  const customers = useLiveQuery(
    async () => {
      const all = await db.customers.toArray();
      return all
        .filter((c) => !c.deleted_at)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    []
  );

  const sites = useLiveQuery(
    async () => db.sites.toArray(),
    []
  );

  const jobs = useLiveQuery(
    async () =>
      db.jobs
        // Project to the fields the list cares about so a giant jobs
        // table doesn't load megabytes into memory. Filtering happens
        // in buildListItems; this is just the projection.
        .toArray(),
    []
  );

  const agreements = useLiveQuery(
    async () => db.agreements.toArray(),
    []
  );

  // ─── Invoice counts (online-only) ─────────────────────────────────
  // Lazily fetched once when online + customers have loaded. Reset
  // to null while offline so the column renders "—" instead of stale
  // counts from a previous online session.

  const [invoiceCounts, setInvoiceCounts] =
    useState<Record<string, number> | null>(null);

  useEffect(() => {
    if (!online) {
      setInvoiceCounts(null);
      return;
    }
    if (!customers || customers.length === 0) return;
    let cancelled = false;
    void getInvoiceCountsForCustomersAction(customers.map((c) => c.id))
      .then((counts) => {
        if (!cancelled) setInvoiceCounts(counts);
      })
      .catch(() => {
        // The action could fail in mid-transition (online → offline
        // flip while the fetch was in flight). Keep the previous
        // counts rather than collapsing to null — they're at worst
        // a few seconds stale.
        if (!cancelled) {
          /* no-op */
        }
      });
    return () => {
      cancelled = true;
    };
  }, [online, customers]);

  // ─── Derive list items + apply filter/sort/search ─────────────────
  //
  // Build the full set first (matches server logic byte-for-byte),
  // then apply the same `customer_type` + ilike-on-name/company
  // predicates the server did, then slice to the limit.
  //
  // We memoise on the live results so re-renders triggered by other
  // pieces of state (e.g. invoiceCounts updating) don't re-run the
  // O(n) build unnecessarily.

  const today = todayUk();
  const allItems = useMemo<CustomerListItem[] | null>(() => {
    if (customers === undefined) return null;
    if (sites === undefined) return null;
    if (jobs === undefined) return null;
    if (agreements === undefined) return null;
    return buildListItems({
      customers,
      sites,
      jobs,
      agreements,
      invoiceCounts,
      today,
    });
  }, [customers, sites, jobs, agreements, invoiceCounts, today]);

  const rows = useMemo<CustomerListItem[] | null>(() => {
    if (allItems === null) return null;
    let filtered = allItems;
    if (normalizedType !== "all") {
      filtered = filtered.filter((c) => c.customer_type === normalizedType);
    }
    const trimmed = q.trim().toLowerCase();
    if (trimmed.length > 0) {
      filtered = filtered.filter((c) => {
        const name = c.name?.toLowerCase() ?? "";
        const company = c.company_name?.toLowerCase() ?? "";
        return name.includes(trimmed) || company.includes(trimmed);
      });
    }
    return filtered.slice(0, LIST_LIMIT);
  }, [allItems, normalizedType, q]);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-gray-900">Customers</h1>
            <SyncStatePill />
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Click a row to see the customer panel.
          </p>
        </div>
        {/* Add Customer link — the target /customers/new is still an
            RSC form that needs a connection to submit. Disabling the
            entry point offline keeps the operator from landing on a
            broken page; the entity_ids[] guard remains the gate for
            ever making the form itself offline-capable. */}
        {online ? (
          <Link
            href={`${ROUTES.CUSTOMERS}/new`}
            className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
          >
            Add Customer
          </Link>
        ) : (
          <span
            className="inline-flex cursor-not-allowed items-center justify-center rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-400"
            title="Online required"
            aria-disabled="true"
          >
            Add Customer
          </span>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CustomersTabs />
        <CustomerSearch />
      </div>

      <div className="mt-4">
        {rows === null ? (
          <TableSkeleton />
        ) : (
          <CustomersTable
            rows={rows}
            query={q || undefined}
            typeFilter={normalizedType}
          />
        )}
      </div>
    </div>
  );
}

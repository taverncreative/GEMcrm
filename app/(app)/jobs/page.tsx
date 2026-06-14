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
 *   - ?filter=today    → j.job_date === today   (dashboard deep-link only —
 *   - ?filter=upcoming → j.job_date >= today     no manual dropdown anymore)
 *   - status segment   → Open (scheduled + in_progress, default) vs
 *                        Completed (?status=completed) — the JobsStatusTabs
 *   - ?q=              → ilike on site.address_line_1 | site.postcode
 *                        | customer.name | customer.company_name
 *   - sort             → job_date, soonest-first default; Date column header
 *                        toggles asc/desc (local state). created_at tie-break.
 *   - limit            → 100
 *
 * Controls were decluttered (deferred quick win): the date + call-type
 * dropdowns are gone — date is now a column-header sort toggle and status is
 * the Open/Completed segmentation. Search is unchanged. Presentational only;
 * the Dexie/offline data layer (incl. the is_archived exclusion) is untouched.
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
 *   - Multi-select → Create Invoice (invoice_jobs pass C): checkbox
 *     column on the Completed tab over uninvoiced rows only, with a
 *     same-customer lock (one invoice covers one customer). The
 *     selection bar's button carries the same useIsOnline gate; the
 *     created invoice goes through the online-only server action, then
 *     a runSync('manual') pulls the flipped is_invoiced flags back
 *     into Dexie so the checkboxes disappear without waiting for the
 *     30s interval tick.
 *   - Invoiced rows show a status chip instead of the checkbox
 *     (pass E): Paid from the synced is_paid flag (offline-capable);
 *     Draft/Sent via one batched online read of the invoices table;
 *     neutral "Invoiced" offline / pre-resolve. Read-only — no Dexie
 *     or sync-pull changes.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { runSync } from "@/lib/sync/engine";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { formatAddress } from "@/lib/utils/format-address";
import { formatWindow } from "@/lib/utils/format-time";
import { CALL_TYPE_LABELS } from "@/lib/constants/job-labels";
import { todayUk } from "@/lib/utils/today-uk";
import { ROUTES } from "@/lib/constants/routes";
import { JobsFilter } from "@/components/jobs/jobs-filter";
import { JobsStatusTabs } from "@/components/jobs/jobs-status-tabs";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { StartJobButton } from "@/components/jobs/start-job-button";
import { InvoiceCreatorModal } from "@/components/invoices/invoice-creator-modal";
import { getInvoiceStatusesForJobsAction } from "@/app/(app)/invoices/actions";
import { SyncStatePill } from "@/components/sync/sync-state-pill";
import type {
  CallType,
  Customer,
  InvoiceStatus,
  Job,
  JobStatus,
  Site,
} from "@/types/database";

const JOBS_LIMIT = 100;

// Same shape `getAllJobs` produced — but populated in the client.
interface JobWithContext extends Job {
  site: Site & { customer: Customer };
}

/**
 * The Open list holds two row shapes. A booking carries full site +
 * customer context (JobWithContext). A DRAFT (Q-series quick capture) is
 * just a phrase + date + arrival window with a null site_id — it can't be
 * forced into JobWithContext, so it gets its own row kind. The table
 * render branches on `kind`.
 *
 * This is also what keeps a draft un-completable BY CONSTRUCTION: the
 * draft branch renders no checkbox and no Start/Complete affordance — its
 * only action is "Upgrade to booking" (→ /jobs/[id]/upgrade). The lifecycle
 * gates (JobStatusActions' draft case, the complete-page FILLABLE_STATUSES
 * whitelist, the L4 DB CHECK) are unchanged and surface-independent.
 */
type RollRow =
  | { kind: "booking"; job: JobWithContext }
  | { kind: "draft"; job: Job };

/**
 * Drafts tab (Q2). Quick captures have no customer/site context — they
 * render straight from their phrase + date + arrival window. Each row
 * links to the job detail, where "Upgrade to booking →" lives (Q3).
 */
function DraftsList({ drafts }: { drafts: Job[] | null }) {
  if (drafts === null) return <JobsTableSkeleton />;
  if (drafts.length === 0) {
    return (
      <div className="rounded-xl bg-white p-12 text-center shadow-sm">
        <p className="text-sm text-gray-500">No draft jobs.</p>
        <p className="mt-1 text-xs text-gray-400">
          Use “Quick job” to jot a phone booking down in seconds — add the
          customer and details later.
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm">
      <ul className="divide-y divide-gray-100">
        {drafts.map((d) => (
          <li key={d.id}>
            {/* A draft's only forward action is upgrade — route straight to
                the upgrade flow (matches the dashboard "Drafts to upgrade"
                card and the Open-tab draft rows), never the job detail page. */}
            <Link
              href={`${ROUTES.jobDetail(d.id)}/upgrade`}
              className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">
                  {d.capture_note || "(no description)"}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {new Date(d.job_date).toLocaleDateString("en-GB", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                  {" · "}
                  {formatWindow(d.job_time, d.job_time_end)}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                Draft
              </span>
            </Link>
          </li>
        ))}
      </ul>
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

/**
 * Invoice state for an invoiced row, in the slot the checkbox occupies
 * on uninvoiced rows.
 *
 * Paid derives from the SYNCED job row (is_paid) — works offline.
 * Draft vs Sent needs the invoices table, which isn't in Dexie; those
 * arrive via one batched online lookup. Until it resolves — or while
 * offline — an invoiced-but-unpaid row shows a neutral "Invoiced".
 * Colour only where it earns it: Paid green, Draft amber (needs
 * action), Sent/Invoiced muted.
 */
function InvoiceStatusChip({
  paid,
  status,
}: {
  paid: boolean;
  status: InvoiceStatus | null;
}) {
  const label =
    paid || status === "paid"
      ? "Paid"
      : status === "sent"
        ? "Sent"
        : status === "draft"
          ? "Draft"
          : "Invoiced";
  const cls =
    label === "Paid"
      ? "bg-brand-soft text-brand-darker"
      : label === "Draft"
        ? "bg-amber-100 text-amber-700"
        : "bg-gray-100 text-gray-500";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

/**
 * One description line per selected job, matching the single-job preset
 * built on the job detail page ("Pest control — wasps · 12 Jun 2026
 * (ref 00037-BSK)") with the call-type label standing in for the generic
 * "Pest control" when the job has one.
 */
function jobSummaryLine(job: JobWithContext): string {
  const parts: string[] = [];
  parts.push(
    job.call_type
      ? (CALL_TYPE_LABELS[job.call_type as CallType] ?? "Pest control")
      : "Pest control"
  );
  if (job.pest_species.length > 0) {
    parts.push(`— ${job.pest_species.join(", ")}`);
  }
  parts.push(
    `· ${new Date(job.job_date).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })}`
  );
  if (job.reference_number) {
    parts.push(`(ref ${job.reference_number})`);
  }
  return parts.join(" ");
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
    // Drafts (Q2) carry a null site_id — they have no site/customer
    // context and never belong in the context-joined Open/Completed
    // views. The Drafts tab renders them from the raw jobs list instead.
    if (!j.site_id) continue;
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
  const searchParam = params.get("q") ?? "";

  // Date filter (today/upcoming) no longer has a manual control — it's kept
  // only so the dashboard deep-links still scope the list (jobs-today →
  // ?filter=today, service-sheets-to-fill → ?filter=upcoming).
  const filter: "today" | "upcoming" | "all" =
    filterParam === "today" || filterParam === "upcoming" ? filterParam : "all";

  // Three-segment status: Open (scheduled + in_progress) is the default;
  // Completed sets ?status=completed; Drafts (quick captures) sets
  // ?status=draft. Each tab enumerates exactly the status(es) it wants.
  const statusParam = params.get("status");
  const status: "open" | "completed" | "draft" =
    statusParam === "completed"
      ? "completed"
      : statusParam === "draft"
        ? "draft"
        : "open";

  // Date sort direction — presentational, local state (no need to deep-link
  // it). Default "asc" = soonest first, so the next/overdue job sits at the
  // top of the Open work queue. The Date column header toggles it to "desc"
  // (latest first), natural for browsing the Completed archive.
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // ─── Multi-select → one invoice (Pass C) ──────────────────────────
  // Selection lives only on the Completed tab and only over uninvoiced
  // rows. Local state — nothing about it is worth deep-linking.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  // Presets are captured at modal-open time so clearing the selection
  // (onCreated) can't unmount or reshape the modal mid-flight.
  const [invoicePresets, setInvoicePresets] = useState<{
    customer: Customer;
    jobIds: string[];
    amount: number | null;
    description: string;
  } | null>(null);
  const online = useIsOnline();

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

    // Status segment: Completed = job_status completed; Open = the rest
    // (scheduled + in_progress).
    if (status === "completed") {
      list = list.filter((j) => j.job_status === "completed");
    } else {
      list = list.filter(
        (j) => j.job_status === "scheduled" || j.job_status === "in_progress"
      );
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

    // Sort by job_date in the chosen direction; created_at breaks ties the
    // same way so ordering is stable.
    list.sort((a, b) => {
      const byDate = a.job_date.localeCompare(b.job_date);
      if (byDate !== 0) return sortDir === "asc" ? byDate : -byDate;
      const byCreated = a.created_at.localeCompare(b.created_at);
      return sortDir === "asc" ? byCreated : -byCreated;
    });

    return list.slice(0, JOBS_LIMIT);
  }, [jobs, sites, customers, filter, status, searchParam, today, sortDir]);

  // Drafts (Q2) live outside the site/customer join — build them straight
  // from the raw jobs list. Quick captures awaiting upgrade: phrase +
  // date + window, newest date first.
  const draftRows = useMemo<Job[] | null>(() => {
    if (jobs === undefined) return null;
    return jobs
      .filter((j) => !j.deleted_at && !j.is_archived && j.job_status === "draft")
      .sort((a, b) => {
        const byDate = b.job_date.localeCompare(a.job_date);
        return byDate !== 0 ? byDate : b.created_at.localeCompare(a.created_at);
      });
  }, [jobs]);

  // ─── Open-tab roll: bookings + drafts merged (Track 1b) ────────────
  // The Open tab is the operator's "job roll". Drafts (quick captures
  // awaiting upgrade) must appear here interleaved by date so they don't
  // get forgotten in a separate tab — but as a DISTINCT row kind, never a
  // pseudo-booking. Completed (and any non-open tab) stays bookings-only:
  // a draft is open work by definition.
  const rollRows = useMemo<RollRow[] | null>(() => {
    if (rows === null) return null;
    const bookingRows: RollRow[] = rows.map((job) => ({ kind: "booking", job }));
    if (status !== "open") return bookingRows;
    // rows !== null already implies jobs is loaded, but guard for TS.
    if (jobs === undefined) return null;

    let drafts = jobs.filter(
      (j) => !j.deleted_at && !j.is_archived && j.job_status === "draft"
    );
    // Same date filter bookings get (dashboard deep-links). Drafts carry job_date.
    if (filter === "today") {
      drafts = drafts.filter((d) => d.job_date === today);
    } else if (filter === "upcoming") {
      drafts = drafts.filter((d) => d.job_date >= today);
    }
    // Drafts carry no customer/site, so the phrase is the only text to
    // match — keeps a draft findable by what the operator jotted.
    const q = searchParam.trim().toLowerCase();
    if (q.length > 0) {
      drafts = drafts.filter((d) =>
        (d.capture_note ?? "").toLowerCase().includes(q)
      );
    }
    const draftRollRows: RollRow[] = drafts.map((job) => ({
      kind: "draft",
      job,
    }));

    // The SAME shared sort bookings already use — job_date, then created_at,
    // sortDir toggles. Drafts interleave by date with no special-casing, so
    // the soonest-first ordering of real bookings is untouched.
    const merged = [...bookingRows, ...draftRollRows];
    merged.sort((a, b) => {
      const byDate = a.job.job_date.localeCompare(b.job.job_date);
      if (byDate !== 0) return sortDir === "asc" ? byDate : -byDate;
      const byCreated = a.job.created_at.localeCompare(b.job.created_at);
      return sortDir === "asc" ? byCreated : -byCreated;
    });
    return merged.slice(0, JOBS_LIMIT);
  }, [rows, jobs, status, filter, searchParam, today, sortDir]);

  // Selection only exists on the Completed tab — drop it when the tab
  // switches away. Render-time adjustment (the documented alternative
  // to a setState-in-effect, which the compiler lint rejects).
  const [prevStatus, setPrevStatus] = useState(status);
  if (prevStatus !== status) {
    setPrevStatus(status);
    if (status !== "completed") setSelected(new Set());
  }

  // Selected rows with their site+customer context, independent of the
  // current search filter (a selected row hidden by a narrower search
  // stays selected — it's still going on the invoice). Validity is part
  // of the derivation rather than pruned into state: an id whose job
  // got invoiced/archived/un-completed under us (sync) simply stops
  // counting — it can't render a checkbox, join the bar's total, or
  // reach the modal presets.
  const selectionInfo = useMemo(() => {
    if (!jobs || !sites || !customers || selected.size === 0) return null;
    const all = buildRows({ jobs, sites, customers });
    const sel = all.filter(
      (j) =>
        selected.has(j.id) && j.job_status === "completed" && !j.is_invoiced
    );
    if (sel.length === 0) return null;
    sel.sort((a, b) => a.job_date.localeCompare(b.job_date));
    const total = sel.reduce((s, j) => s + Number(j.value ?? 0), 0);
    return { jobs: sel, customer: sel[0].site.customer, total };
  }, [jobs, sites, customers, selected]);

  // While ≥1 row is selected, rows of OTHER customers can't be added —
  // one invoice covers exactly one customer.
  const lockedCustomerId = selectionInfo?.customer.id ?? null;

  const toggleSelect = useCallback((jobId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }, []);

  const openInvoiceModal = useCallback(() => {
    if (!selectionInfo) return;
    setInvoicePresets({
      customer: selectionInfo.customer,
      jobIds: selectionInfo.jobs.map((j) => j.id),
      amount: selectionInfo.total > 0 ? selectionInfo.total : null,
      description: selectionInfo.jobs.map(jobSummaryLine).join("\n"),
    });
    setInvoiceOpen(true);
  }, [selectionInfo]);

  const handleInvoiceCreated = useCallback(() => {
    setSelected(new Set());
    // The action flipped is_invoiced on the server; pull it back into
    // Dexie now rather than waiting for the 30s interval tick. Same
    // manual-reason call the conflicts inbox uses.
    void runSync("manual");
  }, []);

  const selectable = status === "completed";

  // ─── Invoice status chips (Pass E) ────────────────────────────────
  // Draft/Sent live only on the invoices table (not synced to Dexie),
  // so fetch them in ONE batched read for the visible invoiced rows
  // when online. Keyed on the sorted id list so the effect re-runs
  // only when the visible invoiced set actually changes. Offline or
  // pre-resolve, the chip falls back to neutral "Invoiced" (Paid still
  // works offline via the synced is_paid flag).
  const [invoiceStatuses, setInvoiceStatuses] = useState<
    Record<string, InvoiceStatus>
  >({});
  const invoicedIdsKey = useMemo(() => {
    if (!selectable || !rows) return "";
    return rows
      .filter((j) => j.is_invoiced)
      .map((j) => j.id)
      .sort()
      .join(",");
  }, [selectable, rows]);

  useEffect(() => {
    if (!online || invoicedIdsKey === "") return;
    let live = true;
    getInvoiceStatusesForJobsAction(invoicedIdsKey.split(",")).then(
      (statuses) => {
        // Merge rather than replace: a narrower search shouldn't wipe
        // statuses already fetched for rows it filtered out.
        if (live) setInvoiceStatuses((prev) => ({ ...prev, ...statuses }));
      },
      () => {
        // Transport failure (offline mid-flight) — fallback chip stands.
      }
    );
    return () => {
      live = false;
    };
  }, [invoicedIdsKey, online]);

  return (
    // Bottom padding keeps the fixed mobile selection bar from covering
    // the table's last rows while a selection is active.
    <div className={selectionInfo ? "pb-28 md:pb-0" : undefined}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-gray-900">Jobs</h1>
            <SyncStatePill />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <StartJobButton />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <JobsStatusTabs />
        <JobsFilter />
      </div>

      {/* Selection bar — appears at ≥1 selected row. In flow under the
          tabs on md+; fixed above the bottom nav (3.5rem + safe-area)
          on mobile. */}
      {selectable && selectionInfo && (
        <div className="fixed inset-x-3 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.75rem)] z-40 md:static md:inset-x-auto md:z-auto md:mt-3">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-brand bg-white px-4 py-3 shadow-lg md:shadow-sm">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">
                {selectionInfo.jobs.length} job
                {selectionInfo.jobs.length === 1 ? "" : "s"} ·{" "}
                {selectionInfo.customer.name}
              </p>
              {selectionInfo.total > 0 && (
                <p className="text-xs text-gray-500">
                  £
                  {selectionInfo.total.toLocaleString("en-GB", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  total
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="min-h-[44px] rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 sm:min-h-0"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => online && openInvoiceModal()}
                disabled={!online}
                title={
                  !online
                    ? "Needs internet — invoicing is online-only"
                    : undefined
                }
                className="min-h-[44px] rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-75 hover:bg-brand-dark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0"
              >
                Create Invoice
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4">
        {status === "draft" ? (
          <DraftsList drafts={draftRows} />
        ) : rollRows === null ? (
          <JobsTableSkeleton />
        ) : rollRows.length === 0 ? (
          <div className="rounded-xl bg-white p-12 text-center shadow-sm">
            <p className="text-sm text-gray-500">No jobs found.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs font-medium uppercase tracking-wider text-gray-500">
                    {selectable && (
                      <th className="px-4 py-3">
                        <span className="sr-only">
                          Select for invoicing / invoice status
                        </span>
                      </th>
                    )}
                    <th className="px-4 py-3">Ref</th>
                    <th className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() =>
                          setSortDir((d) => (d === "asc" ? "desc" : "asc"))
                        }
                        className="inline-flex cursor-pointer items-center gap-1 uppercase tracking-wider hover:text-gray-700"
                        aria-label={
                          sortDir === "asc"
                            ? "Sorted by date, soonest first. Activate to sort latest first."
                            : "Sorted by date, latest first. Activate to sort soonest first."
                        }
                      >
                        Date
                        <span aria-hidden="true" className="text-[10px] leading-none">
                          {sortDir === "asc" ? "▲" : "▼"}
                        </span>
                      </button>
                    </th>
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
                  {rollRows.map((row) => {
                    // Draft rows (Track 1b) — Open tab only. No site/customer,
                    // so render the phrase + date + a grey "Draft" badge and
                    // route the whole row to upgrade. NO checkbox, NO Start/
                    // Complete affordance: a draft's only action is upgrade.
                    if (row.kind === "draft") {
                      const d = row.job;
                      const upgradeHref = `${ROUTES.jobDetail(d.id)}/upgrade`;
                      return (
                        <tr
                          key={d.id}
                          className="bg-gray-50 hover:bg-gray-100/70"
                        >
                          <td className="px-4 py-3 whitespace-nowrap text-gray-300">
                            —
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <Link href={upgradeHref} className="block">
                              <span className="font-medium text-gray-700">
                                {new Date(d.job_date).toLocaleDateString(
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
                                  d.job_time ? "text-gray-500" : "text-gray-400"
                                }`}
                              >
                                {formatWindow(d.job_time, d.job_time_end)}
                              </span>
                            </Link>
                          </td>
                          <td className="px-4 py-3">
                            <Link
                              href={upgradeHref}
                              className="flex items-center gap-2"
                            >
                              <span className="truncate italic text-gray-500">
                                {d.capture_note || "(no description)"}
                              </span>
                              {/* The Status column carries the Draft badge on
                                  md+, but is hidden below md — surface the
                                  badge inline here so a draft is unmistakable
                                  on mobile too. */}
                              <span className="md:hidden">
                                <JobStatusBadge status="draft" />
                              </span>
                            </Link>
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell text-gray-300">
                            —
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell text-gray-300">
                            —
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell">
                            <div className="flex items-center gap-2">
                              <JobStatusBadge status="draft" />
                              <Link
                                href={upgradeHref}
                                className="inline-flex items-center gap-1 rounded-md bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-darker transition-colors hover:bg-brand-soft/70"
                              >
                                Upgrade →
                              </Link>
                            </div>
                          </td>
                          <td className="px-4 py-3 hidden lg:table-cell text-gray-300">
                            —
                          </td>
                        </tr>
                      );
                    }
                    const job = row.job;
                    // With a selection going, rows of other customers
                    // can't join this invoice — dim + disable them.
                    const crossCustomer =
                      selectable &&
                      lockedCustomerId !== null &&
                      job.site.customer.id !== lockedCustomerId;
                    return (
                    <tr
                      key={job.id}
                      className={`hover:bg-gray-50 ${
                        crossCustomer ? "opacity-50" : ""
                      }`}
                    >
                      {selectable && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          {!job.is_invoiced ? (
                            <input
                              type="checkbox"
                              checked={selected.has(job.id)}
                              disabled={crossCustomer}
                              onChange={() => toggleSelect(job.id)}
                              title={
                                crossCustomer
                                  ? `Different customer — this invoice covers ${selectionInfo?.customer.name}`
                                  : undefined
                              }
                              aria-label={`Select job ${
                                job.reference_number ?? job.id.slice(0, 6)
                              } for invoicing`}
                              className="h-4 w-4 cursor-pointer rounded border-gray-300 accent-brand disabled:cursor-not-allowed"
                            />
                          ) : (
                            <InvoiceStatusChip
                              paid={job.is_paid}
                              status={invoiceStatuses[job.id] ?? null}
                            />
                          )}
                        </td>
                      )}
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
                            {formatWindow(job.job_time, job.job_time_end)}
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Multi-job invoice modal. Presets are the modal-open snapshot
          (invoicePresets), NOT live selection state — clearing the
          selection on create must not unmount the open modal. */}
      {invoicePresets && (
        <InvoiceCreatorModal
          open={invoiceOpen}
          onClose={() => setInvoiceOpen(false)}
          presetCustomer={invoicePresets.customer}
          presetJobIds={invoicePresets.jobIds}
          presetAmount={invoicePresets.amount}
          presetDescription={invoicePresets.description}
          onCreated={handleInvoiceCreated}
        />
      )}
    </div>
  );
}

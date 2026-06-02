"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import {
  setReviewReceivedAction,
  setCustomerTypeAction,
  getServiceReportsForCustomerAction,
  type ServiceReportSummary,
} from "@/app/(app)/customers/actions";
import { BookingModal } from "@/components/bookings/booking-modal";
import { InvoiceCreatorModal } from "@/components/invoices/invoice-creator-modal";
import { DeleteCustomerConfirm } from "@/components/customers/delete-customer-confirm";
import { SyncStatePill } from "@/components/sync/sync-state-pill";
import { ROUTES } from "@/lib/constants/routes";
import {
  CALL_TYPE_LABELS,
  AGREEMENT_STATUS_LABELS,
  AGREEMENT_STATUS_COLORS,
  JOB_STATUS_LABELS,
  JOB_STATUS_COLORS,
} from "@/lib/constants/job-labels";
import { db } from "@/lib/db";
import { useIsOnline } from "@/lib/hooks/use-is-online";
import { todayUk } from "@/lib/utils/today-uk";
import type {
  Agreement,
  AgreementStatus,
  CallType,
  Customer,
  CustomerType,
  Job,
  JobStatus,
  Site,
  Task,
} from "@/types/database";

interface CustomerSidePanelProps {
  customerId: string | null;
  onClose: () => void;
}

const TASK_TYPE_LABEL: Record<string, string> = {
  follow_up: "Follow up",
  review_request: "Review request",
  contract_renewal: "Renewal",
  general: "Task",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function CustomerSidePanel({
  customerId,
  onClose,
}: CustomerSidePanelProps) {
  const router = useRouter();
  // Effective online (navigator.onLine + last sync attempt outcome).
  // Surface 3's post-test fix — the bare navigator.onLine read used
  // to keep `true` with Wi-Fi off on localhost, so the guards never
  // engaged. Now it stays `true` only while the engine's last sync
  // attempt actually reached the server.
  const online = useIsOnline();
  const [bookingOpen, setBookingOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [, startTransition] = useTransition();

  // ─── Chained Dexie reads ──────────────────────────────────────────
  //
  // Surface-3 data layer. Replaces the previous one-shot
  // `getCustomerDetailAction` with five reactive `useLiveQuery` calls.
  // Each follows the rolled-out convention: `undefined` = query in
  // flight (loading), `null` = confirmed missing OR soft-deleted, an
  // actual object/array = ready. The render path gates on these states
  // explicitly.
  //
  // Why per-entity queries (not one giant join):
  //
  //   - Dexie has no SQL joins. Five small typed queries keep each
  //     read straightforward and the dep arrays minimal.
  //   - `useLiveQuery` reads ONLY emit when the touched tables change,
  //     so we don't re-render the agreements section when only the
  //     customer's name was edited.
  //   - Loading semantics are clearer per slice: if the operator is on
  //     a fresh device mid-initial-sync, the customer header can land
  //     before the jobs list does, and each section can show its own
  //     skeleton without holding the whole panel back.
  //
  // Filtering invariants applied at the read site (no schema bump):
  //
  //   - `!deleted_at` (soft-delete): customers, sites, jobs,
  //     agreements, tasks. Soft-deleted rows are treated as
  //     not-present, matching surfaces 1 + 2.
  //   - `!is_archived` on jobs: server-side `getCustomerDetail`
  //     applies the same filter via Supabase `.eq("is_archived", false)`.
  //     The Job type now carries the field (see types/database.ts) but
  //     pre-existing synced rows can be `undefined`, so the JS check is
  //     `!j.is_archived` — true for both `false` and `undefined`.
  //   - `tasks.status === "pending"`: matches the server filter; only
  //     open follow-ups belong on the panel.

  const customer = useLiveQuery<Customer | null>(
    async () => {
      if (!customerId) return null;
      const c = await db.customers.get(customerId);
      return c && !c.deleted_at ? c : null;
    },
    [customerId]
  );

  const sites = useLiveQuery<Site[]>(
    async () => {
      if (!customerId) return [];
      const all = await db.sites
        .where("customer_id")
        .equals(customerId)
        .toArray();
      return all
        .filter((s) => !s.deleted_at)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    },
    [customerId]
  );

  // Job IDs are computed from sites; keep the dep stable so anyOf
  // doesn't re-fire on every keystroke elsewhere. We join into a
  // string for the dep (sorted) — useLiveQuery uses === on deps and a
  // changing array reference would needlessly re-fire.
  const siteIds = (sites ?? []).map((s) => s.id);
  const siteIdsDep = [...siteIds].sort().join(",");

  const jobs = useLiveQuery<Job[]>(
    async () => {
      if (siteIds.length === 0) return [];
      const all = await db.jobs
        .where("site_id")
        .anyOf(siteIds)
        .toArray();
      return all
        .filter((j) => !j.deleted_at && !j.is_archived)
        .sort((a, b) => b.job_date.localeCompare(a.job_date));
    },
    [siteIdsDep]
  );

  const agreements = useLiveQuery<Agreement[]>(
    async () => {
      if (!customerId) return [];
      const all = await db.agreements
        .where("customer_id")
        .equals(customerId)
        .toArray();
      return all
        .filter((a) => !a.deleted_at)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    [customerId]
  );

  const tasks = useLiveQuery<Task[]>(
    async () => {
      if (!customerId) return [];
      const all = await db.tasks
        .where("related_customer_id")
        .equals(customerId)
        .toArray();
      // Server sorts by priority_order desc then due_date asc nulls-last.
      // Match as closely as Dexie allows. priority_order isn't on the TS
      // type yet — fall back to title for stable order, which is enough
      // for the operator's "open follow-ups for this customer" pane.
      return all
        .filter(
          (t) => !t.deleted_at && t.status === "pending"
        )
        .sort((a, b) => {
          const aDue = a.due_date ?? "9999-12-31";
          const bDue = b.due_date ?? "9999-12-31";
          return aDue.localeCompare(bDue);
        });
    },
    [customerId]
  );

  // Derived: upcoming vs past, mirroring getCustomerDetail. The
  // calendar boundary uses todayUk() — same helper the server uses.
  const today = todayUk();
  const allJobs: Job[] = jobs ?? [];
  const upcomingJobs = allJobs
    .filter((j) => j.job_date >= today && j.job_status !== "completed")
    .sort((a, b) => a.job_date.localeCompare(b.job_date));
  const upcomingIds = new Set(upcomingJobs.map((j) => j.id));
  const pastJobs = allJobs.filter((j) => !upcomingIds.has(j.id)).slice(0, 15);

  // Close on Escape for keyboard users.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && customerId) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [customerId, onClose]);

  if (!customerId) return null;

  // Resolved gates: `undefined` is in-flight (skeleton); `null` is
  // confirmed-missing (not-found, including soft-deleted). All four
  // child queries (sites/jobs/agreements/tasks) default to [] in their
  // query bodies, so they're never `undefined` once the customer is.
  // The header re-uses the existing skeleton block; the body waits for
  // a non-null customer.
  const loading = customer === undefined;
  const notFound = customer === null;
  const detail = customer && !loading && !notFound ? customer : null;

  function handleReviewToggle(received: boolean) {
    // Online guard: setReviewReceivedAction is a single-entity write
    // that step-7 surface-3 deliberately leaves unwrapped. Offline,
    // the click is a no-op and the checkbox stays at its prior state.
    // The control's `disabled` already prevents this, but the guard
    // here is belt-and-braces in case a future caller bypasses the
    // disabled attr.
    if (!detail || !online) return;
    startTransition(async () => {
      const res = await setReviewReceivedAction(detail.id, received);
      if (res.success) {
        router.refresh();
      }
      // On failure: nothing local to revert — the next pull will
      // bring the server's authoritative value back into Dexie and
      // useLiveQuery will re-render. No optimistic UI here because we
      // own no local state for this field anymore (Dexie is the
      // source of truth via useLiveQuery).
    });
  }

  function handleTypeChange(type: CustomerType) {
    if (!detail || !online) return;
    startTransition(async () => {
      const res = await setCustomerTypeAction(detail.id, type);
      if (res.success) {
        router.refresh();
      }
    });
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl sm:w-[480px]">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-100 px-6 py-4">
          <div className="min-w-0 flex-1">
            {loading || !detail ? (
              <div className="h-6 w-40 animate-pulse rounded bg-gray-100" />
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-lg font-semibold text-gray-900">
                    {detail.name}
                  </h2>
                  {/* SyncStatePill — visual parity with Surfaces 1 + 2.
                      Sits next to the customer name so the operator's
                      sync status is in eyeshot every time they look at
                      who they're working with. */}
                  <SyncStatePill />
                </div>
                {detail.company_name && (
                  <p className="truncate text-sm text-gray-500">
                    {detail.company_name}
                  </p>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* "Open page" → the older RSC `/customers/[id]` route which
                is NOT yet offline-converted. Hide when offline so the
                operator doesn't tap into a non-functional shell. The
                side panel itself remains the offline-aware surface;
                the full-page route is logged as a "convert-or-retire"
                decision for later. */}
            {detail && online && (
              <Link
                href={ROUTES.customerDetail(detail.id)}
                className="hidden rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 md:inline-flex"
                title="Open full page"
              >
                Open page
              </Link>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 md:p-1.5"
              aria-label="Close"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18 18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-lg bg-gray-50"
                />
              ))}
            </div>
          )}

          {/* Not-found / soft-deleted: customer === null after the
              useLiveQuery resolved. Surface 1 + 2 use the same
              convention — distinguishing "still loading" (skeleton)
              from "confirmed missing" (this block) is critical for
              the offline-first behaviour: a fresh-device operator
              opening before sync would otherwise see "not found"
              when the data just isn't local yet. */}
          {notFound && (
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-6 text-center">
              <p className="text-sm font-medium text-gray-900">
                Customer not found
              </p>
              <p className="mt-1 text-xs text-gray-500">
                It may have been deleted, or your local data hasn&apos;t caught
                up yet. Pull to sync or try again later.
              </p>
            </div>
          )}

          {detail && (
            <div className="space-y-6">
              {/* PMA prompt — same soft framing for both customer types.
                  PMAs are a contract framework for recurring work; they're
                  optional for one-off jobs regardless of whether the
                  customer is commercial or domestic. Surfaces only when
                  no active agreement exists. */}
              {!(agreements ?? []).some((a) => a.status === "active") &&
                (sites ?? [])[0] && (
                  <Link
                    href={`${ROUTES.siteDetail((sites ?? [])[0].id)}#agreements`}
                    className="block rounded-xl border border-brand-soft bg-brand-soft/40 p-3 hover:bg-brand-soft"
                  >
                    <div className="flex items-start gap-2">
                      <svg
                        className="mt-0.5 h-4 w-4 shrink-0 text-brand-darker"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                      </svg>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-brand-darker">
                          Set up a Pest Management Agreement?
                        </p>
                        <p className="mt-0.5 text-xs text-brand-darker/80">
                          Right for recurring contracted work — fixed visit
                          schedule, annual fee. Skip it for one-off jobs.
                        </p>
                      </div>
                    </div>
                  </Link>
                )}

              {/* Action bar — desktop only. On mobile, the same actions
                  live in the sticky bottom bar so the primary CTA is
                  always thumb-reachable as the panel is scrolled. */}
              {/* Action bar — both buttons are online-only because their
                  underlying actions (createBookingAction,
                  createInvoiceAction) are multi-entity and the
                  entity_ids[] sync-engine guard hasn't shipped yet.
                  Step-7 reads-only conversion: keep them visible so
                  the operator sees what's possible, but disable + add
                  a tooltip when offline so a tap doesn't silently
                  fail. The same actions live in the sticky mobile bar
                  below; this block only renders on md+. */}
              <div className="hidden grid-cols-2 gap-2 md:grid">
                <button
                  type="button"
                  onClick={() => setBookingOpen(true)}
                  disabled={!online}
                  title={online ? undefined : "Online required"}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 disabled:hover:bg-gray-200"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  New Booking
                </button>
                <button
                  type="button"
                  onClick={() => setInvoiceOpen(true)}
                  disabled={!online}
                  title={online ? undefined : "Online required"}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 disabled:hover:bg-gray-50"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                  Create Invoice
                </button>
              </div>

              {/* Quick info — every field is always rendered, even when
                  blank, so the operator can see at a glance what's on file
                  vs what's missing. Empty values show as em-dashes. */}
              <Section title="Details">
                <dl className="space-y-2.5 text-sm">
                  <Row label="Customer">
                    {/* Customer type toggle — single-entity customer
                        write (setCustomerTypeAction). Step-7 reads-only
                        keeps it online-only. When offline, the buttons
                        appear with the current selection but click is
                        a no-op (guarded inside handleTypeChange too).
                        Cursor + opacity make the disabled state
                        visible without a layout shift. */}
                    <div
                      className="flex gap-1 rounded-lg bg-gray-100 p-0.5 text-xs"
                      title={online ? undefined : "Online required"}
                    >
                      {(["commercial", "domestic"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => handleTypeChange(t)}
                          disabled={!online}
                          className={`rounded-md px-2 py-0.5 font-medium transition-colors ${
                            detail.customer_type === t
                              ? "bg-white text-gray-900 shadow-sm"
                              : "text-gray-500"
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                          {t === "commercial" ? "Commercial" : "Domestic"}
                        </button>
                      ))}
                    </div>
                  </Row>
                  {detail.customer_type === "commercial" && (
                    <>
                      <Row label="Company">
                        {detail.company_name ? (
                          <span>{detail.company_name}</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </Row>
                      <Row label="Position">
                        {detail.position ? (
                          <span>{detail.position}</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </Row>
                    </>
                  )}
                  <Row label="Email">
                    {detail.email ? (
                      <a
                        href={`mailto:${detail.email}`}
                        className="text-brand-darker hover:underline"
                      >
                        {detail.email}
                      </a>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </Row>
                  <Row label="Phone">
                    {detail.phone ? (
                      <a
                        href={`tel:${detail.phone}`}
                        className="text-brand-darker hover:underline"
                      >
                        {detail.phone}
                      </a>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </Row>
                  <Row label="Mobile">
                    {detail.mobile ? (
                      <a
                        href={`tel:${detail.mobile}`}
                        className="text-brand-darker hover:underline"
                      >
                        {detail.mobile}
                      </a>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </Row>
                  {detail.customer_type === "commercial" && (
                    <Row label="Website">
                      {detail.website ? (
                        <a
                          href={detail.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand-darker hover:underline"
                        >
                          {detail.website.replace(/^https?:\/\//, "")}
                        </a>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </Row>
                  )}
                  {detail.customer_type === "commercial" && (
                    <Row label="Annual value">
                      {detail.annual_contract_value != null ? (
                        <span className="font-semibold text-brand-darker">
                          £
                          {Number(
                            detail.annual_contract_value
                          ).toLocaleString("en-GB", {
                            maximumFractionDigits: 0,
                          })}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </Row>
                  )}
                  {(() => {
                    const c = detail;
                    // Structured fields first, fall back to legacy single
                    // `address` for customers created before migration 026.
                    const structured = [
                      c.address_line_1,
                      c.address_line_2,
                      c.town,
                      c.county,
                      c.postcode,
                    ]
                      .filter((v) => v && v.trim() !== "")
                      .join(", ");
                    const display = structured || c.address || "";
                    return (
                      <Row label="Address">
                        {display ? (
                          <span className="whitespace-pre-wrap text-right">
                            {display}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </Row>
                    );
                  })()}
                  <Row label="Notes">
                    {detail.notes ? (
                      <span className="whitespace-pre-wrap text-right text-gray-600">
                        {detail.notes}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </Row>
                  <Row label="Added">{formatDate(detail.created_at)}</Row>
                  <Row label="Google review">
                    {/* Google review checkbox — single-entity write to
                        the customer row. Same online-only treatment as
                        the type toggle. The label's cursor is upgraded
                        to "not-allowed" when offline so the disabled
                        state is felt as well as seen. */}
                    <label
                      className={`flex items-center gap-2 ${online ? "cursor-pointer" : "cursor-not-allowed"}`}
                      title={online ? undefined : "Online required"}
                    >
                      <input
                        type="checkbox"
                        checked={detail.google_review_received}
                        onChange={(e) => handleReviewToggle(e.target.checked)}
                        disabled={!online}
                        className="h-4 w-4 rounded border-gray-300 text-brand-darker focus:ring-brand disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <span className="text-xs text-gray-500">
                        {detail.google_review_received
                          ? "Received"
                          : "Not yet"}
                      </span>
                    </label>
                  </Row>
                </dl>
              </Section>

              {/* Sites */}
              {(sites ?? []).length > 0 && (
                <Section title={`Sites (${(sites ?? []).length})`}>
                  <ul className="space-y-1.5 text-sm">
                    {(sites ?? []).map((s) => (
                      <li key={s.id}>
                        <Link
                          href={ROUTES.siteDetail(s.id)}
                          className="block rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50"
                        >
                          <p className="font-medium text-gray-900">
                            {s.address_line_1}
                          </p>
                          <p className="text-xs text-gray-500">
                            {[s.town, s.postcode].filter(Boolean).join(", ")}
                          </p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* Upcoming jobs */}
              <Section title={`Upcoming visits (${upcomingJobs.length})`}>
                {upcomingJobs.length === 0 ? (
                  <p className="text-sm text-gray-400">None scheduled.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {upcomingJobs.map((j) => (
                      <JobRow key={j.id} job={j} />
                    ))}
                  </ul>
                )}
              </Section>

              {/* Past jobs */}
              {pastJobs.length > 0 && (
                <Section title={`Past jobs (${pastJobs.length})`}>
                  <ul className="space-y-1.5 text-sm">
                    {pastJobs.slice(0, 8).map((j) => (
                      <JobRow key={j.id} job={j} />
                    ))}
                  </ul>
                </Section>
              )}

              {/* Tasks */}
              {(tasks ?? []).length > 0 && (
                <Section title={`Follow-ups (${(tasks ?? []).length})`}>
                  <ul className="space-y-1.5 text-sm">
                    {(tasks ?? []).map((t) => (
                      <li
                        key={t.id}
                        className="rounded-lg border border-gray-100 px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-purple-700">
                            {TASK_TYPE_LABEL[t.task_type] ?? "Task"}
                          </span>
                          {t.due_date && (
                            <span className="text-xs text-gray-500">
                              Due {formatDate(t.due_date)}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-gray-900">{t.title}</p>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* Agreements */}
              {(agreements ?? []).length > 0 && (
                <Section title={`Agreements (${(agreements ?? []).length})`}>
                  <ul className="space-y-1.5 text-sm">
                    {(agreements ?? []).map((a) => (
                      <li
                        key={a.id}
                        className="rounded-lg border border-gray-100 px-3 py-2"
                      >
                        <div className="flex items-center justify-between">
                          <Link
                            href={`${ROUTES.AGREEMENTS}/${a.id}`}
                            className="font-medium text-gray-900 hover:underline"
                          >
                            {a.reference_number ?? `Agreement ${a.id.slice(0, 8)}`}
                          </Link>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              AGREEMENT_STATUS_COLORS[a.status as AgreementStatus]
                            }`}
                          >
                            {AGREEMENT_STATUS_LABELS[a.status as AgreementStatus]}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {a.end_date ? `Renews ${formatDate(a.end_date)}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* Suggestions — virtual to-dos derived from missing artefacts.
                  Surface-3 offline conversion dropped the previous "Generate
                  service report PDF" item because deriving it required the
                  `reports` table, which is not synced to Dexie (offline-pwa
                  Gap A → Option A). The report-generation flow is still
                  available online from the job detail page; the panel just
                  no longer surfaces the suggestion. The PMA / fill-sheet
                  suggestions are unchanged. */}
              {(() => {
                // Visits past their date that still don't have a service sheet
                const sheetsToFill = pastJobs.filter(
                  (j) => j.job_status !== "completed"
                );
                // Active agreement without a signed PDF
                const agreementsMissingPdf = (agreements ?? []).filter(
                  (a) => a.status === "active" && !a.contract_pdf_url
                );
                // Note: the previous "Consider a PMA (after 2+ completed
                // jobs)" suggestion is gone — the new top-of-panel banner
                // surfaces this for any customer without an active PMA,
                // commercial or domestic. Don't duplicate.

                const suggestionCount =
                  sheetsToFill.length + agreementsMissingPdf.length;

                if (suggestionCount === 0) return null;

                return (
                  <Section title={`Suggestions (${suggestionCount})`}>
                    <ul className="space-y-1.5 text-sm">
                      {sheetsToFill.slice(0, 3).map((j) => (
                        <li key={`sheet-${j.id}`}>
                          <Link
                            href={`${ROUTES.jobDetail(j.id)}/complete`}
                            className="flex items-center justify-between gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 hover:bg-amber-100"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-amber-900">
                                Fill service sheet
                              </p>
                              <p className="text-xs text-amber-700">
                                {formatDate(j.job_date)}
                              </p>
                            </div>
                            <span className="text-xs font-medium text-amber-800">
                              Open →
                            </span>
                          </Link>
                        </li>
                      ))}
                      {/* "Generate service report PDF" suggestions removed
                          in the offline conversion — they required the
                          `reports` table which isn't synced (Gap A). The
                          underlying flow still works on the job detail page
                          when online; the panel just no longer prompts for
                          it. */}
                      {agreementsMissingPdf.map((a) => (
                        <li key={`agreement-${a.id}`}>
                          <Link
                            href={`${ROUTES.AGREEMENTS}/${a.id}`}
                            className="flex items-center justify-between gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 hover:bg-blue-100"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-blue-900">
                                Sign + generate agreement PDF
                              </p>
                              <p className="text-xs text-blue-700">
                                {a.reference_number ?? a.id.slice(0, 8)}
                              </p>
                            </div>
                            <span className="text-xs font-medium text-blue-800">
                              Open →
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </Section>
                );
              })()}

              {/* Documents — Surface 3 offline behaviour (Gap A → Option A):
                  Agreement PDFs are unconditional (the `agreements` table IS
                  synced and the `contract_pdf_url` field is on the row, so
                  the LIST renders offline — actually opening the PDF still
                  needs a network round-trip to Supabase Storage, which is
                  the same trade-off Surface 1 made for `photo_urls`).

                  Service report PDFs come from the `reports` table, which
                  is NOT synced (Storage URLs would be dead on tap offline
                  anyway). Instead of an empty section, we show an explicit
                  "online required" notice when offline, and the live list
                  via a small server-action fetch when online. */}
              <Section title="Documents">
                <DocumentsContent
                  agreements={agreements ?? []}
                  customerId={detail.id}
                  online={online}
                />
              </Section>

              {/* Danger zone — last thing in the scroll, separated visually.
                  deleteCustomerAction is multi-entity (cascades across
                  sites/jobs/agreements/tasks), so keep online-only
                  until the entity_ids[] sync guard ships. */}
              <div className="border-t border-gray-100 pt-5">
                <button
                  type="button"
                  onClick={() => setDeleteOpen(true)}
                  disabled={!online}
                  title={online ? undefined : "Online required"}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-white"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                    />
                  </svg>
                  Delete customer
                </button>
                <p className="mt-1 text-xs text-gray-400">
                  Removes the customer plus all their sites, jobs, agreements
                  and invoices. Cannot be undone.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Sticky mobile action bar — primary CTAs always thumb-reachable.
            Desktop has the in-content action grid above, so this hides on
            md+. `env(safe-area-inset-bottom)` keeps the buttons clear of
            the iOS home indicator.

            "New Booking" mirrors the desktop online-only guard. "Open
            page" is replaced with a disabled placeholder offline rather
            than removed, so the layout doesn't reshuffle when
            connectivity flips. */}
        {detail && (
          <div
            className="border-t border-gray-100 bg-white p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] md:hidden"
          >
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setBookingOpen(true)}
                disabled={!online}
                title={online ? undefined : "Online required"}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-brand text-sm font-semibold text-white shadow-sm active:bg-brand-darker disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                New Booking
              </button>
              {online ? (
                <Link
                  href={ROUTES.customerDetail(detail.id)}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 active:bg-gray-50"
                >
                  Open page
                </Link>
              ) : (
                <div
                  className="inline-flex h-11 cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-gray-200 bg-gray-50 text-sm font-medium text-gray-400"
                  title="Online required"
                >
                  Open page
                </div>
              )}
            </div>
          </div>
        )}
      </aside>

      {/* Booking + invoice + delete preset to this customer */}
      {detail && (
        <>
          <BookingModal
            open={bookingOpen}
            onClose={() => setBookingOpen(false)}
            presetCustomer={detail}
          />
          <InvoiceCreatorModal
            open={invoiceOpen}
            onClose={() => setInvoiceOpen(false)}
            presetCustomer={detail}
          />
          <DeleteCustomerConfirm
            customerId={detail.id}
            customerName={detail.name}
            open={deleteOpen}
            onClose={() => setDeleteOpen(false)}
            onDeleted={() => {
              setDeleteOpen(false);
              onClose();
              router.refresh();
            }}
          />
        </>
      )}
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900">{children}</dd>
    </div>
  );
}

function JobRow({
  job,
}: {
  job: {
    id: string;
    job_date: string;
    job_status: string;
    call_type: string | null;
    reference_number: string | null;
    parent_job_id: string | null;
    pest_species: string[] | null;
    report_notes: string | null;
  };
}) {
  const callTypeLabel = job.call_type
    ? CALL_TYPE_LABELS[job.call_type as CallType] ?? job.call_type
    : null;
  const isFollowUp = !!job.parent_job_id;
  const pests = job.pest_species ?? [];
  return (
    <li>
      <Link
        href={ROUTES.jobDetail(job.id)}
        className="block rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-gray-900">
                {formatDate(job.job_date)}
              </span>
              {job.reference_number && (
                <span
                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                    isFollowUp
                      ? "bg-blue-50 text-blue-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {job.reference_number}
                </span>
              )}
              {callTypeLabel && (
                <span className="text-xs text-gray-500">
                  · {callTypeLabel}
                </span>
              )}
            </div>
            {pests.length > 0 && (
              <p className="mt-1 truncate text-xs text-gray-600">
                {pests.join(", ")}
              </p>
            )}
            {job.report_notes && (
              <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">
                {job.report_notes}
              </p>
            )}
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              JOB_STATUS_COLORS[job.job_status as JobStatus]
            }`}
          >
            {JOB_STATUS_LABELS[job.job_status as JobStatus]}
          </span>
        </div>
      </Link>
    </li>
  );
}

/**
 * Documents section content. Split into its own sub-component because
 * the service-reports half does an online-only fetch — keeping that
 * useEffect out of the giant outer component makes the boundary
 * explicit and the dep graph minimal.
 *
 * Renders:
 *   1. Agreement PDFs from the (already-Dexie-backed) agreements list.
 *      Render UNCONDITIONALLY — the listing works offline; tapping the
 *      link still needs network to actually open the PDF, same caveat
 *      Surface 1 already accepted for `photo_urls`.
 *   2. Service report PDFs (the `reports` table — NOT in Dexie):
 *      - Online: fetched once via the small online-only action.
 *      - Offline: rendered as a small notice "Service report PDFs —
 *        online required". Surfacing this explicitly is the spec's
 *        non-negotiable: silent absence would look like a bug.
 *
 * The `online` prop drives both behaviours. On the offline→online
 * transition the fetch fires automatically (effect deps cover it),
 * so the operator sees the live list within a tick of reconnecting
 * without any manual action.
 */
function DocumentsContent({
  agreements,
  customerId,
  online,
}: {
  agreements: Agreement[];
  customerId: string;
  online: boolean;
}) {
  const [reports, setReports] = useState<ServiceReportSummary[] | null>(null);
  const [reportsLoading, setReportsLoading] = useState(false);

  useEffect(() => {
    // Only fetch when online. Offline, the notice carries the story —
    // skip the action call entirely so we don't waste a roundtrip
    // immediately throwing.
    if (!online) {
      setReports(null);
      setReportsLoading(false);
      return;
    }
    let cancelled = false;
    setReportsLoading(true);
    void getServiceReportsForCustomerAction(customerId)
      .then((r) => {
        if (!cancelled) {
          setReports(r);
          setReportsLoading(false);
        }
      })
      .catch(() => {
        // Server action errors are non-fatal — operator can keep
        // working with everything else on the panel. Reports section
        // just stays empty for this open.
        if (!cancelled) {
          setReports([]);
          setReportsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, online]);

  const agreementPdfs = agreements.filter((a) => a.contract_pdf_url);

  if (agreementPdfs.length === 0 && (!online || (reports?.length ?? 0) === 0)) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-gray-400">
          No documents yet. Complete a service sheet or sign an agreement to
          generate PDFs.
        </p>
        {!online && (
          <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Service report PDFs — online required.
          </p>
        )}
      </div>
    );
  }

  return (
    <ul className="space-y-1.5 text-sm">
      {agreementPdfs.map((a) => (
        <li key={a.id}>
          <a
            href={a.contract_pdf_url!}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50"
          >
            <DocIcon />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">
                Pest Management Agreement
              </p>
              <p className="truncate text-xs text-gray-500">
                {a.reference_number ?? a.id.slice(0, 8)}
              </p>
            </div>
          </a>
        </li>
      ))}
      {online ? (
        reportsLoading ? (
          <li className="rounded-lg border border-gray-100 px-3 py-2 text-xs text-gray-400">
            Loading service reports…
          </li>
        ) : (
          (reports ?? []).map((r) => (
            <li key={r.id}>
              <a
                href={r.pdf_url ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50"
              >
                <DocIcon />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">
                    Service Report
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {formatDate(r.created_at)}
                  </p>
                </div>
              </a>
            </li>
          ))
        )
      ) : (
        <li className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Service report PDFs — online required.
        </li>
      )}
    </ul>
  );
}

function DocIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-gray-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
      />
    </svg>
  );
}

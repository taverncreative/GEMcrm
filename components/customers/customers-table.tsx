"use client";

import { useState } from "react";
import Link from "next/link";
import { CustomerSidePanel } from "@/components/customers/customer-side-panel";
import { formatAddress } from "@/lib/utils/format-address";
import { CALL_TYPE_LABELS } from "@/lib/constants/job-labels";
import { ROUTES } from "@/lib/constants/routes";
import { setReviewReceivedAction } from "@/app/(app)/customers/actions";
import { wrapAction } from "@/lib/actions/wrap";
import { db } from "@/lib/db";
import type { CustomerListItem } from "@/lib/data/customers";
import type { CallType } from "@/types/database";

// Local-first wrapper for the inline review-received toggle. Wrapping
// the action at module level (not inside the component) keeps the
// reference stable across renders. The wrapped function preserves the
// {success, error} shape the existing `ReviewCheckbox.flip()` already
// checks, so the optimistic-UI revert path keeps working.
const setReviewReceivedLocalFirst = wrapAction(setReviewReceivedAction, {
  actionName: "setReviewReceivedAction",
  entityType: "customer",
  entityId: ([customerId]) => customerId,
  applyLocal: async ([customerId, received]) => {
    await db.customers.update(customerId, {
      google_review_received: received,
      updated_at: new Date().toISOString(),
    });
  },
});

interface CustomersTableProps {
  rows: CustomerListItem[];
  query: string | undefined;
  typeFilter: string;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export function CustomersTable({ rows, query, typeFilter }: CustomersTableProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (rows.length === 0) {
    const filtered = !!query || typeFilter !== "all";
    return (
      <div className="rounded-xl bg-white p-12 text-center shadow-sm">
        <p className="text-sm text-gray-500">
          {filtered ? "No customers match." : "No customers yet."}
        </p>
        {!filtered && (
          <Link
            href={`${ROUTES.CUSTOMERS}/new`}
            className="mt-3 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
          >
            Add your first customer
          </Link>
        )}
      </div>
    );
  }

  return (
    <>
      {/* ── Mobile: card-per-customer list ──────────────────────
          One card per row, tap to open the side panel. The denser table
          below is hidden on small viewports — at 375px it forced ~700px
          of horizontal scroll, which was unusable in the van. */}
      <div className="space-y-2 md:hidden">
        {rows.map((c) => {
          const isCommercial = c.customer_type === "commercial";
          const upcoming = c.upcomingJob
            ? `Next ${formatDate(c.upcomingJob.job_date)}`
            : null;
          const subtitle = isCommercial
            ? c.company_name ?? null
            : c.primarySite
            ? formatAddress(c.primarySite)
            : null;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedId(c.id)}
              className="flex w-full min-h-[88px] flex-col gap-1.5 rounded-xl bg-white p-4 text-left shadow-sm transition-colors active:bg-gray-50"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="truncate text-base font-semibold text-gray-900">
                  {c.name}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                    isCommercial
                      ? "bg-blue-100 text-blue-700"
                      : "bg-purple-100 text-purple-700"
                  }`}
                >
                  {isCommercial ? "Commercial" : "Domestic"}
                </span>
              </div>
              {subtitle && (
                <p className="truncate text-sm text-gray-500">{subtitle}</p>
              )}
              {isCommercial && c.primarySite && (
                <p className="flex items-center gap-1 truncate text-xs text-gray-400">
                  <svg
                    className="h-3 w-3 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
                    />
                  </svg>
                  <span className="truncate">{formatAddress(c.primarySite)}</span>
                </p>
              )}
              {(upcoming || c.hasActiveAgreement || c.google_review_received) && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {upcoming && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
                      </svg>
                      {upcoming}
                    </span>
                  )}
                  {c.hasActiveAgreement && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-darker">
                      <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                      On PMA
                    </span>
                  )}
                  {c.google_review_received && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-darker">
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                      Reviewed
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Desktop: full table ──────────────────────────────── */}
      <div className="hidden overflow-hidden rounded-xl bg-white shadow-sm md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="whitespace-nowrap px-4 py-3">Name</th>
                <th className="whitespace-nowrap px-4 py-3">Type</th>
                <th className="whitespace-nowrap px-4 py-3">Company</th>
                <th className="whitespace-nowrap px-4 py-3">Location</th>
                <th className="whitespace-nowrap px-4 py-3 text-center">Jobs</th>
                <th className="whitespace-nowrap px-4 py-3 text-center">
                  Sheets
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-center">
                  Invoices
                </th>
                <th className="whitespace-nowrap px-4 py-3">Last type</th>
                <th className="whitespace-nowrap px-4 py-3">PMA</th>
                <th className="whitespace-nowrap px-4 py-3">Next visit</th>
                <th
                  className="whitespace-nowrap px-4 py-3 text-center"
                  title="Google review received"
                >
                  Review
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((c) => {
                const isCommercial = c.customer_type === "commercial";
                // PMA column: positive pill if active, em-dash otherwise.
                // PMAs are optional for any customer type — only a chase
                // item once contracted work begins, so no "required" framing.
                const companyCell =
                  c.company_name ?? (isCommercial ? "—" : "N/A");
                return (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="whitespace-nowrap px-4 py-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(c.id);
                        }}
                        className="text-left font-medium text-gray-900 hover:underline"
                      >
                        {c.name}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                          isCommercial
                            ? "bg-blue-100 text-blue-700"
                            : "bg-purple-100 text-purple-700"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            isCommercial ? "bg-blue-500" : "bg-purple-500"
                          }`}
                        />
                        {isCommercial ? "Commercial" : "Domestic"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                      <span
                        className={
                          companyCell === "N/A" ? "text-gray-300" : ""
                        }
                      >
                        {companyCell}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                      {c.primarySite ? formatAddress(c.primarySite) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-center text-gray-700">
                      {c.jobCount}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-center text-gray-700">
                      {c.serviceSheetCount}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-center text-gray-700">
                      {/* `null` happens when reading from Dexie on
                          the offline-converted list page — invoices
                          aren't synced (Gap A). The em-dash signals
                          "unknown" rather than "zero". */}
                      {c.invoiceCount ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                      {c.latestJobCallType
                        ? CALL_TYPE_LABELS[c.latestJobCallType as CallType] ??
                          c.latestJobCallType
                        : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {c.hasActiveAgreement ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-darker">
                          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                          On PMA
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                      {c.upcomingJob ? formatDate(c.upcomingJob.job_date) : "—"}
                    </td>
                    <td
                      className="whitespace-nowrap px-4 py-3 text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ReviewCheckbox
                        customerId={c.id}
                        initial={c.google_review_received}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <CustomerSidePanel
        customerId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </>
  );
}

/**
 * Tiny optimistic checkbox so we don't have to re-fetch the list to flip
 * the review flag. Posts to the server action; reverts on failure.
 */
function ReviewCheckbox({
  customerId,
  initial,
}: {
  customerId: string;
  initial: boolean;
}) {
  const [checked, setChecked] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function flip(next: boolean) {
    setChecked(next);
    setBusy(true);
    try {
      // Local-first: Dexie row updated immediately, action queued in the
      // outbox, server call fires in the background when online. The
      // {success, error} shape matches the original raw-action return.
      const res = await setReviewReceivedLocalFirst(customerId, next);
      if (!res.success) setChecked(!next);
    } catch {
      setChecked(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={busy}
      onChange={(e) => flip(e.target.checked)}
      className="h-4 w-4 rounded border-gray-300 text-brand-darker focus:ring-brand disabled:opacity-50"
      aria-label="Google review received"
    />
  );
}

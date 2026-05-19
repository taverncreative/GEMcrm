"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getCustomerDetailAction,
  setReviewReceivedAction,
  setCustomerTypeAction,
} from "@/app/(app)/customers/actions";
import { BookingModal } from "@/components/bookings/booking-modal";
import { InvoiceCreatorModal } from "@/components/invoices/invoice-creator-modal";
import { DeleteCustomerConfirm } from "@/components/customers/delete-customer-confirm";
import { ROUTES } from "@/lib/constants/routes";
import {
  CALL_TYPE_LABELS,
  AGREEMENT_STATUS_LABELS,
  AGREEMENT_STATUS_COLORS,
  JOB_STATUS_LABELS,
  JOB_STATUS_COLORS,
} from "@/lib/constants/job-labels";
import type { CustomerDetail } from "@/lib/data/customers";
import type {
  AgreementStatus,
  CallType,
  CustomerType,
  JobStatus,
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
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!customerId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    void getCustomerDetailAction(customerId).then((d) => {
      setDetail(d);
      setLoading(false);
    });
  }, [customerId]);

  // Close on Escape for keyboard users.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && customerId) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [customerId, onClose]);

  if (!customerId) return null;

  function handleReviewToggle(received: boolean) {
    if (!detail) return;
    // Optimistic UI — flip locally, revert on failure.
    setDetail({
      ...detail,
      customer: { ...detail.customer, google_review_received: received },
    });
    startTransition(async () => {
      const res = await setReviewReceivedAction(detail.customer.id, received);
      if (!res.success) {
        // Revert
        setDetail((d) =>
          d
            ? {
                ...d,
                customer: { ...d.customer, google_review_received: !received },
              }
            : d
        );
      } else {
        router.refresh();
      }
    });
  }

  function handleTypeChange(type: CustomerType) {
    if (!detail) return;
    const prev = detail.customer.customer_type;
    setDetail({ ...detail, customer: { ...detail.customer, customer_type: type } });
    startTransition(async () => {
      const res = await setCustomerTypeAction(detail.customer.id, type);
      if (!res.success) {
        setDetail((d) =>
          d ? { ...d, customer: { ...d.customer, customer_type: prev } } : d
        );
      } else {
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
                <h2 className="truncate text-lg font-semibold text-gray-900">
                  {detail.customer.name}
                </h2>
                {detail.customer.company_name && (
                  <p className="truncate text-sm text-gray-500">
                    {detail.customer.company_name}
                  </p>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {detail && (
              <Link
                href={ROUTES.customerDetail(detail.customer.id)}
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

          {detail && (
            <div className="space-y-6">
              {/* PMA banner — two flavours based on customer type:
                  - Commercial without a PMA: amber "required" framing.
                    Commercial customers should always be on an agreement,
                    so we chase this prominently.
                  - Domestic without a PMA: brand-soft "set one up?"
                    framing. Domestic customers CAN have a PMA (regular
                    callouts, holiday-home contracts etc) — we just don't
                    treat its absence as a problem.
                  Both flavours link to the same site-page agreement form,
                  which doesn't gate by customer type. */}
              {!detail.agreements.some((a) => a.status === "active") &&
                detail.sites[0] && (
                  <Link
                    href={`${ROUTES.siteDetail(detail.sites[0].id)}#agreements`}
                    className={
                      detail.customer.customer_type === "commercial"
                        ? "block rounded-xl border border-amber-200 bg-amber-50 p-3 hover:bg-amber-100"
                        : "block rounded-xl border border-brand-soft bg-brand-soft/40 p-3 hover:bg-brand-soft"
                    }
                  >
                    <div className="flex items-start gap-2">
                      <svg
                        className={`mt-0.5 h-4 w-4 shrink-0 ${
                          detail.customer.customer_type === "commercial"
                            ? "text-amber-600"
                            : "text-brand-darker"
                        }`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                      </svg>
                      <div className="min-w-0 flex-1">
                        {detail.customer.customer_type === "commercial" ? (
                          <>
                            <p className="text-sm font-medium text-amber-900">
                              Pest Management Agreement missing
                            </p>
                            <p className="mt-0.5 text-xs text-amber-700">
                              Commercial customers should have an active PMA.
                              Set one up from the site page →
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm font-medium text-brand-darker">
                              Set up a Pest Management Agreement?
                            </p>
                            <p className="mt-0.5 text-xs text-brand-darker/80">
                              Recurring visits, fixed annual fee. Worth it
                              for regular callouts or properties with ongoing
                              risk →
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  </Link>
                )}

              {/* Action bar — desktop only. On mobile, the same actions
                  live in the sticky bottom bar so the primary CTA is
                  always thumb-reachable as the panel is scrolled. */}
              <div className="hidden grid-cols-2 gap-2 md:grid">
                <button
                  type="button"
                  onClick={() => setBookingOpen(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  New Booking
                </button>
                <button
                  type="button"
                  onClick={() => setInvoiceOpen(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                  Create Invoice
                </button>
              </div>

              {/* Quick info */}
              <Section title="Details">
                <dl className="space-y-2.5 text-sm">
                  <Row label="Customer">
                    <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5 text-xs">
                      {(["commercial", "domestic"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => handleTypeChange(t)}
                          className={`rounded-md px-2 py-0.5 font-medium transition-colors ${
                            detail.customer.customer_type === t
                              ? "bg-white text-gray-900 shadow-sm"
                              : "text-gray-500"
                          }`}
                        >
                          {t === "commercial" ? "Commercial" : "Domestic"}
                        </button>
                      ))}
                    </div>
                  </Row>
                  {detail.customer.email && (
                    <Row label="Email">
                      <a
                        href={`mailto:${detail.customer.email}`}
                        className="text-brand-darker hover:underline"
                      >
                        {detail.customer.email}
                      </a>
                    </Row>
                  )}
                  {detail.customer.phone && (
                    <Row label="Phone">
                      <a
                        href={`tel:${detail.customer.phone}`}
                        className="text-brand-darker hover:underline"
                      >
                        {detail.customer.phone}
                      </a>
                    </Row>
                  )}
                  {detail.customer.annual_contract_value != null && (
                    <Row label="Annual value">
                      <span className="font-semibold text-brand-darker">
                        £
                        {Number(detail.customer.annual_contract_value).toLocaleString(
                          "en-GB",
                          { maximumFractionDigits: 0 }
                        )}
                      </span>
                    </Row>
                  )}
                  {(() => {
                    const c = detail.customer;
                    // Build display from the structured fields, falling back
                    // to the legacy single `address` for customers created
                    // before migration 026.
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
                    if (!display) return null;
                    return (
                      <Row label="Address">
                        <span className="whitespace-pre-wrap text-right">
                          {display}
                        </span>
                      </Row>
                    );
                  })()}
                  <Row label="Added">{formatDate(detail.customer.created_at)}</Row>
                  <Row label="Google review">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={detail.customer.google_review_received}
                        onChange={(e) => handleReviewToggle(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-brand-darker focus:ring-brand"
                      />
                      <span className="text-xs text-gray-500">
                        {detail.customer.google_review_received
                          ? "Received"
                          : "Not yet"}
                      </span>
                    </label>
                  </Row>
                </dl>
              </Section>

              {/* Sites */}
              {detail.sites.length > 0 && (
                <Section title={`Sites (${detail.sites.length})`}>
                  <ul className="space-y-1.5 text-sm">
                    {detail.sites.map((s) => (
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
              <Section title={`Upcoming visits (${detail.upcomingJobs.length})`}>
                {detail.upcomingJobs.length === 0 ? (
                  <p className="text-sm text-gray-400">None scheduled.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {detail.upcomingJobs.map((j) => (
                      <JobRow key={j.id} job={j} />
                    ))}
                  </ul>
                )}
              </Section>

              {/* Past jobs */}
              {detail.pastJobs.length > 0 && (
                <Section title={`Past jobs (${detail.pastJobs.length})`}>
                  <ul className="space-y-1.5 text-sm">
                    {detail.pastJobs.slice(0, 8).map((j) => (
                      <JobRow key={j.id} job={j} />
                    ))}
                  </ul>
                </Section>
              )}

              {/* Tasks */}
              {detail.pendingTasks.length > 0 && (
                <Section title={`Follow-ups (${detail.pendingTasks.length})`}>
                  <ul className="space-y-1.5 text-sm">
                    {detail.pendingTasks.map((t) => (
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
              {detail.agreements.length > 0 && (
                <Section title={`Agreements (${detail.agreements.length})`}>
                  <ul className="space-y-1.5 text-sm">
                    {detail.agreements.map((a) => (
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

              {/* Suggestions — virtual to-dos derived from missing artefacts */}
              {(() => {
                // Visits past their date that still don't have a service sheet
                const sheetsToFill = detail.pastJobs.filter(
                  (j) => j.job_status !== "completed"
                );
                // Completed visits that never had a PDF report generated
                const reportedJobIds = new Set(detail.reports.map((r) => r.job_id));
                const reportsToGenerate = detail.pastJobs.filter(
                  (j) =>
                    j.job_status === "completed" && !reportedJobIds.has(j.id)
                );
                // Active agreement without a signed PDF
                const agreementsMissingPdf = detail.agreements.filter(
                  (a) => a.status === "active" && !a.contract_pdf_url
                );
                // Note: the previous "Consider a PMA (after 2+ completed
                // jobs)" suggestion is gone — the new top-of-panel banner
                // surfaces this for any customer without an active PMA,
                // commercial or domestic. Don't duplicate.

                const suggestionCount =
                  sheetsToFill.length +
                  reportsToGenerate.length +
                  agreementsMissingPdf.length;

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
                      {reportsToGenerate.slice(0, 3).map((j) => (
                        <li key={`report-${j.id}`}>
                          <Link
                            href={ROUTES.jobDetail(j.id)}
                            className="flex items-center justify-between gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 hover:bg-blue-100"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-blue-900">
                                Generate service report PDF
                              </p>
                              <p className="text-xs text-blue-700">
                                {formatDate(j.job_date)}
                              </p>
                            </div>
                            <span className="text-xs font-medium text-blue-800">
                              Open →
                            </span>
                          </Link>
                        </li>
                      ))}
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

              {/* Documents */}
              <Section
                title={`Documents (${
                  detail.reports.length +
                  detail.agreements.filter((a) => a.contract_pdf_url).length
                })`}
              >
                {detail.reports.length === 0 &&
                detail.agreements.filter((a) => a.contract_pdf_url).length ===
                  0 ? (
                  <p className="text-sm text-gray-400">
                    No documents yet. Complete a service sheet or sign an
                    agreement to generate PDFs.
                  </p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {detail.agreements
                      .filter((a) => a.contract_pdf_url)
                      .map((a) => (
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
                    {detail.reports.map((r) => (
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
                    ))}
                  </ul>
                )}
              </Section>

              {/* Danger zone — last thing in the scroll, separated visually */}
              <div className="border-t border-gray-100 pt-5">
                <button
                  type="button"
                  onClick={() => setDeleteOpen(true)}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
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
            the iOS home indicator. */}
        {detail && (
          <div
            className="border-t border-gray-100 bg-white p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] md:hidden"
          >
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setBookingOpen(true)}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-brand text-sm font-semibold text-white shadow-sm active:bg-brand-darker"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                New Booking
              </button>
              <Link
                href={ROUTES.customerDetail(detail.customer.id)}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 active:bg-gray-50"
              >
                Open page
              </Link>
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
            presetCustomer={detail.customer}
          />
          <InvoiceCreatorModal
            open={invoiceOpen}
            onClose={() => setInvoiceOpen(false)}
            presetCustomer={detail.customer}
          />
          <DeleteCustomerConfirm
            customerId={detail.customer.id}
            customerName={detail.customer.name}
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

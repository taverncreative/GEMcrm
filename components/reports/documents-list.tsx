"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants/routes";
import { proxyAssetUrl } from "@/lib/storage/asset-url";
import {
  markInvoicePaidAction,
  sendInvoiceFollowUpAction,
  generateInvoicePdfAction,
} from "@/app/(app)/invoices/actions";
import { getCustomerDetailAction } from "@/app/(app)/customers/actions";
import { useEnsureCustomerDocReady } from "@/components/documents/doc-ready-provider";
import type { DocumentItem } from "@/lib/data/documents";
import { customerDisplayName } from "@/lib/utils/customer-display-name";

interface DocumentsListProps {
  items: DocumentItem[];
}

const KIND_LABEL: Record<DocumentItem["kind"], string> = {
  invoice: "Invoices",
  service_sheet: "Service Sheets",
  agreement: "Agreements",
};

const KIND_COLOR: Record<DocumentItem["kind"], string> = {
  invoice: "bg-brand-soft text-brand-darker",
  service_sheet: "bg-blue-100 text-blue-700",
  agreement: "bg-amber-100 text-amber-700",
};

type Filter = "all" | DocumentItem["kind"];

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function DocumentsList({ items }: DocumentsListProps) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts: Record<Filter, number> = {
    all: items.length,
    invoice: items.filter((i) => i.kind === "invoice").length,
    service_sheet: items.filter((i) => i.kind === "service_sheet").length,
    agreement: items.filter((i) => i.kind === "agreement").length,
  };

  const visible =
    filter === "all" ? items : items.filter((i) => i.kind === filter);

  if (items.length === 0) {
    return (
      <div className="rounded-xl bg-white p-12 text-center shadow-sm">
        <p className="text-sm text-gray-500">No documents yet.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        <FilterPill
          label={`All (${counts.all})`}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <FilterPill
          label={`Invoices (${counts.invoice})`}
          active={filter === "invoice"}
          onClick={() => setFilter("invoice")}
        />
        <FilterPill
          label={`Service Sheets (${counts.service_sheet})`}
          active={filter === "service_sheet"}
          onClick={() => setFilter("service_sheet")}
        />
        <FilterPill
          label={`Agreements (${counts.agreement})`}
          active={filter === "agreement"}
          onClick={() => setFilter("agreement")}
        />
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3 hidden sm:table-cell">Customer</th>
                <th className="px-4 py-3 hidden md:table-cell">Detail</th>
                <th className="px-4 py-3 hidden md:table-cell">Date</th>
                <th className="px-4 py-3 text-right">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visible.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                        KIND_COLOR[item.kind]
                      }`}
                    >
                      {KIND_LABEL[item.kind].replace(/s$/, "")}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-900">
                    {item.reference ?? item.title}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell text-gray-700">
                    {item.customer ? (
                      <Link
                        href={ROUTES.customerDetail(item.customer.id)}
                        className="hover:underline"
                      >
                        {customerDisplayName(item.customer)}
                      </Link>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-gray-500">
                    {item.renewalState ? (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                          item.renewalState === "overdue"
                            ? "bg-red-100 text-red-700"
                            : item.renewalState === "upcoming"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-brand-soft text-brand-darker"
                        }`}
                      >
                        {item.renewalState === "overdue" && (
                          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                        )}
                        {item.renewalState === "upcoming" && (
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        )}
                        {item.subtitle ?? "—"}
                      </span>
                    ) : (
                      item.subtitle ?? "—"
                    )}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-gray-500">
                    {formatDate(item.date)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {item.kind === "invoice" && item.invoiceId && (
                        <InvoiceActions item={item} />
                      )}
                      {item.url ? (
                        <a
                          href={proxyAssetUrl(item.url) ?? item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Open
                          <svg
                            className="h-3 w-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                            />
                          </svg>
                        </a>
                      ) : item.kind === "invoice" && item.invoiceId ? (
                        <GenerateInvoicePdfButton invoiceId={item.invoiceId} />
                      ) : (
                        <span className="text-xs text-gray-300">No PDF</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-brand text-white"
          : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * Per-invoice action chip — green Paid badge when settled, otherwise
 * Mark Paid + (if overdue) Send Follow-up.
 */
function InvoiceActions({ item }: { item: DocumentItem }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"paid" | "chase" | null>(null);
  const ensureReady = useEnsureCustomerDocReady();

  if (item.invoiceStatus === "paid") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-darker">
        <span className="h-1.5 w-1.5 rounded-full bg-brand" />
        Paid
      </span>
    );
  }

  function handlePaid() {
    if (!item.invoiceId) return;
    setBusy("paid");
    startTransition(async () => {
      const res = await markInvoicePaidAction(item.invoiceId!);
      setBusy(null);
      if (res.success) router.refresh();
    });
  }

  function handleChase() {
    if (!item.invoiceId) return;
    setBusy("chase");
    // Gate the chase email: a follow-up is on an already-sent invoice (so the
    // email is usually present and the gate passes silently), but if it's
    // since been cleared, prompt for it. The row only carries {id,name}, so
    // fetch the full customer for the readiness check.
    void (async () => {
      if (item.customer) {
        const detail = await getCustomerDetailAction(item.customer.id);
        if (detail?.customer) {
          const gate = await ensureReady(detail.customer, {
            verb: "send",
            doc: "invoice",
          });
          if (!gate.proceed) {
            setBusy(null);
            return;
          }
        }
      }
      startTransition(async () => {
        const res = await sendInvoiceFollowUpAction(item.invoiceId!);
        setBusy(null);
        if (res.success) router.refresh();
      });
    })();
  }

  return (
    <>
      {item.invoiceOverdue && (
        <button
          type="button"
          onClick={handleChase}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          title="Send a follow-up email with the original PDF"
        >
          {busy === "chase" ? "Sending…" : "Follow up"}
        </button>
      )}
      <button
        type="button"
        onClick={handlePaid}
        disabled={isPending}
        className="inline-flex items-center gap-1 rounded-lg border border-brand bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-darker hover:bg-brand hover:text-white disabled:opacity-50"
      >
        {busy === "paid" ? "Saving…" : "Mark paid"}
      </button>
    </>
  );
}

/**
 * Backfill trigger for an invoice with no stored PDF — the legacy
 * auto-invoice path (createInvoiceForJob) never renders one. Generates
 * and stores it server-side, then refreshes so the row's "Open" link
 * appears. Online-only like the sibling pay/chase actions.
 */
function GenerateInvoicePdfButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function handleGenerate() {
    setFailed(false);
    startTransition(async () => {
      const res = await generateInvoicePdfAction(invoiceId);
      if (res.success) router.refresh();
      else setFailed(true);
    });
  }

  return (
    <button
      type="button"
      onClick={handleGenerate}
      disabled={isPending}
      title={
        failed
          ? "Generation failed — try again"
          : "Generate the invoice PDF"
      }
      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
    >
      {isPending ? "Generating…" : failed ? "Retry PDF" : "Generate PDF"}
    </button>
  );
}

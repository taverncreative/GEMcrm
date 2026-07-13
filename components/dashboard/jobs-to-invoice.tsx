"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { ROUTES } from "@/lib/constants/routes";
import { customerDisplayName } from "@/lib/utils/customer-display-name";
import { setJobNeedsInvoiceLocal } from "@/lib/actions/needs-invoice";
import type { JobWithContext } from "@/lib/data/jobs";

interface JobsToInvoiceProps {
  /** Server-rendered initial list (needs_invoice = true). Used only until
   *  the Dexie live query resolves, so there's no empty flash on load. */
  jobs: JobWithContext[];
}

interface ChecklistRow {
  id: string;
  job_date: string;
  reference_number: string | null;
  customerName: string;
}

function shortDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function rowsFromProp(jobs: JobWithContext[]): ChecklistRow[] {
  return jobs.map((j) => ({
    id: j.id,
    job_date: j.job_date,
    reference_number: j.reference_number,
    customerName: customerDisplayName(j.site.customer),
  }));
}

/**
 * "Invoices required" checklist (migration 041). A running to-do of jobs
 * Nate flagged as needing billing in QuickBooks — via the service-sheet
 * "Invoice required" checkbox or the job-detail toggle. Ticking a row off
 * clears the flag (setJobNeedsInvoiceLocal → optimistic Dexie write + one
 * outbox entry), so it works offline and the row disappears instantly.
 *
 * Dexie-live via useLiveQuery so a flag set offline (or ticked off) shows
 * immediately; the server prop is the initial paint before IDB resolves.
 * No money framing — invoicing itself lives in QuickBooks.
 */
export function JobsToInvoice({ jobs }: JobsToInvoiceProps) {
  const [, startTransition] = useTransition();

  const live = useLiveQuery(async (): Promise<ChecklistRow[]> => {
    const flagged = await db.jobs
      .filter((j) => !!j.needs_invoice && !j.is_archived && !j.deleted_at)
      .toArray();
    const rows: ChecklistRow[] = [];
    for (const j of flagged) {
      const site = j.site_id ? await db.sites.get(j.site_id) : undefined;
      const customer = site?.customer_id
        ? await db.customers.get(site.customer_id)
        : undefined;
      rows.push({
        id: j.id,
        job_date: j.job_date,
        reference_number: j.reference_number,
        customerName: customer
          ? customerDisplayName(customer)
          : "Unknown customer",
      });
    }
    // Newest first, matching getJobsNeedingInvoice.
    return rows.sort((a, b) =>
      (b.job_date || "").localeCompare(a.job_date || "")
    );
  }, []);

  // undefined = IDB still loading → fall back to the server prop.
  const rows = live ?? rowsFromProp(jobs);

  function clear(jobId: string) {
    startTransition(async () => {
      await setJobNeedsInvoiceLocal(jobId, false);
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <h3 className="text-sm font-medium text-gray-500">Invoices required</h3>
        <p className="mt-3 text-sm text-gray-400">
          Nothing needs invoicing right now.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-500">Invoices required</h3>
        <span className="text-xs font-medium text-gray-400">{rows.length}</span>
      </div>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2.5"
          >
            <input
              type="checkbox"
              onChange={() => clear(row.id)}
              aria-label={`Mark ${row.customerName} as invoiced`}
              title="Tick once billed in QuickBooks"
              className="h-5 w-5 shrink-0 cursor-pointer rounded border-gray-300 text-brand-darker focus:ring-brand"
            />
            <Link
              href={ROUTES.jobDetail(row.id)}
              className="min-w-0 flex-1 transition-colors hover:opacity-80"
            >
              <span className="block truncate text-sm font-medium text-gray-900">
                {row.customerName}
              </span>
              <span className="block truncate text-xs text-gray-500">
                {row.reference_number ? `${row.reference_number} · ` : ""}
                {shortDate(row.job_date)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";

import { setJobNeedsInvoiceAction } from "@/app/(app)/jobs/[id]/actions";
import { wrapAction } from "@/lib/actions/wrap";
import { db } from "@/lib/db";

/**
 * Local-first toggle of the "Invoices required" flag (migration 041).
 * applyLocal writes needs_invoice to Dexie immediately (so useLiveQuery
 * re-renders and the change works offline) and enqueues ONE outbox entry
 * that replays via the registry's setJobNeedsInvoiceAction. Shared by the
 * job-detail toggle and the homepage checklist so the two never drift.
 */
export const setJobNeedsInvoiceLocal = wrapAction(setJobNeedsInvoiceAction, {
  actionName: "setJobNeedsInvoiceAction",
  entityType: "job",
  entityId: ([jobId]) => jobId,
  applyLocal: async ([jobId, needsInvoice]) => {
    await db.jobs.update(jobId, {
      needs_invoice: needsInvoice,
      updated_at: new Date().toISOString(),
    });
  },
});

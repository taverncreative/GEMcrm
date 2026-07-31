import type { Job } from "@/types/database";
import { createTask, hasPendingTaskOfType } from "@/lib/data/tasks";
import { getCustomerById } from "@/lib/data/customers";
import { getSiteById } from "@/lib/data/sites";
import { getReportByJobId } from "@/lib/data/reports";
// No invoice imports: job completion no longer creates one. See the note in
// onJobCompleted below.
import { sendServiceReport } from "@/lib/services/email";
import { todayUk, dateUk } from "@/lib/utils/today-uk";
import { REVIEW_REQUESTS_ENABLED } from "@/lib/constants/feature-flags";

interface JobContext {
  customerId: string;
  siteId: string;
}

async function getContextNames(context: JobContext) {
  const [customer, site] = await Promise.all([
    getCustomerById(context.customerId),
    getSiteById(context.siteId),
  ]);
  return {
    customerName: customer?.name ?? "Unknown",
    siteName: site?.address_line_1 ?? "Unknown site",
  };
}

/**
 * Side effects triggered after a job is created.
 */
export async function onJobCreated(
  job: Job,
  context: JobContext
): Promise<void> {
  try {
    const exists = await hasPendingTaskOfType(job.id, "follow_up");
    if (exists) return;

    const { customerName, siteName } = await getContextNames(context);

    const followUpDate = new Date(job.job_date);
    followUpDate.setDate(followUpDate.getDate() + 7);

    await createTask({
      title: `Follow up with ${customerName} (${siteName})`,
      due_date: dateUk(followUpDate),
      task_type: "follow_up",
      priority: "medium",
      related_job_id: job.id,
      related_customer_id: context.customerId,
      site_id: context.siteId,
    });
  } catch (err) {
    console.error("[onJobCreated] Failed to run post-create events:", err);
  }
}

/**
 * Side effects triggered after a job is marked completed.
 *
 * `sendReportEmail` (default FALSE) controls the automatic
 * service-report email. The single-owner rule (pass B, hardened after
 * the client's Generate-Report scare): the ONLY thing that ever emails
 * a customer is the sheet's explicit "Complete & Email" choice — the
 * approval action's own send block. No completion path auto-sends:
 * the dropdown path used to, which meant flipping a job to completed
 * could mail whatever PDF happened to be newest (including a
 * placeholder report generated against an unfilled sheet). Opting in
 * requires an explicit `sendReportEmail: true` from a future caller.
 */
export async function onJobCompleted(
  job: Job,
  context: JobContext,
  opts: { sendReportEmail?: boolean } = {}
): Promise<void> {
  const { sendReportEmail = false } = opts;
  try {
    // Review-request auto-creation — DISABLED at the client's request
    // (2026-06) via REVIEW_REQUESTS_ENABLED. The logic is intact behind
    // the gate; flipping the flag back to `true` restores the original
    // behaviour byte-for-byte, including the dedup early-return that
    // short-circuits the rest of this sequence. When off, completion
    // skips straight to the email + invoice side effects below (both
    // carry their own guards, so nothing else changes).
    if (REVIEW_REQUESTS_ENABLED) {
      const exists = await hasPendingTaskOfType(job.id, "review_request");
      if (exists) return;

      const { customerName, siteName } = await getContextNames(context);

      await createTask({
        title: `Send review request to ${customerName} (${siteName})`,
        due_date: todayUk(),
        task_type: "review_request",
        priority: "high",
        related_job_id: job.id,
        related_customer_id: context.customerId,
        site_id: context.siteId,
      });
    }

    // Send service report email if report exists (suppressed when the
    // caller owns email dispatch — see doc comment).
    if (sendReportEmail) {
      const customer = await getCustomerById(context.customerId);
      const report = await getReportByJobId(job.id);
      if (customer && report?.pdf_url) {
        await sendServiceReport(customer, report.pdf_url, undefined, job.job_date);
      }
    }

    // NO INVOICE IS CREATED HERE ANY MORE (Slice 2a, 2026-07-31).
    //
    // Completing a job with a value used to auto-create an invoice, assign
    // it a sequential number off invoice_number_seq, render its PDF and
    // upload it. Nate does his real invoicing in QuickBooks, so those
    // invoices were never sent: prod accumulated 9 of them, 0 ever sent, 1
    // ever marked paid, the most recent minted three days before this
    // change off a £2 job. They were generated AT him, silently.
    //
    // What replaced it (slice 1, migration 041): the `needs_invoice` flag.
    // He ticks "Invoice required" on the service sheet, the job collects in
    // the homepage "Invoices required" checklist, and he ticks it off once
    // he has billed it in QuickBooks. That path is entirely separate from
    // this one and reads no invoice table.
    //
    // Deliberately NOT touched here: the existing invoices and their PDFs,
    // the invoices / invoice_jobs tables, the numbering sequence and
    // trigger, and `jobs.is_invoiced` / `jobs.is_paid` (inert historical
    // data on 9 and 1 rows). Hiding the remaining invoice UI is slice 2b.
  } catch (err) {
    console.error("[onJobCompleted] Failed to run post-complete events:", err);
  }
}

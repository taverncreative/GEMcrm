import type { Job } from "@/types/database";
import { createTask, hasPendingTaskOfType } from "@/lib/data/tasks";
import { getCustomerById } from "@/lib/data/customers";
import { getSiteById } from "@/lib/data/sites";
import { getReportByJobId } from "@/lib/data/reports";
import { createInvoiceForJob, getInvoiceByJobId } from "@/lib/data/invoices";
import { renderAndStoreInvoicePdf } from "@/lib/services/invoice-pdf";
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
        await sendServiceReport(customer, report.pdf_url);
      }
    }

    // Auto-create invoice if job has a value and isn't already invoiced.
    // Render its PDF inline so the auto-invoice comes out complete (number
    // + 20% VAT + PDF) like a manual one — best-effort: a render failure
    // never blocks completion; the Documents "Generate PDF" button is the
    // recovery.
    if (job.value && job.value > 0 && !job.is_invoiced) {
      const existingInvoice = await getInvoiceByJobId(job.id);
      if (!existingInvoice) {
        const inv = await createInvoiceForJob(
          job.id,
          context.customerId,
          job.value
        );
        try {
          await renderAndStoreInvoicePdf(inv.id);
        } catch (pdfErr) {
          console.error("[onJobCompleted] invoice PDF generation:", pdfErr);
        }
      }
    }
  } catch (err) {
    console.error("[onJobCompleted] Failed to run post-complete events:", err);
  }
}

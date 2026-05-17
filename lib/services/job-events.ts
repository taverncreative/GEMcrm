import type { Job } from "@/types/database";
import { createTask, hasPendingTaskOfType } from "@/lib/data/tasks";
import { getCustomerById } from "@/lib/data/customers";
import { getSiteById } from "@/lib/data/sites";
import { getReportByJobId } from "@/lib/data/reports";
import { createInvoiceForJob, getInvoiceByJobId } from "@/lib/data/invoices";
import { sendServiceReport } from "@/lib/services/email";
import { todayUk, dateUk } from "@/lib/utils/today-uk";

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
 */
export async function onJobCompleted(
  job: Job,
  context: JobContext
): Promise<void> {
  try {
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

    // Send service report email if report exists
    const customer = await getCustomerById(context.customerId);
    const report = await getReportByJobId(job.id);
    if (customer && report?.pdf_url) {
      await sendServiceReport(customer, report.pdf_url);
    }

    // Auto-create invoice if job has a value and isn't already invoiced
    if (job.value && job.value > 0 && !job.is_invoiced) {
      const existingInvoice = await getInvoiceByJobId(job.id);
      if (!existingInvoice) {
        await createInvoiceForJob(job.id, context.customerId, job.value);
      }
    }
  } catch (err) {
    console.error("[onJobCompleted] Failed to run post-complete events:", err);
  }
}

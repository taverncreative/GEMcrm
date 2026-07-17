"use server";

import { revalidatePath } from "next/cache";
import { getJobById, markReportEmailed } from "@/lib/data/jobs";
import { getSiteById } from "@/lib/data/sites";
import { getCustomerById } from "@/lib/data/customers";
import { createReport, getReportByJobId } from "@/lib/data/reports";
import { sendServiceReport } from "@/lib/services/email";
import { generateJobReport } from "@/lib/pdf/generate-job-report";
import { uploadPdf } from "@/lib/storage/upload";
import { ROUTES } from "@/lib/constants/routes";
import { requireUser } from "@/lib/auth/require-user";
import { isServiceSheetFilled } from "@/lib/validation/service-sheet";
import { validateRecipients } from "@/lib/validation/recipients";
import type { ActionState } from "@/types/actions";

export async function generateReportAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireUser();
  const jobId = formData.get("job_id") as string;

  if (!jobId) {
    return { success: false, errors: {}, message: "Missing job ID" };
  }

  const job = await getJobById(jobId);
  if (!job) {
    return { success: false, errors: {}, message: "Job not found" };
  }

  // Same gate as the button's disabled state — a report must never be
  // generated from an unfilled sheet (it renders as a placeholder PDF).
  // Server-side too so a stale page can't slip one through.
  if (!isServiceSheetFilled(job)) {
    return {
      success: false,
      errors: {},
      message: "Service sheet not filled in. Complete it before generating a report.",
    };
  }

  const site = await getSiteById(job.site_id);
  if (!site) {
    return { success: false, errors: {}, message: "Site not found" };
  }

  const customer = await getCustomerById(site.customer_id);
  if (!customer) {
    return { success: false, errors: {}, message: "Customer not found" };
  }

  try {
    const pdfBuffer = await generateJobReport({ job, site, customer });
    const fileName = `reports/${jobId}/${Date.now()}.pdf`;
    const pdfUrl = await uploadPdf(pdfBuffer, fileName);
    await createReport(jobId, pdfUrl);

    revalidatePath(ROUTES.jobDetail(jobId));

    return { success: true, errors: {}, message: pdfUrl };
  } catch (err) {
    return {
      success: false,
      errors: {},
      message: err instanceof Error ? err.message : "Failed to generate report",
    };
  }
}

/**
 * "Send report now" — email a completed job's report PDF to one or more
 * recipients (the multi-recipient flow). All recipients go in a single
 * Resend `to`. Online-only (the email leaves from the server on the spot).
 *
 * NOT single-fire any more: a report can be re-sent to a new/updated
 * recipient list. The UI shows an "already sent to …" note so the
 * operator knows, but the send proceeds. `report_emailed_to` records the
 * most recent recipient list as a comma-joined string.
 *
 * Recipients are validated server-side (hard-block on any invalid
 * address) so a stale client can't slip a bad one through.
 */
export async function sendReportNowAction(
  jobId: string,
  recipients: string[]
): Promise<{ success: boolean; message?: string; emailedTo?: string }> {
  await requireUser();
  if (!jobId) return { success: false, message: "Missing job ID" };

  // Validate the recipient list up front — hard-block on any invalid one.
  const validated = validateRecipients(recipients ?? []);
  if (!validated.ok) {
    return { success: false, message: validated.error };
  }

  const job = await getJobById(jobId);
  if (!job) return { success: false, message: "Job not found" };

  const site = await getSiteById(job.site_id);
  const customer = site ? await getCustomerById(site.customer_id) : null;
  if (!customer) {
    return { success: false, message: "Customer not found" };
  }

  const report = await getReportByJobId(jobId);
  if (!report?.pdf_url) {
    return {
      success: false,
      message: "No report PDF yet. Regenerate the report first.",
    };
  }

  const sendRes = await sendServiceReport(
    customer,
    report.pdf_url,
    validated.emails,
    job.job_date
  );
  if (!sendRes.success) {
    return { success: false, message: "Email failed to send. Try again." };
  }

  const emailedTo = validated.emails.join(", ");
  await markReportEmailed(jobId, emailedTo);
  revalidatePath(ROUTES.jobDetail(jobId));
  return { success: true, emailedTo };
}

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
      message: "Service sheet not filled in — complete it before generating a report.",
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
 * L3 "Send report now" — the recovery for a completed job whose report
 * was never emailed (no address at completion, or the operator chose
 * plain Complete). Single-fire: report_emailed_to is checked before
 * sending, so a double-tap or stale button is a no-op, never a second
 * email. Online-only (the email leaves from the server on the spot).
 */
export async function sendReportNowAction(
  jobId: string
): Promise<{ success: boolean; message?: string; emailedTo?: string }> {
  await requireUser();
  if (!jobId) return { success: false, message: "Missing job ID" };

  const job = await getJobById(jobId);
  if (!job) return { success: false, message: "Job not found" };
  if (job.report_emailed_to) {
    // Already sent — single-fire no-op.
    return { success: true, emailedTo: job.report_emailed_to };
  }

  const site = await getSiteById(job.site_id);
  const customer = site ? await getCustomerById(site.customer_id) : null;
  if (!customer?.email) {
    return { success: false, message: "Customer has no email address on file" };
  }

  const report = await getReportByJobId(jobId);
  if (!report?.pdf_url) {
    return {
      success: false,
      message: "No report PDF yet — regenerate the report first",
    };
  }

  const sendRes = await sendServiceReport(customer, report.pdf_url);
  if (!sendRes.success) {
    return { success: false, message: "Email failed to send — try again" };
  }

  await markReportEmailed(jobId, customer.email);
  revalidatePath(ROUTES.jobDetail(jobId));
  return { success: true, emailedTo: customer.email };
}

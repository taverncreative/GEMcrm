"use server";

import { revalidatePath } from "next/cache";
import { ServiceSheetSchema } from "@/lib/validation/service-sheet";
import {
  saveServiceSheet,
  finalizeServiceSheet,
  createBooking,
  getJobById,
} from "@/lib/data/jobs";
import { getSiteById } from "@/lib/data/sites";
import { getCustomerById } from "@/lib/data/customers";
import { getReportByJobId, createReport } from "@/lib/data/reports";
import { generateJobReport } from "@/lib/pdf/generate-job-report";
import { uploadPdf } from "@/lib/storage/upload";
import { sendServiceReport } from "@/lib/services/email";
import { onJobCompleted } from "@/lib/services/job-events";
import { ROUTES } from "@/lib/constants/routes";
import { requireUser } from "@/lib/auth/require-user";
import type { ActionState } from "@/types/actions";

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is string => typeof item === "string" && item.length > 0
    );
  } catch {
    return [];
  }
}

// Result of the save-draft step — note we return pdfUrl so the form can
// pop the approval modal with a live preview.
export interface SaveServiceSheetResult extends ActionState {
  pdfUrl?: string | null;
  jobId?: string;
}

/**
 * Step 1 of two: save the Service Sheet data + generate the report PDF,
 * but leave the job in `in_progress` until the user approves it via the
 * follow-up modal.
 *
 * If the PDF generation fails (e.g. storage bucket missing) we still
 * return success with a null pdfUrl — the user can still approve, the
 * approval action will retry the PDF.
 */
export async function completeServiceSheetAction(
  _prev: SaveServiceSheetResult,
  formData: FormData
): Promise<SaveServiceSheetResult> {
  await requireUser();
  const jobId = formData.get("job_id") as string;

  if (!jobId) {
    return { success: false, errors: {}, message: "Missing job ID" };
  }

  const existing = await getJobById(jobId);
  if (!existing) {
    return { success: false, errors: {}, message: "Job not found" };
  }

  const pestSpecies = parseJsonArray(formData.get("pest_species") as string | null);
  const methodUsed = parseJsonArray(formData.get("method_used") as string | null);
  const photoDataUrls = parseJsonArray(
    formData.get("photo_data_urls") as string | null
  );

  const raw = {
    job_id: jobId,
    call_type: formData.get("call_type") as string,
    pest_species: pestSpecies,
    findings: formData.get("findings") as string,
    recommendations: formData.get("recommendations") as string,
    report_notes: formData.get("report_notes") as string,
    method_used: methodUsed,
    pesticides_used: formData.get("pesticides_used") as string,
    risk_level: formData.get("risk_level") as string,
    risk_comments: formData.get("risk_comments") as string,
    photo_data_urls: photoDataUrls,
    technician_signature: formData.get("technician_signature") as string,
    client_present: formData.get("client_present") as string,
    client_signature: formData.get("client_signature") as string,
    client_name: formData.get("client_name") as string,
  };

  const result = ServiceSheetSchema.safeParse(raw);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") errors[key] = issue.message;
    }
    return { success: false, errors, message: null };
  }

  let updated;
  try {
    updated = await saveServiceSheet(jobId, result.data);
  } catch (err) {
    return {
      success: false,
      errors: {},
      message:
        err instanceof Error ? err.message : "Failed to save service sheet",
    };
  }

  // Generate PDF (best-effort). Failures here are non-fatal — the data is
  // already saved and the user can retry from the approval modal.
  let pdfUrl: string | null = null;
  try {
    const site = await getSiteById(updated.site_id);
    const customer = site ? await getCustomerById(site.customer_id) : null;
    if (site && customer) {
      const buf = await generateJobReport({ job: updated, site, customer });
      pdfUrl = await uploadPdf(buf, `reports/${jobId}/service-sheet.pdf`);
      // Update or create the reports row pointing at the latest PDF.
      const existingReport = await getReportByJobId(jobId);
      if (!existingReport || existingReport.pdf_url !== pdfUrl) {
        await createReport(jobId, pdfUrl);
      }
    }
  } catch (pdfErr) {
    console.error("[completeServiceSheetAction] PDF gen failed:", pdfErr);
  }

  revalidatePath(ROUTES.jobDetail(jobId));
  revalidatePath(ROUTES.JOBS);
  revalidatePath(ROUTES.DASHBOARD);

  return {
    success: true,
    errors: {},
    message: pdfUrl ? null : "Service sheet saved. PDF generation failed — bucket missing?",
    pdfUrl,
    jobId,
  };
}

// ─── Step 2 of two: approve (with or without email) ─────────────────────

export interface ApproveResult {
  success: boolean;
  message?: string;
}

interface ApproveOptions {
  sendEmail?: boolean;
  scheduleFollowUp?: boolean;
  followUpDate?: string | null;
}

export async function approveServiceSheetAction(
  jobId: string,
  options: ApproveOptions = {}
): Promise<ApproveResult> {
  await requireUser();
  if (!jobId) return { success: false, message: "Missing job ID" };

  try {
    const updated = await finalizeServiceSheet(jobId);

    const site = await getSiteById(updated.site_id);
    if (site) {
      await onJobCompleted(updated, {
        customerId: site.customer_id,
        siteId: updated.site_id,
      });
    }

    if (options.sendEmail && site) {
      const customer = await getCustomerById(site.customer_id);
      const report = await getReportByJobId(jobId);
      if (customer && report?.pdf_url) {
        await sendServiceReport(customer, report.pdf_url);
      }
    }

    if (options.scheduleFollowUp && options.followUpDate && site) {
      try {
        await createBooking({
          site_id: updated.site_id,
          job_date: options.followUpDate,
          // Follow-ups inherit no specific time — operator can edit
          // the booking afterwards to add one.
          job_time: "",
          call_type: "followup",
          pest_species: updated.pest_species ?? [],
          report_notes: "",
          parent_job_id: updated.id,
        });
      } catch (followErr) {
        console.error("[approveServiceSheetAction] follow-up booking:", followErr);
      }
    }

    revalidatePath(ROUTES.jobDetail(jobId));
    revalidatePath(ROUTES.JOBS);
    revalidatePath(ROUTES.CALENDAR);
    revalidatePath(ROUTES.DASHBOARD);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      message:
        err instanceof Error ? err.message : "Failed to finalise service sheet",
    };
  }
}

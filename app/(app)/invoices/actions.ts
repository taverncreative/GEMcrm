"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createStandaloneInvoice,
  getInvoiceWithCustomer,
  getInvoiceStatusByJobIds,
  markInvoiceSent,
  markInvoicePaid,
} from "@/lib/data/invoices";
import { renderAndStoreInvoicePdf } from "@/lib/services/invoice-pdf";
import { sendInvoiceEmail } from "@/lib/services/invoice-email";
import { ROUTES } from "@/lib/constants/routes";
import { requireUser } from "@/lib/auth/require-user";
import { BUSINESS } from "@/lib/constants/branding";
import type { ActionState } from "@/types/actions";
import type { InvoiceStatus } from "@/types/database";

/**
 * Batched job → invoice-status lookup for the Jobs list chips.
 * Read-only; errors collapse to {} so the caller's neutral "Invoiced"
 * fallback chip stands. Capped at the list's render limit.
 */
export async function getInvoiceStatusesForJobsAction(
  jobIds: string[]
): Promise<Record<string, InvoiceStatus>> {
  await requireUser();
  if (!Array.isArray(jobIds)) return {};
  const ids = jobIds
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .slice(0, 100);
  if (ids.length === 0) return {};
  try {
    return await getInvoiceStatusByJobIds(ids);
  } catch (err) {
    console.error("[getInvoiceStatusesForJobsAction]", err);
    return {};
  }
}

// ─── Step 1: Create as draft + generate PDF ──────────────────────────────

const DraftPayloadSchema = z.object({
  // Required only for the no-job path — with jobs the customer is
  // derived server-side in createStandaloneInvoice (job → site →
  // customer); the post-parse check below enforces the conditional.
  customer_id: z.string().optional().default(""),
  // DEPRECATED single-job field, kept for the job-detail caller.
  job_id: z.string().optional().default(""),
  // Multi-job path (031): repeated `job_ids` form fields.
  job_ids: z.array(z.string().min(1)).optional().default([]),
  subtotal: z.coerce.number().min(0.01, "Amount must be greater than zero"),
  vat_amount: z.coerce.number().min(0),
  total: z.coerce.number().min(0.01),
  vat_rate: z.coerce.number().min(0).default(20),
  description: z.string().optional().default(""),
  due_date: z.string().optional().default(""),
});

export interface CreateDraftResult extends ActionState {
  invoiceId?: string;
  pdfUrl?: string | null;
}

export async function createInvoiceDraftAction(
  _prev: CreateDraftResult,
  formData: FormData
): Promise<CreateDraftResult> {
  await requireUser();
  const raw = {
    customer_id: (formData.get("customer_id") as string) ?? "",
    job_id: (formData.get("job_id") as string) ?? "",
    job_ids: formData
      .getAll("job_ids")
      .map((v) => String(v))
      .filter((v) => v.length > 0),
    subtotal: (formData.get("subtotal") as string) ?? "",
    vat_amount: (formData.get("vat_amount") as string) ?? "",
    total: (formData.get("total") as string) ?? "",
    vat_rate: (formData.get("vat_rate") as string) ?? "20",
    description: (formData.get("description") as string) ?? "",
    due_date: (formData.get("due_date") as string) ?? "",
  };

  const parsed = DraftPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") errors[key] = issue.message;
    }
    return { success: false, errors, message: null };
  }

  const data = parsed.data;

  // Fold the deprecated single-job field into the list form.
  const jobIds =
    data.job_ids.length > 0 ? data.job_ids : data.job_id ? [data.job_id] : [];

  // No jobs → the customer must come from the form. With jobs, the data
  // layer derives (and validates) the customer from the jobs themselves.
  if (jobIds.length === 0 && !data.customer_id) {
    return {
      success: false,
      errors: { customer_id: "Customer is required" },
      message: null,
    };
  }

  let invoiceId: string;
  let invoiceCustomerId: string;
  let pdfUrl: string | null = null;

  try {
    const inv = await createStandaloneInvoice({
      customer_id: data.customer_id || undefined,
      job_ids: jobIds,
      subtotal: data.subtotal,
      vat_amount: data.vat_amount,
      total: data.total,
      vat_rate: data.vat_rate,
      description: data.description,
      due_date: data.due_date || null,
      status: "draft",
    });
    invoiceId = inv.id;
    invoiceCustomerId = inv.customer_id;

    try {
      const res = await renderAndStoreInvoicePdf(invoiceId);
      pdfUrl = res?.pdfUrl ?? null;
    } catch (pdfErr) {
      console.error("[createInvoiceDraftAction] PDF generation:", pdfErr);
      // PDF can be regenerated later — the invoice row still exists.
    }
  } catch (err) {
    return {
      success: false,
      errors: {},
      message:
        err instanceof Error ? err.message : "Failed to create invoice",
    };
  }

  revalidatePath(ROUTES.DASHBOARD);
  revalidatePath(ROUTES.JOBS);
  revalidatePath(ROUTES.CUSTOMERS);
  // Derived from the created invoice — with jobs supplied, the form's
  // customer_id may be empty (or overridden by the server-side derivation).
  revalidatePath(ROUTES.customerDetail(invoiceCustomerId));
  revalidatePath(ROUTES.REPORTS);

  return {
    success: true,
    errors: {},
    message: "Draft saved.",
    invoiceId,
    pdfUrl,
  };
}

// ─── Step 2: Approve + send the draft ────────────────────────────────────

export interface SendInvoiceResult {
  success: boolean;
  message?: string;
}

/**
 * Mark an invoice as paid. Used from the invoices list and customer panel.
 */
export async function markInvoicePaidAction(
  invoiceId: string
): Promise<{ success: boolean; message?: string }> {
  await requireUser();
  if (!invoiceId) return { success: false, message: "Missing invoice id" };
  try {
    await markInvoicePaid(invoiceId);
    revalidatePath(ROUTES.DASHBOARD);
    revalidatePath(ROUTES.JOBS);
    revalidatePath(ROUTES.CUSTOMERS);
    revalidatePath(ROUTES.REPORTS);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to mark paid",
    };
  }
}

/**
 * Generate (or regenerate) an invoice's PDF and store it in the public
 * reports bucket — the same render → store path the creation flow uses.
 *
 * Backfills rows that landed without a PDF: chiefly the legacy
 * auto-invoice path (createInvoiceForJob, fired on job completion), which
 * never renders one, plus any draft whose generation failed at creation.
 * `uploadPdf` upserts, so a re-run simply overwrites — this doubles as a
 * stale-PDF refresh after a template change.
 */
export async function generateInvoicePdfAction(
  invoiceId: string
): Promise<{ success: boolean; message?: string; pdfUrl?: string }> {
  await requireUser();
  if (!invoiceId) return { success: false, message: "Missing invoice id" };
  try {
    const res = await renderAndStoreInvoicePdf(invoiceId);
    if (!res) return { success: false, message: "Invoice not found" };

    revalidatePath(ROUTES.DASHBOARD);
    revalidatePath(ROUTES.JOBS);
    revalidatePath(ROUTES.CUSTOMERS);
    revalidatePath(ROUTES.customerDetail(res.customerId));
    revalidatePath(ROUTES.REPORTS);
    return { success: true, pdfUrl: res.pdfUrl };
  } catch (err) {
    console.error("[generateInvoicePdfAction]", err);
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to generate PDF",
    };
  }
}

/**
 * Resend an invoice — used as the "Send follow-up" action for overdue
 * invoices. Re-sends the original PDF with a chasing tone in the email.
 */
export async function sendInvoiceFollowUpAction(
  invoiceId: string
): Promise<{ success: boolean; message?: string }> {
  await requireUser();
  if (!invoiceId) return { success: false, message: "Missing invoice id" };
  try {
    const detail = await getInvoiceWithCustomer(invoiceId);
    if (!detail) return { success: false, message: "Invoice not found" };
    if (!detail.customer.email) {
      return { success: false, message: "Customer has no email on file" };
    }
    if (!detail.pdf_url) {
      return { success: false, message: "Invoice PDF not generated yet" };
    }

    const ref =
      detail.invoice_number ?? detail.id.slice(0, 8).toUpperCase();
    const firstName = detail.customer.name.split(" ")[0] ?? detail.customer.name;
    const amount = `£${Number(detail.amount).toLocaleString("en-GB", {
      minimumFractionDigits: 2,
    })}`;
    const due = detail.due_date
      ? new Date(detail.due_date).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "the agreed date";

    await sendInvoiceEmail(detail.customer, detail, detail.pdf_url, {
      subject: `Reminder — invoice ${ref} from ${BUSINESS.name}`,
      body: [
        `Hi ${firstName},`,
        "",
        `Just a friendly reminder that invoice ${ref} for ${amount} was due on ${due} and hasn't yet been settled.`,
        "",
        "If you've paid in the last few days please ignore this — otherwise, let me know if there's anything I can do to help get it across the line.",
        "",
        "Thanks,",
        BUSINESS.signoffName,
        BUSINESS.name,
      ].join("\n"),
    });

    revalidatePath(ROUTES.DASHBOARD);
    revalidatePath(ROUTES.REPORTS);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to send follow-up",
    };
  }
}

export async function sendInvoiceAction(
  invoiceId: string,
  options: { subject: string; body: string }
): Promise<SendInvoiceResult> {
  await requireUser();
  if (!invoiceId) return { success: false, message: "Missing invoice id" };

  try {
    const detail = await getInvoiceWithCustomer(invoiceId);
    if (!detail) return { success: false, message: "Invoice not found" };
    if (!detail.customer.email) {
      return { success: false, message: "Customer has no email on file" };
    }
    if (!detail.pdf_url) {
      return {
        success: false,
        message: "Invoice PDF not generated yet — re-open the invoice.",
      };
    }

    await sendInvoiceEmail(detail.customer, detail, detail.pdf_url, {
      subject: options.subject,
      body: options.body,
    });

    if (detail.status !== "sent" && detail.status !== "paid") {
      await markInvoiceSent(invoiceId);
    }

    revalidatePath(ROUTES.DASHBOARD);
    revalidatePath(ROUTES.JOBS);
    revalidatePath(ROUTES.CUSTOMERS);
    revalidatePath(ROUTES.customerDetail(detail.customer_id));
    revalidatePath(ROUTES.REPORTS);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Failed to send invoice",
    };
  }
}

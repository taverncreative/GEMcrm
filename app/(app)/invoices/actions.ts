"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createStandaloneInvoice,
  setInvoicePdfUrl,
  getInvoiceWithCustomer,
  markInvoiceSent,
  markInvoicePaid,
} from "@/lib/data/invoices";
import { generateInvoicePdf } from "@/lib/pdf/generate-invoice-pdf";
import { uploadPdf } from "@/lib/storage/upload";
import { sendInvoiceEmail } from "@/lib/services/invoice-email";
import { ROUTES } from "@/lib/constants/routes";
import { requireUser } from "@/lib/auth/require-user";
import { BUSINESS } from "@/lib/constants/branding";
import type { ActionState } from "@/types/actions";

// ─── Step 1: Create as draft + generate PDF ──────────────────────────────

const DraftPayloadSchema = z.object({
  customer_id: z.string().min(1, "Customer is required"),
  job_id: z.string().optional().default(""),
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

  let invoiceId: string;
  let pdfUrl: string | null = null;

  try {
    const inv = await createStandaloneInvoice({
      customer_id: data.customer_id,
      job_id: data.job_id || null,
      subtotal: data.subtotal,
      vat_amount: data.vat_amount,
      total: data.total,
      vat_rate: data.vat_rate,
      description: data.description,
      due_date: data.due_date || null,
      status: "draft",
    });
    invoiceId = inv.id;

    try {
      const detail = await getInvoiceWithCustomer(invoiceId);
      if (detail) {
        const buf = await generateInvoicePdf({
          invoice: detail,
          customer: detail.customer,
        });
        pdfUrl = await uploadPdf(buf, `invoices/${invoiceId}/invoice.pdf`);
        await setInvoicePdfUrl(invoiceId, pdfUrl);
      }
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
  revalidatePath(ROUTES.customerDetail(data.customer_id));
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

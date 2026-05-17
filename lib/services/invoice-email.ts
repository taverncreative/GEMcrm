import type { Customer, Invoice } from "@/types/database";
import { sendEmail } from "@/lib/services/email";
import { BUSINESS } from "@/lib/constants/branding";

function formatGbp(value: number): string {
  return `£${Number(value).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value: string | null): string {
  if (!value) return "the agreed date";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Pre-filled email draft used by the Xero-style approval step.
 * Signed off per the brand voice (Nate / GEM Services).
 */
export function buildInvoiceEmailDraft(
  customer: Customer,
  invoice: Invoice
): { subject: string; body: string } {
  const ref = invoice.invoice_number ?? invoice.id.slice(0, 8).toUpperCase();
  const firstName = customer.name.split(" ")[0] ?? customer.name;
  const total = formatGbp(Number(invoice.amount));

  const subject = `Invoice ${ref} from ${BUSINESS.name}`;
  const body = [
    `Hi ${firstName},`,
    "",
    `Please find attached your invoice ${ref} for ${total}.`,
    "",
    `Payment is due by ${formatDate(invoice.due_date)}. Bank transfer or cheque accepted — let me know if you need our bank details.`,
    "",
    "Any questions, just give me a shout.",
    "",
    "Thanks,",
    BUSINESS.signoffName,
    BUSINESS.name,
  ].join("\n");

  return { subject, body };
}

/**
 * Send an invoice via email. The PDF lives at a public Supabase storage
 * URL — we link to it inline rather than attaching the bytes (smaller mail,
 * one source of truth). The plain-text body becomes the email; Resend will
 * auto-generate a basic HTML wrapper from it.
 */
export async function sendInvoiceEmail(
  customer: Customer,
  invoice: Invoice,
  pdfUrl: string,
  override?: { subject?: string; body?: string }
): Promise<{ success: boolean; error?: string }> {
  if (!customer.email) {
    return { success: false, error: "Customer has no email" };
  }
  const defaults = buildInvoiceEmailDraft(customer, invoice);
  const subject = override?.subject ?? defaults.subject;
  const body = override?.body ?? defaults.body;

  // Add the PDF link as a final line so the recipient has a clickable URL
  // even when their client renders only plain text.
  const bodyWithLink = `${body}\n\nInvoice PDF: ${pdfUrl}`;

  return sendEmail({
    to: customer.email,
    subject,
    text: bodyWithLink,
  });
}

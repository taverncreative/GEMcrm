import { getInvoiceWithCustomer, setInvoicePdfUrl } from "@/lib/data/invoices";
import { generateInvoicePdf } from "@/lib/pdf/generate-invoice-pdf";
import { uploadPdf } from "@/lib/storage/upload";

/**
 * Render an invoice's PDF and store it in the public reports bucket.
 *
 * Single source of truth for the render → store step, shared by:
 *   - createInvoiceDraftAction  (modal create)
 *   - generateInvoicePdfAction  (manual "Generate PDF" backfill button)
 *   - onJobCompleted            (auto-invoice on job completion)
 *
 * Returns the public URL + the invoice's customer id (for revalidation),
 * or null when the invoice can't be found. Throws on a render/upload
 * failure — callers decide whether that's fatal (creation surfaces it) or
 * best-effort (the auto path swallows it and leaves the backfill button).
 *
 * `uploadPdf` upserts, so a re-run overwrites — this doubles as the
 * regenerate path after a template change.
 */
export async function renderAndStoreInvoicePdf(
  invoiceId: string
): Promise<{ pdfUrl: string; customerId: string } | null> {
  const detail = await getInvoiceWithCustomer(invoiceId);
  if (!detail) return null;

  const buf = await generateInvoicePdf({
    invoice: detail,
    customer: detail.customer,
  });
  const pdfUrl = await uploadPdf(buf, `invoices/${invoiceId}/invoice.pdf`);
  await setInvoicePdfUrl(invoiceId, pdfUrl);
  return { pdfUrl, customerId: detail.customer_id };
}

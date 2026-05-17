import type { Customer, Invoice } from "@/types/database";
import { renderInvoiceHtml } from "@/lib/pdf/templates/invoice-template";
import { htmlToPdf } from "@/lib/pdf/html-to-pdf";

interface InvoiceData {
  invoice: Invoice;
  customer: Customer;
}

export async function generateInvoicePdf({
  invoice,
  customer,
}: InvoiceData): Promise<Buffer> {
  const html = renderInvoiceHtml({ invoice, customer });
  return htmlToPdf(html);
}

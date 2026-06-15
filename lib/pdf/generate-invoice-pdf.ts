import type { Customer, Invoice, Site } from "@/types/database";
import { renderInvoiceHtml } from "@/lib/pdf/templates/invoice-template";
import { htmlToPdf } from "@/lib/pdf/html-to-pdf";

interface InvoiceData {
  invoice: Invoice;
  customer: Customer;
  site?: Site | null;
}

export async function generateInvoicePdf({
  invoice,
  customer,
  site,
}: InvoiceData): Promise<Buffer> {
  const html = renderInvoiceHtml({ invoice, customer, site });
  return htmlToPdf(html);
}

import type { Agreement, Site, Customer } from "@/types/database";
import { renderAgreementHtml } from "@/lib/pdf/templates/agreement-template";
import { htmlToPdf } from "@/lib/pdf/html-to-pdf";

interface AgreementReportData {
  agreement: Agreement;
  customer: Customer;
  site: Site;
}

export async function generateAgreementPdf({
  agreement,
  customer,
  site,
}: AgreementReportData): Promise<Buffer> {
  const html = renderAgreementHtml({ agreement, customer, site });
  return htmlToPdf(html);
}

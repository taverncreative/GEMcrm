import type { Agreement, Site, Customer } from "@/types/database";
import { renderAgreementHtml } from "@/lib/pdf/templates/agreement-template";
import { htmlToPdf } from "@/lib/pdf/html-to-pdf";

interface AgreementReportData {
  agreement: Agreement;
  customer: Customer;
  site: Site;
  /** "review" produces the unsigned watermarked copy (see renderAgreementHtml). */
  mode?: "signed" | "review";
}

export async function generateAgreementPdf({
  agreement,
  customer,
  site,
  mode = "signed",
}: AgreementReportData): Promise<Buffer> {
  const html = renderAgreementHtml({ agreement, customer, site, mode });
  return htmlToPdf(html);
}

import type { Job, Site, Customer } from "@/types/database";
import { renderJobReportHtml } from "@/lib/pdf/templates/job-report-template";
import { htmlToPdf } from "@/lib/pdf/html-to-pdf";

interface ReportData {
  job: Job;
  site: Site;
  customer: Customer;
}

export async function generateJobReport({
  job,
  site,
  customer,
}: ReportData): Promise<Buffer> {
  const html = renderJobReportHtml({ job, site, customer });
  return htmlToPdf(html);
}

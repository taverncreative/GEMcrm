import { getJobById } from "@/lib/data/jobs";
import { getSiteById } from "@/lib/data/sites";
import { getCustomerById } from "@/lib/data/customers";
import { renderJobReportHtml } from "@/lib/pdf/templates/job-report-template";
import { htmlToPdf } from "@/lib/pdf/html-to-pdf";
import { requireUser } from "@/lib/auth/require-user";
import { resolveSheetAddress } from "@/lib/documents/resolve-sheet-address";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Renders a PII PDF (customer name, address, findings, signatures); gate at
  // the route, not just the edge middleware. Matches reports/export/route.ts.
  await requireUser();
  const { id } = await params;

  const job = await getJobById(id);
  if (!job) {
    return new Response("Job not found", { status: 404 });
  }

  const site = await getSiteById(job.site_id);
  if (!site) {
    return new Response("Site not found", { status: 404 });
  }

  const customer = await getCustomerById(site.customer_id);
  if (!customer) {
    return new Response("Customer not found", { status: 404 });
  }

  // The printed address falls back to the customer's own address when the
  // job's site is bare (feat: sheet prefill) — same resolution the sheet
  // shows, so what prints matches what the operator saw.
  const resolved = resolveSheetAddress(site, customer);
  const siteForPdf =
    resolved.source === "customer"
      ? {
          ...site,
          address_line_1: resolved.address_line_1,
          address_line_2: resolved.address_line_2,
          town: resolved.town,
          county: resolved.county,
          postcode: resolved.postcode,
        }
      : site;

  const html = renderJobReportHtml({ job, site: siteForPdf, customer });
  const pdf = await htmlToPdf(html);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="service-report-${id.slice(0, 8)}.pdf"`,
    },
  });
}

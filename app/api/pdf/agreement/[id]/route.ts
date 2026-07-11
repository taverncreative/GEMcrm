import { getAgreementById } from "@/lib/data/agreements";
import { getSiteById } from "@/lib/data/sites";
import { getCustomerById } from "@/lib/data/customers";
import { renderAgreementHtml } from "@/lib/pdf/templates/agreement-template";
import { htmlToPdf } from "@/lib/pdf/html-to-pdf";
import { requireUser } from "@/lib/auth/require-user";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Renders a PII PDF (names, address, signatures, contract value); gate at
  // the route, not just the edge middleware. Matches reports/export/route.ts.
  await requireUser();
  const { id } = await params;

  const agreement = await getAgreementById(id);
  if (!agreement) {
    return new Response("Agreement not found", { status: 404 });
  }

  const site = await getSiteById(agreement.site_id);
  if (!site) {
    return new Response("Site not found", { status: 404 });
  }

  const customer = await getCustomerById(site.customer_id);
  if (!customer) {
    return new Response("Customer not found", { status: 404 });
  }

  const html = renderAgreementHtml({ agreement, customer, site });
  const pdf = await htmlToPdf(html);

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="agreement-${id.slice(0, 8)}.pdf"`,
    },
  });
}

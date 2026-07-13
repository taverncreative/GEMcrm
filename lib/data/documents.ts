import { createClient } from "@/lib/supabase/server";

export interface DocumentItem {
  id: string;
  kind: "invoice" | "service_sheet" | "agreement";
  title: string;
  reference: string | null;
  customer: { id: string; name: string; company_name: string | null } | null;
  url: string;
  date: string;
  /** Subtitle for the document, e.g. amount for an invoice. */
  subtitle?: string;
  /** Service-sheet only: site address one-liner (line 1 + town/postcode),
   *  so a row is distinguishable even when the job has no reference. */
  siteAddress?: string | null;
  /** Service-sheet only: pests recorded on the job. */
  pests?: string[];
  /** Renewal date on agreements; due date on invoices. Drives the badge. */
  renewalDate?: string | null;
  /** Driven by renewalDate: ok | upcoming (<=30d) | overdue. */
  renewalState?: "ok" | "upcoming" | "overdue" | null;
  /** Invoice-specific surface for the actions row. */
  invoiceId?: string;
  invoiceStatus?: "draft" | "sent" | "paid";
  invoiceDueDate?: string | null;
  invoiceOverdue?: boolean;
}

function classifyRenewal(
  date: string | null | undefined
): "ok" | "upcoming" | "overdue" | null {
  if (!date) return null;
  const due = new Date(date).getTime();
  const now = Date.now();
  const dayMs = 1000 * 60 * 60 * 24;
  const days = Math.ceil((due - now) / dayMs);
  if (days < 0) return "overdue";
  if (days <= 30) return "upcoming";
  return "ok";
}

function formatGbp(value: number): string {
  return `£${Number(value).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Pulls invoices, service-report PDFs, and agreement contract PDFs into a
 * single normalised list for the Reports → Documents view.
 *
 * Sorted newest first across all kinds. Caller can filter client-side.
 */
export async function getAllDocuments(): Promise<DocumentItem[]> {
  const supabase = await createClient();

  // Invoices — every row, whether or not it has a generated PDF. Without a
  // PDF we still show it (link disabled in the UI) so the user can see
  // there's a draft that needs the PDF re-generated.
  const { data: invoices } = await supabase
    .from("invoices")
    .select("id, invoice_number, amount, pdf_url, created_at, customer:customers(id, name, company_name)")
    .order("created_at", { ascending: false })
    .limit(200);

  // Service reports — only those with a generated PDF.
  const { data: reports } = await supabase
    .from("reports")
    .select("id, job_id, pdf_url, created_at, job:jobs(reference_number, job_date, pest_species, site:sites(address_line_1, town, postcode, customer:customers(id, name, company_name)))")
    .not("pdf_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);

  // Agreements — only those with a generated PDF.
  const { data: agreements } = await supabase
    .from("agreements")
    .select("id, reference_number, contract_pdf_url, created_at, end_date, customer:customers(id, name, company_name)")
    .not("contract_pdf_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);

  // Supabase types embedded relations as arrays since it can't tell 1:1
  // from 1:N at the type level. The FK on the FROM side is single-valued,
  // so we safely unwrap to the first element via this helper.
  type Joined<T> = T | T[] | null | undefined;
  function one<T>(v: Joined<T>): T | null {
    if (Array.isArray(v)) return v[0] ?? null;
    return v ?? null;
  }

  const items: DocumentItem[] = [];

  for (const inv of invoices ?? []) {
    const cust = one(
      (inv as unknown as { customer: Joined<{ id: string; name: string; company_name: string | null }> })
        .customer
    );
    // Surface invoice metadata so the documents list can render
    // pay / chase action buttons without a second round-trip.
    const dueDate = (inv as unknown as { due_date?: string | null }).due_date ?? null;
    const status = (inv as unknown as { status: string }).status;
    items.push({
      id: `inv-${inv.id}`,
      kind: "invoice",
      title: `Invoice ${inv.invoice_number ?? inv.id.slice(0, 8)}`,
      reference: inv.invoice_number ?? null,
      customer: cust,
      url: inv.pdf_url ?? "",
      date: inv.created_at,
      subtitle: formatGbp(Number(inv.amount)),
      invoiceId: inv.id,
      invoiceStatus: status as "draft" | "sent" | "paid",
      invoiceDueDate: dueDate,
      invoiceOverdue:
        status !== "paid" && dueDate
          ? new Date(dueDate).getTime() < Date.now()
          : false,
    });
  }

  for (const r of reports ?? []) {
    const job = one(
      (r as unknown as {
        job: Joined<{
          reference_number: string | null;
          job_date: string;
          pest_species: string[] | null;
          site: Joined<{
            address_line_1: string | null;
            town: string | null;
            postcode: string | null;
            customer: Joined<{ id: string; name: string; company_name: string | null }>;
          }>;
        }>;
      }).job
    );
    const site = one(job?.site);
    const cust = one(site?.customer);
    const ref = job?.reference_number ?? null;
    // Site one-liner: line 1 + town + postcode, whichever are present. This
    // is what keeps ref-less service sheets from all reading "Service Sheet".
    const siteAddress = site
      ? [site.address_line_1, site.town, site.postcode]
          .map((p) => p?.trim())
          .filter(Boolean)
          .join(", ") || null
      : null;
    items.push({
      id: `report-${r.id}`,
      kind: "service_sheet",
      title: ref ? `Service Sheet ${ref}` : "Service Sheet",
      reference: ref,
      customer: cust,
      url: r.pdf_url ?? "",
      date: r.created_at,
      subtitle: job?.job_date
        ? new Date(job.job_date).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : undefined,
      siteAddress,
      pests: job?.pest_species ?? [],
    });
  }

  for (const a of agreements ?? []) {
    const cust = one(
      (a as unknown as { customer: Joined<{ id: string; name: string; company_name: string | null }> })
        .customer
    );
    const endDate = (a as unknown as { end_date?: string | null }).end_date ?? null;
    const renewalState = classifyRenewal(endDate);
    items.push({
      id: `agreement-${a.id}`,
      kind: "agreement",
      title: `Agreement ${a.reference_number ?? a.id.slice(0, 8)}`,
      reference: a.reference_number ?? null,
      customer: cust,
      url: a.contract_pdf_url ?? "",
      date: a.created_at,
      subtitle: endDate
        ? `Renews ${new Date(endDate).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}`
        : undefined,
      renewalDate: endDate,
      renewalState,
    });
  }

  // Newest first across the union.
  items.sort((x, y) => y.date.localeCompare(x.date));
  return items;
}

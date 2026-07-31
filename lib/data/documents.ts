import { createClient } from "@/lib/supabase/server";
import { quoteRecipientEmail } from "@/lib/quotes/recipient";

export type DocumentKind = "invoice" | "service_sheet" | "agreement" | "quote";

export interface DocumentItem {
  /** Kind-prefixed and unique across the union ("quote-<uuid>") — the React
   *  key. Use `docId` for anything that has to address the underlying row. */
  id: string;
  /** The underlying row's own id, unprefixed — what the email action takes. */
  docId: string;
  kind: DocumentKind;
  title: string;
  reference: string | null;
  customer: { id: string; name: string; company_name: string | null } | null;
  url: string;
  date: string;
  /** A ready-to-use link, used VERBATIM (bypasses proxyAssetUrl) when the doc
   *  is served by an app route rather than a stored storage object. Quotes set
   *  this to their on-demand /api/pdf/quote/[id] route, which renders the PDF
   *  lazily — so the Open link works even before any PDF has been generated. */
  href?: string;
  /** Quote only: the denormalised bill-to name, so a prospect quote (no
   *  linked customer row) still shows who it is for on the row. */
  partyName?: string | null;
  /** Default address for the Email action, resolved server-side. Set for
   *  quotes (their own bill-to address, else the linked customer's) — the
   *  only prefill a PROSPECT quote can have, since it has no customer row to
   *  look up. Other kinds leave it undefined and fall back to fetching the
   *  linked customer client-side. */
  recipientEmail?: string | null;
  /** Subtitle for the document, e.g. amount for an invoice. */
  subtitle?: string;
  /** Service-sheet only: site address one-liner (line 1 + town/postcode),
   *  so a row is distinguishable even when the job has no reference. */
  siteAddress?: string | null;
  /** Service-sheet only: pests recorded on the job. */
  pests?: string[];
  /** Service-sheet only: the job this sheet was produced from was
   *  soft-deleted (or is missing outright). The sheet DELIBERATELY stays in
   *  the list with all its detail intact — it is the record of work
   *  performed — and the row carries a "Job deleted" chip so it reads as
   *  orphaned rather than broken. Drives that chip. */
  jobDeleted?: boolean;
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

/** One row of `list_report_documents` (migration 049) — a report with its
 *  job/site/customer already resolved owner-side, so a soft-deleted job's
 *  sheet keeps every detail a live one has. */
interface ReportDocumentRow {
  id: string;
  created_at: string;
  pdf_url: string | null;
  job_id: string;
  job_deleted: boolean;
  reference_number: string | null;
  job_date: string | null;
  pest_species: string[] | null;
  site_address_line_1: string | null;
  site_town: string | null;
  site_postcode: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_company_name: string | null;
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

  // Service reports — only live rows (deleted_at is null) with a generated
  // PDF, via the `list_report_documents` SECURITY DEFINER RPC (migration
  // 049) rather than a PostgREST embed.
  //
  // WHY THE RPC: the embed this replaced — `job:jobs(...site(...customer))`
  // — is a LEFT join, and the jobs SELECT policy filters
  // `deleted_at IS NULL`. So the moment a job was soft-deleted its report
  // survived but the embed came back NULL, and the row rendered as an
  // anonymous "Service Sheet" with no reference, customer, site or date.
  //
  // A soft-deleted job's sheet MUST stay visible WITH its details — it is
  // the record of work performed (John's call) — so the fix is a read that
  // can see past that policy, not an `!inner` join that would hide the row.
  // The RPC runs as owner, resolves job/site/customer regardless of the
  // job's soft-delete, and returns `job_deleted` to drive the UI chip.
  const { data: reports, error: reportsError } = await supabase.rpc(
    "list_report_documents",
    { p_limit: 200 }
  );
  if (reportsError) {
    console.error("[getAllDocuments] reports", reportsError.code, reportsError.message);
  }

  // Agreements — only those with a generated PDF.
  const { data: agreements } = await supabase
    .from("agreements")
    .select("id, reference_number, contract_pdf_url, created_at, end_date, customer:customers(id, name, company_name)")
    .not("contract_pdf_url", "is", null)
    // A draft's contract_pdf_url holds its UNSIGNED review copy, which is not
    // a filed document — keep drafts out of the Documents list.
    .neq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(200);

  // Quotes — every live quote. Unlike agreement drafts, a quote's PDF IS the
  // real document from the moment it is created, so drafts are included.
  const { data: quotes } = await supabase
    .from("quotes")
    // `email` on the join is the fallback for the Email action's prefill; it
    // is read for recipientEmail below and deliberately not surfaced on the
    // row's `customer` object, which stays {id, name, company_name}.
    .select("id, quote_number, total, quote_pdf_url, created_at, customer_name, customer_email, customer:customers(id, name, company_name, email)")
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
      docId: inv.id,
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

  // The RPC returns one flat row per report — job/site/customer already
  // resolved owner-side — so there is no embed to unwrap here. A row whose
  // job is soft-deleted carries exactly the same detail as a live one; only
  // `job_deleted` differs.
  for (const r of (reports ?? []) as ReportDocumentRow[]) {
    const ref = r.reference_number ?? null;
    // Site one-liner: line 1 + town + postcode, whichever are present. This
    // is what keeps ref-less service sheets from all reading "Service Sheet".
    const siteAddress =
      [r.site_address_line_1, r.site_town, r.site_postcode]
        .map((p) => p?.trim())
        .filter(Boolean)
        .join(", ") || null;
    items.push({
      id: `report-${r.id}`,
      docId: r.id,
      kind: "service_sheet",
      title: ref ? `Service Sheet ${ref}` : "Service Sheet",
      reference: ref,
      customer: r.customer_id
        ? {
            id: r.customer_id,
            name: r.customer_name ?? "",
            company_name: r.customer_company_name,
          }
        : null,
      url: r.pdf_url ?? "",
      date: r.created_at,
      subtitle: r.job_date
        ? new Date(r.job_date).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : undefined,
      siteAddress,
      pests: r.pest_species ?? [],
      jobDeleted: r.job_deleted,
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
      docId: a.id,
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

  for (const q of quotes ?? []) {
    const custRow = one(
      (q as unknown as {
        customer: Joined<{
          id: string;
          name: string;
          company_name: string | null;
          email: string | null;
        }>;
      }).customer
    );
    // Keep the row's customer object to the shape every other kind uses; the
    // joined email is only for the prefill resolved just below.
    const cust = custRow
      ? {
          id: custRow.id,
          name: custRow.name,
          company_name: custRow.company_name,
        }
      : null;
    const partyName = (q as unknown as { customer_name: string }).customer_name;
    items.push({
      id: `quote-${q.id}`,
      docId: q.id,
      kind: "quote",
      title: `Quote ${q.quote_number ?? q.id.slice(0, 8)}`,
      reference: q.quote_number ?? null,
      customer: cust,
      partyName,
      recipientEmail: quoteRecipientEmail(
        (q as unknown as { customer_email: string | null }).customer_email,
        custRow?.email
      ),
      // PDF is generated lazily; link at the on-demand route, not the (possibly
      // still-null) stored URL, so Open always works.
      url: (q as unknown as { quote_pdf_url: string | null }).quote_pdf_url ?? "",
      href: `/api/pdf/quote/${q.id}`,
      date: q.created_at,
      subtitle: formatGbp(Number((q as unknown as { total: number }).total)),
    });
  }

  // Newest first across the union.
  items.sort((x, y) => y.date.localeCompare(x.date));
  return items;
}

export interface DocumentForEmail {
  kind: DocumentKind;
  id: string;
  /** The stored PDF, or null when none has been rendered yet. Quotes are
   *  lazy by design (rendered on first download); a legacy auto-invoice can
   *  also have none. The caller generates in that case — see
   *  emailDocumentAction. */
  pdfUrl: string | null;
  /** Names the document in the email subject/body, e.g. "Quote QUO-1042". */
  label: string;
  /** Attachment filename. */
  fileName: string;
}

/** Filesystem/mail-client-safe filename from a document label. */
function attachmentFileName(label: string): string {
  return `${label.replace(/[\\/:*?"<>|]+/g, " ").trim()}.pdf`;
}

/**
 * Look up ONE document by kind + row id, resolved to what an email needs:
 * where its PDF is (or that there isn't one yet) and what to call it.
 *
 * The kinds live in four different tables with four different PDF columns,
 * so this is the one place that mapping is written down — the same job
 * getAllDocuments does for the list, for a single row.
 */
export async function getDocumentForEmail(
  kind: DocumentKind,
  id: string
): Promise<DocumentForEmail | null> {
  const supabase = await createClient();

  if (kind === "service_sheet") {
    // Via the `get_report_document` definer RPC (migration 049), NOT a jobs
    // embed — the embed is subject to the jobs SELECT policy, so an orphaned
    // sheet resolved to a null job and the attachment fell back to a bare
    // "Service Sheet" while its Documents ROW read "Service Sheet 00091".
    // The row and the emailed file must agree. The RPC also enforces
    // `deleted_at is null`, so a soft-deleted sheet can't be emailed from a
    // stale open dialog.
    const { data, error } = await supabase.rpc("get_report_document", {
      p_id: id,
    });
    if (error) {
      console.error("[getDocumentForEmail] report", error.code, error.message);
      return null;
    }
    const row = (
      data as
        | {
            pdf_url: string | null;
            reference_number: string | null;
            job_date: string | null;
          }[]
        | null
    )?.[0];
    if (!row) return null;
    const ref = row.reference_number ?? null;
    const label = ref
      ? `Service Sheet ${ref}`
      : row.job_date
        ? `Service Sheet ${new Date(row.job_date).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}`
        : "Service Sheet";
    return {
      kind,
      id,
      pdfUrl: row.pdf_url ?? null,
      label,
      fileName: attachmentFileName(label),
    };
  }

  if (kind === "agreement") {
    const { data } = await supabase
      .from("agreements")
      .select("id, reference_number, contract_pdf_url")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    const label = `Agreement ${data.reference_number ?? data.id.slice(0, 8)}`;
    return {
      kind,
      id,
      pdfUrl: data.contract_pdf_url ?? null,
      label,
      fileName: attachmentFileName(label),
    };
  }

  if (kind === "quote") {
    const { data } = await supabase
      .from("quotes")
      .select("id, quote_number, quote_pdf_url")
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    const label = `Quote ${data.quote_number ?? data.id.slice(0, 8)}`;
    return {
      kind,
      id,
      pdfUrl: data.quote_pdf_url ?? null,
      label,
      fileName: attachmentFileName(label),
    };
  }

  const { data } = await supabase
    .from("invoices")
    .select("id, invoice_number, pdf_url")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const label = `Invoice ${data.invoice_number ?? data.id.slice(0, 8)}`;
  return {
    kind,
    id,
    pdfUrl: data.pdf_url ?? null,
    label,
    fileName: attachmentFileName(label),
  };
}

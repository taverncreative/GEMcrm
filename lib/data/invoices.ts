import { createClient } from "@/lib/supabase/server";
import { todayUk, dateUkOffset } from "@/lib/utils/today-uk";
import { newId } from "@/lib/utils/id";
import { invoiceVatFields } from "@/lib/utils/vat";
import { BUSINESS } from "@/lib/constants/branding";
import type { Invoice, InvoiceStatus, Customer } from "@/types/database";

// Invoice numbering is assigned by the assign_invoice_number DB trigger
// (migration 037): one unified INV-YYYY-NNNN series sourced from the
// invoice_number_seq sequence, applied to every creation path. The old
// app-side nextInvoiceNumber() (JS max+1, race-prone) and the single-job
// job-ref reuse are both gone — the register is now its own sequential
// series, which a VAT invoice register must be.

/**
 * Create an invoice for a completed job.
 * Marks the job as invoiced.
 */
export async function createInvoiceForJob(
  jobId: string,
  customerId: string,
  amount: number
): Promise<Invoice> {
  const supabase = await createClient();

  // job.value is the gross price. VAT is flag-gated (BUSINESS.vatRegistered):
  // not registered → no VAT, amount is the total; registered → 20% split.
  // due_date + numbering (DB trigger) now match a manual invoice, so an
  // auto-invoice comes out complete instead of bare.
  const vat = invoiceVatFields(amount, BUSINESS.vatRegistered);

  const { data, error } = await supabase
    .from("invoices")
    .insert({
      id: newId(),
      job_id: jobId,
      customer_id: customerId,
      amount: vat.amount,
      subtotal_amount: vat.subtotal_amount,
      vat_amount: vat.vat_amount,
      vat_rate: vat.vat_rate,
      due_date: dateUkOffset(30),
      status: "draft",
    })
    .select()
    .single();

  if (error) {
    console.error("[createInvoiceForJob]", error.code, error.message);
    throw new Error(`Failed to create invoice: ${error.message}`);
  }

  // Canonical job link (031). Best-effort like the flag update below —
  // the legacy job_id column on the row above keeps old readers working.
  const { error: linkErr } = await supabase
    .from("invoice_jobs")
    .insert({ invoice_id: data.id, job_id: jobId });
  if (linkErr) {
    console.error("[createInvoiceForJob] link failed:", linkErr.message);
  }

  // Mark job as invoiced
  const { error: jobErr } = await supabase
    .from("jobs")
    .update({ is_invoiced: true })
    .eq("id", jobId);

  if (jobErr) {
    console.error("[createInvoiceForJob] job update failed:", jobErr.message);
  }

  return data;
}

/**
 * Mark an invoice as sent.
 */
export async function markInvoiceSent(invoiceId: string): Promise<Invoice> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("invoices")
    .update({ status: "sent", issued_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .select()
    .single();

  if (error) {
    console.error("[markInvoiceSent]", error.code, error.message);
    throw new Error(`Failed to mark invoice sent: ${error.message}`);
  }

  return data;
}

/**
 * Mark an invoice as paid. Also marks the linked job as paid.
 */
export async function markInvoicePaid(invoiceId: string): Promise<Invoice> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("invoices")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .select()
    .single();

  if (error) {
    console.error("[markInvoicePaid]", error.code, error.message);
    throw new Error(`Failed to mark invoice paid: ${error.message}`);
  }

  // Fan is_paid out over the invoice's jobs. invoice_jobs is the
  // canonical link (031); the legacy invoices.job_id covers rows that
  // pre-date it.
  const { data: links, error: linkErr } = await supabase
    .from("invoice_jobs")
    .select("job_id")
    .eq("invoice_id", invoiceId);
  if (linkErr) {
    console.error("[markInvoicePaid] link lookup failed:", linkErr.message);
  }
  const jobIds = (links ?? []).map((l) => l.job_id);
  if (jobIds.length === 0 && data.job_id) {
    jobIds.push(data.job_id);
  }

  if (jobIds.length > 0) {
    const { error: jobErr } = await supabase
      .from("jobs")
      .update({ is_paid: true })
      .in("id", jobIds);

    if (jobErr) {
      console.error("[markInvoicePaid] job update failed:", jobErr.message);
    }
  }

  return data;
}

/**
 * Get invoice by job ID.
 */
export async function getInvoiceByJobId(
  jobId: string
): Promise<Invoice | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("job_id", jobId)
    .maybeSingle();

  if (error) {
    console.error("[getInvoiceByJobId]", error.code, error.message);
    return null;
  }

  return data;
}

/**
 * Batched job → invoice-status lookup for the Jobs list chips.
 *
 * Sources, canonical first:
 *   1. invoice_jobs join rows (031) — every invoice created since the
 *      multi-job pass, including multi-job ones.
 *   2. legacy invoices.job_id — rows that pre-date the join table.
 *
 * Jobs with no invoice simply aren't in the returned map. unique(job_id)
 * means a job can't sit on two invoices, so there's no merge ambiguity —
 * where both sources have the job they describe the same invoice, and
 * the join row wins only by overwrite order.
 */
export async function getInvoiceStatusByJobIds(
  jobIds: string[]
): Promise<Record<string, InvoiceStatus>> {
  const out: Record<string, InvoiceStatus> = {};
  if (jobIds.length === 0) return out;
  const supabase = await createClient();

  const [legacy, links] = await Promise.all([
    supabase.from("invoices").select("job_id, status").in("job_id", jobIds),
    supabase
      .from("invoice_jobs")
      .select("job_id, invoice:invoices!inner(status)")
      .in("job_id", jobIds),
  ]);

  if (legacy.error) {
    console.error("[getInvoiceStatusByJobIds] legacy:", legacy.error.message);
  }
  for (const row of legacy.data ?? []) {
    if (row.job_id) out[row.job_id] = row.status as InvoiceStatus;
  }

  if (links.error) {
    console.error("[getInvoiceStatusByJobIds] links:", links.error.message);
  }
  for (const row of links.data ?? []) {
    // PostgREST may embed the 1:1 relation as an object or 1-element array.
    const inv = Array.isArray(row.invoice) ? row.invoice[0] : row.invoice;
    if (inv) out[row.job_id] = inv.status as InvoiceStatus;
  }

  return out;
}

/**
 * Standalone invoice creation — covers zero, one, or MANY jobs.
 *
 * VAT is derived from the gross `total`, gated on BUSINESS.vatRegistered
 * (not registered → no VAT; registered → 20% standard-rated split) — the
 * caller's `subtotal` / `vat_amount` / `vat_rate` are advisory only, so
 * every creation path is identical.
 *
 * Jobs: `job_ids` is the canonical input (031); `job_id` is the deprecated
 * single-job path, still honoured for legacy callers. When jobs are
 * supplied the invoice's customer is DERIVED server-side (job → site →
 * customer) and a mixed-customer selection is rejected — the
 * client-supplied `customer_id` is only used for the no-job path.
 *
 * Invoice number: assigned by the assign_invoice_number DB trigger
 * (migration 037) — one unified INV-YYYY-NNNN series across all paths.
 */
export interface StandaloneInvoiceInput {
  /** Required when no jobs are supplied; ignored (derived) otherwise. */
  customer_id?: string;
  /** DEPRECATED — single-job path kept for legacy callers. `job_ids`
   *  wins when both are set. */
  job_id?: string | null;
  /** Jobs this invoice covers. All must belong to the same customer. */
  job_ids?: string[];
  subtotal: number;
  vat_amount: number;
  total: number;
  vat_rate: number;
  description?: string;
  due_date?: string | null;
  status?: "draft" | "sent";
}

/** PostgREST returns an embedded 1:1 relation as an object or a
 *  1-element array depending on version — normalise to the id. */
function embeddedSiteCustomerId(row: {
  site: { customer_id: string } | { customer_id: string }[] | null;
}): string {
  const site = Array.isArray(row.site) ? row.site[0] : row.site;
  if (!site) throw new Error("Job has no site — cannot derive its customer");
  return site.customer_id;
}

export async function createStandaloneInvoice(
  input: StandaloneInvoiceInput
): Promise<Invoice> {
  const supabase = await createClient();

  // Normalise the two job inputs into one de-duplicated list.
  const jobIds = Array.from(
    new Set(
      input.job_ids && input.job_ids.length > 0
        ? input.job_ids
        : input.job_id
          ? [input.job_id]
          : []
    )
  );

  interface JobRow {
    id: string;
    reference_number: string | null;
    site_id: string;
    is_invoiced: boolean;
    site: { customer_id: string } | { customer_id: string }[] | null;
  }
  let jobRows: JobRow[] = [];
  let customerId = input.customer_id || null;

  if (jobIds.length > 0) {
    const { data, error } = await supabase
      .from("jobs")
      .select(
        "id, reference_number, site_id, is_invoiced, site:sites!inner(customer_id)"
      )
      .in("id", jobIds);
    if (error) {
      console.error(
        "[createStandaloneInvoice] job lookup:",
        error.code,
        error.message
      );
      throw new Error(`Failed to look up selected jobs: ${error.message}`);
    }
    jobRows = (data ?? []) as unknown as JobRow[];
    if (jobRows.length !== jobIds.length) {
      throw new Error("One or more selected jobs could not be found.");
    }

    const alreadyInvoiced = jobRows.filter((j) => j.is_invoiced);
    if (alreadyInvoiced.length > 0) {
      const refs = alreadyInvoiced
        .map((j) => j.reference_number ?? j.id.slice(0, 8).toUpperCase())
        .join(", ");
      throw new Error(`Already invoiced: ${refs}. Deselect and try again.`);
    }

    const customerIds = new Set(jobRows.map(embeddedSiteCustomerId));
    if (customerIds.size > 1) {
      throw new Error(
        "Selected jobs belong to different customers — one invoice covers exactly one customer."
      );
    }
    // Derived customer wins over anything the client sent.
    customerId = [...customerIds][0];
  }

  if (!customerId) {
    throw new Error("Customer is required");
  }

  // Numbering: insert with no invoice_number — the assign_invoice_number
  // DB trigger fills it from the unified INV-YYYY-NNNN series (migration
  // 037), and .select() below reads it back. Job references stay on the
  // job and are no longer reused as the invoice number.
  //
  // VAT is flag-gated on BUSINESS.vatRegistered and recomputed from the
  // gross total so every path is identical (the caller's subtotal/vat
  // fields are advisory). Not registered → no VAT; registered → 20%
  // standard-rated split.
  const vat = invoiceVatFields(input.total, BUSINESS.vatRegistered);
  const issuedAt = input.status === "sent" ? new Date().toISOString() : null;
  const dueDate = input.due_date ?? dateUkOffset(30);

  const { data, error } = await supabase
    .from("invoices")
    .insert({
      id: newId(),
      customer_id: customerId,
      // Legacy column (deprecated, 031): dual-written for single-job
      // invoices so pre-031 readers (getInvoiceByJobId, the paid
      // fallback) keep working. Multi-job invoices have no single
      // owner — null; invoice_jobs is the canonical link either way.
      job_id: jobIds.length === 1 ? jobIds[0] : null,
      amount: vat.amount,
      subtotal_amount: vat.subtotal_amount,
      vat_amount: vat.vat_amount,
      vat_rate: vat.vat_rate,
      description: input.description?.trim() || null,
      due_date: dueDate,
      // invoice_number omitted — assigned by the assign_invoice_number trigger.
      status: input.status ?? "draft",
      issued_at: issuedAt,
    })
    .select()
    .single();

  if (error) {
    console.error("[createStandaloneInvoice]", error.code, error.message);
    throw new Error(`Failed to create invoice: ${error.message}`);
  }

  if (jobIds.length > 0) {
    const { error: linkErr } = await supabase
      .from("invoice_jobs")
      .insert(jobIds.map((job_id) => ({ invoice_id: data.id, job_id })));
    if (linkErr) {
      // No transactions over PostgREST — compensate by deleting the
      // invoice (cascade clears any links that did land) so a failed
      // create never leaves a half-linked invoice behind.
      console.error(
        "[createStandaloneInvoice] links:",
        linkErr.code,
        linkErr.message
      );
      await supabase.from("invoices").delete().eq("id", data.id);
      throw new Error(
        linkErr.code === "23505"
          ? "A selected job is already on another invoice."
          : `Failed to link jobs to invoice: ${linkErr.message}`
      );
    }

    const { error: jobErr } = await supabase
      .from("jobs")
      .update({ is_invoiced: true })
      .in("id", jobIds);
    if (jobErr) {
      // Best-effort, as before: the invoice + links exist; is_invoiced
      // is derived state and can be repaired.
      console.error(
        "[createStandaloneInvoice] job update failed:",
        jobErr.message
      );
    }
  }

  return data;
}

/**
 * Save a generated PDF URL onto an existing invoice.
 */
export async function setInvoicePdfUrl(
  invoiceId: string,
  pdfUrl: string
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("invoices")
    .update({ pdf_url: pdfUrl })
    .eq("id", invoiceId);
  if (error) {
    console.error("[setInvoicePdfUrl]", error.code, error.message);
    throw new Error(`Failed to save invoice PDF URL: ${error.message}`);
  }
}

/**
 * Count of invoices per customer for the customers list column.
 * Returns a map { customer_id → count }.
 */
export async function getInvoiceCountsByCustomer(
  customerIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (customerIds.length === 0) return counts;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("customer_id")
    .in("customer_id", customerIds);
  if (error) {
    console.error("[getInvoiceCountsByCustomer]", error.code, error.message);
    return counts;
  }
  for (const row of data ?? []) {
    counts.set(row.customer_id, (counts.get(row.customer_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Invoice + the customer + the optional job that produced it. Used by the
 * PDF generator.
 */
export interface InvoiceWithCustomer extends Invoice {
  customer: Customer;
}

export async function getInvoiceWithCustomer(
  id: string
): Promise<InvoiceWithCustomer | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*, customer:customers!inner(*)")
    .eq("id", id)
    .single();
  if (error) {
    if (error.code === "PGRST116") return null;
    console.error("[getInvoiceWithCustomer]", error.code, error.message);
    return null;
  }
  return data as unknown as InvoiceWithCustomer;
}

/**
 * Get all unpaid invoices (draft + sent).
 */
export async function getUnpaidInvoices(): Promise<Invoice[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .neq("status", "paid")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getUnpaidInvoices]", error.code, error.message);
    throw new Error(`Failed to fetch unpaid invoices: ${error.message}`);
  }

  return data;
}

/**
 * Get invoices for a customer.
 */
export async function getInvoicesByCustomer(
  customerId: string
): Promise<Invoice[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getInvoicesByCustomer]", error.code, error.message);
    throw new Error(`Failed to fetch invoices: ${error.message}`);
  }

  return data;
}

export interface RevenueStats {
  revenueToday: number;
  unpaidJobsCount: number;
  unpaidInvoicesTotal: number;
  /** Paid invoices total since 1 Jan of the current year. */
  revenueYtd: number;
  /** YTD paid revenue split by customer type. */
  revenueYtdCommercial: number;
  revenueYtdDomestic: number;
  /** Sum of active PMA contract_value — annual committed commercial revenue. */
  commercialCommittedAnnual: number;
}

/**
 * Dashboard revenue statistics.
 */
export async function getRevenueStats(): Promise<RevenueStats> {
  const supabase = await createClient();
  const today = todayUk();
  // Year boundary in UK time (Jan 1 in the UK, even if server is mid-year UTC).
  const yearStart = `${todayUk().slice(0, 4)}-01-01`;

  // Revenue today: sum of paid invoices where paid_at is today
  const { data: paidToday, error: e1 } = await supabase
    .from("invoices")
    .select("amount")
    .eq("status", "paid")
    .gte("paid_at", `${today}T00:00:00`)
    .lte("paid_at", `${today}T23:59:59`);
  if (e1) console.error("[getRevenueStats] paidToday:", e1.message);
  const revenueToday = (paidToday ?? []).reduce(
    (s, inv) => s + Number(inv.amount),
    0
  );

  // Year-to-date paid invoices with customer type joined in so we can split
  // commercial vs domestic in JS without a second query.
  const { data: paidYtd, error: e2 } = await supabase
    .from("invoices")
    .select("amount, customer:customers!inner(customer_type)")
    .eq("status", "paid")
    .gte("paid_at", `${yearStart}T00:00:00`);
  if (e2) console.error("[getRevenueStats] paidYtd:", e2.message);

  let revenueYtd = 0;
  let revenueYtdCommercial = 0;
  let revenueYtdDomestic = 0;
  for (const row of paidYtd ?? []) {
    const amt = Number(row.amount);
    revenueYtd += amt;
    // PostgREST returns the embedded relation as an array even for 1:1 — pick first.
    const cust = Array.isArray((row as { customer: unknown }).customer)
      ? ((row as unknown as { customer: { customer_type: string }[] }).customer[0] ?? null)
      : ((row as unknown as { customer: { customer_type: string } | null }).customer ?? null);
    if (cust?.customer_type === "commercial") revenueYtdCommercial += amt;
    else if (cust?.customer_type === "domestic") revenueYtdDomestic += amt;
  }

  // Active commercial PMAs — sum of annual contract values gives a forward-
  // looking committed commercial revenue figure.
  const { data: pmaRows, error: e3 } = await supabase
    .from("agreements")
    .select("contract_value, customer:customers!inner(customer_type)")
    .eq("status", "active");
  if (e3) console.error("[getRevenueStats] pmas:", e3.message);

  let commercialCommittedAnnual = 0;
  for (const row of pmaRows ?? []) {
    const cust = Array.isArray((row as { customer: unknown }).customer)
      ? ((row as unknown as { customer: { customer_type: string }[] }).customer[0] ?? null)
      : ((row as unknown as { customer: { customer_type: string } | null }).customer ?? null);
    if (cust?.customer_type === "commercial") {
      commercialCommittedAnnual += Number(row.contract_value ?? 0);
    }
  }

  // Unpaid jobs + unpaid invoices total (unchanged)
  const { count: unpaidJobsCount } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("job_status", "completed")
    .eq("is_paid", false);

  const { data: unpaidInvs } = await supabase
    .from("invoices")
    .select("amount")
    .neq("status", "paid");

  const unpaidInvoicesTotal = (unpaidInvs ?? []).reduce(
    (s, inv) => s + Number(inv.amount),
    0
  );

  return {
    revenueToday,
    unpaidJobsCount: unpaidJobsCount ?? 0,
    unpaidInvoicesTotal,
    revenueYtd,
    revenueYtdCommercial,
    revenueYtdDomestic,
    commercialCommittedAnnual,
  };
}
